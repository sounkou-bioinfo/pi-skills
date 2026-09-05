import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import completionsExtension, { CompletionQueue, COMPLETION_OBSERVED, COMPLETION_READY } from "./index.js";

const notice = (key: string, sessionId = "one") => ({ sessionId, key, content: `Finished ${key}`, wake: true });

test("completion observations suppress both already-ready and not-yet-published results", () => {
  const queue = new CompletionQueue("one");
  queue.add(notice("bg:ready"));
  queue.acknowledge({ sessionId: "one", keys: ["bg:ready", "rlm:later"] });
  queue.add(notice("rlm:later"));
  queue.deliver(() => assert.fail("observed results must never wake the agent"));
  assert.equal(queue.size, 0);
});

test("unread completions are batched, bounded, deduplicated and scoped", () => {
  const queue = new CompletionQueue("one");
  queue.add(notice("bg:first"));
  queue.add(notice("bg:first"));
  queue.add(notice("rlm:second"));
  queue.add(notice("foreign", "two"));
  queue.acknowledge({ sessionId: "two", keys: ["bg:first"] });
  const sent: string[] = [];
  queue.deliver((content, wake) => { assert(wake); sent.push(content); });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /bg:first/);
  assert.match(sent[0], /rlm:second/);
  assert(!sent[0].includes("foreign"));
  queue.add(notice("bg:first"));
  assert.equal(queue.size, 0);
  for (let i = 0; i < 10; i++) queue.add({ ...notice(String(i)), content: "x".repeat(8000), wake: false });
  queue.deliver((content, wake) => { assert(content.length <= 24000); assert.equal(wake, false); });
  assert(queue.size > 0, "entries not included in the bounded batch remain pending");
});

test("a synchronous send failure leaves notices available", () => {
  const queue = new CompletionQueue("one");
  queue.add(notice("retry"));
  assert.throws(() => queue.deliver(() => { throw new Error("not bound"); }), /not bound/);
  assert.equal(queue.size, 1);
});

test("busy work can consume completions without any late follow-up; shutdown removes listeners", async () => {
  const bus = new EventEmitter();
  const hooks = new Map<string, (...args: any[]) => any>();
  const sent: Array<{ message: any; options: any }> = [];
  let idle = false;
  const pi = {
    on(name: string, handler: (...args: any[]) => any) { hooks.set(name, handler); },
    events: {
      on(name: string, handler: (...args: any[]) => any) { bus.on(name, handler); return () => { bus.off(name, handler); }; },
      emit(name: string, value: unknown) { bus.emit(name, value); },
    },
    sendMessage(message: unknown, options: unknown) { sent.push({ message, options }); },
  };
  completionsExtension(pi as any);
  const ctx = { isIdle: () => idle, sessionManager: { getSessionId: () => "one" } };
  await hooks.get("session_start")!({}, ctx);
  try {
    bus.emit(COMPLETION_READY, notice("already-read"));
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(sent.length, 0, "busy work must not enqueue a host followUp");
    bus.emit(COMPLETION_OBSERVED, { sessionId: "one", keys: ["already-read"] });
    idle = true;
    await hooks.get("agent_end")!({}, ctx);
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(sent.length, 0, "polling consumes the pending wake before idle");
    bus.emit(COMPLETION_READY, notice("first"));
    bus.emit(COMPLETION_READY, notice("second"));
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(sent.length, 1);
    assert.match(sent[0].message.content, /first/);
    assert.match(sent[0].message.content, /second/);
    assert.deepEqual(sent[0].options, { triggerTurn: true });
    await hooks.get("agent_start")!({}, ctx);
    idle = false;
    bus.emit(COMPLETION_READY, notice("retired"));
  } finally {
    await hooks.get("session_shutdown")!({}, ctx);
  }
  assert.equal(bus.listenerCount(COMPLETION_READY), 0);
  idle = true;
  bus.emit(COMPLETION_READY, notice("after-shutdown"));
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(sent.length, 1);
});
