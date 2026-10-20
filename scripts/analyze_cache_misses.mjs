// Offline replay: Node 24+; no provider calls or session writes.
// node scripts/analyze_cache_misses.mjs SESSION.jsonl CORE_SESSION_MANAGER.js [LARGE_TURN_LIMIT]
import { createReadStream, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { boundInspectionResults, boundToolResult } from "../extensions/context-budget/index.ts";

const [file, corePath, limitArg] = process.argv.slice(2);
if (!file || !corePath) throw new Error("Usage: node scripts/analyze_cache_misses.mjs SESSION.jsonl CORE_SESSION_MANAGER.js [LARGE_TURN_LIMIT] (matching the session's Pi version)");
const largeLimit = limitArg === undefined ? Infinity : Number(limitArg);
if (limitArg !== undefined && (!Number.isInteger(largeLimit) || largeLimit < 1)) throw new Error("LARGE_TURN_LIMIT must be a positive integer");
const { buildContextEntries } = await import(pathToFileURL(corePath).href);
const entries = [], byId = new Map();
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const tools = new Set(["read", "bash", "grep", "find", "ls"]);
const eligible = (m) => m.role === "toolResult" && tools.has(m.toolName) && Array.isArray(m.content) && m.content.every((p) => p.type === "text" && typeof p.text === "string");
const limit = (value, fallback, min, max) => !value || !Number.isInteger(Number(value)) ? fallback : Math.max(min, Math.min(max, Number(value)));
const max = limit(process.env.PI_CONTEXT_TOOL_RESULT_BYTES, 12288, 4096, 51200);
const total = limit(process.env.PI_CONTEXT_TOOL_RESULTS_TOTAL_BYTES, 65536, 16384, 524288);
let previous, omitted = new Set();
const rows = [], counts = {};
let systemEntries = 0, toolDeltaEntries = 0, memoryMessages = 0;
const snapshot = statSync(file);
const hash = createHash("sha256");
const input = createReadStream(file, { end: snapshot.size - 1 });
input.on("data", (chunk) => hash.update(chunk));
for await (const line of createInterface({ input, crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  const e = JSON.parse(line);
  counts[e.type] = (counts[e.type] ?? 0) + 1;
  if (e.type === "message" && e.message.role === "system") {
    systemEntries++;
    if (e.message.toolsAdded?.length || e.message.toolsRemoved?.length) toolDeltaEntries++;
  }
  if (e.type === "message" && JSON.stringify(e.message.content).includes("<memory_projection")) memoryMessages++;
  if (e.type === "message" && e.message.role === "assistant" && e.message.provider === "claude-code" && e.message.model === "claude-opus-5-5") {
    const context = buildContextEntries(entries, e.parentId, byId);
    const messages = context.filter((x) => x.type === "message").map((x) => x.message);
    const inspections = messages.filter(eligible).map((m) => {
      const bounded = boundToolResult(m, Math.min(max, total));
      return { id: m.toolCallId, bytes: Buffer.byteLength(bounded.content.map((p) => p.text).join("\n")) };
    });
    let remaining = total;
    const old = new Set();
    for (const r of inspections.toReversed()) { remaining -= r.bytes; if (remaining < 0) old.add(r.id); }
    const before = new Set(omitted);
    boundInspectionResults(messages, max, total, omitted);
    const ids = new Set(inspections.map((r) => r.id));
    const moved = previous ? [...previous.ids].some((id) => ids.has(id) && previous.old.has(id) !== old.has(id)) : false;
    const newMoved = previous ? [...previous.ids].some((id) => ids.has(id) && before.has(id) !== omitted.has(id)) : false;
    const compactions = context.filter((x) => x.type === "compaction").map((x) => x.id).join(",");
    const initial = messages.find((m) => m.role === "system");
    const prompt = digest(initial ? { content: initial.content, sections: initial.sections } : null);
    const initialTools = digest(initial?.toolsAdded ?? []);
    const systems = context.filter((x) => x.type === "message" && x.message.role === "system").map((x) => x.id);
    const parents = [];
    let p = byId.get(e.parentId);
    while (p) { parents.push(p); p = byId.get(p.parentId); }
    const priorAssistantIndex = parents.findIndex((x) => x.type === "message" && x.message.role === "assistant");
    const priorAssistant = parents[priorAssistantIndex]?.message;
    const intervening = parents.slice(0, priorAssistantIndex < 0 ? parents.length : priorAssistantIndex);
    const latestUser = context.findLast((x) => x.type === "message" && x.message.role === "user")?.id;
    const u = e.message.usage;
    const row = {
      id: e.id, timestamp: e.timestamp, total: u.totalTokens, input: u.input, read: u.cacheRead, write: u.cacheWrite,
      cost: u.cost.total, large: u.totalTokens > 100000, miss: u.cacheRead < u.totalTokens * 0.5,
      oldBoundaryMove: moved, newRetrim: newMoved,
      compaction: !!previous && compactions !== previous.compactions,
      modelChange: intervening.some((x) => x.type === "model_change") || !!priorAssistant && (priorAssistant.provider !== e.message.provider || priorAssistant.model !== e.message.model),
      memoryProjectionRelocation: !!previous && latestUser !== previous.latestUser,
      leadingPromptChange: !!previous && prompt !== previous.prompt,
      initialToolsChange: !!previous && initialTools !== previous.initialTools,
      systemDeltaAppended: !!previous && systems.some((id) => !previous.systems.includes(id)),
      toolDeltaAppended: intervening.some((x) => x.type === "message" && x.message.role === "system" && (x.message.toolsAdded?.length || x.message.toolsRemoved?.length)),
      contextEdit: intervening.some((x) => x.type === "context_edit"),
      gapOverHour: !!previous && Date.parse(e.timestamp) - Date.parse(previous.timestamp) > 3600000,
      toolResults: inspections.length,
    };
    rows.push(row);
    previous = { id: e.id, timestamp: e.timestamp, ids, old, compactions, prompt, initialTools, systems, latestUser };
  }
  if (e.id) { entries.push(e); byId.set(e.id, e); }
}
const cutoff = rows.filter((r) => r.large).at(largeLimit === Infinity ? -1 : largeLimit - 1);
const cohort = cutoff ? rows.slice(0, rows.indexOf(cutoff) + 1) : rows;
const large = cohort.filter((r) => r.large), misses = large.filter((r) => r.miss), hits = large.filter((r) => !r.miss);
const causes = ["oldBoundaryMove", "newRetrim", "compaction", "modelChange", "leadingPromptChange", "initialToolsChange", "systemDeltaAppended", "toolDeltaAppended", "memoryProjectionRelocation", "contextEdit", "gapOverHour"];
const sum = (rs) => Number(rs.reduce((s, r) => s + r.cost, 0).toFixed(4));
const withoutOther = (r) => !r.compaction && !r.modelChange && !r.leadingPromptChange && !r.initialToolsChange && !r.contextEdit && !r.gapOverHour && !r.memoryProjectionRelocation && !r.systemDeltaAppended;
console.log(JSON.stringify({ file, snapshotBytes: snapshot.size, sourceSha256: hash.digest("hex"), limits: { max, total }, counts, systemEntries, toolDeltaEntries, memoryMessages,
  targetTurns: cohort.length, allTargetTurns: rows.length, cohortLargeTurnLimit: limitArg ?? null, cohortEndId: cohort.at(-1)?.id, largeTurns: large.length, misses: misses.length, hits: hits.length, missCost: sum(misses), hitCost: sum(hits),
  overlaps: Object.fromEntries(causes.map((key) => [key, { misses: misses.filter((r) => r[key]).length, hits: hits.filter((r) => r[key]).length }])),
  boundaryOnlyMisses: misses.filter((r) => r.oldBoundaryMove && withoutOther(r)).length,
  noObservedCauseMisses: misses.filter((r) => !r.oldBoundaryMove && withoutOther(r)).length,
  replay: { oldInvalidations: cohort.filter((r) => r.oldBoundaryMove).length, newInvalidations: cohort.filter((r) => r.newRetrim).length },
  missReadModes: Object.entries(misses.reduce((s, r) => { s[r.read] = (s[r.read] ?? 0) + 1; return s; }, {})).sort((a,b) => b[1]-a[1]).slice(0,10),
  missRows: misses.map(({ id, timestamp, read, cost, ...r }) => ({ id, timestamp, read, cost, ...Object.fromEntries(causes.map((key) => [key, r[key]])) })),
}, null, 2));
