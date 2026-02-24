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
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (message.type === "HEALTH_CHECK") {
    sendResponse({
      ok: true,
      from: "service_worker",
      timestamp: Date.now()
    });
    return true;
  }

  if (message.type === "START_EXPORT") {
    // TODO(v1): Orchestrate export lifecycle and relay progress updates.
    void handleStartExport(message.payload, sender)
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Unknown export error"
        });
      });
    return true;
  }

  if (message.type === "GET_PREFERENCES") {
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

  if (message.type === "SAVE_PREFERENCES") {
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

  return false;
});

async function handleStartExport(payload, sender) {
  await chrome.storage.local.set({
    [STATE_KEYS.RESUME]: {
      schemaVersion: 1,
      exportId: `exp_${Date.now()}`,
      scope: payload?.scope || "current",
      formats: payload?.formats || [],
      status: "started",
      startedAt: Date.now()
    }
  });

  if (!sender.tab || !sender.tab.id) {
    throw new Error("No active tab available for export");
  }

  await chrome.tabs.sendMessage(sender.tab.id, {
    type: "RUN_EXPORT",
    payload
  });
}
