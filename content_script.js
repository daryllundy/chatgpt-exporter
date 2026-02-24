import { MsgType } from "./lib/messages.js";
import { logger } from "./lib/logger.js";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (message.type === MsgType.RUN_EXPORT) {
    logger.info("RUN_EXPORT received in content script", message.payload);
    void executeExport(message.payload);
    sendResponse({ ok: true, message: "Export runner started" });
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

/**
 * Entry point for the export runner in the page context.
 * Discovers conversations, extracts data, and returns artifacts to service worker.
 * @param {import("./lib/messages.js").StartExportPayload} payload
 */
async function executeExport(payload) {
  try {
    sendProgress({ phase: "init", completed: 0, total: 0, etaSeconds: null });
    const ids = await discoverConversations(payload.scope, payload.conversationIds);
    logger.info(`Discovered ${ids.length} conversation(s)`);
    sendProgress({ phase: "discovering", completed: 0, total: ids.length, etaSeconds: null });
    await chrome.runtime.sendMessage({
      type: MsgType.EXPORT_PROGRESS,
      payload: { phase: "discovering", completed: 0, total: ids.length, etaSeconds: null }
    });
    // Full extraction and packaging are handled in subsequent workstreams.
    // Signal completion (placeholder until Workstream 5 wires ZIP).
    sendProgress({ phase: "done", completed: ids.length, total: ids.length, etaSeconds: 0 });
  } catch (err) {
    logger.error("executeExport failed", err);
    sendProgress({ phase: "error", completed: 0, total: 0, etaSeconds: null, message: err.message });
  }
}

/**
 * Discover conversation IDs based on export scope.
 * Implemented fully in Workstream 2; this shell satisfies the messaging contract.
 * @param {import("./lib/messages.js").ExportScope} scope
 * @param {string[]} [explicitIds]
 * @returns {Promise<string[]>}
 */
async function discoverConversations(scope, explicitIds) {
  if (scope === "selected" && Array.isArray(explicitIds)) {
    return explicitIds;
  }
  if (scope === "current") {
    return discoverCurrentChat();
  }
  if (scope === "full") {
    return discoverAllConversations();
  }
  return [];
}

/**
 * @returns {Promise<string[]>}  single-element array with the current chat ID
 */
async function discoverCurrentChat() {
  // Current chat ID appears in the URL: /c/<id>
  const match = window.location.pathname.match(/\/c\/([a-f0-9-]+)/);
  if (match) {
    return [match[1]];
  }
  logger.warn("Could not determine current chat ID from URL");
  return [];
}

/**
 * Enumerate all conversation IDs by calling ChatGPT's internal history API.
 * Pagination is handled via limit/offset.
 * @returns {Promise<string[]>}
 */
async function discoverAllConversations() {
  const ids = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const url = `https://chatgpt.com/backend-api/conversations?offset=${offset}&limit=${limit}&order=updated`;
    const resp = await fetch(url, { credentials: "include" });
    if (!resp.ok) {
      logger.error("History API error", resp.status);
      break;
    }
    const data = await resp.json();
    const items = Array.isArray(data?.items) ? data.items : [];
    for (const item of items) {
      if (item?.id) ids.push(item.id);
    }
    if (items.length < limit) break;
    offset += limit;
  }
  return ids;
}

/**
 * @param {import("./lib/messages.js").ProgressPayload} progress
 */
function sendProgress(progress) {
  void chrome.runtime.sendMessage({
    type: MsgType.EXPORT_PROGRESS,
    payload: progress
  });
}
