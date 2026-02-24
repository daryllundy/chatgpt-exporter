const elements = {
  exportBtn: document.getElementById("export-btn"),
  status: document.getElementById("status"),
  settingsToggle: document.getElementById("settings-toggle"),
  settings: document.getElementById("settings"),
  namingTemplate: document.getElementById("naming-template"),
  saveSettings: document.getElementById("save-settings"),
  progress: document.getElementById("progress"),
  progressText: document.getElementById("progress-text")
};

init().catch((error) => {
  setStatus(error instanceof Error ? error.message : "Initialization failed");
});

function getSelectedScope() {
  const input = document.querySelector('input[name="scope"]:checked');
  return input ? input.value : null;
}

function getSelectedFormats() {
  return Array.from(document.querySelectorAll('input[name="format"]:checked')).map(
    (node) => node.value
  );
}

async function init() {
  wireEvents();
  await loadPreferences();
  await pingServiceWorker();
  setStatus("Ready");
}

function wireEvents() {
  elements.settingsToggle.addEventListener("click", () => {
    elements.settings.hidden = !elements.settings.hidden;
  });

  elements.exportBtn.addEventListener("click", () => {
    void startExport();
  });

  elements.saveSettings.addEventListener("click", () => {
    void savePreferences();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "EXPORT_PROGRESS") {
      return;
    }
    const payload = message.payload || {};
    elements.progress.hidden = false;
    elements.progressText.textContent = formatProgress(payload);
  });
}

async function startExport() {
  const scope = getSelectedScope();
  const formats = getSelectedFormats();

  if (!scope || formats.length === 0) {
    setStatus("Select scope and at least one format.");
    return;
  }

  elements.exportBtn.disabled = true;
  setStatus("Starting export...");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "START_EXPORT",
      payload: { scope, formats }
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Export failed to start");
    }
    setStatus("Export started.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Export request failed");
  } finally {
    elements.exportBtn.disabled = false;
  }
}

async function loadPreferences() {
  const response = await chrome.runtime.sendMessage({ type: "GET_PREFERENCES" });
  if (!response?.ok || !response.preferences) {
    return;
  }

  const prefs = response.preferences;
  if (typeof prefs.namingTemplate === "string") {
    elements.namingTemplate.value = prefs.namingTemplate;
  }

  if (Array.isArray(prefs.defaultFormats)) {
    const defaults = new Set(prefs.defaultFormats);
    for (const checkbox of document.querySelectorAll('input[name="format"]')) {
      checkbox.checked = defaults.has(checkbox.value);
    }
  }
}

async function savePreferences() {
  const payload = {
    namingTemplate: elements.namingTemplate.value || "{date}_{title}",
    defaultFormats: getSelectedFormats()
  };

  const response = await chrome.runtime.sendMessage({
    type: "SAVE_PREFERENCES",
    payload
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Failed to save settings");
  }

  setStatus("Settings saved.");
}

async function pingServiceWorker() {
  const response = await chrome.runtime.sendMessage({ type: "HEALTH_CHECK" });
  if (!response?.ok) {
    throw new Error("Service worker unavailable");
  }
}

function formatProgress(progress) {
  const completed = Number.isFinite(progress.completed) ? progress.completed : 0;
  const total = Number.isFinite(progress.total) ? progress.total : 0;
  const eta = Number.isFinite(progress.etaSeconds) ? `${progress.etaSeconds}s` : "--";
  return `Exporting... ~${eta} remaining (${completed} / ${total} chats)`;
}

function setStatus(text) {
  elements.status.textContent = text;
}
