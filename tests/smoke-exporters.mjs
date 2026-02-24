import assert from "node:assert/strict";
import { buildFileName, slugify, formatDate } from "../lib/naming.js";
import { renderJsonConversation } from "../lib/exporter/json.js";
import { renderMarkdownConversation } from "../lib/exporter/markdown.js";
import { renderHtmlConversation } from "../lib/exporter/html.js";

const sampleConversation = {
  id: "conv_abc123",
  title: "Hello / World: Test Chat",
  createTime: 1708000000,
  updateTime: 1708003600,
  model: "gpt-4o",
  customGptName: null,
  messages: [
    {
      id: "msg_1",
      role: "user",
      createTime: 1708000001,
      parts: [{ type: "text", text: "Write hello world in python." }]
    },
    {
      id: "msg_2",
      role: "assistant",
      createTime: 1708000002,
      parts: [
        { type: "code", language: "python", text: "print('hello world')" },
        { type: "image", assetId: "file-service://file-xyz", width: 640, height: 480, mimeType: "image/png" }
      ]
    }
  ]
};

function testNaming() {
  assert.equal(slugify("Hello / World"), "hello-world");
  assert.equal(formatDate(1708000000), "2024-02-15");

  const used = new Set();
  const a = buildFileName(sampleConversation, "{date}_{title}", used);
  const b = buildFileName(sampleConversation, "{date}_{title}", used);
  assert.notEqual(a, b, "collisions should be de-duplicated");
}

function testJsonExporter() {
  const jsonText = renderJsonConversation(sampleConversation);
  const parsed = JSON.parse(jsonText);
  assert.equal(parsed.id, "conv_abc123");
  assert.equal(parsed.model, "gpt-4o");
  assert.equal(parsed.messages.length, 2);
  assert.match(parsed.messages[1].content, /```python/);
}

function testMarkdownExporter() {
  const imageMap = new Map([["file-service://file-xyz", "chat_0.png"]]);
  const md = renderMarkdownConversation(sampleConversation, imageMap);
  assert.match(md, /^# Hello \/ World: Test Chat/m);
  assert.match(md, /```python/);
  assert.match(md, /!\[image\]\(\.\/images\/chat_0\.png\)/);
}

function testHtmlExporter() {
  const dataUrlMap = new Map([["file-service://file-xyz", "data:image/png;base64,abc123"]]);
  const html = renderHtmlConversation(sampleConversation, dataUrlMap, "window.hljs={highlightElement(){}};");
  assert.match(html, /<title>Hello \/ World: Test Chat<\/title>/);
  assert.match(html, /data:image\/png;base64,abc123/);
  assert.match(html, /hljs\.highlightElement/);
}

function main() {
  testNaming();
  testJsonExporter();
  testMarkdownExporter();
  testHtmlExporter();
  console.log("smoke-exporters: all checks passed");
}

main();
