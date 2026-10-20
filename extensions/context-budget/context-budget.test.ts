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
  assert.match(bounded[2].content[0]?.text ?? "", /earlier bash result/);
  assert.match(bounded[3].content[0]?.text ?? "", /^3-/);
  assert.match(messages[0].content[0]?.text ?? "", /^0-/, "stored source messages are not mutated");
});

test("inspection text is retained as a contiguous newest suffix without older backfill", () => {
  const messages = [200, 900, 300].map((bytes, index) => ({
    role: "toolResult", toolName: "read", toolCallId: String(index),
    content: [{ type: "text", text: String(index).repeat(bytes) }],
  }));
  const omitted = new Set<string>();
  const before = boundInspectionResults(messages.slice(0, 2), 1000, 1000, omitted);
  const after = boundInspectionResults(messages, 1000, 1000, omitted);
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
  const omitted = new Set<string>();
  for (let length = 1; length <= messages.length; length++) {
    const current = boundInspectionResults(messages.slice(0, length), 1000, 1000, omitted);
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

test("UTF-8 bytes and part separators count toward hysteresis trimming", () => {
  const messages = ["", "🙂", "é", "abcd"].map((text, index) => ({
    role: "toolResult", toolName: "read", toolCallId: String(index),
    content: [{ type: "text", text }],
  }));
  messages[2].content.push({ type: "text", text: "€" });
  const source = structuredClone(messages);
  const bounded = boundInspectionResults(messages, 10, 10);
  assert.match(bounded[0].content[0].text, /earlier read result \(0 bytes/);
  assert.match(bounded[1].content[0].text, /earlier read result \(4 bytes/);
  assert.match(bounded[2].content[0].text, /earlier read result \(6 bytes/);
  assert.equal(bounded[3], messages[3]);
  assert.equal(Buffer.byteLength(bounded[3].content[0].text), 4);
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

test("context hook keeps deterministic per-result copies out of stored messages", async () => {
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

test("entire sent prefixes are byte-stable between half-budget re-trim steps", () => {
  const omitted = new Set<string>();
  const history: any[] = [];
  let previous: any[] = [];
  let retrims = 0;
  for (let index = 0; index < 200; index++) {
    history.push({ role: "toolResult", toolName: "read", toolCallId: String(index),
      content: [{ type: "text", text: "x".repeat(1000) }] });
    const before = new Set(omitted);
    const current = boundInspectionResults(history, 4096, 16000, omitted);
    const retained = current.filter((message) => !omitted.has(message.toolCallId));
    const bytes = retained.reduce((sum, message) => sum + Buffer.byteLength(message.content[0].text), 0);
    assert(bytes <= 16000, "hard retained-text ceiling");
    if (omitted.size === before.size) {
      assert.equal(JSON.stringify(current.slice(0, previous.length)), JSON.stringify(previous));
    } else {
      retrims++;
      assert(bytes <= 8000, "re-trim creates half-budget headroom");
      for (let i = 0; i < previous.length; i++) {
        if (before.has(history[i].toolCallId)) assert.deepEqual(current[i], previous[i]);
      }
    }
    assert.equal(current.at(-1), history.at(-1));
    assert.deepEqual(boundInspectionResults(history, 4096, 16000, omitted), current, "retry is identical");
    previous = current;
  }
  assert.equal(retrims, 21);
});

test("omission decisions persist across reload and follow the active branch", async () => {
  const hooks = new Map<string, any>();
  const entries: any[] = [];
  const pi = { on: (name: string, fn: any) => hooks.set(name, fn),
    appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }) };
  const ctx = { sessionManager: { getBranch: () => entries } };
  contextBudgetExtension(pi as any);
  hooks.get("session_start")({}, ctx);
  const history = Array.from({ length: 8 }, (_, i) => ({ role: "toolResult", toolName: "read", toolCallId: String(i),
    content: [{ type: "text", text: "x".repeat(12288) }] }));
  const first = await hooks.get("context")({ messages: history }, ctx);
  assert.equal(entries.length, 1);
  assert(entries[0].data.length > 1, "one persisted block per re-trim");
  const raw = structuredClone(history);
  contextBudgetExtension(pi as any);
  hooks.get("session_start")({}, ctx);
  assert.deepEqual((await hooks.get("context")({ messages: history }, ctx)).messages, first.messages);
  assert.equal(entries.length, 1, "replay does not duplicate omission records");
  const compacted = await hooks.get("context")({ messages: history.slice(0, 1) }, ctx);
  assert.deepEqual(compacted.messages[0], first.messages[0], "omitted evidence stays omitted after compaction");
  hooks.get("session_tree")({}, { sessionManager: { getBranch: () => [] } });
  assert.deepEqual((await hooks.get("context")({ messages: history.slice(0, 1) }, ctx)).messages, history.slice(0, 1));
  assert.deepEqual(history, raw, "stored/UI history is intact");
});
