import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { runRlmEngine } from "./engine.js";
import { rlmToolParamsSchema, type RlmToolParams } from "./schema.js";
import { RunStore } from "./runs.js";
import type { RunRecord, StartRunInput } from "./types.js";

const defaultWaitTimeoutMs = 120000;
const defaultTimeoutMs = 180000;

export default function extension(pi: ExtensionAPI): void {
  const runs = new RunStore();

  pi.registerTool({
    name: "rlm",
    label: "RLM",
    description:
      "Recursive long-context orchestration with a Node-based, webR-ready environment. Supports start/status/wait/cancel and recursive decomposition over stored context.",
    parameters: rlmToolParamsSchema,
    async execute(_toolCallId, params: RlmToolParams, signal, onUpdate, ctx) {
      const op = params.op ?? "start";

      if (op === "start") {
        if (!params.task || !params.task.trim()) throw new Error("'task' is required for op=start");
        if (!params.context && !params.contextPath) throw new Error("Provide 'context' or 'contextPath' for op=start");

        const input = resolveStartInput(params, ctx.cwd);
        const progress = (line: string): void => {
          onUpdate?.({ content: [{ type: "text", text: line }], details: {} });
        };

        const record = runs.start(input, (runId, runSignal) => runRlmEngine({ ...input, runId }, runSignal, progress), signal);

        if (input.async) {
          return {
            content: [{ type: "text", text: `RLM run started in background.\nrun_id: ${record.id}` }],
            details: toRunDetails(record),
          };
        }

        const result = await record.promise;
        return {
          content: [{ type: "text", text: formatCompletedRunText(result) }],
          details: { ...toRunDetails(record), result },
        };
      }

      if (op === "status") {
        if (params.id) {
          const record = runs.get(params.id);
          if (!record) throw new Error(`Unknown run id: ${params.id}`);
          return { content: [{ type: "text", text: describeRecord(record) }], details: toRunDetails(record) };
        }
        const list = runs.list();
        return {
          content: [{ type: "text", text: list.length === 0 ? "No RLM runs found." : ["Recent RLM runs:", ...list.map(formatRunLine)].join("\n") }],
          details: { runs: list.map(toRunDetails) },
        };
      }

      if (!params.id) throw new Error(`'id' is required for op=${op}`);

      if (op === "wait") {
        const waitTimeoutMs = params.waitTimeoutMs ?? defaultWaitTimeoutMs;
        const { record, done } = await runs.wait(params.id, waitTimeoutMs);
        if (!done) {
          return {
            content: [{ type: "text", text: `Run ${record.id} still running after ${waitTimeoutMs}ms.` }],
            details: { ...toRunDetails(record), done: false },
          };
        }
        return {
          content: [{ type: "text", text: describeRecord(record) }],
          details: { ...toRunDetails(record), done: true },
        };
      }

      if (op === "cancel") {
        const record = runs.cancel(params.id);
        return {
          content: [{ type: "text", text: `Cancellation requested for run ${record.id}. Current status: ${record.status}` }],
          details: toRunDetails(record),
        };
      }

      throw new Error(`Unsupported op: ${op}`);
    },
  });
}

function resolveStartInput(params: RlmToolParams, cwd: string): StartRunInput {
  return {
    task: params.task ?? "",
    context: params.context,
    contextPath: params.contextPath,
    contextKind: params.contextKind,
    cwd: params.cwd ?? cwd,
    backend: params.backend ?? "cli",
    async: params.async ?? false,
    model: params.model ?? "openai-codex/gpt-5.4",
    subModel: params.subModel ?? "openai-codex/gpt-5.3-codex-spark",
    mode: params.mode ?? "auto",
    maxDepth: params.maxDepth ?? 2,
    maxNodes: params.maxNodes ?? 24,
    maxBranching: params.maxBranching ?? 4,
    concurrency: params.concurrency ?? 2,
    maxIterations: params.maxIterations ?? 6,
    maxChunkChars: params.maxChunkChars ?? 40000,
    grepLimit: params.grepLimit ?? 20,
    timeoutMs: params.timeoutMs ?? defaultTimeoutMs,
    piBin: params.piBin ?? "pi",
  };
}

function formatRunLine(record: RunRecord): string {
  return `- ${record.id} | ${record.status} | depth<=${record.input.maxDepth} nodes<=${record.input.maxNodes} | task=${shorten(record.input.task, 56)}`;
}

function describeRecord(record: RunRecord): string {
  const lines = [
    `run_id: ${record.id}`,
    `status: ${record.status}`,
    `task: ${record.input.task}`,
    `model: ${record.input.model}`,
    `sub_model: ${record.input.subModel}`,
  ];
  if (record.finishedAt) lines.push(`duration_ms: ${record.finishedAt - record.startedAt}`);
  if (record.error) lines.push(`error: ${record.error}`);
  if (record.result) {
    lines.push(`artifacts: ${record.result.artifacts.dir}`);
    lines.push(`strategy: ${summarizeStrategy(record.result)}`);
    if (record.result.visualizerSession) lines.push(`tmux_session: ${record.result.visualizerSession}`);
    const childSummary = summarizeChildren(record.result.root);
    if (childSummary.length > 0) lines.push(...childSummary);
    const rLoadCode = extractRLoadCode(record.result.root);
    if (rLoadCode) lines.push("r_load_code:", indentBlock(rLoadCode, "  "));
    lines.push(`final: ${record.result.final}`);
  }
  return lines.join("\n");
}

function formatCompletedRunText(result: { runId: string; artifacts: { dir: string }; final: string; visualizerSession?: string; stats?: { durationMs: number }; root: { decision?: { action: string }; observations: Array<{ kind: string; text: string }>; children: Array<{ id: string; task: string; status: string; result?: string; error?: string }> } }): string {
  const lines = [
    "RLM run completed.",
    `run_id: ${result.runId}`,
    `artifacts: ${result.artifacts.dir}`,
    `strategy: ${summarizeStrategy(result)}`,
  ];
  if (typeof result.stats?.durationMs === "number") lines.push(`duration_ms: ${result.stats.durationMs}`);
  if (result.visualizerSession) lines.push(`tmux_session: ${result.visualizerSession}`);
  const childSummary = summarizeChildren(result.root);
  if (childSummary.length > 0) lines.push(...childSummary);
  const rLoadCode = extractRLoadCode(result.root);
  if (rLoadCode) lines.push("r_load_code:", indentBlock(rLoadCode, "  "));
  lines.push("", result.final);
  return lines.join("\n");
}

function summarizeStrategy(result: { root: { decision?: { action: string }; observations: Array<{ kind: string; text: string }> } }): string {
  const steps: string[] = [];
  for (const observation of result.root.observations) {
    if (observation.kind !== "note") continue;
    if (observation.text.startsWith("r_eval =>")) steps.push("r_eval");
    if (observation.text.startsWith("repl_eval =>")) steps.push("repl_eval");
  }
  if (result.root.decision?.action) steps.push(result.root.decision.action);
  const uniqueSteps = steps.filter((step, index) => steps.indexOf(step) === index);
  return uniqueSteps.length > 0 ? uniqueSteps.join(" -> ") : "unknown";
}

function summarizeChildren(root: { children: Array<{ id: string; task: string; status: string; result?: string; error?: string }> }): string[] {
  if (!root.children || root.children.length === 0) return [];
  const lines = [`child_calls: ${root.children.length}`];
  for (const child of root.children.slice(0, 5)) {
    lines.push(`- ${child.id} | ${child.status} | task=${shorten(child.task, 64)} | result=${shorten(child.result || child.error || "", 64)}`);
  }
  if (root.children.length > 5) lines.push(`- ... ${root.children.length - 5} more child calls`);
  return lines;
}

function extractRLoadCode(root: { observations: Array<{ kind: string; text: string }> }): string | undefined {
  for (const observation of root.observations) {
    if (observation.kind !== "note") continue;
    if (observation.text.startsWith("r_load_code =>")) {
      return observation.text.slice("r_load_code =>".length).trim();
    }
    if (observation.text.startsWith("r_eval =>")) {
      const extracted = extractRLoadCodeFromREval(observation.text.slice("r_eval =>".length).trim());
      if (extracted) return extracted;
      continue;
    }
    if (!observation.text.startsWith("repl_eval =>")) continue;
    const payload = safeJsonParse(observation.text.slice("repl_eval =>".length).trim());
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
    const record = payload as Record<string, unknown>;
    for (const key of ["rLoadCode", "r_load_code", "loadCode"]) {
      if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
    }
  }
  return undefined;
}

function extractRLoadCodeFromREval(text: string): string | undefined {
  const markerMatch = text.match(/(?:^|\n)Loader snippet:\n([\s\S]+)$/);
  if (markerMatch?.[1]?.trim()) return markerMatch[1].trim();

  const lines = text.split("\n");
  if (lines.length < 2) return undefined;
  const candidate = lines.slice(1).join("\n").trim();
  if (!candidate) return undefined;
  if (looksLikeRLoadCode(candidate)) return candidate;
  return undefined;
}

function looksLikeRLoadCode(text: string): boolean {
  return /(read_parquet|arrow::|duckdb::|DBI::|read\.csv|data\.frame\(|requireNamespace\(|context\$path|context\$text)/.test(text);
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function indentBlock(text: string, indent: string): string {
  return text
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n");
}

function toRunDetails(record: RunRecord): Record<string, unknown> {
  return {
    contract_version: "rlm.v1",
    run_id: record.id,
    status: record.status,
    input: record.input,
    created_at: record.createdAt,
    started_at: record.startedAt,
    finished_at: record.finishedAt,
    error: record.error,
  };
}

function shorten(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 3)}...`;
}
