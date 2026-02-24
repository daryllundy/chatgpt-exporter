# ChatGPT Exporter Implementation Plan

## Objective
Ship v1.0 of a Chrome MV3 extension that exports ChatGPT conversations from `chatgpt.com` into a ZIP containing HTML, Markdown, and/or JSON files with resume support.

## Success Criteria
- Export modes: current chat, selected chats, full account dump.
- Output formats: HTML, Markdown, JSON (multi-select supported).
- One ZIP download via `chrome.downloads`.
- Resume/cancel works across popup close/reopen and browser restart.
- No third-party network requests by extension code.

## Constraints
- MV3 only.
- Host scope restricted to `https://chatgpt.com/*`.
- No remote code execution (`eval`, remote scripts).
- Preferences and resume state stored in `chrome.storage.local`.

## Workstreams

### 1. Foundation (Milestone: runnable extension shell)
- [x] Finalize manifest and permission model.
- [x] Wire popup <-> service worker <-> content script messaging.
- [x] Add typed message contract (command and progress event names).
- [x] Add extension-local logging helpers with debug toggle.

Deliverable:
- Extension loads unpacked, popup opens, health check message roundtrip succeeds.

### 2. Conversation Discovery (Milestone: stable IDs list)
- [x] Implement current-chat discovery.
- [x] Implement selectable chat list extraction for manual selection mode.
- [x] Implement full account enumeration with pagination/scroll handling.
- [x] Normalize conversation metadata (`id`, `title`, `updatedAt`, `customGptName`).

Deliverable:
- Service worker receives deterministic conversation ID list for each export scope.

### 3. Normalized Data Model (Milestone: one canonical schema)
- [x] Define internal `NormalizedConversation` schema.
- [x] Implement extraction pipeline from page state/API responses with DOM fallback.
- [x] Parse message roles, timestamps, code blocks, links, and images.
- [x] Add schema validation and fallback defaults.

Deliverable:
- Each conversation transforms into a single canonical object used by all exporters.

### 4. Exporters (Milestone: artifact generation)
- [ ] JSON exporter aligned with PRD schema.
- [ ] Markdown exporter (GFM fences, links, image paths).
- [ ] HTML exporter (inline styles, syntax-highlight ready blocks, print-friendly markup).
- [ ] Shared slug + file naming utility (`{date}_{title}`, `{id}_{title}` templates).
- [ ] Collision handling for duplicate titles.

Deliverable:
- For one conversation, all selected formats are generated with deterministic file paths.

### 5. Assets + ZIP Packaging (Milestone: downloadable bundle)
- [ ] Implement image extraction and naming (`{conv-slug}_{index}.png`).
- [ ] Store image files for Markdown/JSON.
- [ ] Embed Base64 images in HTML output.
- [ ] Build `index.html` linking all chat artifacts.
- [ ] Package ZIP with folder layout:
  - `/chats`
  - `/custom-gpts/<name>`
  - `/images`
- [ ] Trigger download with `chrome.downloads`.

Deliverable:
- End-to-end export produces a valid ZIP that opens correctly offline.

### 6. Resume + Control Flow (Milestone: robust long-run behavior)
- [ ] Define `resumeState` schema with versioning.
- [ ] Checkpoint after each conversation artifact set.
- [ ] Resume prompt and flow when an unfinished export exists.
- [ ] Cancel flow that safely clears state and stops workers.
- [ ] Partial failure handling and summary report file in ZIP.

Deliverable:
- Interrupted runs recover without duplicated or missing conversations.

### 7. Popup UX (Milestone: usable v1 interface)
- [ ] Scope controls: current / selected / full.
- [ ] Format multi-select controls.
- [ ] Export button enable/disable logic.
- [ ] Live progress text with ETA and counts.
- [ ] Settings panel: naming template, default formats, reset preferences.

Deliverable:
- User can configure and run exports entirely from popup + in-page selector.

### 8. QA + Hardening (Milestone: release-ready v1.0)
- [ ] Test matrix: small (1-10), medium (50), large (100+) chats.
- [ ] Browser restart resume test.
- [ ] Verify deterministic output names and link integrity.
- [ ] Validate JSON schema outputs.
- [ ] Performance profiling and memory guardrails.
- [ ] Manual security checklist (permissions, CSP, no remote assets).

Deliverable:
- Release candidate with passing acceptance checks.

## Suggested Task Sequence
1. Foundation
2. Conversation discovery
3. Normalized data model
4. JSON exporter
5. Markdown exporter
6. HTML exporter
7. Assets + ZIP
8. Resume/cancel
9. Popup polish
10. QA + release notes

## Backlog (Post-v1)
- [ ] Chrome Web Store packaging and listing.
- [ ] Additional AI platform adapters (Claude, Gemini).
- [ ] Export integrity checksum report.
- [ ] Optional CLI converter for exported JSON.

## Risks and Mitigations
- Risk: ChatGPT DOM/state changes break extraction.
  - Mitigation: layered extractors + feature flags + fallback parser.
- Risk: MV3 worker suspension during large exports.
  - Mitigation: keep long-running extraction in tab context, use worker as coordinator.
- Risk: memory spikes on full dump ZIP assembly.
  - Mitigation: chunk processing, conservative batching, early checkpointing.

## Definition of Done (v1.0)
- [ ] All success criteria met.
- [ ] QA checklist complete.
- [ ] MIT license and install instructions present.
- [ ] Unpacked install tested on clean Chrome profile.
