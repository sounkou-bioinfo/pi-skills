import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";
import { Type } from "typebox";

export const WORKBENCH_ENTRY = "pi-workbench-v1";
const CONTRACT_FIELDS = ["acceptance", "invariants", "autonomy", "escalation"] as const;
const PROPOSAL_ENTRY = "pi-workbench-proposal-v1";
export type WorkbenchContract = Record<(typeof CONTRACT_FIELDS)[number], string>;
type Goal = { id: string; objective: string; status: string };
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

function terminalText(text: string): string {
  return stripVTControlCharacters(text).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}

export function workbenchWidget(state: WorkbenchState, width: number): string[] {
  return [
    `Workbench ${state.phase.toUpperCase()} · ${state.admissions}/${state.allowance} tool admissions`,
    `Question: ${state.objective}`,
    state.checkpoint ? `Agent report: ${state.checkpoint.statement}` : state.reason,
    "/workbench show · evidence · pause · resume N",
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
    else if (matchesKey(data, "pageUp")) this.offset = Math.max(0, this.offset - this.height());
    else if (matchesKey(data, "pageDown")) this.offset += this.height();
  }
  render(width: number): string[] {
    width = Math.max(1, width);
    const lines = wrapTextWithAnsi(terminalText(this.text), width);
    const height = Math.max(1, this.height() - 1);
    this.offset = Math.min(this.offset, Math.max(0, lines.length - height));
    return [...lines.slice(this.offset, this.offset + height), "↑↓ scroll · PgUp/PgDn · Esc close"]
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

export function registerWorkbench(pi: ExtensionAPI, currentGoal: (ctx: ExtensionContext) => Goal | undefined) {
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
    if (ctx.mode === "tui") {
      ctx.ui.setWidget("pi-workbench", state || pending ? () => ({
        render: (width) => state ? [...workbenchWidget(state, width),
          ...(pending ? [truncateToWidth("Amendment proposed · /workbench contract", Math.max(1, width))] : [])]
          : [truncateToWidth("Contract PROPOSED · /workbench contract to review", Math.max(1, width))],
        invalidate() {},
      }) : undefined);
    }
  }
  function append(event: WorkbenchEvent, ctx: ExtensionContext) {
    pi.appendEntry(WORKBENCH_ENTRY, event);
    refresh(ctx);
  }
  async function display(text: string, ctx: ExtensionContext) {
    if (ctx.mode === "tui") {
      await ctx.ui.custom<void>((tui, _theme, _keys, done) => new WorkbenchView(text, () => Math.max(3, tui.terminal.rows - 6), () => done()), { overlay: true });
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

  pi.registerCommand("workbench", {
    description: "Shared contract and evidence: show | contract [JSON] | evidence [entry-id] | pause | resume N | off",
    getArgumentCompletions: (prefix) => ["show", "contract", "evidence", "pause", "resume", "off"]
      .filter((value) => value.startsWith(prefix) && value !== prefix).map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      const parsed = args.trim().match(/^(\S+)(?:\s+(.*))?$/s);
      const command = parsed?.[1] ?? "show";
      const tail = parsed?.[2] ?? "";
      const rest = tail.split(/\s+/).filter(Boolean);
      const branch = ctx.sessionManager.getBranch();
      const state = readWorkbench(branch);
      if (["show", "pause", "off"].includes(command) && rest.length) throw new Error(`${command} takes no arguments.`);
      if (command === "contract") {
        const goal = requireGoal(ctx);
        if (!ctx.isIdle()) throw new Error("Set the contract while idle. /workbench pause stops future admissions; let current work finish.");
        let text = tail;
        if (!text) {
          if (!ctx.hasUI) throw new Error("Supply contract JSON in non-interactive mode.");
          const initial = proposal(ctx) ?? state?.contract ?? { acceptance: "", invariants: "", autonomy: "", escalation: "" };
          const edited = await ctx.ui.editor("Workbench contract — save to approve; Esc cancels", JSON.stringify(initial, null, 2));
          if (edited === undefined) return;
          text = edited;
        }
        const contract = parseContract(text);
        if (requireGoal(ctx).id !== goal.id || !ctx.isIdle()) throw new Error("Goal or activity changed during editing; review the contract again.");
        append({ kind: "contract", goalId: goal.id, objective: goal.objective, contract }, ctx);
        ctx.ui.notify("Contract recorded. /workbench resume N grants N tool admissions; it does not start a model turn.", "info");
      } else if (command === "resume") {
        if (!state) throw new Error("Set a workbench contract first.");
        if (requireGoal(ctx).id !== state.goalId) throw new Error("Goal changed; set a contract for the current goal.");
        if (!ctx.isIdle()) throw new Error("Renew while idle after admitted work finishes.");
        const allowance = Number(rest[0]);
        if (rest.length !== 1 || !Number.isSafeInteger(allowance) || allowance < 1 || allowance > 10000) {
          throw new Error("Usage: /workbench resume N (1–10000 tool admissions; not a token or spending cap)");
        }
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
        await display(state ? [
          `Question: ${state.objective}`, `Goal: ${state.goalId}`, `State: ${state.phase} — ${state.reason}`,
          `Tool admissions: ${state.admissions}/${state.allowance} (not spending; excludes nested/background work)`,
          ...CONTRACT_FIELDS.map((field) => `${field}: ${state.contract[field]}`),
          "", "Proposed amendment (not authority):", JSON.stringify(proposal(ctx) ?? "none", null, 2),
          "", "Agent checkpoint (reported, not certified):", JSON.stringify(state.checkpoint ?? "none", null, 2),
          "", "Commands: /workbench contract | evidence [entry-id] | pause | resume N | off",
          "Pause gates future tool admissions and package continuations, not running work or rollback.",
        ].join("\n\n") : `No approved workbench contract. Start with /goals <objective> --no-auto, then /workbench contract.\nAgent proposal (not authority):\n${JSON.stringify(proposal(ctx) ?? "none", null, 2)}`, ctx);
      } else throw new Error("Usage: /workbench show | contract [JSON] | evidence [entry-id] | pause | resume N | off");
    },
  });

  pi.registerTool({
    name: "propose_contract", label: "Propose contract",
    description: "Draft a collaboration contract for the existing user goal. A proposal grants no authority and does not change the approved contract. The user reviews it with /workbench contract, then grants an allowance with /workbench resume N.",
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
    const state = readWorkbench(ctx.sessionManager.getBranch());
    if (!state) return;
    const goal = currentGoal(ctx);
    if (!goal || goal.id !== state.goalId || goal.status === "complete") {
      append({ kind: "pause", reason: "Goal changed or completed; user contract review required." }, ctx);
      return { block: true, terminate: true, reason: "Workbench goal changed; user must review the contract." };
    }
    if (state.phase === "paused") return { block: true, terminate: true, reason: `Workbench paused: ${state.reason} Only the user can /workbench resume N.` };
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
    const contractMessage = { role: "custom" as const, customType: "pi-workbench-contract", display: false,
      timestamp: messages[index].timestamp,
      content: `User-approved workbench contract for ${state.objective}:\n${JSON.stringify(state.contract)}\nState: ${state.phase}; admissions ${state.admissions}/${state.allowance}.\nOperate within this contract. Evidence is inspectable source output, not automatic certification. Use record_checkpoint for material uncertainty or a reviewable result. Only user commands grant or renew authority. Paused means discuss without tools until the user renews; it does not mean goal complete.` };
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
}
