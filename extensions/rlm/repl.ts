import { promises as fs } from "node:fs";
import { resolve, sep } from "node:path";
import { createContext, Script } from "node:vm";
import { chunkText, grepText, shortText } from "./utils.js";

export interface ReplFileEntry {
  path: string;
  size: number;
  text?: string;
  omittedReason?: "binary" | "too_large" | "content_budget" | "unreadable";
}

const MAX_REPL_RESULT_CHARS = 100_000;
const MAX_LAZY_FILE_BYTES = 1_000_000;
const REPL_SYNC_TIMEOUT_MS = 1_000;
const REPL_ASYNC_TIMEOUT_MS = 30_000;

export type ReplContext =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "files";
      root: string;
      files: ReplFileEntry[];
    }
  | {
      kind: "csv";
      text: string;
      columns: string[];
      rows: Array<Record<string, string>>;
    }
  | {
      kind: "json";
      value: unknown;
    }
  | {
      kind: "parquet";
      path: string;
      columns: string[];
      rows: Array<Record<string, unknown>>;
    };

export interface ReplEvalOptions {
  callRlm?: (task: string, subcontext?: unknown) => Promise<unknown>;
  signal?: AbortSignal;
}

export async function evalInRepl(code: string, context: ReplContext, options: ReplEvalOptions = {}): Promise<string> {
  const helpers = createHelpers(context, options);
  for (const helper of Object.values(helpers)) {
    if (typeof helper === "function") Object.setPrototypeOf(helper, null);
  }
  const sandbox = Object.assign(Object.create(null) as Record<string, unknown>, helpers);
  const vmContext = createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });

  try {
    const script = new Script(`(async () => {\n"use strict";\n${code}\n})()`, { filename: "rlm-repl.js" });
    const pending = script.runInContext(vmContext, { timeout: REPL_SYNC_TIMEOUT_MS }) as PromiseLike<unknown>;
    const result = await withTimeout(Promise.resolve(pending), REPL_ASYNC_TIMEOUT_MS, options.signal);
    return formatResult(result);
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    return `repl error: ${message}`;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`REPL evaluation exceeded ${timeoutMs}ms`)), timeoutMs);
    timer.unref();
  });
  const aborted = new Promise<never>((_, reject) => {
    if (!signal) return;
    onAbort = () => reject(new Error("REPL evaluation aborted"));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, timeout, aborted]);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

function createHelpers(context: ReplContext, options: ReplEvalOptions): Record<string, unknown> {
  const base = {
    callRlm: async (task: string, subcontext?: unknown) => {
      if (!options.callRlm) throw new Error("callRlm is not available in this REPL");
      return options.callRlm(task, subcontext);
    },
    rLoadCode: () => rLoadCodeForContext(context),
  };

  if (context.kind === "text") {
    const lines = context.text.split(/\r?\n/);
    return {
      ...base,
      context: {
        kind: "text",
        chars: context.text.length,
        text: context.text,
        lines,
      },
      contextText: context.text,
      contextLines: () => [...lines],
      grepText: (pattern: string, limit = 20) => grepText(context.text, pattern, limit),
      chunkText: (size = 40000) => chunkText(context.text, size),
    };
  }

  if (context.kind === "files") {
    const loadedFiles = context.files.filter((file) => file.text !== undefined);
    return {
      ...base,
      context: {
        kind: "files",
        root: context.root,
        fileCount: context.files.length,
        loadedFileCount: loadedFiles.length,
        loadedChars: loadedFiles.reduce((sum, file) => sum + (file.text?.length ?? 0), 0),
        files: context.files.map((file) => ({
          path: file.path,
          bytes: file.size,
          loaded: file.text !== undefined,
          omittedReason: file.omittedReason,
        })),
      },
      listFiles: (pattern?: string) => filterFilePaths(context.files.map((file) => file.path), pattern),
      fileInfo: (path: string) => {
        const file = getFile(context.files, path);
        return file ? { path: file.path, bytes: file.size, loaded: file.text !== undefined, omittedReason: file.omittedReason } : null;
      },
      readFile: async (path: string) => loadFileText(context.root, getFile(context.files, path)),
      peekFile: async (path: string, start = 0, end = 2000) => {
        const text = (await loadFileText(context.root, getFile(context.files, path))) ?? "";
        const s = Math.max(0, Math.min(start, text.length));
        const e = Math.max(s, Math.min(end, text.length));
        return text.slice(s, e);
      },
      grepFiles: async (pattern: string, limit = 20) => grepFiles(context.root, context.files, pattern, limit),
      chunkFiles: (maxChars = 40000) => chunkFiles(context.files, maxChars),
    };
  }

  if (context.kind === "csv") {
    return {
      ...base,
      context: {
        kind: "csv",
        text: context.text,
        columns: context.columns,
        rowCount: context.rows.length,
        rows: context.rows,
      },
      csvColumns: () => [...context.columns],
      csvRows: () => context.rows.map((row) => ({ ...row })),
      csvColumn: (name: string) => context.rows.map((row) => row[name]),
    };
  }

  if (context.kind === "json") {
    return {
      ...base,
      context: {
        kind: "json",
        value: context.value,
      },
      jsonValue: context.value,
      jsonKeys: () => (isRecord(context.value) ? Object.keys(context.value) : []),
      jsonEntries: () => (isRecord(context.value) ? Object.entries(context.value) : []),
    };
  }

  return {
    ...base,
    context: {
      kind: "parquet",
      path: context.path,
      columns: context.columns,
      rowCount: context.rows.length,
      rows: context.rows,
    },
    parquetPath: context.path,
    parquetColumns: () => [...context.columns],
    parquetRows: () => context.rows.map((row) => ({ ...row })),
  };
}

function formatResult(value: unknown): string {
  let formatted: string;
  if (value === undefined || value === null) formatted = "";
  else if (typeof value === "string") formatted = value;
  else if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") formatted = String(value);
  else {
    try {
      formatted = JSON.stringify(value, null, 2);
    } catch {
      formatted = String(value);
    }
  }
  return shortText(formatted, MAX_REPL_RESULT_CHARS);
}

function getFile(files: ReplFileEntry[], path: string): ReplFileEntry | undefined {
  return files.find((file) => file.path === path);
}

async function loadFileText(root: string, file: ReplFileEntry | undefined): Promise<string | null> {
  if (!file || file.omittedReason === "binary" || file.omittedReason === "unreadable") return null;
  if (file.text !== undefined) return file.text;
  if (file.size > MAX_LAZY_FILE_BYTES) return null;
  const rootPath = resolve(root);
  const fullPath = resolve(rootPath, file.path);
  if (fullPath !== rootPath && !fullPath.startsWith(`${rootPath}${sep}`)) return null;
  try {
    const readablePath = await fs.realpath(fullPath);
    if (readablePath !== rootPath && !readablePath.startsWith(`${rootPath}${sep}`)) return null;
    const stat = await fs.stat(readablePath);
    if (!stat.isFile() || stat.size > MAX_LAZY_FILE_BYTES) return null;
    const data = await fs.readFile(readablePath);
    if (data.length > MAX_LAZY_FILE_BYTES || data.includes(0)) return null;
    return data.toString("utf8");
  } catch {
    return null;
  }
}

function filterFilePaths(paths: string[], pattern?: string): string[] {
  if (!pattern) return paths;
  const regex = safeRegex(pattern);
  return paths.filter((path) => regex.test(path));
}

async function grepFiles(root: string, files: ReplFileEntry[], pattern: string, limit: number): Promise<string[]> {
  const regex = safeRegex(pattern);
  const matches: string[] = [];
  for (const file of files) {
    if (matches.length >= limit) break;
    if (regex.test(file.path)) matches.push(`${file.path}:<path>`);
    const text = await loadFileText(root, file);
    if (text === null) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length && matches.length < limit; i++) {
      if (regex.test(lines[i])) matches.push(`${file.path}:${i + 1}: ${lines[i]}`);
    }
  }
  return matches;
}

function chunkFiles(files: ReplFileEntry[], maxChars: number): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentChars = 0;
  for (const file of files) {
    const cost = (file.text?.length ?? 0) + file.path.length + 32;
    if (current.length > 0 && currentChars + cost > maxChars) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(file.path);
    currentChars += cost;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function safeRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
