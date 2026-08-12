import assert from "node:assert/strict";
import test from "node:test";
import goalsExtension from "./index.js";

test("goal policy is stable and volatile goal state is transient tail context", async () => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const tools = new Map<string, any>();
  const branch: any[] = [];
  const sent: Array<{ text: string; options?: unknown }> = [];
  const pi = {
    on(name: string, handler: (...args: any[]) => any) { handlers.set(name, handler); },
    registerCommand() {},
    registerTool(tool: any) { tools.set(tool.name, tool); },
    appendEntry(customType: string, data: unknown) { branch.push({ type: "custom", customType, data }); },
    sendUserMessage(text: string, options?: unknown) { sent.push({ text, options }); },
  };
  goalsExtension(pi as any);

  const ctx = {
    hasUI: false,
    isIdle() { return true; },
    getContextUsage() { return { tokens: 1234 }; },
    sessionManager: {
      getBranch() { return branch; },
      getSessionId() { return "goal-test-session"; },
    },
    ui: { setStatus() {}, setWidget() {}, notify() {}, confirm: async () => true },
  };
  const create = tools.get("create_goal");
  assert(create);
  await create.execute(
    "call",
    { objective: "Ship the exact artifact after all gates pass.", token_budget: 5000 },
    undefined,
    undefined,
    ctx,
  );

  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.text, "Continue the active goal with the next concrete action; do not repeat completed work.");
  assert.doesNotMatch(sent[0]?.text ?? "", /exact artifact|completion audit/i);

  const before = await handlers.get("before_agent_start")?.({ systemPrompt: "base" }, ctx);
  assert.match(before.systemPrompt, /PI GOAL POLICY/);
  assert.doesNotMatch(before.systemPrompt, /exact artifact|continuation turns/i);

  const messages = [{ role: "user", content: [{ type: "text", text: "start" }], timestamp: 10 }];
  const first = await handlers.get("context")?.({ messages }, ctx);
  assert.equal(first.messages.length, 2);
  assert.equal(first.messages[0]?.customType, "pi-goal-context");
  assert.equal(first.messages[1]?.role, "user");
  assert.match(String(first.messages[0]?.content), /Ship the exact artifact/);

  const loopMessages = [
    ...first.messages,
    { role: "assistant", content: [{ type: "toolCall", id: "x", name: "read", arguments: {} }], timestamp: 11 },
    { role: "toolResult", toolCallId: "x", toolName: "read", content: [{ type: "text", text: "ok" }], isError: false, timestamp: 12 },
  ];
  await tools.get("update_goal").execute(
    "complete",
    { status: "complete", note: "evidence audited" },
    undefined,
    undefined,
    ctx,
  );
  const second = await handlers.get("context")?.({ messages: loopMessages }, ctx);
  assert.equal(second.messages.length, 4, "transient goal context must replace rather than accumulate");
  assert.equal(second.messages.filter((message: any) => message.customType === "pi-goal-context").length, 1);
  assert.equal(second.messages[0]?.customType, "pi-goal-context");
  assert.equal(second.messages[1]?.role, "user", "goal context position stays stable through the tool loop");
  assert.equal(second.messages[0]?.content, first.messages[0]?.content, "mid-turn goal updates apply on the next user turn");

  const nextTurn = await handlers.get("context")?.({
    messages: [...loopMessages, { role: "user", content: [{ type: "text", text: "next" }], timestamp: 20 }],
  }, ctx);
  assert.equal(nextTurn.messages.some((message: any) => message.customType === "pi-goal-context"), false);
});
