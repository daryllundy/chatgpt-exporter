chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (message.type === "RUN_EXPORT") {
    // TODO(v1): Extract conversations from ChatGPT page/app state.
    sendProgress({
      phase: "init",
      completed: 0,
      total: 0,
      etaSeconds: null
    });

    sendResponse({
      ok: true,
      message: "Export runner placeholder executed"
    });
    return true;
  }

  if (message.type === "PAGE_CONTEXT_STATUS") {
    sendResponse({
      ok: true,
      host: window.location.host,
      ready: window.location.host === "chatgpt.com"
    });
    return true;
  }

  return false;
});

function sendProgress(progress) {
  void chrome.runtime.sendMessage({
    type: "EXPORT_PROGRESS",
    payload: progress
  });
}
