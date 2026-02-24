import { MsgType } from "../lib/messages.js";

const elements = {
  exportBtn:     document.getElementById("export-btn"),
  status:        document.getElementById("status"),
  settingsToggle:document.getElementById("settings-toggle"),
  settings:      document.getElementById("settings"),
  namingTemplate:document.getElementById("naming-template"),
  saveSettings:  document.getElementById("save-settings"),
  resetSettings: document.getElementById("reset-settings"),
  progress:      document.getElementById("progress"),
  progressText:  document.getElementById("progress-text"),
  cancelExport:  document.getElementById("cancel-export"),
  resumeBanner:  document.getElementById("resume-banner"),
  resumeText:    document.getElementById("resume-text"),
  resumeBtn:     document.getElementById("resume-btn"),
  discardBtn:    document.getElementById("discard-btn"),
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

// ─── Initialization ───────────────────────────────────────────────────────────

async function init() {
  wireEvents();
  await loadPreferences();
  await pingServiceWorker();
  await checkResumeState();
  setStatus("Ready");
}

// ─── Events ───────────────────────────────────────────────────────────────────

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

  elements.resetSettings.addEventListener("click", () => {
    void resetPreferences();
  });

  elements.cancelExport.addEventListener("click", () => {
    void cancelExport();
  });

  elements.resumeBtn.addEventListener("click", () => {
    void resumeExport();
  });

  elements.discardBtn.addEventListener("click", () => {
    void discardResume();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== MsgType.EXPORT_PROGRESS) {
      return;
    }
    const payload = message.payload || {};
    if (payload.phase === "done" || payload.phase === "error") {
      elements.progress.hidden = true;
      elements.exportBtn.disabled = false;
      setStatus(payload.phase === "done"
        ? "Export complete! Check your downloads."
        : `Error: ${payload.message || "Unknown error"}`);
    } else {
      elements.progress.hidden = false;
      elements.progressText.textContent = formatProgress(payload);
    }
  });
}

// ─── Export Flows ─────────────────────────────────────────────────────────────

async function startExport(resumePayload = null) {
  const scope   = resumePayload?.scope   ?? getSelectedScope();
  const formats = resumePayload?.formats ?? getSelectedFormats();

  if (!scope || formats.length === 0) {
    setStatus("Select a scope and at least one format.");
    return;
  }

  elements.exportBtn.disabled = true;
  elements.resumeBanner.hidden = true;
  elements.progress.hidden = false;
  elements.progressText.textContent = "Starting export...";
  setStatus("");

  try {
    const response = await chrome.runtime.sendMessage({
      type: MsgType.START_EXPORT,
      payload: { scope, formats }
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Export failed to start");
    }
    setStatus("Export started.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Export request failed");
    elements.exportBtn.disabled = false;
    elements.progress.hidden = true;
  }
}

async function cancelExport() {
  const response = await chrome.runtime.sendMessage({ type: MsgType.CANCEL_EXPORT });
  elements.progress.hidden = true;
  elements.exportBtn.disabled = false;
  setStatus(response?.ok ? "Export cancelled." : "Cancel failed.");
}

async function resumeExport() {
  const rsResp = await chrome.runtime.sendMessage({ type: MsgType.GET_RESUME_STATE });
  const state  = rsResp?.resumeState;
  if (state) {
    await startExport({ scope: state.scope, formats: state.formats });
  }
}

async function discardResume() {
  await chrome.runtime.sendMessage({ type: MsgType.CANCEL_EXPORT });
  elements.resumeBanner.hidden = true;
  setStatus("Previous export discarded.");
}

// ─── Preferences ─────────────────────────────────────────────────────────────

async function loadPreferences() {
  const response = await chrome.runtime.sendMessage({ type: MsgType.GET_PREFERENCES });
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
    type: MsgType.SAVE_PREFERENCES,
    payload
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Failed to save settings");
  }

  setStatus("Settings saved.");
}

async function resetPreferences() {
  const defaults = { namingTemplate: "{date}_{title}", defaultFormats: ["html", "markdown"] };
  await chrome.runtime.sendMessage({ type: MsgType.SAVE_PREFERENCES, payload: defaults });
  elements.namingTemplate.value = defaults.namingTemplate;
  for (const cb of document.querySelectorAll('input[name="format"]')) {
    cb.checked = defaults.defaultFormats.includes(cb.value);
  }
  setStatus("Preferences reset.");
}

// ─── Resume State Check ───────────────────────────────────────────────────────

async function checkResumeState() {
  const response = await chrome.runtime.sendMessage({ type: MsgType.GET_RESUME_STATE });
  const state    = response?.resumeState;
  if (state && state.status !== "done" && state.status !== "cancelled") {
    const completed = state.completedIds?.length ?? 0;
    const total     = state.allIds?.length ?? "?";
    elements.resumeText.textContent =
      `Previous export interrupted (${completed}/${total} completed). Resume?`;
    elements.resumeBanner.hidden = false;
  }
}

// ─── Health Check ─────────────────────────────────────────────────────────────

async function pingServiceWorker() {
  const response = await chrome.runtime.sendMessage({ type: MsgType.HEALTH_CHECK });
  if (!response?.ok) {
    throw new Error("Service worker unavailable");
  }
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatProgress(progress) {
  const completed = Number.isFinite(progress.completed) ? progress.completed : 0;
  const total     = Number.isFinite(progress.total)     ? progress.total     : 0;
  const eta       = Number.isFinite(progress.etaSeconds) ? `${progress.etaSeconds}s` : "--";
  const phase     = progress.phase || "exporting";
  return `${capitalize(phase)}... ~${eta} remaining (${completed} / ${total} chats)`;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function setStatus(text) {
  elements.status.textContent = text;
}
