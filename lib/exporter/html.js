function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function renderHtmlConversation(conversation) {
  const title = conversation?.title || "Untitled Chat";
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  const body = messages
    .map((message) => {
      const role = escapeHtml(message?.role || "unknown");
      const content = escapeHtml(message?.content || "");
      return `<article class="message"><h2>${role}</h2><pre>${content}</pre></article>`;
    })
    .join("");

  // TODO(v1): Add syntax highlighting hooks, image embedding, and print CSS.
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #111; }
    .message { border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin-bottom: 12px; }
    pre { white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${body}
</body>
</html>`;
}
