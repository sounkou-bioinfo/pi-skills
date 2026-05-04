import type { RunRecord, RlmRunResult, StartRunInput } from "./types.js";

export class RunStore {
  private runs = new Map<string, RunRecord>();

  start(
    input: StartRunInput,
    executor: (runId: string, signal: AbortSignal) => Promise<RlmRunResult>,
    parentSignal?: AbortSignal,
  ): RunRecord {
    const controller = new AbortController();
    const id = createRunId();
    if (parentSignal) {
      const cancel = () => controller.abort();
      if (parentSignal.aborted) cancel();
      else parentSignal.addEventListener("abort", cancel, { once: true });
    }
    const record: RunRecord = {
      id,
      createdAt: Date.now(),
      startedAt: Date.now(),
      status: "running",
      input,
      promise: Promise.resolve(undefined as never),
      cancel: () => {
        controller.abort();
        if (record.status === "running") record.status = "cancelled";
      },
    };

    record.promise = executor(id, controller.signal)
      .then((result) => {
        record.result = result;
        if (record.status !== "cancelled") record.status = "completed";
        record.finishedAt = Date.now();
        return result;
      })
      .catch((error: Error) => {
        record.error = error.message;
        if (record.status !== "cancelled") record.status = "failed";
        record.finishedAt = Date.now();
        throw error;
      });

    this.runs.set(id, record);
    return record;
  }

  get(id: string): RunRecord | undefined {
    return this.runs.get(id);
  }

  list(): RunRecord[] {
    return Array.from(this.runs.values()).sort((a, b) => b.startedAt - a.startedAt);
  }

  cancel(id: string): RunRecord {
    const record = this.mustGet(id);
    record.cancel();
    return record;
  }

  async wait(id: string, timeoutMs: number): Promise<{ record: RunRecord; done: boolean }> {
    const record = this.mustGet(id);
    if (record.status !== "running") return { record, done: true };
    const timed = await Promise.race([
      record.promise.then(() => true).catch(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]);
    return { record, done: timed };
  }

  private mustGet(id: string): RunRecord {
    const record = this.runs.get(id);
    if (!record) throw new Error(`Unknown run id: ${id}`);
    return record;
  }
}

function createRunId(): string {
  return Math.random().toString(36).slice(2, 10);
}
