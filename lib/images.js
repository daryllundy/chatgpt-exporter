/**
 * Image Asset Fetcher
 *
 * Fetches image assets embedded in ChatGPT conversations.
 * Runs in the content-script context so auth cookies are sent automatically.
 *
 * ChatGPT stores uploaded images in file-service.openai.com;
 * generated images are served inline as data URIs in some models.
 */

import { logger } from "./logger.js";

/**
 * Fetch all images referenced in a conversation's messages.
 *
 * @param {import("./schema.js").NormalizedConversation} conversation
 * @returns {Promise<ImageRecord[]>}
 */
export async function fetchConversationImages(conversation) {
  const images = [];
  const seen   = new Set();

  const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
  for (const msg of messages) {
    const parts = Array.isArray(msg.parts) ? msg.parts : [];
    for (const part of parts) {
      if (part.type !== "image") continue;
      if (seen.has(part.assetId)) continue;
      seen.add(part.assetId);

      try {
        const record = await fetchImageAsset(part.assetId, part.mimeType);
        if (record) images.push(record);
      } catch (err) {
        logger.warn("Failed to fetch image", part.assetId, err);
      }
    }
  }

  return images;
}

/**
 * Fetch a single image asset by ID.
 * The file-service URL pattern is used by ChatGPT for user uploads.
 *
 * @param {string} assetId
 * @param {string} [mimeType]
 * @returns {Promise<ImageRecord|null>}
 */
async function fetchImageAsset(assetId, mimeType = "image/png") {
  // asset_pointer format: "file-service://file-<UUID>"
  // Actual URL: https://files.oaiusercontent.com/file-<UUID>
  const fileId = assetId.replace(/^file-service:\/\//, "");
  const url    = `https://files.oaiusercontent.com/${fileId}`;

  let resp;
  try {
    resp = await fetch(url, { credentials: "include" });
  } catch {
    logger.warn("Image fetch network error for", url);
    return null;
  }

  if (!resp.ok) {
    logger.warn("Image HTTP error", resp.status, "for", url);
    return null;
  }

  const contentType = resp.headers.get("content-type") || mimeType;
  const bytes = await resp.arrayBuffer();
  return { assetId, bytes, mimeType: contentType };
}

/**
 * @typedef {Object} ImageRecord
 * @property {string}       assetId
 * @property {ArrayBuffer}  bytes
 * @property {string}       mimeType
 */
