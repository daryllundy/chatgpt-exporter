/**
 * JSON Exporter
 *
 * Serializes a NormalizedConversation into the canonical JSON schema
 * described in the PRD (mirrors ChatGPT's own export format).
 *
 * @param {import("../schema.js").NormalizedConversation} conversation
 * @returns {string}  pretty-printed JSON
 */
export function renderJsonConversation(conversation) {
  const payload = {
    id:          conversation.id         || "",
    title:       conversation.title      || "",
    create_time: conversation.createTime ?? null,
    update_time: conversation.updateTime ?? null,
    model:       conversation.model      ?? null,
    custom_gpt:  conversation.customGptName ?? null,
    messages: (Array.isArray(conversation.messages) ? conversation.messages : []).map((m) => ({
      id:          m.id         || "",
      role:        m.role       || "unknown",
      content:     flattenPartsToText(m.parts),
      create_time: m.createTime ?? null
    }))
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Flatten content parts to a plain string for the JSON schema.
 * Code blocks are rendered as fenced markdown so they remain readable.
 * @param {import("../schema.js").ContentPart[]} parts
 * @returns {string}
 */
function flattenPartsToText(parts) {
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "code") {
        const lang = part.language || "";
        return `\`\`\`${lang}\n${part.text}\n\`\`\``;
      }
      if (part.type === "image") return `[image: ${part.assetId}]`;
      return "";
    })
    .join("\n\n");
}
