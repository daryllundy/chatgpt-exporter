(function loadChatGptExporterModule() {
  if (window.__cgptExporterLoaderStarted) {
    return;
  }
  window.__cgptExporterLoaderStarted = true;

  const moduleUrl = chrome.runtime.getURL("content_script_module.js");
  import(moduleUrl)
    .then(() => {
      void chrome.runtime.sendMessage({ type: "CONTENT_SCRIPT_READY" }).catch(() => {});
    })
    .catch((error) => {
      console.error("[ChatGPT-Exporter] Failed to load content script module", error);
    });
})();
