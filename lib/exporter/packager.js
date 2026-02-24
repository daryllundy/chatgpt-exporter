/**
 * ZIP Packager
 *
 * Assembles the final ZIP archive from a batch of exported conversation data.
 * Uses the bundled JSZip library (lib/jszip.min.js).
 *
 * Folder layout (per PRD §6.2):
 *   export_YYYY-MM-DD/
 *   ├── index.html
 *   ├── chats/
 *   │   ├── YYYY-MM-DD_title.html
 *   │   ├── YYYY-MM-DD_title.md
 *   │   └── YYYY-MM-DD_title.json
 *   ├── custom-gpts/
 *   │   └── <gpt-name>/
 *   │       └── ...
 *   └── images/
 *       └── <conv-slug>_0.png
 */

import { buildFileName, getFolderPrefix, formatDate, slugify } from "../naming.js";
import { renderHtmlConversation }      from "./html.js";
import { renderMarkdownConversation }  from "./markdown.js";
import { renderJsonConversation }      from "./json.js";

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Package exported conversations into a ZIP blob.
 *
 * @param {ConvExportRecord[]} records
 * @param {string[]} formats    subset of ["html","markdown","json"]
 * @param {string} template     naming template, e.g. "{date}_{title}"
 * @param {FailureRecord[]} [failures]  conversations that errored during extraction
 * @param {ProgressCallback} [onProgress]
 * @returns {Promise<Blob>}     ZIP file blob
 */
export async function packageZip(records, formats, template, failures = [], onProgress) {
  const JSZip = await loadJSZip();
  const zip   = new JSZip();
  const highlightSource = formats.includes("html")
    ? await loadHighlightSource()
    : "";

  const rootFolder = `chatgpt-export_${formatDate(Date.now() / 1000)}`;
  const usedNames  = new Set();

  /** @type {IndexEntry[]} */
  const indexEntries = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const conv   = record.conversation;

    const baseName   = buildFileName(conv, template, usedNames);
    const folderPfx  = getFolderPrefix(conv);
    const imageMap   = new Map(); // assetId → relative file path for Markdown

    // ── Images ──────────────────────────────────────────────────────────────
    const dataUrlMap = new Map(); // assetId → data URL for HTML embed

    if (Array.isArray(record.images)) {
      for (let j = 0; j < record.images.length; j++) {
        const img    = record.images[j];
        const imgName = `${slugify(baseName)}_${j}.png`;
        const imgPath = `${rootFolder}/images/${imgName}`;

        // Store raw bytes in ZIP (for Markdown/JSON)
        zip.file(imgPath, img.bytes);
        imageMap.set(img.assetId, imgName);

        // Build data URL for HTML embedding
        const b64 = arrayBufferToBase64(img.bytes);
        dataUrlMap.set(img.assetId, `data:${img.mimeType || "image/png"};base64,${b64}`);
      }
    }

    // ── Per-format artifacts ─────────────────────────────────────────────────
    if (formats.includes("html")) {
      const html = renderHtmlConversation(conv, dataUrlMap, highlightSource);
      zip.file(`${rootFolder}/${folderPfx}${baseName}.html`, html);
    }

    if (formats.includes("markdown")) {
      const md = renderMarkdownConversation(conv, imageMap);
      zip.file(`${rootFolder}/${folderPfx}${baseName}.md`, md);
    }

    if (formats.includes("json")) {
      const json = renderJsonConversation(conv);
      zip.file(`${rootFolder}/${folderPfx}${baseName}.json`, json);
    }

    indexEntries.push({
      title:    conv.title || "Untitled Chat",
      folder:   folderPfx,
      baseName,
      formats
    });

    onProgress?.(i + 1, records.length);
  }

  // ── Index HTML ─────────────────────────────────────────────────────────────
  if (formats.includes("html")) {
    const indexHtml = buildIndexHtml(indexEntries);
    zip.file(`${rootFolder}/index.html`, indexHtml);
  }

  // ── Summary Report ─────────────────────────────────────────────────────────
  const summary = buildSummaryReport(records, failures);
  zip.file(`${rootFolder}/export-summary.txt`, summary);

  // ── Generate and return blob ───────────────────────────────────────────────
  return zip.generateAsync({ type: "blob", compression: "DEFLATE",
    compressionOptions: { level: 6 } });
}

// ─── Index HTML ───────────────────────────────────────────────────────────────

/**
 * @param {IndexEntry[]} entries
 * @returns {string}
 */
function buildIndexHtml(entries) {
  const rows = entries.map(({ title, folder, baseName, formats }) => {
    const links = formats
      .filter((f) => f === "html" || f === "markdown" || f === "json")
      .map((f) => {
        const ext = f === "markdown" ? "md" : f;
        return `<a href="./${folder}${baseName}.${ext}">${ext.toUpperCase()}</a>`;
      })
      .join(" &middot; ");
    return `<li><span class="title">${escHtml(title)}</span> &mdash; ${links}</li>`;
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ChatGPT Export Index</title>
  <style>
    body{font-family:"Segoe UI",sans-serif;max-width:800px;margin:40px auto;color:#111}
    h1{font-size:22px;margin-bottom:20px}
    ul{list-style:none;padding:0}
    li{padding:8px 0;border-bottom:1px solid #e5e7eb}
    .title{font-weight:600}
    a{color:#2563eb;text-decoration:none}
    a:hover{text-decoration:underline}
  </style>
</head>
<body>
  <h1>ChatGPT Export — ${new Date().toLocaleDateString()}</h1>
  <ul>
    ${rows.join("\n    ")}
  </ul>
  <p style="margin-top:24px;font-size:12px;color:#6b7280">
    Exported by ChatGPT Conversation Exporter &middot; ${entries.length} conversation(s)
  </p>
</body>
</html>`;
}

// ─── Summary Report ───────────────────────────────────────────────────────────

/**
 * @param {ConvExportRecord[]} records
 * @param {FailureRecord[]} failures
 * @returns {string}
 */
function buildSummaryReport(records, failures) {
  const lines = [
    "ChatGPT Conversation Exporter — Export Summary",
    "=".repeat(50),
    `Exported at : ${new Date().toISOString()}`,
    `Successful  : ${records.length}`,
    `Failed      : ${failures.length}`,
    ""
  ];
  if (failures.length > 0) {
    lines.push("Failed Conversations:");
    for (const f of failures) {
      lines.push(`  - ${f.id} ("${f.title}"): ${f.error}`);
    }
    lines.push("");
  }
  lines.push("Formats exported: " + (records.length > 0 ? "see individual files" : "n/a"));
  return lines.join("\n");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * Load JSZip from the extension's bundled copy.
 * @returns {Promise<typeof JSZip>}
 */
async function loadJSZip() {
  if (typeof globalThis.JSZip !== "undefined") return globalThis.JSZip;
  // Dynamically import the bundled build (works in content-script context)
  const url = chrome.runtime.getURL("lib/jszip.min.js");
  await import(url);
  if (typeof globalThis.JSZip === "undefined") {
    throw new Error("JSZip failed to load from bundled lib/jszip.min.js");
  }
  return globalThis.JSZip;
}

/**
 * Read bundled highlight.js source so each exported HTML file remains
 * self-contained and works offline.
 * @returns {Promise<string>}
 */
async function loadHighlightSource() {
  const url = chrome.runtime.getURL("lib/highlight.min.js");
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to load bundled highlight.js (${resp.status})`);
  }
  return resp.text();
}

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ConvExportRecord
 * @property {import("../schema.js").NormalizedConversation} conversation
 * @property {ImageRecord[]} [images]
 */

/**
 * @typedef {Object} ImageRecord
 * @property {string}       assetId
 * @property {ArrayBuffer}  bytes
 * @property {string}       mimeType
 */

/**
 * @typedef {Object} FailureRecord
 * @property {string} id
 * @property {string} title
 * @property {string} error
 */

/**
 * @typedef {Object} IndexEntry
 * @property {string}   title
 * @property {string}   folder
 * @property {string}   baseName
 * @property {string[]} formats
 */

/**
 * @callback ProgressCallback
 * @param {number} completed
 * @param {number} total
 */
