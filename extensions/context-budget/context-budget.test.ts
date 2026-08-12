import assert from "node:assert/strict";
import test from "node:test";
import contextBudgetExtension, { boundInspectionResults, boundToolResult } from "./index.js";

test("large built-in inspection results keep bounded head and tail in model context", () => {
  const source = `HEAD-${"ã".repeat(5000)}-TAIL`;
  const message = {
    role: "toolResult",
    toolName: "bash",
    toolCallId: "x",
    content: [{ type: "text", text: source }],
    details: { fullOutputPath: "/tmp/full" },
  };
  const bounded = boundToolResult(message, 4096);
  const text = bounded.content[0]?.text ?? "";
  assert(Buffer.byteLength(text, "utf8") <= 4096);
  assert.match(text, /^HEAD-/);
  assert.match(text, /-TAIL$/);
  assert.match(text, /Context budget: middle omitted/);
  assert.equal(message.content[0]?.text, source, "stored/UI message is not mutated");
  assert.deepEqual(bounded.details, message.details);
});

test("small, non-text, and extension tool results pass through unchanged", () => {
  const small = { role: "toolResult", toolName: "read", content: [{ type: "text", text: "small" }] };
  const image = { role: "toolResult", toolName: "read", content: [{ type: "image", data: "x" }] };
  const extension = { role: "toolResult", toolName: "memory", content: [{ type: "text", text: "x".repeat(9000) }] };
  assert.equal(boundToolResult(small, 4096), small);
  assert.equal(boundToolResult(image, 4096), image);
  assert.equal(boundToolResult(extension, 4096), extension);
});

test("aggregate budget retains newest inspection evidence and receipts older results", () => {
  const messages = Array.from({ length: 4 }, (_, index) => ({
    role: "toolResult",
    toolName: index % 2 ? "read" : "bash",
    content: [{ type: "text", text: `${index}-${"x".repeat(5000)}` }],
  }));
  const bounded = boundInspectionResults(messages, 6000, 11_000);
  assert.match(bounded[0].content[0]?.text ?? "", /earlier bash result/);
  assert.match(bounded[1].content[0]?.text ?? "", /earlier read result/);
  assert.match(bounded[2].content[0]?.text ?? "", /^2-/);
  assert.match(bounded[3].content[0]?.text ?? "", /^3-/);
  assert.match(messages[0].content[0]?.text ?? "", /^0-/, "stored source messages are not mutated");
});

test("context hook does not persist or accumulate bounded copies", async () => {
  let handler: any;
  contextBudgetExtension({ on(name: string, value: any) { if (name === "context") handler = value; } } as any);
  const ctx = { sessionManager: { getSessionId() { return "s1"; } } };
  const original = { role: "toolResult", toolName: "bash", toolCallId: "a", content: [{ type: "text", text: "x".repeat(20000) }] };
  const first = await handler({ messages: [original] }, ctx);
  const second = await handler({ messages: [original] }, ctx);
  assert.equal(first.messages.length, 1);
  assert.equal(second.messages.length, 1);
  assert.equal(original.content[0]?.text.length, 20000);
  assert.equal(first.messages[0].content[0].text, second.messages[0].content[0].text);
});

test("a result already sent in full never flips to a stub once new results arrive", () => {
  const settled = new Map<string, boolean>();
  const early = { role: "toolResult", toolName: "bash", toolCallId: "1", content: [{ type: "text", text: "1-" + "x".repeat(5000) }] };

  const turn1 = boundInspectionResults([early], 6000, 11_000, settled);
  assert.match(turn1[0].content[0]?.text ?? "", /^1-/, "fits alone and is kept in full");

  // A second, larger result arrives on a later turn. Under a naive trailing-byte window this
  // would push `early` out of budget and rewrite content the provider may have already cached.
  const late = { role: "toolResult", toolName: "read", toolCallId: "2", content: [{ type: "text", text: "2-" + "x".repeat(9000) }] };
  const turn2 = boundInspectionResults([early, late], 10_000, 11_000, settled);
  assert.match(turn2[0].content[0]?.text ?? "", /^1-/, "already-settled result stays full even though it no longer fits the naive window");
  assert.match(turn2[1].content[0]?.text ?? "", /earlier read result/, "the new, larger result is stubbed instead of the settled one");
});

test("new results are still recency-prioritized against the budget that remains", () => {
  const settled = new Map<string, boolean>();
  const a = { role: "toolResult", toolName: "bash", toolCallId: "a", content: [{ type: "text", text: "a-" + "x".repeat(5000) }] };
  const b = { role: "toolResult", toolName: "bash", toolCallId: "b", content: [{ type: "text", text: "b-" + "x".repeat(5000) }] };
  const bounded = boundInspectionResults([a, b], 6000, 6000, settled);
  assert.match(bounded[0].content[0]?.text ?? "", /earlier bash result/, "older of two simultaneously-new results is stubbed");
  assert.match(bounded[1].content[0]?.text ?? "", /^b-/, "newer of two simultaneously-new results is kept");
});
