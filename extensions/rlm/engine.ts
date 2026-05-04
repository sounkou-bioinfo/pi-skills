import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";
import { completeWithCli } from "./backends.js";
import { plannerPrompt, solverPrompt, synthesisPrompt } from "./prompts.js";
import { evalInRepl, type ReplContext } from "./repl.js";
import { startTmuxVisualizer } from "./tmux.js";
import type { RlmAction, RlmContextKind, RlmNode, RlmObservation, RlmRunResult, RunArtifacts, StartRunInput } from "./types.js";
import { chunkText, extractFirstJsonObject, grepText, normalizeTask, safeJsonParse, shortText } from "./utils.js";
import { createWebRSession, evalWithWebR, type WebRSession } from "./webr.js";

interface EngineInput extends StartRunInput {
  runId: string;
}

interface EngineState {
  nodeCounter: number;
  nodesVisited: number;
  maxDepthSeen: number;
}

type FileEntry = { path: string; text: string };
type CsvRow = Record<string, string>;

type ResolvedContext =
  | { kind: "text"; label: string; text: string }
  | { kind: "files"; label: string; root: string; files: FileEntry[] }
  | { kind: "csv"; label: string; text: string; columns: string[]; rows: CsvRow[] }
  | { kind: "json"; label: string; value: unknown }
  | { kind: "parquet"; label: string; path: string; columns: string[]; rows: Array<Record<string, unknown>> };

const DEFAULT_IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".turbo"]);
const MAX_FILE_CONTEXT_FILES = 2000;
const MAX_FILE_CONTEXT_BYTES = 5_000_000;

class NodeEnvironment {
  constructor(readonly context: ResolvedContext, readonly maxChunkChars: number, readonly grepLimit: number) {}

  describe(): string {
    switch (this.context.kind) {
      case "text":
        return `kind=text; chars=${this.context.text.length}; capabilities=peek,grep,sample_chunks,map_chunks,decompose,repl_eval,r_eval,solve`;
      case "files": {
        const totalChars = this.context.files.reduce((sum, file) => sum + file.text.length, 0);
        return `kind=files; root=${this.context.root}; files=${this.context.files.length}; chars=${totalChars}; capabilities=peek,grep,sample_chunks,map_chunks,decompose,repl_eval,solve`;
      }
      case "csv":
        return `kind=csv; rows=${this.context.rows.length}; columns=${this.context.columns.length}; capabilities=peek,grep,sample_chunks,map_chunks,decompose,repl_eval,r_eval,solve`;
      case "json":
        return `kind=json; chars=${JSON.stringify(this.context.value)?.length ?? 0}; capabilities=peek,grep,sample_chunks,map_chunks,decompose,repl_eval,solve`;
      case "parquet":
        return `kind=parquet; path=${this.context.path}; rows=${this.context.rows.length}; columns=${this.context.columns.length}; capabilities=peek,grep,sample_chunks,map_chunks,decompose,repl_eval,r_eval,solve`;
    }
  }

  contextKind(): RlmContextKind {
    return this.context.kind;
  }

  contextSize(context = this.context): number {
    switch (context.kind) {
      case "text":
        return context.text.length;
      case "files":
        return context.files.reduce((sum, file) => sum + file.text.length, 0);
      case "csv":
        return context.text.length;
      case "json":
        return JSON.stringify(context.value)?.length ?? 0;
      case "parquet":
        return JSON.stringify(context.rows)?.length ?? 0;
    }
  }

  manifestText(context = this.context): string {
    switch (context.kind) {
      case "text":
        return context.text;
      case "files":
        return context.files.map((file) => `${file.path} (${file.text.length} chars)`).join("\n");
      case "csv":
        return renderCsvContext(context);
      case "json":
        return JSON.stringify(context.value, null, 2) ?? "null";
      case "parquet":
        return renderParquetContext(context);
    }
  }

  peek(start: number, end: number): string {
    const basis = this.manifestText();
    const s = Math.max(0, Math.min(start, basis.length));
    const e = Math.max(s, Math.min(end, basis.length));
    return basis.slice(s, e);
  }

  grep(pattern: string): string[] {
    switch (this.context.kind) {
      case "text":
        return grepText(this.context.text, pattern, this.grepLimit);
      case "files":
        return grepFiles(this.context.files, pattern, this.grepLimit);
      case "csv":
        return grepText(renderCsvContext(this.context), pattern, this.grepLimit);
      case "json":
        return grepText(JSON.stringify(this.context.value, null, 2) ?? "null", pattern, this.grepLimit);
      case "parquet":
        return grepText(renderParquetContext(this.context), pattern, this.grepLimit);
    }
  }

  chunk(size?: number): ResolvedContext[] {
    switch (this.context.kind) {
      case "text": {
        const textChunks = chunkText(this.context.text, Math.max(500, Math.min(size ?? this.maxChunkChars, this.maxChunkChars)));
        return textChunks.map((text, index) => ({ kind: "text", label: `${this.context.label}#chunk${index + 1}`, text }));
      }
      case "files": {
        const ctx = this.context;
        const maxChars = Math.max(500, Math.min(size ?? this.maxChunkChars, this.maxChunkChars));
        const groups = chunkFileEntries(ctx.files, maxChars);
        return groups.map((files, index) => ({ kind: "files", label: `${ctx.label}#chunk${index + 1}`, root: ctx.root, files }));
      }
      case "csv": {
        const ctx = this.context;
        const maxChars = Math.max(500, Math.min(size ?? this.maxChunkChars, this.maxChunkChars));
        const groups = chunkCsvRows(ctx.rows, maxChars);
        return groups.map((rows, index) => ({
          kind: "csv",
          label: `${ctx.label}#chunk${index + 1}`,
          columns: ctx.columns,
          rows,
          text: renderCsv(ctx.columns, rows),
        }));
      }
      case "json": {
        return chunkJsonContext(this.context, size ?? this.maxChunkChars);
      }
      case "parquet": {
        const ctx = this.context;
        const maxChars = Math.max(500, Math.min(size ?? this.maxChunkChars, this.maxChunkChars));
        const groups = chunkGenericRows(ctx.rows, maxChars);
        return groups.map((rows, index) => ({ kind: "parquet", label: `${ctx.label}#chunk${index + 1}`, path: ctx.path, columns: ctx.columns, rows }));
      }
    }
  }

  sampleChunks(size?: number, sampleCount = 3): ResolvedContext[] {
    const chunks = this.chunk(size);
    if (chunks.length <= sampleCount) return chunks;
    const indices = [0, Math.floor(chunks.length / 2), chunks.length - 1].slice(0, sampleCount);
    return indices.map((index) => chunks[index]);
  }

  renderContextForModel(context = this.context): string {
    switch (context.kind) {
      case "text":
        return context.text;
      case "files":
        return context.files.map((file) => `===== FILE: ${file.path} =====\n${file.text}`).join("\n\n");
      case "csv":
        return renderCsvContext(context);
      case "json":
        return JSON.stringify(context.value, null, 2) ?? "null";
      case "parquet":
        return renderParquetContext(context);
    }
  }

  asReplContext(context = this.context): ReplContext {
    switch (context.kind) {
      case "text":
        return { kind: "text", text: context.text };
      case "files":
        return { kind: "files", root: context.root, files: context.files };
      case "csv":
        return { kind: "csv", text: context.text, columns: context.columns, rows: context.rows };
      case "json":
        return { kind: "json", value: context.value };
      case "parquet":
        return { kind: "parquet", path: context.path, columns: context.columns, rows: context.rows };
    }
  }
}

type ProgressFn = (line: string) => void;

export async function runRlmEngine(input: EngineInput, signal?: AbortSignal, progress?: ProgressFn): Promise<RlmRunResult> {
  const startedAt = Date.now();
  const artifacts = await createArtifacts(input.runId);
  const log = createEventLogger(artifacts.eventsPath);
  const state: EngineState = { nodeCounter: 0, nodesVisited: 0, maxDepthSeen: 0 };
  const context = await resolveContext(input);
  const visualizerSession = input.backend === "tmux" ? await startTmuxVisualizer(input.runId, artifacts.eventsPath, artifacts.treePath, artifacts.outputPath) : undefined;

  log("run_start", { runId: input.runId, task: input.task, contextKind: context.kind, input, visualizerSession });
  progress?.(`RLM run ${input.runId} started; kind=${context.kind}; size=${summarizeContextSize(context)}`);
  if (visualizerSession) progress?.(`tmux visualizer: ${visualizerSession}`);

  try {
    const root = await runNode({ task: input.task, depth: 0, lineage: [], parentId: undefined, context });
    if (visualizerSession) root.visualizerSession = visualizerSession;
    const finalOutput = root.result ?? "(no final output)";
    await fs.writeFile(artifacts.treePath, JSON.stringify(root, null, 2), "utf8");
    await fs.writeFile(artifacts.outputPath, finalOutput, "utf8");
    const durationMs = Date.now() - startedAt;
    const result: RlmRunResult = {
      runId: input.runId,
      backend: input.backend,
      final: finalOutput,
      root,
      artifacts,
      visualizerSession,
      stats: { nodesVisited: state.nodesVisited, maxDepthSeen: state.maxDepthSeen, durationMs },
    };
    log("run_end", { runId: input.runId, durationMs, nodesVisited: state.nodesVisited, maxDepthSeen: state.maxDepthSeen });
    return result;
  } finally {
    await log.flush();
  }

  async function runNode(params: { task: string; depth: number; lineage: string[]; parentId?: string; context: ResolvedContext }): Promise<RlmNode> {
    const nodeId = `n${++state.nodeCounter}`;
    state.nodesVisited += 1;
    state.maxDepthSeen = Math.max(state.maxDepthSeen, params.depth);
    const env = new NodeEnvironment(params.context, input.maxChunkChars, input.grepLimit);
    let webRSession: WebRSession | undefined;
    const node: RlmNode = {
      id: nodeId,
      depth: params.depth,
      task: params.task,
      contextKind: params.context.kind,
      contextChars: env.contextSize(),
      status: "running",
      startedAt: Date.now(),
      observations: [],
      children: [],
    };
    if (params.depth === 0 && visualizerSession) node.visualizerSession = visualizerSession;
    log("node_start", { nodeId, parentId: params.parentId ?? null, depth: params.depth, task: params.task, env: env.describe() });
    progress?.(`[${nodeId}] depth=${params.depth} kind=${params.context.kind} ${shortText(params.task, 80)}`);

    try {
      if (signal?.aborted) throw new Error("RLM run cancelled");
      const forcedSolveReason = getForcedSolveReason(params, input, state, env);
      if (forcedSolveReason) {
        node.decision = { action: "solve", reason: forcedSolveReason };
        node.result = await solveNode(node, env.renderContextForModel());
        node.status = "completed";
        node.finishedAt = Date.now();
        log("node_end", { nodeId, action: "solve", reason: forcedSolveReason, chars: node.result.length });
        return node;
      }

      for (let iteration = 1; iteration <= input.maxIterations; iteration++) {
        const action = await planNode(node, env, iteration);
        node.decision = { action: action.action, reason: action.reason };
        log("node_action", { nodeId, iteration, action });

        if (action.action === "final") {
          node.result = action.answer || "";
          node.status = "completed";
          node.finishedAt = Date.now();
          return node;
        }

        if (action.action === "solve") {
          node.result = await solveNode(node, env.renderContextForModel());
          node.status = "completed";
          node.finishedAt = Date.now();
          return node;
        }

        if (action.action === "peek") {
          const start = action.start ?? 0;
          const end = action.end ?? Math.min(env.manifestText().length, start + 4000);
          const peeked = env.peek(start, end);
          addObservation(node, "peek", `peek(${start},${end}) =>\n${shortText(peeked, 6000)}`);
          continue;
        }

        if (action.action === "grep") {
          const pattern = action.pattern ?? "";
          const matches = env.grep(pattern);
          addObservation(node, "grep", `grep(${pattern}) =>\n${matches.join("\n") || "(no matches)"}`);
          continue;
        }

        if (action.action === "sample_chunks") {
          const chunks = env.sampleChunks(action.chunkSize);
          const preview = chunks.map((chunk, index) => `chunk_sample_${index + 1}:\n${shortText(env.renderContextForModel(chunk), 2000)}`).join("\n\n");
          addObservation(node, "note", `sample_chunks(${action.chunkSize ?? input.maxChunkChars}) =>\n${preview || "(no chunks)"}`);
          continue;
        }

        if (action.action === "r_eval") {
          if (params.context.kind !== "text" && params.context.kind !== "csv" && params.context.kind !== "parquet") {
            addObservation(node, "note", "r_eval is only available for text/csv/parquet context; use repl_eval for files/json context");
            continue;
          }
          const code = action.code?.trim();
          if (!code) {
            addObservation(node, "note", "r_eval requested without code");
            continue;
          }
          const rContext =
            params.context.kind === "parquet"
              ? { kind: "parquet" as const, path: params.context.path, columns: params.context.columns, rows: params.context.rows }
              : params.context.kind === "csv"
                ? { kind: "csv" as const, text: params.context.text, columns: params.context.columns, rows: params.context.rows }
                : { kind: "text" as const, text: params.context.text };
          webRSession ??= await createWebRSession(rContext, {
            scopeId: `${input.runId}-${nodeId}`,
            artifactDir: artifacts.dir,
            callRlm: async (task, subcontext, contextKind) => {
              const child = await runNode({
                task,
                depth: params.depth + 1,
                lineage: [...params.lineage, normalizeTask(params.task)],
                parentId: nodeId,
                context: coerceRequestedSubcontext(subcontext, contextKind, params.context),
              });
              node.children.push(child);
              return {
                result: child.result,
                error: child.error,
                contextKind: child.contextKind,
                strategy: child.decision?.action,
              };
            },
          });
          const evalResult = await webRSession.eval(code);
          addObservation(node, "note", `r_eval =>\n${shortText(evalResult.output, 6000)}`);
          if (evalResult.signaledFinal) {
            node.decision = {
              action: "final",
              reason: evalResult.recursiveCalls > 0 ? `FINAL(...) returned from r_eval after ${evalResult.recursiveCalls} webR child call(s)` : "FINAL(...) returned from r_eval",
            };
            node.result = evalResult.output.trim();
            node.status = "completed";
            node.finishedAt = Date.now();
            return node;
          }
          continue;
        }

        if (action.action === "repl_eval") {
          const code = action.code?.trim();
          if (!code) {
            addObservation(node, "note", "repl_eval requested without code");
            continue;
          }
          const output = await evalInRepl(code, env.asReplContext(), {
            callRlm: async (task, subcontext) => {
              const child = await runNode({
                task,
                depth: params.depth + 1,
                lineage: [...params.lineage, normalizeTask(params.task)],
                parentId: nodeId,
                context: coerceSubcontext(subcontext, params.context),
              });
              node.children.push(child);
              return {
                result: child.result,
                error: child.error,
                contextKind: child.contextKind,
                strategy: child.decision?.action,
              };
            },
          });
          addObservation(node, "note", `repl_eval =>\n${shortText(output, 6000)}`);
          continue;
        }

        if (action.action === "decompose") {
          const subtasks = (action.subtasks ?? []).filter(Boolean).slice(0, input.maxBranching);
          if (subtasks.length >= 2) {
            const childResults = await mapConcurrent(subtasks, input.concurrency, (subtask) =>
              runNode({
                task: subtask,
                depth: params.depth + 1,
                lineage: [...params.lineage, normalizeTask(params.task)],
                parentId: nodeId,
                context: params.context,
              }),
            );
            node.children.push(...childResults);
            node.result = await synthesizeNode(node, childResults.map((c) => c.result || c.error || ""));
            node.status = "completed";
            node.finishedAt = Date.now();
            return node;
          }
          addObservation(node, "note", "decompose requested but returned fewer than two valid subtasks");
          continue;
        }

        if (action.action === "map_chunks") {
          const chunks = env.chunk(action.chunkSize).slice(0, input.maxBranching);
          if (chunks.length >= 2) {
            const childTask = action.subtaskPrompt || params.task;
            const childResults = await mapConcurrent(chunks, input.concurrency, (chunk, index) =>
              runNode({
                task: `${childTask}\n\nChunk ${index + 1}/${chunks.length}: focus only on this chunk and report relevant findings for the original task.`,
                depth: params.depth + 1,
                lineage: [...params.lineage, normalizeTask(params.task)],
                parentId: nodeId,
                context: chunk,
              }),
            );
            node.children.push(...childResults);
            node.result = await synthesizeNode(node, childResults.map((c) => c.result || c.error || ""));
            node.status = "completed";
            node.finishedAt = Date.now();
            return node;
          }
          addObservation(node, "note", "map_chunks produced fewer than two chunks; continuing");
          continue;
        }
      }

      node.decision = { action: "solve", reason: "maxIterations reached" };
      node.result = await solveNode(node, env.renderContextForModel());
      node.status = "completed";
      node.finishedAt = Date.now();
      return node;
    } catch (error) {
      node.status = signal?.aborted ? "cancelled" : "failed";
      node.error = error instanceof Error ? error.message : String(error);
      node.finishedAt = Date.now();
      log("node_error", { nodeId, error: node.error });
      return node;
    } finally {
      if (webRSession) await webRSession.close();
    }
  }

  async function planNode(node: RlmNode, env: NodeEnvironment, iteration: number): Promise<RlmAction> {
    const observationSummary = node.observations.map((o) => `- [${o.kind}] ${shortText(o.text, 1200)}`).join("\n");
    const prompt = plannerPrompt({
      task: node.task,
      nodeId: node.id,
      depth: node.depth,
      maxDepth: input.maxDepth,
      mode: input.mode,
      contextKind: node.contextKind,
      contextChars: node.contextChars,
      observationSummary,
      remainingNodeBudget: Math.max(0, input.maxNodes - state.nodesVisited),
      maxBranching: input.maxBranching,
      maxChunkChars: input.maxChunkChars,
      grepLimit: input.grepLimit,
      environmentSummary: env.describe(),
    });
    const result = await completeWithCli({
      model: input.model,
      systemPrompt: prompt,
      prompt: `Iteration ${iteration}. Return JSON only.`,
      cwd: input.cwd,
      piBin: input.piBin,
      signal,
    });
    if (result.exitCode !== 0) throw new Error(result.stderr || `planner exited with code ${result.exitCode}`);
    const jsonText = extractFirstJsonObject(result.text) ?? result.text.trim();
    const parsed = safeJsonParse<RlmAction>(jsonText);
    if (!parsed?.action || !parsed.reason) throw new Error(`Invalid planner JSON: ${result.text}`);
    return parsed;
  }

  async function solveNode(node: RlmNode, text: string): Promise<string> {
    const observations = node.observations.map((o) => `[${o.kind}] ${o.text}`).join("\n\n");
    const result = await completeWithCli({
      model: node.depth === 0 ? input.model : input.subModel,
      systemPrompt: "You are a recursive language model worker. Use only the provided context subset and observations.",
      prompt: solverPrompt({ task: node.task, context: text, observations }),
      cwd: input.cwd,
      piBin: input.piBin,
      signal,
    });
    if (result.exitCode !== 0) throw new Error(result.stderr || `solver exited with code ${result.exitCode}`);
    return result.text.trim();
  }

  async function synthesizeNode(node: RlmNode, childResults: string[]): Promise<string> {
    const result = await completeWithCli({
      model: input.model,
      systemPrompt: "You are synthesizing child RLM results into a final answer.",
      prompt: synthesisPrompt({ task: node.task, childResults }),
      cwd: input.cwd,
      piBin: input.piBin,
      signal,
    });
    if (result.exitCode !== 0) throw new Error(result.stderr || `synthesizer exited with code ${result.exitCode}`);
    return result.text.trim();
  }
}

function addObservation(node: RlmNode, kind: RlmObservation["kind"], text: string): void {
  node.observations.push({ kind, text });
  if (node.observations.length > 12) node.observations = node.observations.slice(-12);
}

function getForcedSolveReason(
  params: { task: string; depth: number; lineage: string[]; context: ResolvedContext },
  input: StartRunInput,
  state: EngineState,
  env: NodeEnvironment,
): string | undefined {
  if (input.mode === "solve") return "mode=solve";
  if (params.depth >= input.maxDepth) return "maxDepth reached";
  if (state.nodesVisited >= input.maxNodes) return "maxNodes reached";
  if (params.lineage.includes(normalizeTask(params.task))) return "cycle detected";
  if (params.context.kind === "text" && env.contextSize() <= Math.min(12000, input.maxChunkChars) && !shouldPreferEvaluation(params.task, params.context.kind)) {
    return "context subset already small";
  }
  return undefined;
}

function shouldPreferEvaluation(task: string, contextKind: RlmContextKind): boolean {
  if (/\b(count|how many|sum|total|average|mean|median|min|max|frequency|frequencies|distribution|lines mention|rows mention|group by|tabulate)\b/i.test(task)) {
    return true;
  }
  if (contextKind === "files" && /\b(codebase|repository|repo|file|files|module|import|function|class|symbol|definition|defined|usage|call sites?)\b/i.test(task)) {
    return true;
  }
  if ((contextKind === "csv" || contextKind === "json" || contextKind === "parquet") && /\b(row|rows|column|columns|field|fields|json|csv|parquet|array|object|key|keys)\b/i.test(task)) {
    return true;
  }
  return false;
}

async function resolveContext(input: StartRunInput): Promise<ResolvedContext> {
  const inferredKind = input.contextKind ?? (input.contextPath ? await inferContextKind(input.contextPath, input.cwd) : "text");
  if (inferredKind === "files") {
    const root = input.contextPath ? resolve(input.cwd, input.contextPath) : input.cwd;
    const files = await loadFileContext(root);
    return { kind: "files", label: root, root, files };
  }
  if (inferredKind === "csv") {
    const text = input.context !== undefined ? input.context : input.contextPath ? await fs.readFile(resolve(input.cwd, input.contextPath), "utf8") : "";
    return parseCsvContext(text, input.contextPath ?? "inline-csv");
  }
  if (inferredKind === "json") {
    const text = input.context !== undefined ? input.context : input.contextPath ? await fs.readFile(resolve(input.cwd, input.contextPath), "utf8") : "null";
    return parseJsonContext(text, input.contextPath ?? "inline-json");
  }
  if (inferredKind === "parquet") {
    if (!input.contextPath) throw new Error("contextKind=parquet requires contextPath");
    return loadParquetContext(resolve(input.cwd, input.contextPath), input.contextPath);
  }
  if (input.context !== undefined) return { kind: "text", label: "inline", text: input.context };
  if (input.contextPath) return { kind: "text", label: input.contextPath, text: await fs.readFile(resolve(input.cwd, input.contextPath), "utf8") };
  return { kind: "text", label: "empty", text: "" };
}

async function inferContextKind(contextPath: string, cwd: string): Promise<RlmContextKind> {
  const fullPath = resolve(cwd, contextPath);
  const stat = await fs.stat(fullPath);
  if (stat.isDirectory()) return "files";
  if (/\.csv$/i.test(fullPath)) return "csv";
  if (/\.json$/i.test(fullPath)) return "json";
  if (/\.parquet$/i.test(fullPath)) return "parquet";
  return "text";
}

async function loadFileContext(root: string): Promise<FileEntry[]> {
  const files: FileEntry[] = [];
  let totalBytes = 0;

  async function walk(dir: string): Promise<void> {
    if (files.length >= MAX_FILE_CONTEXT_FILES || totalBytes >= MAX_FILE_CONTEXT_BYTES) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= MAX_FILE_CONTEXT_FILES || totalBytes >= MAX_FILE_CONTEXT_BYTES) return;
      const fullPath = join(dir, entry.name);
      const relPath = relative(root, fullPath) || entry.name;
      if (entry.isDirectory()) {
        if (DEFAULT_IGNORED_DIRS.has(entry.name)) continue;
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const text = await fs.readFile(fullPath, "utf8");
        files.push({ path: relPath, text });
        totalBytes += text.length;
      } catch {
        // ignore non-text or unreadable files
      }
    }
  }

  await walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function parseCsvContext(text: string, label: string): ResolvedContext {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return { kind: "csv", label, text, columns: [], rows: [] };
  const columns = splitCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row: CsvRow = {};
    for (let i = 0; i < columns.length; i++) row[columns[i]] = values[i] ?? "";
    return row;
  });
  return { kind: "csv", label, text, columns, rows };
}

function parseJsonContext(text: string, label: string): ResolvedContext {
  try {
    return { kind: "json", label, value: JSON.parse(text) };
  } catch {
    return { kind: "json", label, value: text };
  }
}

async function loadParquetContext(fullPath: string, label: string): Promise<ResolvedContext> {
  const file = await asyncBufferFromFile(fullPath);
  const rows = await parquetReadObjects({ file });
  const columns = inferColumns(rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v ?? "")]))));
  return { kind: "parquet", label, path: fullPath, columns, rows };
}

function coerceRequestedSubcontext(value: unknown, requestedKind: string | undefined, parent: ResolvedContext): ResolvedContext {
  if (!requestedKind) return coerceSubcontext(value, parent);
  if (requestedKind === "text") return { kind: "text", label: `${parent.label}#r-text`, text: typeof value === "string" ? value : String(value ?? "") };
  if (requestedKind === "json") return { kind: "json", label: `${parent.label}#r-json`, value };
  if (requestedKind === "csv") {
    if (Array.isArray(value)) {
      const rows = value.filter(isRecord).map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v ?? "")]))) as CsvRow[];
      const columns = inferColumns(rows);
      return { kind: "csv", label: `${parent.label}#r-csv`, columns, rows, text: renderCsv(columns, rows) };
    }
    if (isRecord(value) && Array.isArray(value.rows)) {
      return coerceSubcontext({ kind: "csv", rows: value.rows, columns: Array.isArray(value.columns) ? value.columns : undefined }, parent);
    }
  }
  return coerceSubcontext(value, parent);
}

function coerceSubcontext(value: unknown, parent: ResolvedContext): ResolvedContext {
  if (value === undefined) return parent;
  if (typeof value === "string") return { kind: "text", label: `${parent.label}#repl`, text: value };
  if (isRecord(value) && typeof value.kind === "string") {
    if (value.kind === "text" && typeof value.text === "string") return { kind: "text", label: `${parent.label}#repl-text`, text: value.text };
    if (value.kind === "json" && "value" in value) return { kind: "json", label: `${parent.label}#repl-json`, value: value.value };
    if (value.kind === "csv" && Array.isArray(value.rows)) {
      const rows = value.rows.filter(isRecord).map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v ?? "")]))) as CsvRow[];
      const columns = Array.isArray(value.columns) ? value.columns.map(String) : inferColumns(rows);
      return { kind: "csv", label: `${parent.label}#repl-csv`, columns, rows, text: renderCsv(columns, rows) };
    }
    if (value.kind === "files" && Array.isArray(value.files)) {
      const files = value.files
        .filter((file): file is Record<string, unknown> => isRecord(file) && typeof file.path === "string" && typeof file.text === "string")
        .map((file) => ({ path: String(file.path), text: String(file.text) }));
      return { kind: "files", label: `${parent.label}#repl-files`, root: typeof value.root === "string" ? value.root : parent.kind === "files" ? parent.root : parent.label, files };
    }
    if (value.kind === "parquet" && Array.isArray(value.rows)) {
      const rows = value.rows.filter(isRecord);
      const columns = Array.isArray(value.columns) ? value.columns.map(String) : inferColumns(rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v ?? "")]))));
      return { kind: "parquet", label: `${parent.label}#repl-parquet`, path: typeof value.path === "string" ? value.path : parent.label, columns, rows };
    }
  }
  return { kind: "json", label: `${parent.label}#repl-json`, value };
}

function renderCsvContext(context: { columns: string[]; rows: CsvRow[]; text: string }): string {
  return context.text || renderCsv(context.columns, context.rows);
}

function renderParquetContext(context: { columns: string[]; rows: Array<Record<string, unknown>>; path: string }): string {
  const preview = context.rows.slice(0, 50).map((row) => JSON.stringify(row)).join("\n");
  return [`# parquet_path=${context.path}`, `# columns=${context.columns.join(",")}`, preview].filter(Boolean).join("\n");
}

function renderCsv(columns: string[], rows: CsvRow[]): string {
  if (columns.length === 0) return "";
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvEscape(row[column] ?? "")).join(","));
  return lines.join("\n");
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells;
}

function csvEscape(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function inferColumns(rows: CsvRow[]): string[] {
  const set = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) set.add(key);
  return Array.from(set);
}

function grepFiles(files: FileEntry[], pattern: string, limit: number): string[] {
  const regex = safeRegex(pattern);
  const matches: string[] = [];
  for (const file of files) {
    if (matches.length >= limit) break;
    if (regex.test(file.path)) matches.push(`${file.path}:<path>`);
    const lines = file.text.split(/\r?\n/);
    for (let i = 0; i < lines.length && matches.length < limit; i++) {
      if (regex.test(lines[i])) matches.push(`${file.path}:${i + 1}: ${lines[i]}`);
    }
  }
  return matches;
}

function safeRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
}

function chunkFileEntries(files: FileEntry[], maxChars: number): FileEntry[][] {
  const groups: FileEntry[][] = [];
  let current: FileEntry[] = [];
  let currentChars = 0;
  for (const file of files) {
    const cost = file.text.length + file.path.length + 64;
    if (current.length > 0 && currentChars + cost > maxChars) {
      groups.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(file);
    currentChars += cost;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function chunkCsvRows(rows: CsvRow[], maxChars: number): CsvRow[][] {
  const groups: CsvRow[][] = [];
  let current: CsvRow[] = [];
  let currentChars = 0;
  for (const row of rows) {
    const cost = JSON.stringify(row)?.length ?? 32;
    if (current.length > 0 && currentChars + cost > maxChars) {
      groups.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(row);
    currentChars += cost;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function chunkGenericRows<T extends Record<string, unknown>>(rows: T[], maxChars: number): T[][] {
  const groups: T[][] = [];
  let current: T[] = [];
  let currentChars = 0;
  for (const row of rows) {
    const cost = JSON.stringify(row)?.length ?? 32;
    if (current.length > 0 && currentChars + cost > maxChars) {
      groups.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(row);
    currentChars += cost;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function chunkJsonContext(context: { kind: "json"; label: string; value: unknown }, maxChars: number): ResolvedContext[] {
  if (Array.isArray(context.value)) {
    const groups: unknown[][] = [];
    let current: unknown[] = [];
    let currentChars = 0;
    for (const item of context.value) {
      const cost = JSON.stringify(item)?.length ?? 32;
      if (current.length > 0 && currentChars + cost > maxChars) {
        groups.push(current);
        current = [];
        currentChars = 0;
      }
      current.push(item);
      currentChars += cost;
    }
    if (current.length > 0) groups.push(current);
    return groups.map((value, index) => ({ kind: "json", label: `${context.label}#chunk${index + 1}`, value }));
  }
  if (isRecord(context.value)) {
    const entries = Object.entries(context.value);
    const groups: Array<Record<string, unknown>> = [];
    let current: Record<string, unknown> = {};
    let currentChars = 0;
    for (const [key, value] of entries) {
      const cost = key.length + (JSON.stringify(value)?.length ?? 32);
      if (Object.keys(current).length > 0 && currentChars + cost > maxChars) {
        groups.push(current);
        current = {};
        currentChars = 0;
      }
      current[key] = value;
      currentChars += cost;
    }
    if (Object.keys(current).length > 0) groups.push(current);
    return groups.map((value, index) => ({ kind: "json", label: `${context.label}#chunk${index + 1}`, value }));
  }
  return [{ kind: "json", label: `${context.label}#chunk1`, value: context.value }];
}

function summarizeContextSize(context: ResolvedContext): string {
  switch (context.kind) {
    case "text":
      return `${context.text.length} chars`;
    case "files":
      return `${context.files.length} files / ${context.files.reduce((sum, file) => sum + file.text.length, 0)} chars`;
    case "csv":
      return `${context.rows.length} rows / ${context.columns.length} columns`;
    case "json":
      return `${JSON.stringify(context.value)?.length ?? 0} chars json`;
    case "parquet":
      return `${context.rows.length} rows / ${context.columns.length} columns parquet`;
  }
}

async function createArtifacts(runId: string): Promise<RunArtifacts> {
  const dir = join(tmpdir(), "pi-rlm-runs", runId);
  await fs.mkdir(dir, { recursive: true });
  return {
    dir,
    eventsPath: join(dir, "events.jsonl"),
    treePath: join(dir, "tree.json"),
    outputPath: join(dir, "output.md"),
  };
}

function createEventLogger(eventsPath: string) {
  const writes: Promise<void>[] = [];
  const log = (type: string, details: Record<string, unknown>) => {
    const line = JSON.stringify({ ts: Date.now(), type, ...details }) + "\n";
    writes.push(fs.appendFile(eventsPath, line, "utf8"));
  };
  log.flush = async () => {
    await Promise.allSettled(writes);
  };
  return log as ((type: string, details: Record<string, unknown>) => void) & { flush: () => Promise<void> };
}

async function mapConcurrent<TIn, TOut>(items: TIn[], concurrency: number, fn: (item: TIn, index: number) => Promise<TOut>): Promise<TOut[]> {
  if (items.length === 0) return [];
  const results: TOut[] = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.max(1, Math.min(concurrency, items.length))).fill(null).map(async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
