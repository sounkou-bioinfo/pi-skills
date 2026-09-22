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

test("inspection text is retained as a contiguous newest suffix without older backfill", () => {
  const messages = [200, 900, 300].map((bytes, index) => ({
    role: "toolResult", toolName: "read", toolCallId: String(index),
    content: [{ type: "text", text: String(index).repeat(bytes) }],
  }));
  const before = boundInspectionResults(messages.slice(0, 2), 1000, 1000);
  const after = boundInspectionResults(messages, 1000, 1000);
  assert.match(before[0].content[0].text, /earlier read result/);
  assert.deepEqual(after[0], before[0], "the earlier omission remains byte-for-byte stable");
  assert.match(after[1].content[0].text, /earlier read result/);
  assert.equal(after[2], messages[2], "fresh evidence is retained even with unused budget");
});

test("append-only mixed-size histories preserve omitted prefixes and bounded fresh evidence", () => {
  const messages = [200, 900, 300, 800, 0, 1, 1000, 1250, 160, 999, 50, 2100].map((bytes, index) => ({
    role: "toolResult", toolName: "read", toolCallId: String(index),
    content: [{ type: "text", text: "x".repeat(bytes) }],
  }));
  let previous: typeof messages = [];
  for (let length = 1; length <= messages.length; length++) {
    const current = boundInspectionResults(messages.slice(0, length), 1000, 1000);
    const cutoff = previous.map((message) => message.content[0].text.startsWith("[Context budget: earlier")).lastIndexOf(true);
    assert.deepEqual(current.slice(0, cutoff + 1), previous.slice(0, cutoff + 1), `stable prefix at length ${length}`);
    assert.deepEqual(current.at(-1), boundToolResult(messages[length - 1], 1000), `fresh evidence at length ${length}`);
    previous = current;
  }
});

test("shortened and independent branch histories recompute their own retained suffix", () => {
  const messages = [200, 900, 300].map((bytes, index) => ({
    role: "toolResult", toolName: "read", toolCallId: String(index),
    content: [{ type: "text", text: "x".repeat(bytes) }],
  }));
  const full = boundInspectionResults(messages, 1000, 1000);
  const shortened = messages.slice(0, 1);
  const branch = [messages[0], { ...messages[2], toolCallId: "branch" }];
  assert.deepEqual(boundInspectionResults(shortened, 1000, 1000), shortened);
  assert.deepEqual(boundInspectionResults(branch, 1000, 1000), branch);
  assert.deepEqual(boundInspectionResults(messages, 1000, 1000), full);
});

test("UTF-8 text and part separators fill the exact budget; earlier empty results stay omitted", () => {
  const messages = ["", "🙂", "é", "abcd"].map((text, index) => ({
    role: "toolResult", toolName: "read", toolCallId: String(index),
    content: [{ type: "text", text }],
  }));
  messages[2].content.push({ type: "text", text: "€" });
  const source = structuredClone(messages);
  const bounded = boundInspectionResults(messages, 10, 10);
  assert.match(bounded[0].content[0].text, /earlier read result \(0 bytes/);
  assert.match(bounded[1].content[0].text, /earlier read result \(4 bytes/);
  assert.equal(bounded[2], messages[2]);
  assert.equal(bounded[3], messages[3]);
  assert.equal(bounded.slice(2).reduce((bytes, message) =>
    bytes + Buffer.byteLength(message.content.map((part) => part.text).join("\n"), "utf8"), 0), 10);
  assert.deepEqual(messages, source);
});

test("aggregate selection preserves metadata and excludes conversation, extension and mixed-image content", () => {
  const evicted = {
    role: "toolResult", toolName: "bash", toolCallId: "evicted", isError: true,
    content: [{ type: "text", text: "x".repeat(900) }],
    details: { fullOutputPath: "/tmp/full-output" }, timestamp: 42,
  };
  const older = { role: "toolResult", toolName: "read", toolCallId: "older", content: [{ type: "text", text: "a".repeat(200) }] };
  const fresh = { ...older, toolCallId: "fresh", content: [{ type: "text", text: "b".repeat(300) }] };
  const excluded = [
    { role: "user", content: [{ type: "text", text: "user request" }] },
    { role: "assistant", content: [{ type: "text", text: "assistant response" }] },
    { role: "toolResult", toolName: "memory", content: [{ type: "text", text: "m".repeat(9000) }] },
    { role: "toolResult", toolName: "read", content: [{ type: "image", data: "image" }] },
    { role: "toolResult", toolName: "read", content: [{ type: "text", text: "i".repeat(9000) }, { type: "image", data: "image" }] },
  ];
  const messages = [evicted, older, ...excluded, fresh];
  const source = structuredClone(messages);
  const bounded = boundInspectionResults(messages, 1000, 1000);
  assert.notEqual(bounded[0], evicted);
  assert.deepEqual({ ...bounded[0], content: evicted.content }, evicted);
  assert.equal(bounded[1], older, "excluded content does not consume the retained-text allowance");
  for (let index = 0; index < excluded.length; index++) assert.equal(bounded[index + 2], excluded[index]);
  assert.equal(bounded.at(-1), fresh);
  assert.deepEqual(messages, source);
  assert.deepEqual(boundInspectionResults(messages, 1000, 1000), bounded);
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
