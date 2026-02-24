export function renderMarkdownConversation(conversation) {
  const title = conversation?.title || "Untitled Chat";
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];

  const lines = [`# ${title}`, ""];
  for (const message of messages) {
    const role = message?.role || "unknown";
    const content = String(message?.content || "").trim();
    lines.push(`## ${role}`);
    lines.push("");
    lines.push(content || "_(empty)_");
    lines.push("");
  }

  // TODO(v1): Add proper code fences, image references, and link preservation.
  return lines.join("\n");
}
