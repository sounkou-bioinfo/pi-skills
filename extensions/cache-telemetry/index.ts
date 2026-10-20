import { createHash } from "node:crypto";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";

const ENTRY_TYPE = "cache-telemetry-v1";
export type CacheTurn = {
  timestamp: number; provider: string; model: string;
  input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost: number;
  classification: "hit" | "miss" | "cold" | "unknown"; sharpDrop: boolean;
  events: string[]; toolResults?: number; promptHash?: string; toolsHash?: string;
};
type MeasuredTurn = Omit<CacheTurn, "classification" | "sharpDrop">;

export function classifyTurn(turn: MeasuredTurn, previous?: CacheTurn): CacheTurn {
  const context = turn.input + turn.cacheRead + turn.cacheWrite;
  const sameModel = previous?.provider === turn.provider && previous.model === turn.model;
  const previousContext = previous ? previous.input + previous.cacheRead + previous.cacheWrite : 0;
  const sharpDrop = !!(sameModel && previous.cacheRead >= 4096 &&
    turn.cacheRead < previous.cacheRead * 0.5 && context > previousContext);
  const classification = context <= 0 ? "unknown" : sharpDrop ? "miss" :
    turn.cacheRead >= context * 0.5 ? "hit" : sameModel ? "miss" : "cold";
  return { ...turn, classification, sharpDrop };
}

// Usage already lives in assistant messages. Custom entries add request diagnostics
// without injecting telemetry into model context; older turns use their stored usage.
export function readTurns(entries: readonly SessionEntry[]): CacheTurn[] {
  const diagnostics = new Map<number, CacheTurn>();
  for (const entry of entries) {
    if (entry.type === "custom" && entry.customType === ENTRY_TYPE) {
      const data = entry.data as CacheTurn;
      diagnostics.set(data.timestamp, data);
    }
  }
  const turns: CacheTurn[] = [];
  let events: string[] = [];
  for (const entry of entries) {
    if (entry.type === "compaction") events.push("compaction");
    if (entry.type === "model_change") events.push("model change");
    if (entry.type === "branch_summary") events.push("branch summary");
    const message = entry.type === "message" ? entry.message : undefined;
    if (message?.role !== "assistant" || !message.usage) continue;
    const saved = diagnostics.get(message.timestamp);
    turns.push(classifyTurn({ ...measure(message), ...saved,
      events: saved?.events ?? (events.length ? events : ["request diagnostics not recorded"]) }, turns.at(-1)));
    events = [];
  }
  return turns;
}

function measure(message: AssistantMessage): MeasuredTurn {
  const usage = message.usage;
  return { timestamp: message.timestamp, provider: message.provider, model: message.model,
    input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite,
    totalTokens: usage.totalTokens, cost: usage.cost.total, events: [] };
}

export function formatCacheSummary(turns: CacheTurn[], last = 5): string {
  const misses = turns.filter((turn) => turn.classification === "miss");
  const hits = turns.filter((turn) => turn.classification === "hit");
  const cold = turns.filter((turn) => turn.classification === "cold");
  const unknown = turns.filter((turn) => turn.classification === "unknown");
  const cost = (rows: CacheTurn[]) => rows.reduce((sum, turn) => sum + turn.cost, 0).toFixed(2);
  const measured = misses.length + hits.length;
  return [
    `Cache (active branch): ${turns.length} turns; ${misses.length} misses; ${measured ? (100 * misses.length / measured).toFixed(1) : "0.0"}% miss rate (hits + misses).`,
    `Cost: misses $${cost(misses)}; hits $${cost(hits)}; cold $${cost(cold)} (${cold.length}); unknown $${cost(unknown)} (${unknown.length}).`,
    "Hit: >=50% cached input. Miss: <50% reuse after a comparable turn, or >50% cache-read drop while input context grew. First/model-switch low reuse is cold. These are heuristics, not provider cache verdicts.",
    ...misses.slice(-last).map((turn) => `${new Date(turn.timestamp).toISOString()} ${turn.provider}/${turn.model}: read ${turn.cacheRead}, input ${turn.input}, write ${turn.cacheWrite}, total ${turn.totalTokens}, $${turn.cost.toFixed(2)}${turn.sharpDrop ? " [sharp drop]" : ""}; preceding: ${turn.events.join(", ") || "none observed"}; tool results ${turn.toolResults ?? "unknown"}.`),
  ].join("\n");
}

export default function cacheTelemetry(pi: ExtensionAPI): void {
  let turns: CacheTurn[] = [];
  let events: string[] = [];
  let request: Pick<CacheTurn, "toolResults" | "promptHash" | "toolsHash"> = {};
  const restore = (_event: unknown, ctx: ExtensionContext) => {
    turns = readTurns(ctx.sessionManager.getBranch());
    events = [];
    request = {};
  };
  pi.on("session_start", restore);
  pi.on("session_tree", (event, ctx) => { restore(event, ctx); events.push("tree navigation"); });
  pi.on("session_compact", () => { events.push("compaction"); });
  pi.on("model_select", () => { events.push("model change"); });
  pi.on("context", (event, ctx) => {
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    request = {
      toolResults: event.messages.filter((message) => message.role === "toolResult").length,
      promptHash: hash(ctx.getSystemPrompt()), toolsHash: hash(JSON.stringify(pi.getActiveTools())),
    };
  });
  pi.on("turn_end", (event) => {
    if (event.message.role !== "assistant") return;
    const previous = turns.at(-1);
    if (previous?.promptHash && request.promptHash !== previous.promptHash) events.push("system prompt changed");
    if (previous?.toolsHash && request.toolsHash !== previous.toolsHash) events.push("active tool order/set changed");
    const turn = classifyTurn({ ...measure(event.message), ...request, events: [...new Set(events)] }, previous);
    turns.push(turn);
    pi.appendEntry(ENTRY_TYPE, turn);
    events = [];
    request = {};
  });
  pi.registerCommand("cache", {
    description: "Show cache reuse, cost, and last N misses (default 5; active branch)",
    handler: async (args, ctx) => {
      const last = args.trim() ? Number(args.trim()) : 5;
      if (!Number.isInteger(last) || last < 1 || last > 100) {
        ctx.ui.notify("Usage: /cache [1–100]", "warning");
        return;
      }
      ctx.ui.notify(formatCacheSummary(turns, last), "info");
    },
  });
}
