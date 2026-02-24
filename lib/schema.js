/**
 * Normalized Conversation Schema
 *
 * Defines the canonical internal data model that all exporters consume.
 * Every conversation from any discovery source is transformed into this shape
 * before being handed to the HTML, Markdown, or JSON exporter.
 *
 * Extraction pipeline:
 *   1. fetchConversationData(id)  → raw API response
 *   2. normalizeConversation(raw) → NormalizedConversation
 *   3. validateConversation(conv) → NormalizedConversation (with fallbacks applied)
 */

import { logger } from "./logger.js";

const CONV_API = "https://chatgpt.com/backend-api/conversation";

// ─── Fetch ────────────────────────────────────────────────────────────────────

/**
 * Fetch the full conversation payload from the ChatGPT backend.
 * Runs in the content-script context so credentials are included.
 *
 * @param {string} id  conversation UUID
 * @returns {Promise<NormalizedConversation>}
 */
export async function fetchAndNormalizeConversation(id) {
  try {
    const resp = await fetch(`${CONV_API}/${id}`, { credentials: "include" });
    if (!resp.ok) {
      throw new Error(`Conversation API returned ${resp.status} for id=${id}`);
    }
    const raw = await resp.json();
    const normalized = validateConversation(normalizeConversation(raw));
    if (normalized.messages.length > 0) {
      return normalized;
    }
    logger.warn("API payload had no exportable messages; falling back to DOM extraction", id);
  } catch (err) {
    logger.warn("Conversation API fetch failed; falling back to DOM extraction", id, err);
  }

  const domFallback = extractConversationFromDom(id);
  if (domFallback.messages.length > 0) {
    return validateConversation(domFallback);
  }

  throw new Error(`Unable to extract conversation id=${id} from API or DOM`);
}

// ─── Normalisation ────────────────────────────────────────────────────────────

/**
 * Normalize a raw ChatGPT conversation API response into the canonical schema.
 *
 * @param {*} raw  raw API response object
 * @returns {NormalizedConversation}
 */
function normalizeConversation(raw) {
  if (!raw || typeof raw !== "object") {
    return makeEmpty("");
  }

  const id    = String(raw.id || raw.conversation_id || "").trim();
  const title = trimString(raw.title) || "Untitled Chat";
  const model = detectModel(raw);
  const createTime = toUnixSeconds(raw.create_time);
  const updateTime = toUnixSeconds(raw.update_time);

  const customGptName = raw.gizmo_id
    ? String(raw.meta?.gizmo?.display?.name ?? raw.gizmo_id)
    : null;

  const messages = extractMessages(raw.mapping ?? {});

  return { id, title, createTime, updateTime, model, customGptName, messages };
}

/**
 * Apply fallback defaults and strip invalid entries.
 * @param {NormalizedConversation} conv
 * @returns {NormalizedConversation}
 */
function validateConversation(conv) {
  return {
    id:            conv.id            || `unknown_${Date.now()}`,
    title:         conv.title         || "Untitled Chat",
    createTime:    conv.createTime    ?? null,
    updateTime:    conv.updateTime    ?? null,
    model:         conv.model         ?? null,
    customGptName: conv.customGptName ?? null,
    messages:      Array.isArray(conv.messages)
      ? conv.messages.filter(isValidMessage)
      : []
  };
}

// ─── Message Extraction ───────────────────────────────────────────────────────

/**
 * Walk the mapping (node graph) ChatGPT uses internally and flatten it into
 * a chronologically ordered array of normalized messages.
 *
 * @param {Record<string, *>} mapping
 * @returns {NormalizedMessage[]}
 */
function extractMessages(mapping) {
  if (!mapping || typeof mapping !== "object") return [];

  // Build parent→children adjacency for topological traversal
  const nodes = Object.values(mapping);

  // Find root(s): nodes with no parent or parent not in mapping
  const idSet = new Set(Object.keys(mapping));
  let roots = nodes.filter((n) => !n?.parent || !idSet.has(n.parent));

  // Walk depth-first following the `children` field of each node
  const ordered = [];
  const visited = new Set();

  function walk(node) {
    if (!node || visited.has(node.id)) return;
    visited.add(node.id);
    const msg = extractMessage(node);
    if (msg) ordered.push(msg);
    const children = Array.isArray(node.children) ? node.children : [];
    // Only follow the last child (latest branch) to avoid duplicates
    const lastChild = children[children.length - 1];
    if (lastChild && mapping[lastChild]) {
      walk(mapping[lastChild]);
    }
  }

  for (const root of roots) walk(root);

  return ordered;
}

/**
 * Extract a single normalized message from a mapping node.
 * Returns null for system/internal nodes with no displayable content.
 *
 * @param {*} node
 * @returns {NormalizedMessage|null}
 */
function extractMessage(node) {
  const m = node?.message;
  if (!m) return null;

  const role = String(m.author?.role || "unknown");
  if (role === "system") return null; // skip system prompt nodes

  const createTime = toUnixSeconds(m.create_time);
  const parts = extractContentParts(m.content);

  if (parts.length === 0) return null;

  return {
    id:         String(m.id || node.id || ""),
    role,
    createTime,
    parts
  };
}

/**
 * Extract content parts from a message's content field.
 * Handles both the legacy string format and the modern parts array.
 *
 * @param {*} content
 * @returns {ContentPart[]}
 */
function extractContentParts(content) {
  if (!content) return [];

  // Legacy: content is a plain string
  if (typeof content === "string") {
    return content.trim() ? [{ type: "text", text: content }] : [];
  }

  if (typeof content !== "object") return [];

  // Modern: { content_type: "text", parts: [...] }
  if (content.content_type === "text") {
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const text = parts
      .map((p) => (typeof p === "string" ? p : p?.text || ""))
      .join("")
      .trim();
    return text ? [{ type: "text", text }] : [];
  }

  // Code block: { content_type: "code", language, text }
  if (content.content_type === "code") {
    const language = String(content.language || "").trim();
    const text     = String(content.text || "").trim();
    return text ? [{ type: "code", language, text }] : [];
  }

  // Tether / image reference
  if (content.content_type === "tether_browsing_display" ||
      content.content_type === "tether_quote") {
    return []; // skip navigation result snippets
  }

  // Image upload: { content_type: "multimodal_text", parts: [...] }
  if (content.content_type === "multimodal_text") {
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const result = [];
    for (const part of parts) {
      if (typeof part === "string" && part.trim()) {
        result.push({ type: "text", text: part });
      } else if (part?.content_type === "image_asset_pointer") {
        result.push({
          type:     "image",
          assetId:  String(part.asset_pointer || ""),
          width:    part.width  ?? null,
          height:   part.height ?? null,
          mimeType: "image/png"
        });
      }
    }
    return result;
  }

  logger.debug("Unknown content_type:", content.content_type);
  return [];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEmpty(id) {
  return { id, title: "Untitled Chat", createTime: null, updateTime: null,
           model: null, customGptName: null, messages: [] };
}

function isValidMessage(m) {
  return m && Array.isArray(m.parts) && m.parts.length > 0;
}

function trimString(v) {
  return typeof v === "string" ? v.trim() : "";
}

function toUnixSeconds(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return Math.floor(raw);
  if (typeof raw === "string") {
    const n = Date.parse(raw);
    return Number.isNaN(n) ? null : Math.floor(n / 1000);
  }
  return null;
}

function detectModel(raw) {
  // Prefer the top-level model field; fall back to the last assistant message's metadata
  if (raw.default_model_slug) return String(raw.default_model_slug);
  const mapping = raw.mapping ?? {};
  const nodes   = Object.values(mapping);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const meta = nodes[i]?.message?.metadata;
    if (meta?.model_slug) return String(meta.model_slug);
  }
  return null;
}

/**
 * Fallback extractor for when backend API access fails.
 * Reads rendered chat messages from the live DOM.
 *
 * @param {string} id
 * @returns {NormalizedConversation}
 */
function extractConversationFromDom(id) {
  const messageEls = Array.from(document.querySelectorAll("[data-message-author-role]"));
  const messages = [];

  for (const el of messageEls) {
    const role = String(el.getAttribute("data-message-author-role") || "unknown");
    const parts = [];

    // Text blocks
    const textNodes = Array.from(el.querySelectorAll("p, li, blockquote"));
    if (textNodes.length > 0) {
      const text = textNodes
        .map((node) => node.textContent || "")
        .join("\n")
        .trim();
      if (text) {
        parts.push({ type: "text", text });
      }
    }

    // Code blocks
    for (const codeEl of el.querySelectorAll("pre code")) {
      const cls = codeEl.className || "";
      const m = cls.match(/language-([a-z0-9_+-]+)/i);
      const language = m ? m[1] : "";
      const text = (codeEl.textContent || "").trim();
      if (text) {
        parts.push({ type: "code", language, text });
      }
    }

    // Images
    for (const imgEl of el.querySelectorAll("img[src]")) {
      const src = imgEl.getAttribute("src") || "";
      if (!src) continue;
      // DOM fallback cannot reliably recover asset ids; keep src as an opaque identifier.
      parts.push({
        type: "image",
        assetId: src,
        width: imgEl.naturalWidth || null,
        height: imgEl.naturalHeight || null,
        mimeType: "image/png"
      });
    }

    if (parts.length > 0) {
      messages.push({
        id: `${id}_${messages.length}`,
        role,
        createTime: null,
        parts
      });
    }
  }

  const title = (document.querySelector("h1")?.textContent || document.title || "Untitled Chat").trim();
  return {
    id,
    title: title || "Untitled Chat",
    createTime: null,
    updateTime: Math.floor(Date.now() / 1000),
    model: null,
    customGptName: null,
    messages
  };
}

// ─── Type Definitions ─────────────────────────────────────────────────────────

/**
 * @typedef {Object} NormalizedConversation
 * @property {string}            id
 * @property {string}            title
 * @property {number|null}       createTime   – Unix seconds
 * @property {number|null}       updateTime   – Unix seconds
 * @property {string|null}       model        – e.g. "gpt-4o"
 * @property {string|null}       customGptName
 * @property {NormalizedMessage[]} messages
 */

/**
 * @typedef {Object} NormalizedMessage
 * @property {string}        id
 * @property {string}        role     – "user" | "assistant" | "tool"
 * @property {number|null}   createTime
 * @property {ContentPart[]} parts
 */

/**
 * @typedef {TextPart|CodePart|ImagePart} ContentPart
 */

/**
 * @typedef {Object} TextPart
 * @property {"text"} type
 * @property {string} text
 */

/**
 * @typedef {Object} CodePart
 * @property {"code"}  type
 * @property {string}  language
 * @property {string}  text
 */

/**
 * @typedef {Object} ImagePart
 * @property {"image"}       type
 * @property {string}        assetId
 * @property {number|null}   width
 * @property {number|null}   height
 * @property {string}        mimeType
 */
