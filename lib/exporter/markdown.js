/**
 * Markdown (GFM) Exporter
 *
 * Renders a NormalizedConversation to GitHub-Flavored Markdown:
 *   - H1 for conversation title
 *   - H2 per message role (bold-prefixed)
 *   - Fenced code blocks with language tags
 *   - Image references as ![alt](./images/filename)
 *   - Standard links and blockquotes preserved
 *
 * @param {import("../schema.js").NormalizedConversation} conversation
 * @param {Map<string,string>} [imageFileNames]  assetId → file basename mapping
 * @returns {string}
 */
export function renderMarkdownConversation(conversation, imageFileNames = new Map()) {
  const title    = conversation.title || "Untitled Chat";
  const messages = Array.isArray(conversation.messages) ? conversation.messages : [];

  const lines = [`# ${title}`, ""];

  for (const message of messages) {
    const role = formatRole(message.role || "unknown");
    lines.push(`## ${role}`);
    lines.push("");

    if (!Array.isArray(message.parts) || message.parts.length === 0) {
      lines.push("_(empty)_");
      lines.push("");
      continue;
    }

    for (const part of message.parts) {
      if (part.type === "text") {
        lines.push(part.text.trim() || "_(empty)_");
        lines.push("");
      } else if (part.type === "code") {
        const lang = part.language || "";
        lines.push(`\`\`\`${lang}`);
        lines.push(part.text);
        lines.push("```");
        lines.push("");
      } else if (part.type === "image") {
        const fileName = imageFileNames.get(part.assetId) || `${part.assetId}.png`;
        lines.push(`![image](./images/${fileName})`);
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

/**
 * Capitalizes and formats a message role label for display.
 * @param {string} role
 * @returns {string}
 */
function formatRole(role) {
  const map = {
    user:      "👤 User",
    assistant: "🤖 Assistant",
    system:    "⚙️ System",
    tool:      "🔧 Tool"
  };
  return map[role] || role.charAt(0).toUpperCase() + role.slice(1);
}
