import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import goalsExtension from "./index.js";
import { parseContract, readWorkbench, WORKBENCH_ENTRY, workbenchEvidence, WorkbenchView, workbenchWidget } from "./workbench.js";
import { readGoal } from "./state.js";
import { planText, WorkbenchCard, type CardAction } from "./workbench-card.js";

const contract = {
  acceptance: "Pinned fixture preserves missingness and phase.",
  invariants: "Retain every source record and the comparison denominator.",
  autonomy: "Inspect, edit the reader, and run local tests.",
  escalation: "Ask before changing the data model or acceptance criterion.",
};

function harness() {
  const manager = SessionManager.inMemory("/tmp/workbench-test");
  const hooks = new Map<string, Array<(...args: any[]) => any>>();
  const commands = new Map<string, any>();
  const tools = new Map<string, any>();
  const sent: any[] = [];
  const widgets = new Map<string, any>();
  let idle = true;
  let editor: string | undefined;
  const actions: CardAction[] = [];
  const selections: string[] = [];
  const ctx: any = {
    mode: "print", hasUI: false, sessionManager: manager, isIdle: () => idle,
    getContextUsage: () => undefined, hasPendingMessages: () => false,
    ui: {
      notify() {}, setStatus() {}, setWidget: (key: string, value: any) => widgets.set(key, value),
      editor: async () => editor, confirm: async () => true,
      custom: async () => actions.shift(), select: async () => selections.shift(), input: async () => undefined,
    },
  };
  goalsExtension({
    on: (name: string, fn: (...args: any[]) => any) => hooks.set(name, [...(hooks.get(name) ?? []), fn]),
    registerCommand: (name: string, definition: any) => commands.set(name, definition),
    registerTool: (definition: any) => tools.set(definition.name, definition),
    appendEntry: (name: string, value: unknown) => manager.appendCustomEntry(name, value),
    sendUserMessage: (...args: any[]) => sent.push(args),
    sendMessage: (...args: any[]) => sent.push(args),
  } as any);
  return {
    manager, ctx, sent, widgets, actions, selections,
    state: () => readWorkbench(manager.getBranch()),
    setIdle: (value: boolean) => { idle = value; },
    setEditor: (value: string | undefined) => { editor = value; },
    command: (name: string, args = "") => commands.get(name).handler(args, ctx),
    tool: (name: string, params: unknown = {}) => tools.get(name).execute("test-call", params, undefined, undefined, ctx),
    async emit(name: string, event: unknown = {}) {
      const results = [];
      for (const hook of hooks.get(name) ?? []) {
        const result = await hook(event, ctx);
        if (name === "tool_call" && result?.block) return [result];
        results.push(result);
      }
      return name === "tool_call" ? [undefined] : results;
    },
  };
}

async function configured() {
  const h = harness();
  await h.command("goals", "Preserve GT semantics --no-auto");
  await h.command("workbench", `contract ${JSON.stringify(contract)}`);
  return h;
}

function result(manager: SessionManager, id = "read-1", isError = false) {
  return manager.appendMessage({ role: "toolResult", toolCallId: id, toolName: "read", content: [{ type: "text", text: "GT=0|.\n" }], isError, timestamp: 1 });
}

test("contracts require explicit fields and reject extra authority or empty claims", () => {
  assert.deepEqual(parseContract(JSON.stringify(contract)), contract);
  for (const value of [null, [], {}, { ...contract, autonomy: "  " }, { ...contract, acceptance: "x".repeat(2001) }, { ...contract, resume: true }]) {
    assert.throws(() => parseContract(JSON.stringify(value)));
  }
  assert.throws(() => parseContract("not json"));
});

test("a proposal changes neither approved authority nor goal status", async () => {
  const h = harness();
  await assert.rejects(h.tool("propose_contract", contract), /unfinished goal/);
  await h.command("goals", "Investigate the diagnostic --no-auto");
  await h.tool("propose_contract", contract);
  assert.equal(h.state(), undefined);
  await h.command("workbench", "show");
  assert.match(h.sent.at(-1)[0].content, /Agent proposal \(not authority\)/);
  await h.command("workbench", `contract ${JSON.stringify(contract)}`);
  assert.equal(h.state()?.phase, "paused");
  await h.command("workbench", "resume 8");
  await h.tool("propose_contract", { ...contract, autonomy: "Different proposed scope" });
  assert.deepEqual(h.state()?.contract, contract);
  assert.equal(h.state()?.allowance, 8);
  assert.equal(h.state()?.phase, "running");
});

test("command approval preserves significant whitespace inside contract values", async () => {
  const h = await configured();
  const exact = { ...contract, invariants: "Preserve the literal value 'A  B' and its spacing." };
  await h.command("workbench", `contract ${JSON.stringify(exact, null, 2)}`);
  assert.deepEqual(h.state()?.contract, exact);
});

test("advanced contract JSON and resume N commands do not start a model turn", async () => {
  const h = await configured();
  assert.equal(h.state()?.phase, "paused");
  assert.equal(h.sent.length, 0);
  await h.command("workbench", "resume 2");
  assert.equal(h.state()?.allowance, 2);
  assert.equal(h.sent.length, 0);
  const goal = await h.tool("get_goal");
  assert.equal(goal.details.goal.status, "active");
});

test("tool admissions reserve a finite allowance before execution and block subsequent calls", async () => {
  const h = await configured();
  const [initialBlock] = await h.emit("tool_call", { toolCallId: "blocked", toolName: "bash" });
  assert.equal(initialBlock.block, true);
  assert.match(initialBlock.reason, /Only the user/);
  await h.command("workbench", "resume 2");
  assert.deepEqual(await h.emit("tool_call", { toolCallId: "one", toolName: "read" }), [undefined]);
  assert.deepEqual(await h.emit("tool_call", { toolCallId: "one", toolName: "bash" }), [undefined]);
  assert.equal(h.state()?.phase, "paused");
  assert.equal(h.state()?.admissions, 2, "separate calls consume separate slots even if the provider repeats an ID");
  const [blocked] = await h.emit("tool_call", { toolCallId: "three", toolName: "bash" });
  assert.equal(blocked.block, true);
  assert.equal(blocked.terminate, true);
  assert.equal(h.state()?.admissions, 2);
});

test("a checkpoint references actual branch entries and remains an agent report", async () => {
  const h = await configured();
  const evidenceId = result(h.manager);
  await assert.rejects(h.tool("record_checkpoint", { statement: "Passed", evidenceIds: ["invented"], uncertainty: "None", nextDecision: "Review" }), /Evidence must reference/);
  const checkpoint = { statement: "Fixture returned the expected GT", evidenceIds: [evidenceId], uncertainty: "Only one synthetic record checked", nextDecision: "Review missingness coverage" };
  const output = await h.tool("record_checkpoint", checkpoint);
  assert.equal(output.terminate, true);
  assert.equal(h.state()?.phase, "paused");
  assert.deepEqual(h.state()?.checkpoint, checkpoint);
  assert.equal((await h.tool("get_goal")).details.goal.status, "active");
  await h.command("workbench", `evidence ${evidenceId}`);
  assert.match(h.sent.at(-1)[0].content, /not independent certification/);
  assert.match(h.sent.at(-1)[0].content, /GT=0\|\./);
  await h.command("workbench", "show");
  assert.match(h.sent.at(-1)[0].content, /reported, not certified/);
});

test("evidence discovery is bounded while explicit historical IDs remain inspectable", async () => {
  const h = await configured();
  const first = result(h.manager, "first", true);
  for (let i = 0; i < 30; i++) result(h.manager, `call-${i}`);
  assert.equal(workbenchEvidence(h.manager.getBranch()).length, 20);
  assert.equal(workbenchEvidence(h.manager.getBranch(), first)[0].isError, true);
  const output = await h.tool("get_goal");
  const details = JSON.parse(output.content[0].text.split("\n").at(-1));
  assert.equal(details.evidence.length, 12);
  assert.equal(details.evidence[0].output, undefined);
  await assert.rejects(h.command("workbench", "evidence missing"), /not on this session branch/);
});

test("evidence binds to its preceding call and leaves ambiguous arguments unavailable", () => {
  const manager = SessionManager.inMemory();
  const appendCalls = (paths: string[]) => manager.appendMessage({
    role: "assistant", api: "test", provider: "test", model: "test", timestamp: 0, stopReason: "toolUse",
    content: paths.map((path) => ({ type: "toolCall", id: "reused", name: "read", arguments: { path } })),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  });
  appendCalls(["first.txt"]);
  const first = result(manager, "reused");
  appendCalls(["second.txt"]);
  const second = result(manager, "reused");
  appendCalls(["ambiguous-a.txt", "ambiguous-b.txt"]);
  const ambiguous = result(manager, "reused");
  assert.deepEqual(workbenchEvidence(manager.getBranch(), first)[0].arguments, { path: "first.txt" });
  assert.deepEqual(workbenchEvidence(manager.getBranch(), second)[0].arguments, { path: "second.txt" });
  assert.equal(workbenchEvidence(manager.getBranch(), ambiguous)[0].arguments, undefined);
});

test("pause suppresses goal auto-continuation and cannot be bypassed by goal resume", async () => {
  const h = await configured();
  await h.command("goals", "auto on");
  await h.emit("agent_end");
  await h.command("goals", "resume");
  assert.equal(h.sent.length, 0);
  await h.command("workbench", "resume 10");
  assert.equal(h.sent.length, 0);
  await h.emit("agent_end");
  assert.equal(h.sent.length, 1);
  await h.command("workbench", "pause");
  await h.emit("agent_end");
  assert.equal(h.sent.length, 1);
});

test("reload, branch navigation and goal replacement require renewed authority", async () => {
  const h = await configured();
  const contractLeaf = h.manager.getLeafId()!;
  await h.command("workbench", "resume 3");
  const runningLeaf = h.manager.getLeafId()!;
  await h.emit("session_start");
  assert.equal(h.state()?.phase, "paused");
  assert.match(h.state()!.reason, /opened or reloaded/);
  h.manager.branch(runningLeaf);
  await h.emit("session_tree");
  assert.equal(h.state()?.phase, "paused");
  h.manager.branch(contractLeaf);
  assert.equal(h.state()?.allowance, 0);
  await h.command("workbench", "resume 3");
  await h.command("goals", "Another objective --no-auto");
  const [blocked] = await h.emit("tool_call", { toolCallId: "wrong-goal", toolName: "read" });
  assert.equal(blocked.block, true);
  await assert.rejects(h.command("workbench", "resume 3"), /Goal changed/);
  assert.equal(h.state()?.phase, "paused");
});

test("busy users can pause but cannot change or renew the contract", async () => {
  const h = await configured();
  h.setIdle(false);
  await assert.rejects(h.command("workbench", "resume 2"), /while idle/);
  await assert.rejects(h.command("workbench", `contract ${JSON.stringify(contract)}`), /while idle/);
  await assert.rejects(h.command("workbench", "off"), /while idle/);
  await assert.rejects(h.command("workbench", "show"), /must not enqueue steering/);
  await h.command("workbench", "pause");
  assert.equal(h.state()?.phase, "paused");
});

test("invalid renewals and cancelled editing leave authority unchanged", async () => {
  const h = await configured();
  for (const args of ["resume", "resume 0", "resume -2", "resume 1.5", "resume 10001", "resume 3 extra", "off extra"]) {
    await assert.rejects(h.command("workbench", args));
  }
  h.ctx.hasUI = true;
  h.ctx.mode = "tui";
  h.actions.push("cancel");
  await h.command("workbench", "contract");
  assert.equal(h.state()?.allowance, 0);
  await h.command("workbench", "off");
  assert.equal(h.state(), undefined);
  assert.deepEqual(await h.emit("tool_call", { toolCallId: "outside", toolName: "read" }), [undefined]);
});

test("widget and evidence view fit narrow terminals and remove terminal control sequences", async () => {
  const h = await configured();
  const state = h.state()!;
  state.objective = "\x1b]52;c;YXR0YWNr\x07\x1b[31m研究🧬\n".repeat(20);
  let closed = false;
  const view = new WorkbenchView([state.objective.split("\n")[0], ...Array.from({ length: 100 }, (_, i) => `Evidence ${i}`)].join("\n"), () => 8, () => { closed = true; });
  for (const width of [1, 8, 20, 40, 80]) {
    for (const line of [...workbenchWidget(state, width), ...view.render(width)]) {
      assert(visibleWidth(line) <= width, `${visibleWidth(line)} exceeds ${width}`);
      assert(!line.replaceAll("\x1b[0m", "").includes("\x1b"), "only renderer reset sequences are permitted");
    }
  }
  const start = view.render(40);
  view.handleInput("\x1b[6~");
  assert.notDeepEqual(view.render(40), start);
  for (let i = 0; i < 100; i++) view.handleInput("\x1b[B");
  assert(view.render(12).length <= 8);
  view.handleInput("\x1b");
  assert(closed);
  h.ctx.mode = "tui";
  await h.emit("session_start");
  assert(h.widgets.get("pi-workbench"));
  await h.emit("session_shutdown");
  assert.equal(h.widgets.get("pi-workbench"), undefined);
});

test("contract context is current, transient and absent after disabling the envelope", async () => {
  const h = await configured();
  const user = { role: "user", content: "Inspect the fixture", timestamp: 1 };
  const view = { role: "custom", customType: "pi-workbench-view", content: "Display-only evidence", display: true, timestamp: 0 };
  const [first] = await h.emit("context", { messages: [view, user] });
  assert(!first.messages.some((message: any) => message.customType === "pi-workbench-view"));
  const projected = first.messages.filter((message: any) => message.customType === "pi-workbench-contract");
  assert.equal(projected.length, 1);
  assert.match(projected[0].content, /State: paused/);
  await h.command("workbench", "resume 5");
  const [next] = await h.emit("context", { messages: first.messages });
  const active = next.messages.filter((message: any) => message.customType === "pi-workbench-contract");
  assert.equal(active.length, 1);
  assert.match(active[0].content, /State: running/);
  assert(!h.manager.getBranch().some((entry) => entry.type === "custom_message" && entry.customType === "pi-workbench-contract"));
  await h.command("workbench", "off");
  const [disabled] = await h.emit("context", { messages: next.messages });
  assert(!disabled.messages.some((message: any) => message.customType === "pi-workbench-contract"));
});

test("the task card uses plain language, pins decisions and requires the plan end to be exposed", () => {
  const model = { objective: "Inspect the directory", contract, allowance: 20 };
  assert.doesNotMatch(planText(model), /"acceptance"|"invariants"/);
  const chosen: CardAction[] = [];
  const card = new WorkbenchCard(model, () => 18, (action) => chosen.push(action));
  const first = card.render(40);
  assert(first.some((line) => line.includes("Approve & start")));
  assert(first.some((line) => line.includes("Change plan")));
  assert(first.some((line) => line.includes("Cancel")));
  card.handleInput("a");
  assert.deepEqual(chosen, [], "approval stays disabled while part of the plan is hidden");
  for (let i = 0; i < 30; i++) { card.handleInput(" "); card.render(40); }
  card.handleInput("a");
  assert.deepEqual(chosen, ["start"]);
  card.handleInput("a");
  assert.deepEqual(chosen, ["start"], "a decision is submitted once");
  for (const width of [1, 8, 20, 40, 80]) for (const height of [3, 10, 18]) {
    const small = new WorkbenchCard({ ...model, objective: "\x1b]52;c;eA==\x07研究🧬" }, () => height, () => {});
    const lines = small.render(width);
    assert(lines.length <= height);
    assert(lines.every((line) => visibleWidth(line) <= width));
    assert(lines.every((line) => !line.includes("\x1b]52")));
  }
  const cancelled: CardAction[] = [];
  const dismiss = new WorkbenchCard(model, () => 18, (action) => cancelled.push(action));
  dismiss.handleInput("\x1b");
  assert.deepEqual(cancelled, ["cancel"]);
});

test("Approve and start grants the reviewed plan and starts exactly one user turn", async () => {
  const h = harness();
  await h.command("goals", "Inspect the directory --no-auto");
  await h.tool("propose_contract", contract);
  h.ctx.mode = "tui";
  h.ctx.hasUI = true;
  h.actions.push("start");
  await h.command("workbench");
  assert.deepEqual(h.state()?.contract, contract);
  assert.equal(h.state()?.phase, "running");
  assert.equal(h.state()?.allowance, 20);
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0][0], /Start the user-approved/);
});

test("plan edits are local until approval and Cancel preserves existing authority", async () => {
  const h = await configured();
  h.ctx.mode = "tui";
  h.ctx.hasUI = true;
  h.actions.push("change", "cancel");
  h.selections.push("What you'll get");
  h.setEditor("A different acceptance criterion.");
  await h.command("workbench");
  assert.deepEqual(h.state()?.contract, contract);
  assert.equal(h.state()?.allowance, 0);
  assert.equal(h.sent.length, 0);
  h.actions.push("change", "start");
  h.selections.push("What you'll get");
  await h.command("workbench");
  assert.equal(h.state()?.contract.acceptance, "A different acceptance criterion.");
  assert.equal(h.sent.length, 1);
});

test("starting an unchanged plan preserves its latest checkpoint and evidence references", async () => {
  const h = await configured();
  await h.command("workbench", "resume 3");
  const report = { statement: "The next step needs a scope decision.", evidenceIds: [result(h.manager)], uncertainty: "Only one fixture is recorded.", nextDecision: "Approve the existing plan." };
  await h.tool("record_checkpoint", report);
  h.ctx.mode = "tui";
  h.ctx.hasUI = true;
  h.actions.push("start");
  await h.command("workbench");
  assert.deepEqual(h.state()?.checkpoint, report);
  assert.equal(h.state()?.phase, "running");
  assert.equal(h.state()?.allowance, 3);
  assert.equal(h.sent.length, 1);
});

test("a stale task card cannot approve a different goal or pending work", async () => {
  const h = await configured();
  h.ctx.mode = "tui";
  h.ctx.hasUI = true;
  h.ctx.ui.custom = async () => {
    await h.command("goals", "A different task --no-auto");
    return "start";
  };
  await assert.rejects(h.command("workbench"), /task changed during review/);
  assert.equal(h.state()?.allowance, 0);
  assert.equal(h.sent.length, 0);
  h.ctx.hasPendingMessages = () => true;
  await assert.rejects(h.command("workbench"), /wait for current operations/);
});

test("needs_input stops the ambiguous-goal loop before a workbench plan exists", async () => {
  const h = harness();
  await h.command("goals", "ls clear --no-auto");
  await h.command("goals", "auto on");
  const id = readGoal(h.manager.getBranch())!.id;
  const user = { role: "user", content: "Continue", timestamp: 1 };
  await h.emit("context", { messages: [user] });
  const response = await h.tool("request_human_input", { question: "Did you mean to clear the goal or list a path?", reason: "The intended task is ambiguous." });
  assert.equal(response.terminate, true);
  assert.equal(readGoal(h.manager.getBranch())?.status, "needs_input");
  assert.equal(readGoal(h.manager.getBranch())?.id, id);
  assert.equal(readGoal(h.manager.getBranch())?.completedAt, undefined);
  await h.emit("agent_end");
  await h.emit("agent_end");
  await h.command("goals", "pause");
  await h.command("goals", "auto on");
  await h.emit("input", { text: "Continue the active goal", source: "extension" });
  assert.equal(h.sent.length, 0);
  assert.equal(readGoal(h.manager.getBranch())?.continuationTurns, 0);
  const [block] = await h.emit("tool_call", { toolName: "update_goal", toolCallId: "attempt" });
  assert.equal(block.block, true);
  await assert.rejects(h.tool("update_goal", { status: "complete" }), /cannot mark it complete/);
  await assert.rejects(h.tool("request_human_input", { question: "Another question", reason: "Replace it" }), /existing question/);
  const contexts = await h.emit("context", { messages: [user] });
  assert.match(JSON.stringify(contexts), /goal_needs_input/);
  await assert.rejects(h.command("goals", "resume"), /answer/);
  assert.equal(readGoal(h.manager.getBranch())?.status, "needs_input");
  await h.command("goals", "resume Inspect the directory; do not clear anything.");
  assert.equal(readGoal(h.manager.getBranch())?.status, "active");
  assert.equal(readGoal(h.manager.getBranch())?.inputRequest, undefined);
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0][0], /Inspect the directory; do not clear anything/);
});

test("input holds persist without mutating the earlier branch and survive an exhausted allowance", async () => {
  const h = await configured();
  const prior = h.manager.getLeafId()!;
  const request = { question: "Which comparison is intended?", reason: "The scope is unresolved." };
  assert.deepEqual(await h.emit("tool_call", { toolName: "request_human_input", toolCallId: "hold" }), [undefined]);
  await h.tool("request_human_input", request);
  assert.equal(h.state()?.admissions, 0, "requesting a pause does not consume or renew work authority");
  const held = h.manager.getLeafId()!;
  await h.emit("session_start");
  await h.emit("agent_end");
  assert.equal(h.sent.length, 0);
  assert.deepEqual(readGoal(h.manager.getBranch())?.inputRequest, request);
  h.manager.branch(prior);
  assert.equal(readGoal(h.manager.getBranch())?.status, "active", "the stored earlier state is immutable");
  h.manager.branch(held);
  await h.emit("session_tree");
  assert.equal(readGoal(h.manager.getBranch())?.status, "needs_input");
  await h.command("workbench", "off");
  const [block] = await h.emit("tool_call", { toolName: "bash", toolCallId: "after-off" });
  assert.equal(block.block, true, "turning off a workbench envelope does not answer the outstanding question");
});

test("clearing an input-held goal does not present it as active work", async () => {
  const h = await configured();
  h.ctx.mode = "tui";
  h.ctx.hasUI = true;
  await h.command("workbench", "resume 3");
  await h.tool("request_human_input", { question: "Which directory?", reason: "The path is ambiguous." });
  await h.command("goals", "clear");
  assert.equal(readGoal(h.manager.getBranch()), null);
  const lines = h.widgets.get("pi-workbench")().render(40).join("\n");
  assert.match(lines, /No goal is set/);
  assert.doesNotMatch(lines, /Working|Needs your input/);
});

test("the reply card resumes a goal without inventing a workbench contract", async () => {
  const h = harness();
  await h.command("goals", "Clarify the task --no-auto");
  await h.tool("request_human_input", { question: "Which directory?", reason: "Two paths are possible." });
  h.ctx.mode = "tui";
  h.ctx.hasUI = true;
  h.actions.push("start");
  h.setEditor("Only the current directory.");
  await h.command("workbench");
  assert.equal(readGoal(h.manager.getBranch())?.status, "active");
  assert.equal(h.state(), undefined);
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0][0], /Only the current directory/);
});

test("unknown persisted workbench events fail explicitly", () => {
  const manager = SessionManager.inMemory();
  manager.appendCustomEntry(WORKBENCH_ENTRY, { kind: "new-unrecognized-authority" });
  assert.throws(() => readWorkbench(manager.getBranch()), /Unrecognized/);
});
