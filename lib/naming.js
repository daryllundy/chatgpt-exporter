/**
 * File Naming Utility
 *
 * Generates deterministic, collision-resistant file names for exported
 * conversation artifacts based on a user-configurable template.
 *
 * Default template: `{date}_{title}`
 * Supported tokens: {date}, {title}, {id}
 *
 * Slugification rules (per PRD §6.3):
 *   - Lowercase
 *   - Replace spaces and special characters with hyphens
 *   - Collapse consecutive hyphens
 *   - Max 80 characters for the slug component
 *   - Strip leading/trailing hyphens
 */

/**
 * Build a file base name (without extension) for a conversation.
 *
 * @param {import("./schema.js").NormalizedConversation} conversation
 * @param {string} [template]   defaults to "{date}_{title}"
 * @param {Set<string>} [used]  tracks used names across a batch to handle collisions
 * @returns {string}
 */
export function buildFileName(conversation, template = "{date}_{title}", used = new Set()) {
  const dateStr = formatDate(conversation.updateTime ?? conversation.createTime ?? null);
  const titleSlug = slugify(conversation.title || "untitled-chat");
  const idSlug    = slugify(conversation.id || "no-id");

  let base = template
    .replace("{date}",  dateStr)
    .replace("{title}", titleSlug)
    .replace("{id}",    idSlug);

  // Clip the whole base to 100 chars (generous, to leave room for ext)
  base = base.slice(0, 100);

  // Collision resolution: append -2, -3, … until unique
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix++;
  }
  used.add(candidate);
  return candidate;
}

/**
 * Slugify a string: lowercase, ascii, hyphens, max 80 chars.
 * @param {string} text
 * @returns {string}
 */
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFD")                         // decompose accented chars
    .replace(/[\u0300-\u036f]/g, "")          // strip combining marks
    .replace(/[^a-z0-9]+/g, "-")             // non-alphanumeric → hyphen
    .replace(/^-+|-+$/g, "")                  // trim hyphens
    .slice(0, 80)
    .replace(/-+$/g, "");                     // re-trim after slice
}

/**
 * Format a Unix-seconds timestamp as "YYYY-MM-DD".
 * Falls back to today's date if null.
 * @param {number|null} unixSeconds
 * @returns {string}
 */
export function formatDate(unixSeconds) {
  const d = (unixSeconds != null)
    ? new Date(unixSeconds * 1000)
    : new Date();
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const dd   = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Determine whether a conversation belongs to a Custom GPT and return
 * the folder path prefix for it.
 *
 * @param {import("./schema.js").NormalizedConversation} conversation
 * @returns {string}  e.g. "custom-gpts/MyGPT/" or "chats/"
 */
export function getFolderPrefix(conversation) {
  if (conversation.customGptName) {
    return `custom-gpts/${slugify(conversation.customGptName)}/`;
  }
  return "chats/";
}
