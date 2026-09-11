import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { PLAN_LABELS, planText, terminalText, WorkbenchCard, type CardAction } from "./workbench-card.js";
import type { GoalState } from "./state.js";

export const WORKBENCH_ENTRY = "pi-workbench-v1";
const CONTRACT_FIELDS = ["acceptance", "invariants", "autonomy", "escalation"] as const;
const PROPOSAL_ENTRY = "pi-workbench-proposal-v1";
export type WorkbenchContract = Record<(typeof CONTRACT_FIELDS)[number], string>;
type Goal = Pick<GoalState, "id" | "objective" | "status" | "inputRequest">;
type Checkpoint = { statement: string; evidenceIds: string[]; uncertainty: string; nextDecision: string };
type WorkbenchEvent =
  | { kind: "contract"; goalId: string; objective: string; contract: WorkbenchContract }
  | { kind: "renew"; allowance: number }
  | { kind: "admit"; toolCallId: string }
  | { kind: "pause"; reason: string; checkpoint?: Checkpoint }
  | { kind: "off" };

export type WorkbenchState = {
  goalId: string;
  objective: string;
  contract: WorkbenchContract;
  phase: "paused" | "running";
  allowance: number;
  admissions: number;
  reason: string;
  checkpoint?: Checkpoint;
};

export function readWorkbench(branch: readonly SessionEntry[]): WorkbenchState | undefined {
  let state: WorkbenchState | undefined;
  for (const entry of branch) {
    if (entry.type !== "custom" || entry.customType !== WORKBENCH_ENTRY) continue;
    const event = entry.data as WorkbenchEvent;
    switch (event.kind) {
      case "contract":
        state = { goalId: event.goalId, objective: event.objective, contract: event.contract,
          phase: "paused", allowance: 0, admissions: 0, reason: "Contract set; awaiting a user allowance." };
        break;
      case "off": state = undefined; break;
      case "renew":
        if (state) state = { ...state, phase: "running", allowance: event.allowance, admissions: 0, reason: "User allowance active." };
        break;
      case "admit":
        if (state) {
          state.admissions++;
          if (state.admissions >= state.allowance) {
            state.phase = "paused";
            state.reason = "Tool allowance reached; admitted calls may still finish.";
          }
        }
        break;
      case "pause":
        if (state) state = { ...state, phase: "paused", reason: event.reason, checkpoint: event.checkpoint ?? state.checkpoint };
        break;
      default: throw new Error("Unrecognized workbench event; inspect the session before continuing.");
    }
  }
  return state;
}

export function workbenchPaused(branch: readonly SessionEntry[]): boolean {
  return readWorkbench(branch)?.phase === "paused";
}

export function parseContract(text: string): WorkbenchContract {
  const data: unknown = JSON.parse(text);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Contract must be a JSON object.");
  const record = data as Record<string, unknown>;
  if (Object.keys(record).some((key) => !CONTRACT_FIELDS.includes(key as typeof CONTRACT_FIELDS[number]))) {
    throw new Error(`Contract fields: ${CONTRACT_FIELDS.join(", ")}.`);
  }
  for (const field of CONTRACT_FIELDS) {
    if (typeof record[field] !== "string" || !record[field].trim() || record[field].length > 2000) {
      throw new Error(`${field} must contain 1–2000 characters.`);
    }
  }
  return Object.fromEntries(CONTRACT_FIELDS.map((field) => [field, (record[field] as string).trim()])) as WorkbenchContract;
}

export function workbenchWidget(state: WorkbenchState, width: number): string[] {
  return [
    `${state.phase === "running" ? "Working" : "Work paused"} · ${state.admissions}/${state.allowance} tool calls`,
    state.objective,
    state.checkpoint ? `Agent report: ${state.checkpoint.statement}` : state.reason,
    "/workbench to review · /workbench pause",
  ].map((line) => truncateToWidth(terminalText(line).replace(/\s+/g, " "), Math.max(1, width)));
}

/** Read-only, width-bounded terminal view; source outputs remain in the session. */
export class WorkbenchView {
  private offset = 0;
  constructor(private text: string, private height: () => number, private done: () => void) {}
  invalidate() {}
  handleInput(data: string) {
    if (matchesKey(data, "escape") || data === "q") this.done();
    else if (matchesKey(data, "up")) this.offset = Math.max(0, this.offset - 1);
    else if (matchesKey(data, "down")) this.offset++;
    else if (matchesKey(data, "pageUp")) this.offset = Math.max(0, this.offset - Math.max(1, this.height() - 1));
    else if (matchesKey(data, "pageDown") || data === " ") this.offset += Math.max(1, this.height() - 1);
  }
  render(width: number): string[] {
    width = Math.max(1, width);
    const lines = wrapTextWithAnsi(terminalText(this.text), width);
    const height = Math.max(1, this.height() - 1);
    this.offset = Math.min(this.offset, Math.max(0, lines.length - height));
    const page = lines.slice(this.offset, this.offset + height);
    return [...page, ...Array(height - page.length).fill(""), "↑↓/Space scroll · Esc close"]
      .map((line) => truncateToWidth(line, width));
  }
}

export function workbenchEvidence(branch: readonly SessionEntry[], id?: string) {
  let calls: Array<{ id: string; name: string; arguments: unknown }> = [];
  const results = branch.flatMap((entry) => {
    if (entry.type !== "message") return [];
    const message = entry.message;
    if (message.role === "assistant") {
      calls = message.content.filter((block) => block.type === "toolCall");
      return [];
    }
    if (message.role !== "toolResult") return [];
    const matching = calls.filter((call) => call.id === message.toolCallId && call.name === message.toolName);
    return [{ entry, message, arguments: matching.length === 1 ? matching[0].arguments : undefined }];
  });
  return (id ? results.filter(({ entry }) => entry.id === id) : results.slice(-20))
    .map(({ entry, message, arguments: args }) => ({
      id: entry.id, tool: message.toolName, timestamp: entry.timestamp, isError: message.isError,
      arguments: args,
      output: message.content.map((block) => block.type === "text" ? block.text : `[${block.type} attachment]`).join("\n"),
    }));
}

export function registerWorkbench(
  pi: ExtensionAPI,
  currentGoal: (ctx: ExtensionContext) => Goal | undefined,
  startApprovedWork: (ctx: ExtensionContext, goalId: string, answer?: string) => void,
) {
  function proposal(ctx: ExtensionContext): WorkbenchContract | undefined {
    const goalId = currentGoal(ctx)?.id;
    const branch = ctx.sessionManager.getBranch();
    for (let index = branch.length - 1; index >= 0; index--) {
      const entry = branch[index];
      if (entry.type !== "custom") continue;
      if (entry.customType === WORKBENCH_ENTRY && ["contract", "off"].includes((entry.data as WorkbenchEvent).kind)) return;
      if (entry.customType === PROPOSAL_ENTRY) {
        const data = entry.data as { goalId: string; contract: WorkbenchContract };
        return data.goalId === goalId ? data.contract : undefined;
      }
    }
  }
  function refresh(ctx: ExtensionContext) {
    const state = readWorkbench(ctx.sessionManager.getBranch());
    const pending = proposal(ctx);
    const goal = currentGoal(ctx);
    const visible = Boolean(state || pending);
    if (ctx.mode === "tui") {
      ctx.ui.setWidget("pi-workbench", visible ? () => ({
        render: (width) => !goal
          ? ["No goal is set", "/goals <objective> --no-auto", "/workbench evidence"].map((line) => truncateToWidth(line, Math.max(1, width)))
          : goal.status === "needs_input"
          ? ["Needs your input — work paused", goal.inputRequest?.question ?? "Review the task", "/workbench to reply"].map((line) => truncateToWidth(terminalText(line).replace(/\s+/g, " "), Math.max(1, width)))
          : goal?.status === "complete" ? ["Task marked complete", goal.objective, "/workbench show · /workbench evidence"].map((line) => truncateToWidth(terminalText(line).replace(/\s+/g, " "), Math.max(1, width)))
          : state && goal && state.goalId !== goal.id ? ["This goal needs a plan", goal.objective, "/workbench to review"].map((line) => truncateToWidth(terminalText(line).replace(/\s+/g, " "), Math.max(1, width)))
          : state ? [...workbenchWidget(state, width),
            ...(pending ? [truncateToWidth("Plan change proposed · /workbench", Math.max(1, width))] : [])]
            : ["Plan ready to review", goal?.objective ?? "", "/workbench to approve and start"].map((line) => truncateToWidth(terminalText(line).replace(/\s+/g, " "), Math.max(1, width))),
        invalidate() {},
      }) : undefined);
      if (visible) {
        ctx.ui.setWidget("goals", undefined);
        ctx.ui.setStatus("goals", undefined);
      }
    }
    return visible;
  }
  function append(event: WorkbenchEvent, ctx: ExtensionContext) {
    pi.appendEntry(WORKBENCH_ENTRY, event);
    refresh(ctx);
  }
  async function display(text: string, ctx: ExtensionContext) {
    if (ctx.mode === "tui") {
      await ctx.ui.custom<void>((tui, _theme, _keys, done) => new WorkbenchView(text, () => tui.terminal.rows, () => done()), { overlay: true, overlayOptions: { width: "100%", maxHeight: "100%" } });
    } else {
      if (!ctx.isIdle()) throw new Error("Use inspection commands while idle outside the TUI; views must not enqueue steering.");
      pi.sendMessage({ customType: "pi-workbench-view", content: terminalText(text), display: true }, { triggerTurn: false });
    }
  }
  function requireGoal(ctx: ExtensionContext): Goal {
    const goal = currentGoal(ctx);
    if (!goal || goal.status === "complete") throw new Error("Create an unfinished goal first: /goals <objective> --no-auto");
    return goal;
  }

  function allowanceFrom(text: string): number {
    const value = Number(text);
    if (!Number.isSafeInteger(value) || value < 1 || value > 10000) throw new Error("Choose 1–10000 tool calls; this is not a spending cap.");
    return value;
  }

  async function review(ctx: ExtensionContext) {
    const goal = requireGoal(ctx);
    if (!ctx.isIdle() || ctx.hasPendingMessages()) throw new Error("Pause work and wait for current operations before reviewing a plan.");
    const snapshot = () => JSON.stringify({ goal: currentGoal(ctx), state: readWorkbench(ctx.sessionManager.getBranch()), proposal: proposal(ctx) });
    const version = snapshot();
    const stored = readWorkbench(ctx.sessionManager.getBranch());
    const state = stored?.goalId === goal.id ? stored : undefined;
    const pending = proposal(ctx);
    let draft = pending ?? state?.contract;
    if (!draft && goal.status !== "needs_input") draft = { acceptance: "", invariants: "", autonomy: "", escalation: "" };
    let allowance = state?.allowance || 20;
    for (;;) {
      if (snapshot() !== version) throw new Error("The task changed during review. Open /workbench again; nothing was approved.");
      const action = await ctx.ui.custom<CardAction>((tui, _theme, _keys, done) => new WorkbenchCard({
        objective: goal.objective, contract: draft, allowance,
        question: goal.status === "needs_input" ? goal.inputRequest?.question : undefined,
        reason: goal.inputRequest?.reason,
        report: state?.checkpoint ? `${state.checkpoint.statement}\nUncertainty: ${state.checkpoint.uncertainty}\nNext decision: ${state.checkpoint.nextDecision}\nEvidence: ${state.checkpoint.evidenceIds.join(", ") || "none"}` : undefined,
      }, () => tui.terminal.rows, done, () => ctx.ui.theme), { overlay: true, overlayOptions: { width: "100%", maxHeight: "100%" } });
      if (!action || action === "cancel") return;
      if (snapshot() !== version || !ctx.isIdle() || ctx.hasPendingMessages()) throw new Error("The task changed during review. Open /workbench again; nothing was approved.");
      if (action === "change") {
        const fields = Object.entries(PLAN_LABELS);
        const selected = await ctx.ui.select("Change the plan", [...fields.map(([, label]) => label), "Back"]);
        const field = fields.find(([, label]) => label === selected)?.[0] as keyof WorkbenchContract | undefined;
        if (!field) continue;
        const edited = await ctx.ui.editor(PLAN_LABELS[field], draft?.[field] ?? "");
        if (edited === undefined) continue;
        if (!edited.trim() || edited.length > 2000) { ctx.ui.notify("Use 1–2000 characters for this part of the plan.", "warning"); continue; }
        draft = { ...(draft ?? { acceptance: "", invariants: "", autonomy: "", escalation: "" }), [field]: edited.trim() };
      } else if (action === "more") {
        const selected = await ctx.ui.select("More options", [...(draft ? ["Work limit"] : []), "Inspect evidence", "Back"]);
        if (selected === "Work limit") {
          const value = await ctx.ui.input("Maximum tool calls (not a spending cap)", String(allowance));
          if (value !== undefined) {
            try { allowance = allowanceFrom(value); } catch (error) { ctx.ui.notify((error as Error).message, "warning"); }
          }
        } else if (selected === "Inspect evidence") {
          const evidence = workbenchEvidence(ctx.sessionManager.getBranch()).reverse();
          if (!evidence.length) { await display("No tool results have been recorded on this branch.", ctx); continue; }
          const selectedEntry = await ctx.ui.select("Recorded output — not certification", evidence.map((item) => `${item.id} · ${terminalText(item.tool)}`));
          const item = evidence.find((candidate) => selectedEntry?.startsWith(`${candidate.id} · `));
          if (item) await display(`Recorded ${item.tool} output · ${item.timestamp}\nTool error: ${item.isError}\n\n${item.output.slice(0, 24000)}\n\n/workbench evidence ${item.id} shows arguments and the source locator.`, ctx);
        }
      } else if (action === "start") {
        const answer = goal.status === "needs_input" ? await ctx.ui.editor(`Your answer: ${goal.inputRequest?.question ?? "Clarify the task"}`) : undefined;
        if (goal.status === "needs_input" && !answer?.trim()) continue;
        if (snapshot() !== version || !ctx.isIdle() || ctx.hasPendingMessages()) throw new Error("The task changed during review. Open /workbench again; nothing was approved.");
        if (draft) {
          const contract = parseContract(JSON.stringify(draft));
          if (!state || pending || CONTRACT_FIELDS.some((field) => contract[field] !== state.contract[field])) {
            append({ kind: "contract", goalId: goal.id, objective: goal.objective, contract }, ctx);
          }
          append({ kind: "renew", allowance }, ctx);
        }
        startApprovedWork(ctx, goal.id, answer);
        return;
      }
    }
  }

  pi.registerCommand("workbench", {
    description: "Review a plain-language task card; approve and start, change the plan, or cancel. Advanced: show | contract JSON | evidence | pause | resume N | off.",
    getArgumentCompletions: (prefix) => ["show", "contract", "evidence", "pause", "resume", "off"]
      .filter((value) => value.startsWith(prefix) && value !== prefix).map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      const parsed = args.trim().match(/^(\S+)(?:\s+(.*))?$/s);
      const command = parsed?.[1] ?? (currentGoal(ctx)?.status === "complete" ? "show" : "review");
      const tail = parsed?.[2] ?? "";
      const rest = tail.split(/\s+/).filter(Boolean);
      const branch = ctx.sessionManager.getBranch();
      const state = readWorkbench(branch);
      if (["show", "pause", "off", "review"].includes(command) && rest.length) throw new Error(`${command} takes no arguments.`);
      if (command === "review" || (command === "contract" && !tail)) {
        if (ctx.mode !== "tui") throw new Error("Use /workbench show to inspect, contract JSON to approve, and resume N to grant an allowance outside the TUI.");
        await review(ctx);
      } else if (command === "contract") {
        const goal = requireGoal(ctx);
        if (!ctx.isIdle()) throw new Error("Set the contract while idle. /workbench pause stops future admissions; let current work finish.");
        const contract = parseContract(tail);
        if (requireGoal(ctx).id !== goal.id || !ctx.isIdle()) throw new Error("Goal or activity changed during editing; review the contract again.");
        append({ kind: "contract", goalId: goal.id, objective: goal.objective, contract }, ctx);
        ctx.ui.notify("Contract recorded. /workbench resume N grants N tool admissions; it does not start a model turn.", "info");
      } else if (command === "resume") {
        if (!state) throw new Error("Set a workbench contract first.");
        if (requireGoal(ctx).id !== state.goalId) throw new Error("Goal changed; set a contract for the current goal.");
        if (!ctx.isIdle()) throw new Error("Renew while idle after admitted work finishes.");
        if (rest.length !== 1) throw new Error("Usage: /workbench resume N (tool calls, not a spending cap)");
        const allowance = allowanceFrom(rest[0]);
        append({ kind: "renew", allowance }, ctx);
        ctx.ui.notify("Allowance renewed. Send a prompt to continue; goal status is unchanged.", "info");
      } else if (command === "pause") {
        if (!state) throw new Error("No workbench contract is set.");
        append({ kind: "pause", reason: "Paused by user; admitted calls may still finish." }, ctx);
        ctx.ui.notify("Future tool admissions paused. Existing jobs and model requests are not cancelled.", "info");
      } else if (command === "off") {
        if (!ctx.isIdle()) throw new Error("Disable the workbench while idle.");
        append({ kind: "off" }, ctx);
        ctx.ui.notify("Workbench disabled. Normal goal and completion behavior applies.", "info");
      } else if (command === "evidence") {
        const evidence = workbenchEvidence(branch, rest[0]);
        if (rest.length > 1) throw new Error("Usage: /workbench evidence [entry-id]");
        let selectedId = rest[0];
        if (!selectedId && ctx.mode === "tui" && evidence.length) {
          const selected = await ctx.ui.select("Recorded tool output — not certification", evidence.map((item) =>
            `${item.id} · ${terminalText(item.tool)} · ${item.isError ? "tool error" : "tool returned"}`));
          if (!selected) return;
          selectedId = selected.split(" · ")[0];
        }
        if (selectedId) {
          const item = evidence.find((candidate) => candidate.id === selectedId);
          if (!item) throw new Error("Tool-result entry is not on this session branch.");
          await display(`Recorded tool result; not independent certification\nEntry: ${item.id}\nTool: ${item.tool}\nTime: ${item.timestamp}\nTool error: ${item.isError}\nArguments:\n${JSON.stringify(item.arguments ?? "unavailable", null, 2)}\nOutput (up to 24000 characters):\n${item.output.slice(0, 24000)}\n\nFull source: ${ctx.sessionManager.getSessionFile() ?? "in-memory session"}`, ctx);
        } else {
          await display(["Recent tool-result entries (current branch; tool success is not scientific verification):",
            ...evidence.slice(-20).map((item) => `${item.id} · ${item.tool} · ${item.isError ? "tool error" : "tool returned"} · ${item.timestamp}`),
            "Open with /workbench evidence <entry-id>. Source outputs are historical and may be stale."].join("\n"), ctx);
        }
      } else if (command === "show") {
        const goal = currentGoal(ctx);
        const pending = proposal(ctx);
        await display([
          goal?.status === "needs_input" ? "Needs your input — work paused" : state ? `Work ${state.phase}` : "No approved plan",
          pending ? "Agent proposal (not authority)" : "",
          planText({ objective: goal?.objective ?? state?.objective ?? "Create a goal with /goals <objective> --no-auto",
            contract: pending ?? state?.contract, allowance: state?.allowance || 20,
            question: goal?.inputRequest?.question, reason: goal?.inputRequest?.reason }),
          "Agent checkpoint (reported, not certified)",
          state?.checkpoint ? `${state.checkpoint.statement}\nUncertainty: ${state.checkpoint.uncertainty}\nNext decision: ${state.checkpoint.nextDecision}\nEvidence: ${state.checkpoint.evidenceIds.join(", ") || "none"}` : "None recorded.",
          "/workbench to review and start · /workbench evidence to inspect output",
        ].filter(Boolean).join("\n\n"), ctx);
      } else throw new Error("Usage: /workbench | show | contract JSON | evidence [entry-id] | pause | resume N | off");
    },
  });

  pi.registerTool({
    name: "propose_contract", label: "Propose contract",
    description: "Draft a brief, plain-language plan for the existing user goal. Keep each field to one or two sentences; avoid procedural jargon. A proposal grants no authority. The user reviews the task card with /workbench and chooses Approve & start, Change plan, or Cancel. If the goal itself is unclear, use request_human_input instead.",
    parameters: Type.Object({
      acceptance: Type.String({ minLength: 1, maxLength: 2000 }),
      invariants: Type.String({ minLength: 1, maxLength: 2000 }),
      autonomy: Type.String({ minLength: 1, maxLength: 2000 }),
      escalation: Type.String({ minLength: 1, maxLength: 2000 }),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const goal = requireGoal(ctx);
      const contract = parseContract(JSON.stringify(params));
      pi.appendEntry(PROPOSAL_ENTRY, { goalId: goal.id, contract });
      refresh(ctx);
      return { content: [{ type: "text", text: `Proposal only; user review required.\n${JSON.stringify(contract)}` }], details: { contract } };
    },
  });

  pi.registerTool({
    name: "record_checkpoint", label: "Record checkpoint",
    description: "Record an agent-reported result with existing tool-result entry IDs, uncertainty, and the next decision. Pauses the workbench for user review; never approves evidence, completes the goal, or renews authority. Use get_goal to discover recent evidence IDs.",
    parameters: Type.Object({
      statement: Type.String({ minLength: 1, maxLength: 2000 }),
      evidenceIds: Type.Array(Type.String(), { maxItems: 12 }),
      uncertainty: Type.String({ minLength: 1, maxLength: 2000 }),
      nextDecision: Type.String({ minLength: 1, maxLength: 2000 }),
    }),
    async execute(_id, checkpoint, _signal, _update, ctx) {
      const branch = ctx.sessionManager.getBranch();
      const state = readWorkbench(branch);
      if (!state) throw new Error("The user must set a workbench contract first.");
      const known = new Set(branch.filter((entry) => entry.type === "message" && entry.message.role === "toolResult").map((entry) => entry.id));
      if (checkpoint.evidenceIds.some((id) => !known.has(id))) throw new Error("Evidence must reference tool-result entry IDs on the current branch.");
      append({ kind: "pause", reason: "Agent checkpoint awaits user review.", checkpoint }, ctx);
      return { content: [{ type: "text", text: "Checkpoint recorded as an agent report. Workbench paused; only the user can renew." }], details: { checkpoint }, terminate: true };
    },
  });

  pi.on("tool_call", (event, ctx) => {
    if (event.toolName === "request_human_input") return;
    const state = readWorkbench(ctx.sessionManager.getBranch());
    if (!state) return;
    const goal = currentGoal(ctx);
    if (!goal || goal.id !== state.goalId || goal.status === "complete") {
      append({ kind: "pause", reason: "Goal changed or completed; user contract review required." }, ctx);
      return { block: true, terminate: true, reason: "Workbench goal changed; user must review the contract." };
    }
    if (state.phase === "paused") return { block: true, terminate: true, reason: `Workbench paused: ${state.reason} Only the user can resume; open /workbench to review.` };
    append({ kind: "admit", toolCallId: event.toolCallId }, ctx);
  });

  pi.on("context", (event, ctx) => {
    const messages = event.messages.filter((message) => message.role !== "custom"
      || !["pi-workbench-contract", "pi-workbench-view"].includes(message.customType));
    const state = readWorkbench(ctx.sessionManager.getBranch());
    if (!state) return { messages };
    let index = messages.length - 1;
    while (index >= 0 && messages[index].role !== "user") index--;
    if (index < 0) return { messages };
    const phase = currentGoal(ctx)?.status === "needs_input" ? "needs_input" : state.phase;
    const contractMessage = { role: "custom" as const, customType: "pi-workbench-contract", display: false,
      timestamp: messages[index].timestamp,
      content: `User-approved workbench contract for ${state.objective}:\n${JSON.stringify(state.contract)}\nState: ${phase}; admissions ${state.admissions}/${state.allowance}.\nOperate within this contract. Evidence is inspectable source output, not automatic certification. Use record_checkpoint for a reviewable result. If meaning is unclear or a human decision is needed, use request_human_input; it can reduce authority even when the work allowance is exhausted. Only user commands grant or renew authority. A workbench pause blocks work tools; request_human_input can record one question. needs_input blocks all tools until the user answers and resumes. Neither pause means goal complete.` };
    return { messages: [...messages.slice(0, index), contractMessage, ...messages.slice(index)] };
  });
  pi.on("session_start", (_event, ctx) => {
    const state = readWorkbench(ctx.sessionManager.getBranch());
    if (state?.phase === "running") append({ kind: "pause", reason: "Session opened or reloaded; user renewal required." }, ctx);
    else refresh(ctx);
  });
  pi.on("session_tree", (_event, ctx) => {
    const state = readWorkbench(ctx.sessionManager.getBranch());
    if (state?.phase === "running") append({ kind: "pause", reason: "Session branch changed; user renewal required." }, ctx);
    else refresh(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.mode === "tui") ctx.ui.setWidget("pi-workbench", undefined);
  });
  return { refresh };
}
