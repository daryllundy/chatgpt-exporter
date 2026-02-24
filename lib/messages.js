/**
 * Typed message contract for all chrome.runtime.sendMessage calls.
 * All message types are centralized here to prevent typos and enable
 * consistent handling across popup, service worker, and content script.
 */

/** @enum {string} */
export const MsgType = {
  // Health
  HEALTH_CHECK: "HEALTH_CHECK",

  // Preferences
  GET_PREFERENCES: "GET_PREFERENCES",
  SAVE_PREFERENCES: "SAVE_PREFERENCES",

  // Export lifecycle (popup -> service worker)
  START_EXPORT: "START_EXPORT",
  CANCEL_EXPORT: "CANCEL_EXPORT",
  GET_RESUME_STATE: "GET_RESUME_STATE",

  // Export execution (service worker -> content script)
  RUN_EXPORT: "RUN_EXPORT",
  STOP_EXPORT: "STOP_EXPORT",

  // Download trigger (content script -> service worker)
  TRIGGER_DOWNLOAD: "TRIGGER_DOWNLOAD",

  // Progress events (content script -> service worker -> popup)
  EXPORT_PROGRESS: "EXPORT_PROGRESS",
  EXPORT_COMPLETE: "EXPORT_COMPLETE",
  EXPORT_ERROR: "EXPORT_ERROR",
};

/**
 * @typedef {Object} HealthCheckResponse
 * @property {boolean} ok
 * @property {string} from
 * @property {number} timestamp
 */

/**
 * @typedef {Object} Preferences
 * @property {string[]} defaultFormats  - e.g. ["html","markdown"]
 * @property {string}   namingTemplate  - e.g. "{date}_{title}"
 */

/**
 * @typedef {"current"|"selected"|"full"} ExportScope
 */

/**
 * @typedef {Object} StartExportPayload
 * @property {ExportScope} scope
 * @property {string[]}    formats       - subset of ["html","markdown","json"]
 * @property {string[]}    [conversationIds] - required when scope === "selected"
 */

/**
 * @typedef {Object} ProgressPayload
 * @property {"init"|"discovering"|"exporting"|"packaging"|"done"|"error"} phase
 * @property {number}       completed
 * @property {number}       total
 * @property {number|null}  etaSeconds
 * @property {string}       [message]  - optional human-readable note
 */

/**
 * @typedef {Object} ResumeState
 * @property {number}   schemaVersion
 * @property {string}   exportId
 * @property {ExportScope} scope
 * @property {string[]} formats
 * @property {"started"|"in_progress"|"done"|"cancelled"} status
 * @property {number}   startedAt
 * @property {string[]} [allIds]      - full list discovered during this run
 * @property {string[]} [completedIds]
 */
