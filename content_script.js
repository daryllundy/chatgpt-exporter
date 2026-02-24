import { MsgType } from "./lib/messages.js";
import { logger } from "./lib/logger.js";
import { discoverConversations, promptConversationSelection } from "./lib/discovery.js";

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
 * @param {import("./lib/messages.js").StartExportPayload} payload
 */
async function executeExport(payload) {
  try {
    sendProgress({ phase: "init", completed: 0, total: 0, etaSeconds: null });

    // For "selected" scope, show the in-page selector if no IDs were provided.
    let explicitIds = payload.conversationIds;
    if (payload.scope === "selected" && (!explicitIds || explicitIds.length === 0)) {
      explicitIds = await promptConversationSelection();
      if (explicitIds.length === 0) {
        sendProgress({ phase: "done", completed: 0, total: 0, etaSeconds: 0,
          message: "No conversations selected." });
        return;
      }
    }

    const conversations = await discoverConversations(
      payload.scope,
      explicitIds,
      (ids) => sendProgress({ phase: "discovering", completed: ids.length, total: ids.length, etaSeconds: null })
    );

    logger.info(`Discovered ${conversations.length} conversation(s)`);
    sendProgress({ phase: "discovering", completed: 0, total: conversations.length, etaSeconds: null });

    // Notify service worker of full ID list so resume state can be persisted
    void chrome.runtime.sendMessage({
      type: MsgType.EXPORT_PROGRESS,
      payload: {
        phase: "discovering",
        completed: 0,
        total: conversations.length,
        etaSeconds: null,
        allIds: conversations.map((c) => c.id)
      }
    });

    // Full extraction and ZIP are completed in Workstreams 3–5.
    // Placeholder completion signal:
    sendProgress({ phase: "done", completed: conversations.length, total: conversations.length, etaSeconds: 0 });
  } catch (err) {
    logger.error("executeExport failed", err);
    sendProgress({
      phase: "error",
      completed: 0,
      total: 0,
      etaSeconds: null,
      message: err instanceof Error ? err.message : String(err)
    });
  }
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
