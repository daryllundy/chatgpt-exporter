import { MsgType } from "./lib/messages.js";
import { logger } from "./lib/logger.js";

const STATE_KEYS = {
  PREFERENCES: "preferences",
  RESUME: "resumeState"
};
const CONTENT_SCRIPT_READY_WAITERS = new Map();

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

  if (message.type === MsgType.CONTENT_SCRIPT_READY) {
    const tabId = sender?.tab?.id;
    if (tabId != null) {
      resolveContentScriptWaiters(tabId);
    }
    sendResponse({ ok: true });
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
    void handleCancelExport(sender)
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
    const progressPayload = message.payload || {};
    logger.debug("Relaying EXPORT_PROGRESS", progressPayload);

    void chrome.storage.local.get([STATE_KEYS.RESUME]).then((result) => {
      const state = result[STATE_KEYS.RESUME];
      if (!state) return;

      if (progressPayload.allIds) {
        state.allIds = progressPayload.allIds;
      }

      if (progressPayload.phase === "exporting" || progressPayload.phase === "packaging") {
        state.status = "in_progress";
      }

      if (progressPayload.phase === "exporting" && progressPayload.lastCompletedId) {
        if (!Array.isArray(state.completedIds)) state.completedIds = [];
        if (!state.completedIds.includes(progressPayload.lastCompletedId)) {
          state.completedIds.push(progressPayload.lastCompletedId);
        }
      }

      if (progressPayload.phase === "done") {
        state.status = "done";
      }

      return chrome.storage.local.set({ [STATE_KEYS.RESUME]: state });
    });

    // Relay to popup (may be closed — ignore errors)
    void chrome.runtime.sendMessage(message).catch(() => {});
    return false;
  }

  if (message.type === MsgType.TRIGGER_DOWNLOAD) {
    const { dataUrl, fileName } = message.payload || {};
    if (!dataUrl || !fileName) {
      sendResponse({ ok: false, error: "Missing dataUrl or fileName" });
      return true;
    }
    chrome.downloads.download({ url: dataUrl, filename: fileName, saveAs: false }, (downloadId) => {
      if (chrome.runtime.lastError) {
        logger.error("Download failed", chrome.runtime.lastError.message);
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        logger.info("Download started, id:", downloadId);
        // Clear resume state after successful download
        void chrome.storage.local.remove(STATE_KEYS.RESUME);
        sendResponse({ ok: true, downloadId });
      }
    });
    return true;
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

  await sendRunExportMessage(tabId, payload);
}

/**
 * Cancel any active export run and clear resume state.
 * @param {chrome.runtime.MessageSender} sender
 */
async function handleCancelExport(sender) {
  await chrome.storage.local.remove(STATE_KEYS.RESUME);

  let tabId = sender?.tab?.id;
  if (!tabId) {
    const [tab] = await chrome.tabs.query({ active: true, url: "https://chatgpt.com/*" });
    tabId = tab?.id;
  }

  if (tabId) {
    // Best-effort signal to stop the currently running content-script pipeline.
    await chrome.tabs.sendMessage(tabId, { type: MsgType.STOP_EXPORT }).catch(() => {});
  }
}

/**
 * Ensure the content script is present in the tab before dispatching RUN_EXPORT.
 * This handles the common case where the tab was opened before extension install/update.
 *
 * @param {number} tabId
 * @param {import("./lib/messages.js").StartExportPayload} payload
 */
async function sendRunExportMessage(tabId, payload) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: MsgType.RUN_EXPORT,
      payload
    });
    return;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!msg.includes("Receiving end does not exist")) {
      throw error;
    }
  }

  logger.warn("Content script missing in tab, injecting and retrying", { tabId });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content_script_loader.js"]
  });
  const isReady = await waitForContentScriptReady(tabId, 3000);
  if (!isReady) {
    throw new Error("Content script failed to initialize in tab. Reload ChatGPT tab and try again.");
  }

  await chrome.tabs.sendMessage(tabId, {
    type: MsgType.RUN_EXPORT,
    payload
  });
}

/**
 * Wait for content script initialization.
 * Primary signal: CONTENT_SCRIPT_READY message.
 * Fallback: poll PAGE_CONTEXT_STATUS in case message races are missed.
 *
 * @param {number} tabId
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function waitForContentScriptReady(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let finished = false;
    const done = (value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      clearInterval(pollId);
      removeContentScriptWaiter(tabId, onReady);
      resolve(value);
    };

    const onReady = () => done(true);
    addContentScriptWaiter(tabId, onReady);

    const timeoutId = setTimeout(() => done(false), timeoutMs);
    const pollId = setInterval(() => {
      void chrome.tabs
        .sendMessage(tabId, { type: MsgType.PAGE_CONTEXT_STATUS })
        .then((resp) => {
          if (resp?.ok && resp?.ready) {
            done(true);
          }
        })
        .catch(() => {});
    }, 100);
  });
}

function addContentScriptWaiter(tabId, callback) {
  const list = CONTENT_SCRIPT_READY_WAITERS.get(tabId) || [];
  list.push(callback);
  CONTENT_SCRIPT_READY_WAITERS.set(tabId, list);
}

function removeContentScriptWaiter(tabId, callback) {
  const list = CONTENT_SCRIPT_READY_WAITERS.get(tabId) || [];
  const next = list.filter((item) => item !== callback);
  if (next.length > 0) {
    CONTENT_SCRIPT_READY_WAITERS.set(tabId, next);
  } else {
    CONTENT_SCRIPT_READY_WAITERS.delete(tabId);
  }
}

function resolveContentScriptWaiters(tabId) {
  const list = CONTENT_SCRIPT_READY_WAITERS.get(tabId) || [];
  CONTENT_SCRIPT_READY_WAITERS.delete(tabId);
  for (const callback of list) {
    callback();
  }
}
