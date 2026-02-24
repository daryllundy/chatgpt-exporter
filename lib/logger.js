/**
 * Extension-local logging helpers.
 *
 * Debug logging is controlled by the `CHATGPT_EXPORTER_DEBUG` key in
 * chrome.storage.local.  Call `logger.setDebug(true)` at runtime to enable,
 * or just open Chrome DevTools for the relevant context.
 *
 * Usage:
 *   import { logger } from "./lib/logger.js";
 *   logger.info("Starting export", { scope });
 *   logger.debug("Parsed message", message);
 *   logger.warn("Retrying...");
 *   logger.error("ZIP failed", err);
 */

const PREFIX = "[ChatGPT-Exporter]";

let _debugEnabled = false;

/** Read persisted debug flag once on first import. */
(async () => {
  try {
    const result = await chrome.storage.local.get("CHATGPT_EXPORTER_DEBUG");
    _debugEnabled = Boolean(result["CHATGPT_EXPORTER_DEBUG"]);
  } catch {
    // not in an extension context (e.g. unit tests) — keep false
  }
})();

function fmt(level, msg, ...args) {
  return [`${PREFIX} [${level}] ${msg}`, ...args];
}

export const logger = {
  /** Enable or disable debug output at runtime. */
  setDebug(enabled) {
    _debugEnabled = Boolean(enabled);
    void chrome.storage.local.set({ CHATGPT_EXPORTER_DEBUG: _debugEnabled }).catch(() => {});
  },

  debug(msg, ...args) {
    if (_debugEnabled) {
      console.debug(...fmt("DEBUG", msg, ...args));
    }
  },

  info(msg, ...args) {
    console.info(...fmt("INFO", msg, ...args));
  },

  warn(msg, ...args) {
    console.warn(...fmt("WARN", msg, ...args));
  },

  error(msg, ...args) {
    console.error(...fmt("ERROR", msg, ...args));
  },
};
