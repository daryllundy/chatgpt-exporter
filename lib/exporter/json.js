export function renderJsonConversation(conversation) {
  // TODO(v1): Align to final normalized schema and include all required fields.
  const payload = {
    id: conversation?.id || "",
    title: conversation?.title || "",
    create_time: conversation?.create_time || null,
    update_time: conversation?.update_time || null,
    model: conversation?.model || null,
    custom_gpt: conversation?.custom_gpt || null,
    messages: Array.isArray(conversation?.messages) ? conversation.messages : []
  };

  return JSON.stringify(payload, null, 2);
}
