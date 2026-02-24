
# Product Requirements Document
## ChatGPT Conversation Exporter — Chrome Extension

**Version:** 1.0
**License:** MIT
**Distribution:** Self-hosted `.crx` (Chrome Web Store in future phase)
**Last Updated:** 2026-02-23

***

## 1. Overview

A free, open-source Chrome extension that runs exclusively on `chatgpt.com`, enabling power users and casual users alike to export ChatGPT conversations — individually, in bulk, or as a full account dump — into structured, offline-ready ZIP archives. All processing is 100% local with zero external server dependencies.

***

## 2. Goals & Non-Goals

**Goals**
- Bulk and single-conversation export with no API key requirement
- Three output formats: HTML, GitHub-Flavored Markdown, JSON
- Privacy-first: no telemetry, no external requests, no accounts
- Resumable downloads to handle large conversation sets
- MIT licensed, source-inspectable, non-commercial

**Non-Goals (v1.0)**
- Support for Claude, Gemini, or other AI platforms
- Cloud sync or remote storage of any kind
- Export history or conversation indexing within the extension
- Chrome Web Store distribution (planned for a later phase)

***

## 3. Target Users

| User Type | Volume | Primary Need |
|---|---|---|
| Power user | 100+ chats | Full account dump, folder-grouped exports, resumable bulk downloads |
| Casual user | 1–10 chats | Single or manually selected conversation export, simple UI |

***

## 4. Platform & Technical Constraints

- **Manifest Version:** V3 (required; MV2 support ended in Chrome) [developer.chrome](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
- **Host Restriction:** Content script injected only on `chatgpt.com` — no broad `<all_urls>` permission [stackoverflow](https://stackoverflow.com/questions/67870956/minimum-permissions-to-inject-chrome-extension-content-script)
- **Background Context:** Service Worker (not persistent background page, per MV3) [oreateai](https://www.oreateai.com/blog/guide-to-chrome-extension-development-practices-based-on-manifest-v3-and-ant-design-vue/40f10287e7bcccff164b4ad49b396fcd)
- **No remote code execution:** All logic is bundled; no `eval()` or remote script loading [hackernoon](https://hackernoon.com/the-complete-guide-to-migrating-chrome-extensions-from-manifest-v2-to-manifest-v3)

***

## 5. Permissions

Minimal permissions justified per feature:

| Permission | Justification |
|---|---|
| `activeTab` | Read DOM of the currently active chatgpt.com tab |
| `scripting` | Inject content script to traverse conversation DOM |
| `downloads` | Trigger ZIP file download to user's local machine |
| `storage` | Persist user preferences across sessions (see §9) |
| `host_permissions: ["https://chatgpt.com/*"]` | Scoped host access — no broad permissions  [stackoverflow](https://stackoverflow.com/questions/67870956/minimum-permissions-to-inject-chrome-extension-content-script) |

> `unlimitedStorage` is **not** requested in v1.0; resume state and preferences are small enough to stay well under the 5MB default.

***

## 6. Core Features

### 6.1 Export Scope
- **Single conversation** — Export the currently open chat
- **Manual selection** — Checkbox-select multiple conversations from the sidebar
- **Full account dump** — One-click export of every conversation, including Custom GPT sets

### 6.2 Custom GPT Handling
- Conversations from Custom GPTs are grouped by GPT name in a subfolder within the ZIP
- Custom GPT chats may also appear interleaved chronologically in the main index
- Structure example:
```
export_2026-02-23/
├── index.html
├── chats/
│   ├── 2026-02-23_my-chat-title.html
│   └── ...
├── custom-gpts/
│   ├── MyGPTName/
│   │   ├── 2026-02-20_session-one.html
│   │   └── ...
└── images/
```

### 6.3 File Naming Convention
- **Auto-generated:** `YYYY-MM-DD_chat-title-slug.{ext}`
- **User-defined template:** Configurable via settings panel (e.g., `{date}_{title}`, `{id}_{title}`)
- Slugification: lowercase, hyphens, max 80 characters, no special characters

### 6.4 Output Formats

**HTML**
- `index.html` — Master index linking to all exported chats
- Individual `.html` files per conversation in `/chats/`
- Self-contained: styles inlined, images Base64-embedded
- Syntax-highlighted code blocks using a bundled highlight.js (no CDN)
- Print-to-PDF friendly layout

**Markdown (GitHub-Flavored)**
- One `.md` file per conversation [github](https://github.com/dipankar/chrome-extension-best-practices)
- Fenced code blocks with language tag (` ```python `, ` ```bash `, etc.)
- Images referenced as `![alt](./images/filename.png)` with files saved to `/images/`
- Standard GFM links, headers, and blockquotes preserved

**JSON**
- Mirrors ChatGPT's native export schema structure:
```json
{
  "id": "conv_abc123",
  "title": "My Chat Title",
  "create_time": 1708000000,
  "update_time": 1708003600,
  "model": "gpt-4o",
  "custom_gpt": null,
  "messages": [
    {
      "id": "msg_xyz",
      "role": "user | assistant | system",
      "content": "...",
      "create_time": 1708000001
    }
  ]
}
```

### 6.5 Image Handling
- **Primary:** Images Base64-embedded directly in HTML output
- **Secondary:** Images also saved as separate files in `/images/` subfolder for Markdown and JSON exports
- Filename format: `{conv-slug}_{index}.png`

### 6.6 Resumable Downloads
- Export state (list of conversation IDs, completion status per file) stored in `chrome.storage.local` [stackoverflow](https://stackoverflow.com/questions/69846971/chrome-extension-development-chrome-storage-local-vs-indexeddb)
- On re-opening the popup mid-export, user is prompted: **"Resume previous export?"**
- Resume state is cleared automatically once export completes or user cancels

***

## 7. ZIP Output
- All exports packaged as a single `.zip` file via the [`JSZip`](https://stuk.github.io/jszip/) library (bundled, no CDN)
- ZIP triggered via `chrome.downloads` API
- Default filename: `chatgpt-export_YYYY-MM-DD.zip`

***

## 8. UI / UX

### 8.1 Popup (Toolbar Icon)
- Activates **only** when user is on `chatgpt.com` — grayed out on all other domains
- Clean, minimal single-panel popup (~320px wide)

### 8.2 Popup Sections

**Export Scope**
- Radio buttons: `[ ] Current Chat` `[ ] Selected Chats` `[ ] Full Account Dump`
- "Selected Chats" triggers a sidebar overlay on chatgpt.com for checkbox selection

**Format Selection**
- Checkboxes (multi-select): `[x] HTML` `[x] Markdown` `[ ] JSON`

**Export Button**
- `[ Export & Download ZIP ]`
- Disabled if no scope or format is selected

**Progress Indicator** (active during export)
- Single line: `Exporting... ~2 min remaining (47 / 132 chats)`
- Estimated time calculated from per-chat processing rate
- Cancel button available

**Settings Gear Icon**
- File naming template input
- Default format preferences
- Reset preferences option

***

## 9. Storage Strategy

**Recommendation: `chrome.storage.local`** [stackoverflow](https://stackoverflow.com/questions/47335633/indexeddb-vs-storage)

Rationale:
- Simpler, cleaner API compared to IndexedDB [stackoverflow](https://stackoverflow.com/questions/47335633/indexeddb-vs-storage)
- Sufficient for the data volume needed (preferences + resume state, well under 5MB)
- Natively accessible from both service worker and content scripts via messaging [stackoverflow](https://stackoverflow.com/questions/69846971/chrome-extension-development-chrome-storage-local-vs-indexeddb)
- Persistent across sessions without `unlimitedStorage` permission [stackoverflow](https://stackoverflow.com/questions/69846971/chrome-extension-development-chrome-storage-local-vs-indexeddb)
- IndexedDB is better for large structured datasets; resume state here is small key-value data [stackoverflow](https://stackoverflow.com/questions/47335633/indexeddb-vs-storage)

**Stored keys:**
```json
{
  "defaultFormat": ["html", "markdown"],
  "namingTemplate": "{date}_{title}",
  "resumeState": {
    "exportId": "exp_20260223",
    "total": 132,
    "completed": ["conv_abc", "conv_xyz"],
    "pending": ["conv_123", "..."]
  }
}
```

***

## 10. Privacy & Security

- Zero network requests from the extension itself
- No analytics, telemetry, or usage tracking of any kind
- No export history stored (cleared after completion or cancellation)
- Session authentication piggybacks the active browser session — no credential storage
- Content script scoped exclusively to `chatgpt.com` [stackoverflow](https://stackoverflow.com/questions/67870956/minimum-permissions-to-inject-chrome-extension-content-script)
- Source code fully auditable via MIT license

***

## 11. Architecture Overview

```
manifest.json (MV3)
├── content_script.js     → DOM traversal on chatgpt.com, message relay
├── service_worker.js     → Orchestrates export jobs, manages resume state
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js          → UI logic, dispatches export commands
└── lib/
    ├── jszip.min.js       → ZIP generation (bundled)
    ├── highlight.min.js   → Code syntax highlighting (bundled)
    └── exporter/
        ├── html.js        → HTML formatter
        ├── markdown.js    → GFM formatter
        └── json.js        → JSON schema builder
```

***

## 12. Licensing

**MIT License** — users can freely use, modify, and distribute the code for personal and commercial purposes, but attribution is required and no warranty is provided. This is the most permissive standard license and the best fit for a community tool built around personal data ownership. If preventing commercial resale of the extension itself is important, consider **AGPL-3.0** as an alternative, which requires derivative works to also be open-sourced.

***

## 13. Phased Roadmap

| Phase | Milestone |
|---|---|
| **v1.0** | Single + manual + full dump export, HTML/MD/JSON, ZIP download, resumable, self-hosted `.crx` |
| **v1.1** | User-defined naming templates, settings persistence, improved progress UX |
| **v2.0** | Chrome Web Store submission, additional AI platform support (Claude, Gemini) |

