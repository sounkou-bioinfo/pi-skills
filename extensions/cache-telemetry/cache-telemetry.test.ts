import assert from "node:assert/strict";
import test from "node:test";
import cacheTelemetry, { classifyTurn, formatCacheSummary, readTurns } from "./index.js";

const usage = (overrides = {}) => ({ timestamp: 1000, provider: "claude-code", model: "opus",
  input: 5000, output: 1000, cacheRead: 100000, cacheWrite: 0, totalTokens: 106000, cost: 1,
  events: [] as string[], ...overrides });

test("reuse classification separates warm hits, cold starts, low reuse and zero usage", () => {
  const hit = classifyTurn(usage());
  assert.equal(hit.classification, "hit");
  assert.equal(classifyTurn(usage({ cacheRead: 0 })).classification, "cold");
  assert.equal(classifyTurn(usage({ cacheRead: 0 }), hit).classification, "miss");
  assert.equal(classifyTurn(usage({ input: 0, cacheRead: 0, output: 99, totalTokens: 99 }), hit).classification, "unknown");
  assert.equal(classifyTurn(usage({ provider: "other", cacheRead: 0 }), hit).classification, "cold");
  assert.equal(classifyTurn(usage({ model: "other", cacheRead: 0 }), hit).classification, "cold");
});

test("sharp drops require growing input context, a comparable model and a material prior cache", () => {
  const hit = classifyTurn(usage());
  const miss = classifyTurn(usage({ input: 91000, cacheRead: 15000 }), hit);
  assert.equal(miss.classification, "miss");
  assert.equal(miss.sharpDrop, true);
  assert.equal(classifyTurn(usage({ input: 0, cacheRead: 15000 }), hit).sharpDrop, false);
  assert.equal(classifyTurn(usage({ input: 90000, cacheRead: 15000 }), hit).sharpDrop, false, "equal input context did not grow");
  assert.equal(classifyTurn(usage({ input: 0, cacheRead: 50000, cacheWrite: 60000 }), hit).sharpDrop, false, "50% is not a sharp drop");
  assert.equal(classifyTurn(usage({ input: 100, cacheRead: 100 }), classifyTurn(usage({ input: 0, cacheRead: 1000 }))).sharpDrop, false);
  assert.equal(classifyTurn(usage({ input: 200000, cacheRead: 0, model: "other" }), hit).sharpDrop, false);
});

test("cache-write tokens count as input; output alone does not make context grow", () => {
  const previous = classifyTurn(usage());
  assert.equal(classifyTurn(usage({ input: 0, cacheRead: 15000, cacheWrite: 100000 }), previous).sharpDrop, true);
  assert.equal(classifyTurn(usage({ input: 1, cacheRead: 15000, output: 200000, totalTokens: 215001 }), previous).sharpDrop, false);
});

test("branch replay reuses assistant usage and restores recorded diagnostics without double counting", () => {
  const message = (timestamp: number, overrides = {}) => ({ role: "assistant", timestamp, provider: "claude-code", model: "opus",
    usage: { input: 5000, output: 1000, cacheRead: 100000, cacheWrite: 0, totalTokens: 106000, cost: { total: 1 }, ...overrides } });
  const miss = classifyTurn(usage({ timestamp: 2000, input: 91000, cacheRead: 15000, cost: 10,
    events: ["compaction"], toolResults: 42 }), classifyTurn(usage()));
  const turns = readTurns([
    { type: "message", message: message(1000) },
    { type: "compaction" },
    { type: "message", message: message(2000, { input: 91000, cacheRead: 15000, cost: { total: 10 } }) },
    { type: "custom", customType: "cache-telemetry-v1", data: miss },
  ] as any);
  assert.equal(turns.length, 2);
  assert.deepEqual(turns[1].events, ["compaction"]);
  assert.equal(turns[1].toolResults, 42);
  const summary = formatCacheSummary(turns, 1);
  assert.match(summary, /2 turns; 1 misses; 50.0%/);
  assert.match(summary, /misses \$10.00; hits \$1.00/);
  assert.match(summary, /compaction; tool results 42/);
  assert.equal(readTurns([{ type: "message", message: message(1000) }] as any)[0].classification, "hit");
});

test("extension observes without mutating context and persists diagnostics outside model history", async () => {
  const hooks = new Map<string, any>();
  const entries: any[] = [];
  let command: any;
  const notifications: string[] = [];
  cacheTelemetry({
    on: (name: string, fn: any) => hooks.set(name, fn),
    appendEntry: (customType: string, data: any) => entries.push({ type: "custom", customType, data }),
    getActiveTools: () => ["read", "bash"],
    registerCommand: (name: string, value: any) => { assert.equal(name, "cache"); command = value; },
  } as any);
  const ctx = { getSystemPrompt: () => "stable", sessionManager: { getBranch: () => entries },
    ui: { notify: (text: string) => notifications.push(text) } };
  hooks.get("session_start")({}, ctx);
  const messages = [{ role: "toolResult", toolCallId: "a", content: [] }];
  const source = structuredClone(messages);
  assert.equal(hooks.get("context")({ messages }, ctx), undefined);
  assert.deepEqual(messages, source);
  hooks.get("session_compact")();
  hooks.get("model_select")();
  hooks.get("turn_end")({ message: { role: "assistant", ...usage(), usage: { ...usage(), cost: { total: 1 } } } });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].data.toolResults, 1);
  assert.deepEqual(entries[0].data.events, ["compaction", "model change"]);
  await command.handler("2", ctx);
  assert.match(notifications.at(-1)!, /1 turns/);
  await command.handler("0", ctx);
  assert.match(notifications.at(-1)!, /Usage/);
  hooks.get("session_start")({}, { ...ctx, sessionManager: { getBranch: () => [] } });
  await command.handler("", ctx);
  assert.match(notifications.at(-1)!, /0 turns/);
});
