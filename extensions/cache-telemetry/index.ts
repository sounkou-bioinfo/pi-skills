import { createHash } from "node:crypto";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";

const ENTRY_TYPE = "cache-telemetry-v1";
const OMISSIONS_TYPE = "context-budget-omissions-v1";
// Provider prompt caches used here expire after at most one hour without use.
export const CACHE_LIFETIME_MS = 60 * 60 * 1000;

export function idleEvent(previousTimestamp: number | undefined, requestTimestamp: number): string | undefined {
  if (previousTimestamp === undefined) return undefined;
  const idle = requestTimestamp - previousTimestamp;
  return idle > CACHE_LIFETIME_MS ? `idle ${Math.round(idle / 60000)} min, past the ${CACHE_LIFETIME_MS / 60000} min cache lifetime` : undefined;
}

function trimEvent(entry: SessionEntry): string | undefined {
  if (entry.type !== "custom" || entry.customType !== OMISSIONS_TYPE || !Array.isArray(entry.data)) return undefined;
  return `context-budget trimmed ${entry.data.length} tool results`;
}

// Context-budget trims recorded on the branch since the assistant reply before `currentId`.
export function trimEventsBefore(entries: readonly SessionEntry[], currentId?: string): string[] {
  let end = entries.length;
  if (currentId) {
    const index = entries.findIndex((entry) => entry.id === currentId);
    if (index >= 0) end = index;
  }
  const found: string[] = [];
  for (let index = end - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.type === "message" && entry.message.role === "assistant") break;
    const event = trimEvent(entry);
    if (event) found.unshift(event);
  }
  return found;
}
export type ProviderPayloadContinuity = {
  field: "input" | "messages"; items: number; previousItems?: number; commonPrefixItems?: number;
  prefixStable?: boolean; firstMismatch?: number; changedFields?: string[];
};
type ProviderPayloadFingerprint = {
  field: "input" | "messages"; itemHashes: string[]; fieldHashes: Record<string, string>;
};
export type CacheTurn = {
  timestamp: number; provider: string; model: string;
  input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost: number;
  classification: "hit" | "miss" | "cold" | "unknown"; sharpDrop: boolean;
  events: string[]; messageEntryId?: string; toolResults?: number; promptHash?: string; toolsHash?: string;
  providerPayload?: ProviderPayloadContinuity;
};
type MeasuredTurn = Omit<CacheTurn, "classification" | "sharpDrop">;

// Estimated extra cost of a miss: tokens written to cache that a hit would have
// read instead, priced from the turn's own per-token write and read costs.
export function missPenalty(message: any): number {
  const usage = message?.usage;
  if (!usage?.cacheWrite || !usage.cost?.cacheWrite) return 0;
  const writeRate = usage.cost.cacheWrite / usage.cacheWrite;
  const readRate = usage.cacheRead && usage.cost.cacheRead ? usage.cost.cacheRead / usage.cacheRead : writeRate / 12.5;
  return Math.max(0, usage.cacheWrite * (writeRate - readRate));
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const jsonHash = (value: unknown) => hash(JSON.stringify(value) ?? "undefined");
const tokens = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(value >= 100000 ? 0 : 1)}k` : String(value);

export function inspectProviderPayload(payload: unknown, previous?: ProviderPayloadFingerprint):
  { fingerprint: ProviderPayloadFingerprint; continuity: ProviderPayloadContinuity } | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, unknown>;
  const field: "input" | "messages" | undefined = Array.isArray(record.input) ? "input" :
    Array.isArray(record.messages) ? "messages" : undefined;
  if (!field) return undefined;
  const itemHashes = (record[field] as unknown[]).map(jsonHash);
  const fieldHashes = Object.fromEntries(Object.keys(record).sort()
    .filter((key) => key !== field && key !== "previous_response_id")
    .map((key) => [key, jsonHash(record[key])]));
  const fingerprint = { field, itemHashes, fieldHashes };
  const continuity: ProviderPayloadContinuity = { field, items: itemHashes.length };
  if (!previous) return { fingerprint, continuity };
  continuity.previousItems = previous.itemHashes.length;
  continuity.changedFields = [...new Set([...Object.keys(previous.fieldHashes), ...Object.keys(fieldHashes)])]
    .sort().filter((key) => previous.fieldHashes[key] !== fieldHashes[key]);
  if (previous.field !== field) {
    continuity.commonPrefixItems = 0;
    continuity.firstMismatch = 0;
    continuity.prefixStable = false;
    continuity.changedFields.unshift("message container");
    return { fingerprint, continuity };
  }
  const comparable = Math.min(previous.itemHashes.length, itemHashes.length);
  let common = 0;
  while (common < comparable && previous.itemHashes[common] === itemHashes[common]) common++;
  continuity.commonPrefixItems = common;
  if (common < previous.itemHashes.length) continuity.firstMismatch = common;
  continuity.prefixStable = itemHashes.length >= previous.itemHashes.length &&
    common === previous.itemHashes.length && continuity.changedFields.length === 0;
  return { fingerprint, continuity };
}

export function formatPayloadContinuity(payload?: ProviderPayloadContinuity): string {
  if (!payload) return "Pre-transport logical request not observed.";
  if (payload.prefixStable === undefined) {
    return `Pre-transport logical request: ${payload.field} ${payload.items} items; no preceding comparable request.`;
  }
  if (payload.prefixStable) {
    return `Pre-transport logical request prefix stable: ${payload.commonPrefixItems}/${payload.previousItems} prior ${payload.field} items; static fields stable. Transport continuation unobserved.`;
  }
  const location = payload.firstMismatch === undefined ? "item prefix" : `${payload.field}[${payload.firstMismatch}]`;
  const fields = payload.changedFields?.length ? `; changed fields ${payload.changedFields.join(", ")}` : "";
  return `Pre-transport logical request drift: ${location}${fields}. Transport continuation unobserved.`;
}

export function formatCacheStatus(turns: CacheTurn[]): string {
  const last = turns.at(-1);
  if (!last) return "cache –";
  const context = last.input + last.cacheRead + last.cacheWrite;
  const reuse = context ? Math.round(100 * last.cacheRead / context) : 0;
  const misses = turns.filter((turn) => turn.classification === "miss");
  const total = turns.reduce((sum, turn) => sum + turn.cost, 0);
  const missCost = misses.reduce((sum, turn) => sum + turn.cost, 0);
  const mark = last.classification === "miss" ? "✗ MISS" : last.classification === "hit" ? "✓" : last.classification;
  return `cache ${mark} ${reuse}% · turn $${last.cost.toFixed(2)} · session $${total.toFixed(2)} · ${misses.length} misses $${missCost.toFixed(2)}`;
}

export function formatMissAlert(turn: CacheTurn, penalty: number): string {
  return `Cache miss: read ${tokens(turn.cacheRead)}, rewrote ${tokens(turn.cacheWrite)} of ${tokens(turn.input + turn.cacheRead + turn.cacheWrite)} tokens. ` +
    `Turn cost $${turn.cost.toFixed(2)}${penalty > 0 ? ` (about $${penalty.toFixed(2)} more than a hit)` : ""}. ` +
    `Preceding: ${turn.events.join(", ") || "none observed"}. ${formatPayloadContinuity(turn.providerPayload)}`;
}

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
  const diagnosticsByEntry = new Map<string, CacheTurn>();
  const legacyDiagnostics = new Map<number, CacheTurn>();
  for (const entry of entries) {
    if (entry.type === "custom" && entry.customType === ENTRY_TYPE) {
      const data = entry.data as CacheTurn;
      if (data.messageEntryId) diagnosticsByEntry.set(data.messageEntryId, data);
      else legacyDiagnostics.set(data.timestamp, data);
    }
  }
  const turns: CacheTurn[] = [];
  let events: string[] = [];
  let previousAssistant: number | undefined;
  for (const entry of entries) {
    if (entry.type === "compaction") events.push("compaction");
    if (entry.type === "model_change") events.push("model change");
    if (entry.type === "branch_summary") events.push("branch summary");
    const trim = trimEvent(entry);
    if (trim) events.push(trim);
    const message = entry.type === "message" ? entry.message : undefined;
    if (message?.role === "user") {
      const idle = idleEvent(previousAssistant, message.timestamp);
      if (idle) events.push(idle);
    }
    if (message?.role === "assistant") previousAssistant = message.timestamp;
    if (message?.role !== "assistant" || !message.usage) continue;
    const saved = diagnosticsByEntry.get(entry.id) ?? legacyDiagnostics.get(message.timestamp);
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
    ...misses.slice(-last).map((turn) => `${new Date(turn.timestamp).toISOString()} ${turn.provider}/${turn.model}: read ${turn.cacheRead}, input ${turn.input}, write ${turn.cacheWrite}, total ${turn.totalTokens}, $${turn.cost.toFixed(2)}${turn.sharpDrop ? " [sharp drop]" : ""}; preceding: ${turn.events.join(", ") || "none observed"}; tool results ${turn.toolResults ?? "unknown"}. ${formatPayloadContinuity(turn.providerPayload)}`),
  ].join("\n");
}

export default function cacheTelemetry(pi: ExtensionAPI): void {
  let turns: CacheTurn[] = [];
  let events: string[] = [];
  let request: Pick<CacheTurn, "toolResults" | "promptHash" | "toolsHash" | "providerPayload"> & { at?: number } = {};
  let previousPayload: ProviderPayloadFingerprint | undefined;
  const showStatus = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    const text = formatCacheStatus(turns);
    const color = turns.at(-1)?.classification === "miss" ? "error" : "dim";
    ctx.ui.setStatus("cache-telemetry", ctx.ui.theme.fg(color, text));
  };
  const restore = (_event: unknown, ctx: ExtensionContext) => {
    turns = readTurns(ctx.sessionManager.getBranch());
    events = [];
    request = {};
    previousPayload = undefined;
    showStatus(ctx);
  };
  pi.on("session_start", restore);
  pi.on("session_tree", (event, ctx) => { restore(event, ctx); events.push("tree navigation"); });
  pi.on("session_compact", () => { events.push("compaction"); });
  pi.on("model_select", () => { events.push("model change"); previousPayload = undefined; });
  pi.on("context", (event, ctx) => {
    request = {
      at: request.at ?? Date.now(),
      toolResults: event.messages.filter((message) => message.role === "toolResult").length,
      promptHash: hash(ctx.getSystemPrompt()), toolsHash: hash(JSON.stringify(pi.getActiveTools())),
    };
  });
  pi.on("before_provider_request", (event) => {
    const observed = inspectProviderPayload(event.payload, previousPayload);
    request = { ...request, providerPayload: observed?.continuity };
    previousPayload = observed?.fingerprint;
  });
  pi.on("turn_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const previous = turns.at(-1);
    if (previous?.promptHash && request.promptHash !== previous.promptHash) events.push("system prompt changed");
    if (previous?.toolsHash && request.toolsHash !== previous.toolsHash) events.push("active tool order/set changed");
    const idle = idleEvent(previous?.timestamp, request.at ?? event.message.timestamp);
    if (idle) events.push(idle);
    events.push(...trimEventsBefore(ctx.sessionManager.getBranch(), event.messageEntryId));
    const { at: _at, ...diagnostics } = request;
    const turn = classifyTurn({ ...measure(event.message), ...diagnostics, messageEntryId: event.messageEntryId,
      events: [...new Set(events)] }, previous);
    turns.push(turn);
    pi.appendEntry(ENTRY_TYPE, turn);
    events = [];
    request = {};
    showStatus(ctx);
    if (turn.classification === "miss" && ctx.hasUI) ctx.ui.notify(formatMissAlert(turn, missPenalty(event.message)), "warning");
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
