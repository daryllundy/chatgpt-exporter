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
  // Handle inline data URIs (common in DOM fallback and some generated images).
  if (assetId.startsWith("data:")) {
    return decodeDataUriAsset(assetId);
  }

  // Blob URLs often come from in-page rendered assets and may not be fetchable
  // directly from extension context. Try fetch first, then DOM extraction.
  if (assetId.startsWith("blob:")) {
    const fetched = await fetchImageFromUrl(assetId, mimeType);
    if (fetched) return fetched;
    return extractBlobImageFromDom(assetId, mimeType);
  }

  // Handle direct http(s) image URLs captured from the DOM.
  if (assetId.startsWith("http://") || assetId.startsWith("https://")) {
    return fetchImageFromUrl(assetId, mimeType);
  }

  // asset_pointer format: "file-service://file-<UUID>"
  // Actual URL: https://files.oaiusercontent.com/file-<UUID>
  const fileId = assetId.replace(/^file-service:\/\//, "");
  const url = `https://files.oaiusercontent.com/${fileId}`;

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
 * Fetch image bytes from a normal URL.
 *
 * @param {string} url
 * @param {string} fallbackMimeType
 * @returns {Promise<ImageRecord|null>}
 */
async function fetchImageFromUrl(url, fallbackMimeType) {
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

  const contentType = resp.headers.get("content-type") || fallbackMimeType || inferMimeTypeFromUrl(url);
  const bytes = await resp.arrayBuffer();
  return { assetId: url, bytes, mimeType: contentType };
}

/**
 * Decode a data URI into an ImageRecord.
 *
 * @param {string} dataUri
 * @returns {ImageRecord|null}
 */
function decodeDataUriAsset(dataUri) {
  const m = dataUri.match(/^data:([^;,]+)?((?:;[^,]+)*)?,(.*)$/i);
  if (!m) {
    logger.warn("Invalid data URI image asset");
    return null;
  }

  const mime = m[1] || "image/png";
  const attrs = m[2] || "";
  const payload = m[3] || "";
  const isBase64 = /;base64/i.test(attrs);
  try {
    if (isBase64) {
      const raw = atob(payload);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) {
        bytes[i] = raw.charCodeAt(i);
      }
      return {
        assetId: dataUri,
        bytes: bytes.buffer,
        mimeType: mime
      };
    }

    // Non-base64 data URIs are URL-encoded bytes.
    const decoded = decodeURIComponent(payload);
    const bytes = new TextEncoder().encode(decoded);
    return {
      assetId: dataUri,
      bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      mimeType: mime
    };
  } catch (err) {
    logger.warn("Failed to decode data URI image asset", err);
    return null;
  }
}

function inferMimeTypeFromUrl(url) {
  const lower = url.toLowerCase();
  if (lower.includes(".jpg") || lower.includes(".jpeg")) return "image/jpeg";
  if (lower.includes(".webp")) return "image/webp";
  if (lower.includes(".gif")) return "image/gif";
  return "image/png";
}

/**
 * Attempt to recover blob URL images directly from rendered DOM nodes.
 * This avoids extension-context blob fetch limitations.
 *
 * @param {string} blobUrl
 * @param {string} fallbackMimeType
 * @returns {Promise<ImageRecord|null>}
 */
async function extractBlobImageFromDom(blobUrl, fallbackMimeType) {
  const imgs = Array.from(document.querySelectorAll("img[src], img"));
  const img = imgs.find((node) => node.currentSrc === blobUrl || node.src === blobUrl);
  if (!img) {
    logger.warn("Blob image not found in DOM for", blobUrl);
    return null;
  }

  if (!img.complete) {
    await waitForImageLoad(img, 3000).catch(() => {});
  }

  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (!width || !height) {
    logger.warn("Blob image has no render dimensions for", blobUrl);
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    logger.warn("Failed to create canvas context for blob image");
    return null;
  }

  try {
    ctx.drawImage(img, 0, 0, width, height);
  } catch (err) {
    logger.warn("Failed to draw blob image to canvas", err);
    return null;
  }

  const blob = await canvasToBlob(canvas, fallbackMimeType || "image/png");
  if (!blob) {
    logger.warn("Failed to convert canvas to blob for", blobUrl);
    return null;
  }
  const bytes = await blob.arrayBuffer();
  return {
    assetId: blobUrl,
    bytes,
    mimeType: blob.type || fallbackMimeType || "image/png"
  };
}

function canvasToBlob(canvas, mimeType) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType);
  });
}

function waitForImageLoad(img, timeoutMs) {
  return new Promise((resolve, reject) => {
    const onLoad = () => done(resolve);
    const onError = () => done(() => reject(new Error("image-load-failed")));
    const timeoutId = setTimeout(() => done(() => reject(new Error("image-load-timeout"))), timeoutMs);

    function done(cb) {
      clearTimeout(timeoutId);
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onError);
      cb();
    }

    img.addEventListener("load", onLoad);
    img.addEventListener("error", onError);
  });
}

/**
 * @typedef {Object} ImageRecord
 * @property {string}       assetId
 * @property {ArrayBuffer}  bytes
 * @property {string}       mimeType
 */
