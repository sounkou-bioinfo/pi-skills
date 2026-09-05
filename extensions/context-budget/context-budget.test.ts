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

test("new evidence displaces old history rather than consuming a lifetime quota", () => {
  const history = Array.from({ length: 16 }, (_, i) => ({
    role: "toolResult", toolName: "read", toolCallId: String(i), content: [{ type: "text", text: "x".repeat(4096) }],
  }));
  for (let i = 1; i <= history.length; i++) boundInspectionResults(history.slice(0, i), 4096, 65536);
  const fresh = { role: "toolResult", toolName: "read", toolCallId: "fresh", content: [{ type: "text", text: "NEW EVIDENCE" }] };
  const first = boundInspectionResults([...history, fresh], 4096, 65536);
  assert.equal(first.at(-1)?.content[0].text, "NEW EVIDENCE");
  assert.match(first[0].content[0].text, /omitted/);
  const retry = { ...fresh, toolCallId: "retry" };
  assert.equal(boundInspectionResults([...history, fresh, retry], 4096, 65536).at(-1)?.content[0].text, "NEW EVIDENCE");
});

test("the newest large result fits even when the total cap is below the per-result cap", () => {
  const fresh = { role: "toolResult", toolName: "read", content: [{ type: "text", text: "HEAD-" + "x".repeat(50000) }] };
  const bounded = boundInspectionResults([fresh], 50000, 16384);
  assert.match(bounded[0].content[0].text, /^HEAD-/);
  assert(Buffer.byteLength(bounded[0].content[0].text) <= 16384);
});
