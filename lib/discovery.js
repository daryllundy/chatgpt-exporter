/**
 * Conversation Discovery
 *
 * Responsible for building the list of conversation IDs and metadata
 * for all three export scopes: current, selected, full.
 *
 * All discovery functions run inside the content script (chatgpt.com page context)
 * and can therefore access the page DOM and authenticated fetch credentials.
 */

import { logger } from "./logger.js";

const HISTORY_API = "https://chatgpt.com/backend-api/conversations";
const CONV_API    = "https://chatgpt.com/backend-api/conversation";

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Discover conversation IDs and metadata for the given export scope.
 *
 * @param {"current"|"selected"|"full"} scope
 * @param {string[]} [explicitIds] – required when scope === "selected"
 * @param {(ids: string[]) => void} [onProgress]
 * @returns {Promise<ConversationMeta[]>}
 */
export async function discoverConversations(scope, explicitIds, onProgress) {
  if (scope === "selected" && Array.isArray(explicitIds) && explicitIds.length > 0) {
    return explicitIds.map((id) => makeMinimalMeta(id));
  }
  if (scope === "current") {
    const meta = await discoverCurrentChat();
    if (meta) return [meta];
    return [];
  }
  if (scope === "full") {
    return fetchAllConversationMeta(onProgress);
  }
  return [];
}

/**
 * Present the in-page conversation selector overlay and resolve with the
 * list of IDs the user checked before clicking "Export selected".
 *
 * @returns {Promise<string[]>}
 */
export function promptConversationSelection() {
  return new Promise((resolve) => {
    const overlay = buildSelectorOverlay(resolve);
    document.body.appendChild(overlay);
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ConversationMeta
 * @property {string}      id
 * @property {string}      title
 * @property {number|null} updatedAt   – Unix timestamp (seconds)
 * @property {string|null} customGptName
 */

// ─── Discovery Implementations ────────────────────────────────────────────────

/**
 * Determine the current chat from the URL path (/c/<id>).
 * Falls back to fetching recent history and picking the first item.
 * @returns {Promise<ConversationMeta|null>}
 */
async function discoverCurrentChat() {
  const match = window.location.pathname.match(/\/c\/([a-z0-9-]+)/i);
  if (match) {
    const id = match[1];
    // Enrich with API metadata if available
    try {
      const resp = await fetch(`${CONV_API}/${id}`, { credentials: "include" });
      if (resp.ok) {
        const data = await resp.json();
        return normalizeMeta(data);
      }
    } catch {
      logger.warn("Could not fetch conversation metadata for", id);
    }
    return makeMinimalMeta(id);
  }
  logger.warn("Could not determine current chat ID from URL");
  return null;
}

/**
 * Paginate through /conversations to collect all conversation metadata.
 * @param {(ids: string[]) => void} [onProgress]
 * @returns {Promise<ConversationMeta[]>}
 */
async function fetchAllConversationMeta(onProgress) {
  const all = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const url = `${HISTORY_API}?offset=${offset}&limit=${limit}&order=updated`;
    let data;
    try {
      const resp = await fetch(url, { credentials: "include" });
      if (!resp.ok) {
        logger.error("History API returned", resp.status);
        break;
      }
      data = await resp.json();
    } catch (err) {
      logger.error("History API fetch error", err);
      break;
    }

    const items = Array.isArray(data?.items) ? data.items : [];
    for (const item of items) {
      const meta = normalizeMeta(item);
      if (meta) all.push(meta);
    }

    onProgress?.(all.map((m) => m.id));

    if (items.length < limit) break;
    offset += limit;
  }

  logger.info(`discoverAllConversations: found ${all.length} conversation(s)`);
  return all;
}

// ─── Normalisation ────────────────────────────────────────────────────────────

/**
 * Normalize a raw API item into a canonical ConversationMeta object.
 * @param {*} raw
 * @returns {ConversationMeta|null}
 */
function normalizeMeta(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || raw.conversation_id || "").trim();
  if (!id) return null;

  const title = String(raw.title || "Untitled Chat").trim();
  const updatedAt = toUnixSeconds(raw.update_time ?? raw.updatedAt ?? raw.updated_at ?? null);
  const customGptName = raw.gizmo_id
    ? String(raw.meta?.gizmo?.display?.name ?? raw.gizmo_id)
    : null;

  return { id, title, updatedAt, customGptName };
}

/**
 * Minimal fallback when we only know the ID.
 * @param {string} id
 * @returns {ConversationMeta}
 */
function makeMinimalMeta(id) {
  return { id, title: "Untitled Chat", updatedAt: null, customGptName: null };
}

/**
 * Coerce a raw timestamp value to Unix seconds (integer) or null.
 * ChatGPT's API can return a float (seconds since epoch) or ISO string.
 * @param {*} raw
 * @returns {number|null}
 */
function toUnixSeconds(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return Math.floor(raw);
  if (typeof raw === "string") {
    const n = Date.parse(raw);
    return Number.isNaN(n) ? null : Math.floor(n / 1000);
  }
  return null;
}

// ─── In-page Conversation Selector Overlay ────────────────────────────────────

/**
 * Build the sidebar overlay DOM element for manual conversation selection.
 * @param {(ids: string[]) => void} onConfirm
 * @returns {HTMLElement}
 */
function buildSelectorOverlay(onConfirm) {
  const overlay = document.createElement("div");
  overlay.id = "cgpt-exporter-selector";
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 99999;
    background: rgba(0,0,0,0.55);
    display: flex; align-items: flex-start; justify-content: flex-end;
    font-family: "Segoe UI", sans-serif;
  `;

  const panel = document.createElement("div");
  panel.style.cssText = `
    width: 340px; height: 100vh;
    background: #fff; color: #111;
    display: flex; flex-direction: column;
    box-shadow: -4px 0 20px rgba(0,0,0,0.3);
  `;

  const header = document.createElement("div");
  header.style.cssText = `
    padding: 14px 16px; border-bottom: 1px solid #e5e7eb;
    font-weight: 600; font-size: 15px;
  `;
  header.textContent = "Select conversations to export";

  const list = document.createElement("ul");
  list.style.cssText = `flex: 1; overflow-y: auto; margin: 0; padding: 8px 0; list-style: none;`;

  // Discover sidebar items from ChatGPT's existing navigation
  const sidebarLinks = Array.from(
    document.querySelectorAll('a[href^="/c/"]')
  );
  const seen = new Set();
  for (const link of sidebarLinks) {
    const href = link.getAttribute("href") || "";
    const m = href.match(/\/c\/([a-z0-9-]+)/i);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);

    const id = m[1];
    const label = link.textContent?.trim() || id;

    const li = document.createElement("li");
    li.style.cssText = `display: flex; align-items: center; gap: 10px; padding: 8px 16px; cursor: pointer;`;

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = id;
    cb.id = `cgpt-sel-${id}`;
    cb.style.cursor = "pointer";

    const lbl = document.createElement("label");
    lbl.htmlFor = `cgpt-sel-${id}`;
    lbl.textContent = label;
    lbl.style.cssText = `cursor: pointer; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;

    li.appendChild(cb);
    li.appendChild(lbl);
    li.addEventListener("click", (e) => {
      if (e.target !== cb) cb.checked = !cb.checked;
    });
    list.appendChild(li);
  }

  const footer = document.createElement("div");
  footer.style.cssText = `
    padding: 12px 16px; border-top: 1px solid #e5e7eb;
    display: flex; gap: 8px;
  `;

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = "Export selected";
  confirmBtn.style.cssText = `
    flex: 1; padding: 9px; background: #111827; color: #fff;
    border: none; border-radius: 8px; cursor: pointer; font-size: 13px;
  `;
  confirmBtn.addEventListener("click", () => {
    const ids = Array.from(list.querySelectorAll("input:checked")).map((cb) => cb.value);
    overlay.remove();
    onConfirm(ids);
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.style.cssText = `
    padding: 9px 14px; background: #e7ebf0; color: #111;
    border: none; border-radius: 8px; cursor: pointer; font-size: 13px;
  `;
  cancelBtn.addEventListener("click", () => {
    overlay.remove();
    onConfirm([]);
  });

  footer.appendChild(confirmBtn);
  footer.appendChild(cancelBtn);
  panel.appendChild(header);
  panel.appendChild(list);
  panel.appendChild(footer);
  overlay.appendChild(panel);
  return overlay;
}
