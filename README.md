# ChatGPT Conversation Exporter

A free, open-source Chrome extension (Manifest V3) that exports ChatGPT conversations to **HTML**, **Markdown**, and **JSON** ZIP archives — entirely locally, with no external server dependencies.

## Features

- **Three export scopes**: current chat, manually selected chats, or full account dump
- **Three output formats**: HTML (self-contained with inline styles), GitHub-Flavored Markdown, and JSON
- **Resume support**: interrupted exports are checkpointed and can be resumed after popup close or browser restart
- **Custom GPT grouping**: conversations from Custom GPTs are organized in a `/custom-gpts/<name>/` subfolder
- **Image handling**: uploaded images embedded as Base64 in HTML; saved as separate files for Markdown/JSON
- **Configurable naming**: `{date}_{title}` template (supports `{id}_{title}` and custom patterns)
- **Privacy-first**: zero network requests from the extension; no analytics, no telemetry
- **MIT licensed**: fully auditable, source-inspectable

## Installation (Developer / Unpacked)

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the root of this repository.
5. Navigate to [chatgpt.com](https://chatgpt.com) and click the extension icon in the toolbar.

## Usage

1. Open a conversation on chatgpt.com.
2. Click the **ChatGPT Exporter** toolbar icon.
3. Choose an export scope (Current Chat / Selected Chats / Full Account Dump).
4. Select output formats (HTML, Markdown, JSON — multi-select).
5. Click **Export & Download ZIP**.
6. The ZIP file will be saved to your default downloads folder.

### Troubleshooting

If export fails right after updating/reloading the extension:
1. Reload the extension in `chrome://extensions`.
2. Refresh the `chatgpt.com` tab.
3. Retry export.

This ensures the loader and module content scripts are attached to the active tab.

If **Selected Chats** shows no items, the extension falls back to scraping currently visible left-sidebar chats when account-history API access is blocked. Expand/load the sidebar chat list, then retry.

### Resuming an interrupted export

If the popup is closed or the browser restarted during a large export, reopening the popup will show a **Resume** banner. Click **Resume** to continue from where it left off, or **Start fresh** to discard the previous state and begin anew.

### Settings

Click the ⚙ icon to open settings:
- **Naming template**: customize file names using `{date}`, `{title}`, `{id}` tokens.
- **Default formats**: choose which formats are pre-selected when the popup opens.
- **Reset**: restore default preferences.

## ZIP Structure

```
chatgpt-export_YYYY-MM-DD/
├── index.html              ← master index linking all chats
├── export-summary.txt      ← export report (success/failure counts)
├── chats/
│   ├── YYYY-MM-DD_title.html
│   ├── YYYY-MM-DD_title.md
│   └── YYYY-MM-DD_title.json
├── custom-gpts/
│   └── <gpt-name>/
│       └── YYYY-MM-DD_title.html
└── images/
    └── <conv-slug>_0.png
```

## Architecture

```
manifest.json (MV3)
├── content_script_loader.js → classic loader shim; dynamically imports module content script
├── content_script_module.js → export pipeline: discovery, fetch, normalize, package
├── service_worker.js        → orchestrates jobs, manages resume state, triggers download
├── popup/
│   ├── popup.html / .css    → UI
│   └── popup.js             → UI logic, dispatches commands, shows resume prompt
└── lib/
    ├── messages.js          → typed message contract (MsgType enum + JSDoc types)
    ├── logger.js            → debug-toggle logging helpers
    ├── discovery.js         → conversation discovery for all three scopes
    ├── schema.js            → NormalizedConversation extraction from ChatGPT API
    ├── naming.js            → file name / slug / folder utilities
    ├── images.js            → image asset fetcher
    ├── jszip.min.js         → bundled JSZip (no CDN)
    ├── highlight.min.js     → bundled highlight.js (no CDN)
    └── exporter/
        ├── html.js          → HTML formatter (inline CSS, Base64 images)
        ├── markdown.js      → GFM formatter (code fences, image refs)
        ├── json.js          → JSON schema exporter
        └── packager.js      → ZIP assembly, index.html, summary report
```

## Permissions

| Permission | Justification |
|---|---|
| `activeTab` | Read the currently active chatgpt.com tab |
| `scripting` | Inject content script for DOM access |
| `downloads` | Trigger ZIP file download |
| `storage` | Persist preferences and resume state |
| `host_permissions: chatgpt.com/*` | Scoped host access only |

## Development

No build step required — the extension uses native ES modules. Load unpacked and reload after edits.

Run smoke tests for naming + exporters:

```bash
node tests/smoke-exporters.mjs
```

Run exporter performance smoke test:

```bash
node tests/perf-smoke.mjs
```

Run extension security/policy checks:

```bash
./tests/security-checks.sh
```

To enable verbose debug logging, open the DevTools console for the service worker or content script and run:

```javascript
// In content script context (chatgpt.com DevTools):
import { logger } from chrome.runtime.getURL("lib/logger.js");
logger.setDebug(true);
```

Or set `CHATGPT_EXPORTER_DEBUG: true` in `chrome.storage.local`.

## License

[MIT](./LICENSE)
