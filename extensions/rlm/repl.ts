import { Worker } from "node:worker_threads";

export interface ReplFileEntry {
  path: string;
  size: number;
  text?: string;
  omittedReason?: "binary" | "too_large" | "content_budget" | "unreadable";
}

export type ReplContext =
  | { kind: "text"; text: string }
  | { kind: "files"; root: string; files: ReplFileEntry[] }
  | { kind: "csv"; text: string; columns: string[]; rows: Array<Record<string, string>> }
  | { kind: "json"; value: unknown }
  | { kind: "parquet"; path: string; columns: string[]; rows: Array<Record<string, unknown>> };

export interface ReplEvalOptions {
  callRlm?: (task: string, subcontext?: unknown) => Promise<unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

// The watchdog lives outside the worker: code after an await (and even a
// pathological result serializer/regex) cannot starve Pi's cancellation loop.
export async function evalInRepl(code: string, context: ReplContext, options: ReplEvalOptions = {}): Promise<string> {
  if (options.signal?.aborted) return "repl error: REPL evaluation aborted";
  const worker = new Worker(new URL("./repl-worker.mjs", import.meta.url), {
    workerData: { code, context, rLoadCode: rLoadCodeForContext(context) },
    resourceLimits: { maxOldGenerationSizeMb: 128 },
    stdout: true,
    stderr: true,
  });
  worker.stdout.resume();
  worker.stderr.resume();
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  let finished = false;
  try {
    return await new Promise<string>((resolve) => {
      const finish = (result: string) => {
        if (finished) return;
        finished = true;
        resolve(result);
      };
      onAbort = () => finish("repl error: REPL evaluation aborted");
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.signal?.aborted) onAbort();
      const timeoutMs = options.timeoutMs ?? 30_000;
      timer = setTimeout(() => finish(`repl error: REPL evaluation exceeded ${timeoutMs}ms`), timeoutMs);
      worker.on("error", (error) => finish(`repl error: ${error.message}`));
      worker.on("exit", (code) => finish(`repl error: worker exited before returning a result (${code})`));
      worker.on("message", (message) => {
        if (finished) return;
        if (message.type === "result") {
          finish(message.result);
          return;
        }
        if (message.type === "callRlm") {
          void Promise.resolve().then(() => {
            if (!options.callRlm) throw new Error("callRlm is not available in this REPL");
            return options.callRlm(message.task, message.context);
          }).then(
            (result) => { if (!finished) worker.postMessage({ id: message.id, result }); },
            (error) => { if (!finished) worker.postMessage({ id: message.id, error: String(error) }); },
          ).catch((error) => finish(`repl error: ${String(error)}`));
        }
      });
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) options.signal?.removeEventListener("abort", onAbort);
    await worker.terminate();
  }
}

export function rLoadCodeForContext(context: ReplContext): string {
  switch (context.kind) {
    case "text":
      return [
        '# text already loaded as context_text',
        'lines <- strsplit(context_text, "\\n", fixed = TRUE)[[1]]',
        'data.frame(line = seq_along(lines), text = lines)',
      ].join("\n");
    case "csv":
      return [
        '# csv already available in-memory at context$text',
        'df <- utils::read.csv(text = context$text, stringsAsFactors = FALSE)',
        'df',
      ].join("\n");
    case "json":
      return [
        '# requires jsonlite in R if available',
        'if (!requireNamespace("jsonlite", quietly = TRUE)) stop("Install jsonlite to load JSON in R")',
        `jsonlite::fromJSON(${JSON.stringify(JSON.stringify(context.value))})`,
      ].join("\n");
    case "parquet":
      return [
        '# parquet file path is available at context$path',
        'if (requireNamespace("arrow", quietly = TRUE)) {',
        '  arrow::read_parquet(context$path)',
        '} else if (requireNamespace("duckdb", quietly = TRUE) && requireNamespace("DBI", quietly = TRUE)) {',
        '  con <- DBI::dbConnect(duckdb::duckdb(), dbdir = ":memory:")',
        '  on.exit(DBI::dbDisconnect(con, shutdown = TRUE), add = TRUE)',
        '  DBI::dbGetQuery(con, paste0("SELECT * FROM read_parquet(", shQuote(context$path), ")"))',
        '} else {',
        '  stop("Install arrow or duckdb+DBI to load parquet in R")',
        '}',
      ].join("\n");
    case "files":
      return [
        '# files are usually easier to inspect via JS REPL helpers',
        '# if you need R, serialize selected files to text first',
        'stop("Prefer repl_eval for files context")',
      ].join("\n");
  }
}
