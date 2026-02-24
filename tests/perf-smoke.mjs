import assert from "node:assert/strict";
import { renderJsonConversation } from "../lib/exporter/json.js";
import { renderMarkdownConversation } from "../lib/exporter/markdown.js";
import { renderHtmlConversation } from "../lib/exporter/html.js";

function makeConversation(i) {
  return {
    id: `conv_${i}`,
    title: `Synthetic Chat ${i}`,
    createTime: 1708000000 + i,
    updateTime: 1708003600 + i,
    model: "gpt-4o",
    customGptName: null,
    messages: [
      {
        id: `u_${i}`,
        role: "user",
        createTime: 1708000001 + i,
        parts: [{ type: "text", text: "Generate an example." }]
      },
      {
        id: `a_${i}`,
        role: "assistant",
        createTime: 1708000002 + i,
        parts: [
          { type: "text", text: "Sure, here's a snippet." },
          { type: "code", language: "js", text: "console.log('hello')" }
        ]
      }
    ]
  };
}

function main() {
  const batchSize = 250;
  const dataset = Array.from({ length: batchSize }, (_, i) => makeConversation(i));

  const t0 = Date.now();
  for (const conv of dataset) {
    const json = renderJsonConversation(conv);
    const md = renderMarkdownConversation(conv, new Map());
    const html = renderHtmlConversation(conv, new Map(), "");
    assert.ok(json.length > 0);
    assert.ok(md.length > 0);
    assert.ok(html.length > 0);
  }
  const elapsed = Date.now() - t0;
  console.log(`perf-smoke: rendered ${batchSize} conversations in ${elapsed}ms`);

  // Keep this intentionally loose to avoid machine-specific false failures.
  assert.ok(elapsed < 10000, "Exporter rendering exceeded 10s guardrail");
}

main();
