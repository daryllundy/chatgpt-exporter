import { MsgType } from "./lib/messages.js";
import { logger } from "./lib/logger.js";

const STATE_KEYS = {
  PREFERENCES: "preferences",
  RESUME: "resumeState"
};

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get([STATE_KEYS.PREFERENCES]);
  if (!current[STATE_KEYS.PREFERENCES]) {
    await chrome.storage.local.set({
      [STATE_KEYS.PREFERENCES]: {
        defaultFormats: ["html", "markdown"],
        namingTemplate: "{date}_{title}"
      }
    });
  }
  logger.info("Extension installed / updated — preferences initialized.");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (message.type === MsgType.HEALTH_CHECK) {
    sendResponse({
      ok: true,
      from: "service_worker",
      timestamp: Date.now()
    });
    return true;
  }

  if (message.type === MsgType.START_EXPORT) {
    logger.info("START_EXPORT received", message.payload);
    void handleStartExport(message.payload, sender)
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        logger.error("handleStartExport failed", error);
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Unknown export error"
        });
      });
    return true;
  }

  if (message.type === MsgType.CANCEL_EXPORT) {
    logger.info("CANCEL_EXPORT received");
    void chrome.storage.local
      .remove(STATE_KEYS.RESUME)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === MsgType.GET_RESUME_STATE) {
    void chrome.storage.local
      .get([STATE_KEYS.RESUME])
      .then((result) => {
        sendResponse({
          ok: true,
          resumeState: result[STATE_KEYS.RESUME] || null
        });
      })
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === MsgType.GET_PREFERENCES) {
    void chrome.storage.local
      .get([STATE_KEYS.PREFERENCES])
      .then((result) => {
        sendResponse({
          ok: true,
          preferences: result[STATE_KEYS.PREFERENCES] || null
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Failed to load preferences"
        });
      });
    return true;
  }

  if (message.type === MsgType.SAVE_PREFERENCES) {
    void chrome.storage.local
      .set({ [STATE_KEYS.PREFERENCES]: message.payload || {} })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Failed to save preferences"
        });
      });
    return true;
  }

  if (message.type === MsgType.EXPORT_PROGRESS) {
    // Relay progress from content script to popup
    logger.debug("Relaying EXPORT_PROGRESS", message.payload);
    void chrome.runtime.sendMessage(message).catch(() => {
      // Popup may be closed — safe to ignore
    });
    return false;
  }

  return false;
});

/**
 * Kick off an export run: persist resumeState, then send RUN_EXPORT to the
 * active chatgpt.com tab's content script.
 * @param {import("./lib/messages.js").StartExportPayload} payload
 * @param {chrome.runtime.MessageSender} sender
 */
async function handleStartExport(payload, sender) {
  /** @type {import("./lib/messages.js").ResumeState} */
  const resumeState = {
    schemaVersion: 1,
    exportId: `exp_${Date.now()}`,
    scope: payload?.scope || "current",
    formats: payload?.formats || [],
    status: "started",
    startedAt: Date.now(),
    allIds: [],
    completedIds: []
  };
  await chrome.storage.local.set({ [STATE_KEYS.RESUME]: resumeState });

  // Find the active chatgpt.com tab
  let tabId = sender?.tab?.id;
  if (!tabId) {
    const [tab] = await chrome.tabs.query({ active: true, url: "https://chatgpt.com/*" });
    tabId = tab?.id;
  }
  if (!tabId) {
    throw new Error("No active chatgpt.com tab found — open ChatGPT first.");
  }

  await chrome.tabs.sendMessage(tabId, {
    type: MsgType.RUN_EXPORT,
    payload
  });
}
