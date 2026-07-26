import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { RunRecord, RlmRunResult, RunStatus, StartRunInput } from "./types.js";

interface PendingRun {
  record: RunRecord;
  controller: AbortController;
  executor: (runId: string, signal: AbortSignal) => Promise<RlmRunResult>;
  resolve: (result: RlmRunResult) => void;
  reject: (error: Error) => void;
  detachParent: () => void;
}

interface PersistedRun {
  version: 1;
  id: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  status: RunStatus;
  input: StartRunInput;
  error?: string;
  result?: Pick<RlmRunResult, "backend" | "visualizerSession" | "stats">;
}

const DEFAULT_RUNS_ROOT = path.join(os.tmpdir(), "pi-rlm-runs");
const MAX_RUN_HISTORY = 50;
const MAX_PENDING_RUNS = 4;

export class RunStore {
  private readonly runs = new Map<string, RunRecord>();
  private readonly queue: PendingRun[] = [];
  private active = 0;

  constructor(
    private readonly maxActiveRuns = 1,
    private readonly runsRoot = DEFAULT_RUNS_ROOT,
  ) {
    fs.mkdirSync(this.runsRoot, { recursive: true });
    this.hydrate();
  }

  start(
    input: StartRunInput,
    executor: (runId: string, signal: AbortSignal) => Promise<RlmRunResult>,
    parentSignal?: AbortSignal,
  ): RunRecord {
    if (this.active + this.queue.length >= MAX_PENDING_RUNS) {
      throw new Error(`RLM already has ${MAX_PENDING_RUNS} active or queued runs; wait for or cancel an existing run`);
    }
    const controller = new AbortController();
    const id = createRunId();
    let resolvePromise!: (result: RlmRunResult) => void;
    let rejectPromise!: (error: Error) => void;
    const promise = new Promise<RlmRunResult>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    // Background runs may fail before anyone waits on them. Keep the rejection
    // observable through record.promise without creating an unhandled rejection.
    void promise.catch(() => undefined);

    let detachParent = (): void => {};
    if (parentSignal) {
      const cancel = () => controller.abort();
      if (parentSignal.aborted) cancel();
      else {
        parentSignal.addEventListener("abort", cancel, { once: true });
        detachParent = () => parentSignal.removeEventListener("abort", cancel);
      }
    }

    const record: RunRecord = {
      id,
      createdAt: Date.now(),
      status: "queued",
      artifactsDir: path.join(this.runsRoot, id),
      input,
      promise,
      cancel: () => this.cancelRecord(id),
    };
    const pending: PendingRun = {
      record,
      controller,
      executor,
      resolve: resolvePromise,
      reject: rejectPromise,
      detachParent,
    };

    try {
      this.persist(record, true);
    } catch (error) {
      detachParent();
      throw error;
    }
    this.runs.set(id, record);
    this.queue.push(pending);
    this.dispatch();
    return record;
  }

  get(id: string): RunRecord | undefined {
    return this.runs.get(id);
  }

  list(): RunRecord[] {
    return Array.from(this.runs.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  cancel(id: string): RunRecord {
    const record = this.mustGet(id);
    record.cancel();
    return record;
  }

  async shutdown(timeoutMs = 6000): Promise<void> {
    const pending = Array.from(this.runs.values()).filter((record) => record.status === "queued" || record.status === "running");
    for (const record of pending) record.cancel();
    await Promise.race([
      Promise.allSettled(pending.map((record) => record.promise)),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        timer.unref();
      }),
    ]);
  }

  async wait(id: string, timeoutMs: number): Promise<{ record: RunRecord; done: boolean }> {
    const record = this.mustGet(id);
    if (record.status !== "queued" && record.status !== "running") return { record, done: true };
    const timed = await Promise.race([
      record.promise.then(() => true).catch(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]);
    return { record, done: timed };
  }

  private dispatch(): void {
    while (this.active < this.maxActiveRuns && this.queue.length > 0) {
      const pending = this.queue.shift()!;
      if (pending.controller.signal.aborted || pending.record.status === "cancelled") {
        this.finishQueuedCancellation(pending);
        continue;
      }
      this.launch(pending);
    }
  }

  private launch(pending: PendingRun): void {
    const { record } = pending;
    this.active++;
    this.runningControllers.set(record.id, pending.controller);
    record.status = "running";
    record.startedAt = Date.now();
    this.persist(record);

    void pending.executor(record.id, pending.controller.signal)
      .then((result) => {
        record.result = result;
        record.input = redactInlineContext(record.input);
        if (record.status !== "cancelled") record.status = "completed";
        record.finishedAt = Date.now();
        this.persist(record);
        pending.resolve(result);
      })
      .catch((error: unknown) => {
        const normalized = error instanceof Error ? error : new Error(String(error));
        record.input = redactInlineContext(record.input);
        record.error = normalized.message;
        if (record.status !== "cancelled") record.status = pending.controller.signal.aborted ? "cancelled" : "failed";
        record.finishedAt = Date.now();
        this.persist(record);
        pending.reject(normalized);
      })
      .finally(() => {
        pending.detachParent();
        this.runningControllers.delete(record.id);
        this.active--;
        this.pruneHistory();
        this.dispatch();
      });
  }

  private cancelRecord(id: string): void {
    const record = this.mustGet(id);
    if (record.status !== "queued" && record.status !== "running") return;
    record.status = "cancelled";
    record.finishedAt = Date.now();
    record.input = redactInlineContext(record.input);
    const pendingIndex = this.queue.findIndex((item) => item.record.id === id);
    if (pendingIndex >= 0) {
      const [pending] = this.queue.splice(pendingIndex, 1);
      pending.controller.abort();
      pending.detachParent();
      this.persist(record);
      pending.reject(new Error("RLM run cancelled while queued"));
      this.dispatch();
      return;
    }
    const pending = this.findRunningController(id);
    pending?.abort();
    this.persist(record);
  }

  private findRunningController(id: string): AbortController | undefined {
    return this.runningControllers.get(id);
  }

  private readonly runningControllers = new Map<string, AbortController>();

  private finishQueuedCancellation(pending: PendingRun): void {
    pending.record.status = "cancelled";
    pending.record.finishedAt ??= Date.now();
    pending.detachParent();
    this.persist(pending.record);
    pending.reject(new Error("RLM run cancelled while queued"));
  }

  private pruneHistory(): void {
    const terminal = Array.from(this.runs.values())
      .filter((record) => record.status !== "queued" && record.status !== "running")
      .sort((a, b) => b.createdAt - a.createdAt);
    for (const record of terminal.slice(MAX_RUN_HISTORY)) this.runs.delete(record.id);
  }

  private mustGet(id: string): RunRecord {
    const record = this.runs.get(id);
    if (!record) throw new Error(`Unknown run id: ${id}`);
    return record;
  }

  private persist(record: RunRecord, required = false): void {
    const dir = path.join(this.runsRoot, record.id);
    fs.mkdirSync(dir, { recursive: true });
    const metadata: PersistedRun = {
      version: 1,
      id: record.id,
      createdAt: record.createdAt,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      status: record.status,
      input: redactInlineContext(record.input),
      error: record.error,
      result: record.result
        ? {
            backend: record.result.backend,
            visualizerSession: record.result.visualizerSession,
            stats: record.result.stats,
          }
        : undefined,
    };
    const target = path.join(dir, "run.json");
    const temporary = `${target}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(metadata, null, 2), "utf8");
      fs.renameSync(temporary, target);
    } catch (error) {
      try {
        fs.rmSync(temporary, { force: true });
      } catch {
        // Preserve the original persistence error.
      }
      const message = `RLM run metadata persistence failed: ${error instanceof Error ? error.message : String(error)}`;
      if (required) throw new Error(message);
      record.error = record.error ? `${record.error}; ${message}` : message;
    }
  }

  private hydrate(): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.runsRoot, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(this.runsRoot, entry.name);
      try {
        const metadata = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8")) as PersistedRun;
        if (metadata.version !== 1 || !metadata.id || !metadata.input) continue;
        const status: RunStatus = metadata.status === "running" || metadata.status === "queued" ? "interrupted" : metadata.status;
        const result = loadPersistedResult(metadata, dir);
        const record: RunRecord = {
          id: metadata.id,
          createdAt: metadata.createdAt,
          startedAt: metadata.startedAt,
          finishedAt: metadata.finishedAt ?? (status === "interrupted" ? Date.now() : undefined),
          status,
          artifactsDir: dir,
          input: metadata.input,
          result,
          error: status === "interrupted" ? metadata.error ?? "RLM host exited before the run finished" : metadata.error,
          promise: result ? Promise.resolve(result) : Promise.resolve(undefined as never),
          cancel: () => {},
        };
        this.runs.set(record.id, record);
        if (status !== metadata.status) this.persist(record);
      } catch {
        // Ignore incomplete artifacts from runs that died before metadata creation.
      }
    }
    this.pruneHistory();
  }
}

function redactInlineContext(input: StartRunInput): StartRunInput {
  if (input.context === undefined) return input;
  return { ...input, context: undefined };
}

function loadPersistedResult(metadata: PersistedRun, dir: string): RlmRunResult | undefined {
  if (metadata.status !== "completed" || !metadata.result) return undefined;
  try {
    const root = JSON.parse(fs.readFileSync(path.join(dir, "tree.json"), "utf8"));
    const final = fs.readFileSync(path.join(dir, "output.md"), "utf8");
    return {
      runId: metadata.id,
      backend: metadata.result.backend,
      final,
      root,
      artifacts: {
        dir,
        eventsPath: path.join(dir, "events.jsonl"),
        treePath: path.join(dir, "tree.json"),
        outputPath: path.join(dir, "output.md"),
      },
      visualizerSession: metadata.result.visualizerSession,
      stats: metadata.result.stats,
    };
  } catch {
    return undefined;
  }
}

function createRunId(): string {
  return Math.random().toString(36).slice(2, 10);
}
