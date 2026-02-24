/**
 * HTML Exporter
 *
 * Renders a NormalizedConversation to a standalone HTML file:
 *   - Self-contained: inline styles only, no CDN dependencies
 *   - Syntax-highlighted code blocks via bundled highlight.js
 *   - Base64-embedded images
 *   - Print-to-PDF friendly layout
 *
 * @param {import("../schema.js").NormalizedConversation} conversation
 * @param {Map<string,string>} [imageDataUrls]  assetId → "data:image/...;base64,..." mapping
 * @returns {string}
 */
export function renderHtmlConversation(conversation, imageDataUrls = new Map()) {
  const title    = escapeHtml(conversation.title || "Untitled Chat");
  const messages = Array.isArray(conversation.messages) ? conversation.messages : [];

  const bodyHtml = messages.map((message) => renderMessage(message, imageDataUrls)).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
${INLINE_CSS}
  </style>
  <script>
${HIGHLIGHT_INIT}
  </script>
</head>
<body>
  <main class="conversation">
    <h1 class="conv-title">${title}</h1>
${bodyHtml}
  </main>
</body>
</html>`;
}

// ─── Message Rendering ────────────────────────────────────────────────────────

/**
 * @param {import("../schema.js").NormalizedMessage} message
 * @param {Map<string,string>} imageDataUrls
 * @returns {string}
 */
function renderMessage(message, imageDataUrls) {
  const role  = String(message.role || "unknown");
  const label = ROLE_LABELS[role] || escapeHtml(role);
  const parts = Array.isArray(message.parts) ? message.parts : [];

  const partsHtml = parts.map((part) => renderPart(part, imageDataUrls)).join("\n");
  const roleClass = `role-${role.replace(/[^a-z]/g, "")}`;

  return `    <article class="message ${roleClass}">
      <h2 class="role-label">${label}</h2>
      <div class="content">${partsHtml}</div>
    </article>`;
}

/**
 * @param {import("../schema.js").ContentPart} part
 * @param {Map<string,string>} imageDataUrls
 * @returns {string}
 */
function renderPart(part, imageDataUrls) {
  if (part.type === "text") {
    return `<p class="text-part">${escapeHtml(part.text).replace(/\n/g, "<br>")}</p>`;
  }
  if (part.type === "code") {
    const lang = escapeHtml(part.language || "");
    const code = escapeHtml(part.text);
    return `<pre><code class="language-${lang}">${code}</code></pre>`;
  }
  if (part.type === "image") {
    const src = imageDataUrls.get(part.assetId) || "";
    const alt = `Uploaded image (${part.assetId})`;
    if (src) {
      return `<figure class="image-part"><img src="${src}" alt="${escapeHtml(alt)}" style="max-width:100%"></figure>`;
    }
    return `<p class="image-placeholder">[Image: ${escapeHtml(part.assetId)}]</p>`;
  }
  return "";
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const ROLE_LABELS = {
  user:      "👤 User",
  assistant: "🤖 Assistant",
  system:    "⚙️ System",
  tool:      "🔧 Tool"
};

// ─── Inline Styles ────────────────────────────────────────────────────────────

const INLINE_CSS = `
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      background: #f9fafb; color: #111827;
      margin: 0; padding: 24px;
      line-height: 1.6;
    }
    .conversation { max-width: 800px; margin: 0 auto; }
    .conv-title { font-size: 22px; font-weight: 700; margin-bottom: 20px; color: #111827; }
    .message {
      border: 1px solid #e5e7eb; border-radius: 12px;
      padding: 16px 20px; margin-bottom: 16px; background: #fff;
    }
    .role-user    { border-left: 4px solid #3b82f6; }
    .role-assistant { border-left: 4px solid #10b981; }
    .role-tool    { border-left: 4px solid #f59e0b; }
    .role-label { font-size: 13px; font-weight: 600; margin: 0 0 10px; color: #6b7280; }
    .content { font-size: 15px; }
    .text-part { margin: 0 0 10px; white-space: pre-wrap; word-break: break-word; }
    pre {
      background: #1e293b; color: #e2e8f0;
      border-radius: 8px; padding: 14px 16px;
      overflow-x: auto; margin: 10px 0;
      font-size: 13px;
    }
    code { font-family: "Cascadia Code", "Fira Code", Consolas, monospace; }
    .image-part img { border-radius: 8px; border: 1px solid #e5e7eb; }
    .image-placeholder { color: #9ca3af; font-style: italic; }
    @media print {
      body { background: #fff; padding: 0; }
      .message { break-inside: avoid; }
    }
`.trim();

// Initialise highlight.js if it was injected by the extension
const HIGHLIGHT_INIT = `
  document.addEventListener("DOMContentLoaded", function() {
    if (typeof hljs !== "undefined") {
      document.querySelectorAll("pre code").forEach(function(el) {
        hljs.highlightElement(el);
      });
    }
  });
`.trim();
