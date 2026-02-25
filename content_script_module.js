import { MsgType } from "./lib/messages.js";
import { logger } from "./lib/logger.js";
import { discoverConversations, promptConversationSelection } from "./lib/discovery.js";
import { fetchAndNormalizeConversation, extractConversationFromActiveDom } from "./lib/schema.js";
import { fetchConversationImages } from "./lib/images.js";
import { packageZip } from "./lib/exporter/packager.js";
import { formatDate } from "./lib/naming.js";

let activeRun = null;
if (!window.__cgptExporterModuleReady) {
  window.__cgptExporterModuleReady = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      return false;
    }

    if (message.type === MsgType.RUN_EXPORT) {
      if (activeRun && !activeRun.cancelled) {
        sendResponse({ ok: false, message: "An export is already running" });
        return true;
      }

      const runToken = { cancelled: false };
      activeRun = runToken;
      logger.info("RUN_EXPORT received in content script", message.payload);
      void executeExport(message.payload, runToken).finally(() => {
        if (activeRun === runToken) {
          activeRun = null;
        }
      });
      sendResponse({ ok: true, message: "Export runner started" });
      return true;
    }

    if (message.type === MsgType.STOP_EXPORT) {
      if (activeRun) {
        activeRun.cancelled = true;
        logger.info("STOP_EXPORT received in content script");
      }
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === MsgType.PAGE_CONTEXT_STATUS) {
      sendResponse({
        ok: true,
        host: window.location.host,
        ready: window.location.host === "chatgpt.com"
      });
      return true;
    }

    return false;
  });

  void chrome.runtime.sendMessage({ type: MsgType.CONTENT_SCRIPT_READY }).catch(() => {});
}

// ─── Main Export Pipeline ─────────────────────────────────────────────────────

/**
 * Full end-to-end export pipeline running in the page context:
 *   discover → fetch + normalize → fetch images → assemble ZIP → download
 *
 * @param {import("./lib/messages.js").StartExportPayload} payload
 */
async function executeExport(payload, runToken) {
  const originalConversationId = getCurrentConversationIdFromUrl();
  const enableNavigationFallback = payload.scope === "selected";

  try {
    throwIfCancelled(runToken);
    sendProgress({ phase: "init", completed: 0, total: 0, etaSeconds: null });

    // 1. Determine conversation IDs ─────────────────────────────────────────
    let explicitIds = payload.conversationIds;
    if (payload.scope === "selected" && (!explicitIds || explicitIds.length === 0)) {
      explicitIds = await promptConversationSelection();
      throwIfCancelled(runToken);
      if (explicitIds.length === 0) {
        sendProgress({ phase: "done", completed: 0, total: 0, etaSeconds: 0,
          message: "No conversations selected." });
        return;
      }
    }

    const metas = await discoverConversations(
      payload.scope,
      explicitIds,
      (ids) => sendProgress({
        phase: "discovering", completed: ids.length, total: ids.length, etaSeconds: null
      })
    );

    const total = metas.length;
    throwIfCancelled(runToken);
    logger.info(`Discovered ${total} conversation(s)`);
    sendProgress({ phase: "discovering", completed: 0, total, etaSeconds: null });

    // Inform service worker of the full ID list for resume state
    void chrome.runtime.sendMessage({
      type: MsgType.EXPORT_PROGRESS,
      payload: { phase: "discovering", completed: 0, total, etaSeconds: null,
        allIds: metas.map((m) => m.id) }
    });

    // 2. Load resume state to skip already-completed conversations ──────────
    const rsResp = await chrome.runtime.sendMessage({ type: MsgType.GET_RESUME_STATE });
    throwIfCancelled(runToken);
    const completedIds = new Set(rsResp?.resumeState?.completedIds ?? []);

    // 3. Fetch + normalize each conversation ────────────────────────────────
    /** @type {import("./lib/exporter/packager.js").ConvExportRecord[]} */
    const records = [];
    /** @type {import("./lib/exporter/packager.js").FailureRecord[]} */
    const failures = [];
    const startTime = Date.now();

    for (let i = 0; i < metas.length; i++) {
      throwIfCancelled(runToken);
      const meta = metas[i];

      if (completedIds.has(meta.id)) {
        logger.debug("Skipping already-completed conversation", meta.id);
        continue;
      }

      try {
        const conversation = await loadConversationForExport(meta.id, runToken, enableNavigationFallback);
        throwIfCancelled(runToken);
        const images = await fetchConversationImages(conversation);
        throwIfCancelled(runToken);
        records.push({ conversation, images });

        // Checkpoint: notify service worker of this completion
        void chrome.runtime.sendMessage({
          type: MsgType.EXPORT_PROGRESS,
          payload: { phase: "exporting", completed: i + 1, total,
            etaSeconds: estimateEta(startTime, i + 1, total),
            lastCompletedId: meta.id }
        });
      } catch (err) {
        logger.error(`Failed to export conversation ${meta.id}`, err);
        failures.push({
          id:    meta.id,
          title: meta.title || "Untitled Chat",
          error: err instanceof Error ? err.message : String(err)
        });
      }

      sendProgress({
        phase: "exporting",
        completed: i + 1,
        total,
        etaSeconds: estimateEta(startTime, i + 1, total)
      });
    }

    // 4. Package ZIP ─────────────────────────────────────────────────────────
    sendProgress({ phase: "packaging", completed: 0, total: records.length, etaSeconds: null });

    const prefs = await getPreferences();
    throwIfCancelled(runToken);
    const blob = await packageZip(
      records,
      payload.formats,
      prefs.namingTemplate || "{date}_{title}",
      failures,
      (done, tot) => sendProgress({ phase: "packaging", completed: done, total: tot, etaSeconds: null })
    );

    // 5. Trigger download via service worker ─────────────────────────────────
    const dataUrl = await blobToDataUrl(blob);
    throwIfCancelled(runToken);
    const fileName = `chatgpt-export_${formatDate(Date.now() / 1000)}.zip`;

    await chrome.runtime.sendMessage({
      type: MsgType.TRIGGER_DOWNLOAD,
      payload: { dataUrl, fileName }
    });

    sendProgress({ phase: "done", completed: total, total, etaSeconds: 0 });
  } catch (err) {
    if (runToken?.cancelled) {
      sendProgress({
        phase: "error",
        completed: 0,
        total: 0,
        etaSeconds: null,
        message: "Export cancelled."
      });
      return;
    }
    logger.error("executeExport failed", err);
    sendProgress({
      phase: "error", completed: 0, total: 0, etaSeconds: null,
      message: err instanceof Error ? err.message : String(err)
    });
  } finally {
    if (enableNavigationFallback && originalConversationId) {
      void navigateToConversation(originalConversationId, null).catch(() => {});
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** @param {import("./lib/messages.js").ProgressPayload} progress */
function sendProgress(progress) {
  void chrome.runtime.sendMessage({ type: MsgType.EXPORT_PROGRESS, payload: progress });
}

async function getPreferences() {
  const resp = await chrome.runtime.sendMessage({ type: MsgType.GET_PREFERENCES });
  return resp?.preferences || {};
}

/**
 * @param {number} startMs
 * @param {number} done
 * @param {number} total
 * @returns {number|null}
 */
function estimateEta(startMs, done, total) {
  if (done === 0) return null;
  const elapsed = (Date.now() - startMs) / 1000;
  const perItem = elapsed / done;
  return Math.round(perItem * (total - done));
}

/** @param {Blob} blob @returns {Promise<string>} */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(/** @type {string} */ (reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function throwIfCancelled(runToken) {
  if (runToken?.cancelled) {
    throw new Error("Export cancelled");
  }
}

/**
 * Load a conversation for export. Primary source is API; for selected chats we
 * also support a navigation+DOM fallback when API lookup fails.
 *
 * @param {string} id
 * @param {{cancelled:boolean}} runToken
 * @param {boolean} allowNavigationFallback
 */
async function loadConversationForExport(id, runToken, allowNavigationFallback) {
  try {
    return await fetchAndNormalizeConversation(id);
  } catch (err) {
    if (!allowNavigationFallback) {
      throw err;
    }

    logger.warn(`API load failed for ${id}; trying navigation fallback`, err);
    await navigateToConversation(id, runToken);
    throwIfCancelled(runToken);
    const conversation = extractConversationFromActiveDom(id);
    if (!conversation.messages || conversation.messages.length === 0) {
      throw new Error(`Navigation fallback produced no messages for id=${id}`);
    }
    return conversation;
  }
}

/**
 * Navigate to a conversation via the left sidebar link and wait for render.
 * Requires the target chat link to be currently present in the DOM.
 *
 * @param {string} id
 * @param {{cancelled:boolean}|null} runToken
 */
async function navigateToConversation(id, runToken) {
  const escapedId = cssAttributeEscape(id);
  const selector = `a[href="/c/${escapedId}"], a[href$="/c/${escapedId}"]`;
  const link = /** @type {HTMLAnchorElement|null} */ (document.querySelector(selector));
  if (!link) {
    throw new Error(`Sidebar link not found for conversation id=${id}`);
  }

  link.click();

  await waitForCondition(
    () => getCurrentConversationIdFromUrl() === id,
    10000,
    100,
    runToken,
    `Timed out navigating to /c/${id}`
  );

  await waitForCondition(
    () => document.querySelectorAll("[data-message-author-role]").length > 0,
    10000,
    100,
    runToken,
    `Timed out waiting for rendered messages for id=${id}`
  );
}

function getCurrentConversationIdFromUrl() {
  const match = window.location.pathname.match(/\/c\/([a-z0-9-]+)/i);
  return match ? match[1] : null;
}

function cssAttributeEscape(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

async function waitForCondition(predicate, timeoutMs, intervalMs, runToken, timeoutMessage) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    throwIfCancelled(runToken);
    if (predicate()) return;
    await sleep(intervalMs);
  }
  throw new Error(timeoutMessage);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
