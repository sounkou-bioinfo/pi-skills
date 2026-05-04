import { chunkText, grepText } from "./utils.js";

export type ReplContext =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "files";
      root: string;
      files: Array<{ path: string; text: string }>;
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
}

export async function evalInRepl(code: string, context: ReplContext, options: ReplEvalOptions = {}): Promise<string> {
  const AsyncFunction = Object.getPrototypeOf(async function () {
    // noop
  }).constructor as new (...args: string[]) => (...fnArgs: unknown[]) => Promise<unknown>;

  const helpers = createHelpers(context, options);
  const names = Object.keys(helpers);
  const values = Object.values(helpers);

  try {
    const fn = new AsyncFunction(...names, `"use strict";\n${code}`);
    const result = await fn(...values);
    return formatResult(result);
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    return `repl error: ${message}`;
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
    return {
      ...base,
      context: {
        kind: "files",
        root: context.root,
        fileCount: context.files.length,
        totalChars: context.files.reduce((sum, file) => sum + file.text.length, 0),
        files: context.files.map((file) => ({ path: file.path, chars: file.text.length })),
      },
      listFiles: (pattern?: string) => filterFilePaths(context.files.map((file) => file.path), pattern),
      readFile: (path: string) => getFile(context.files, path)?.text ?? null,
      peekFile: (path: string, start = 0, end = 2000) => {
        const text = getFile(context.files, path)?.text ?? "";
        const s = Math.max(0, Math.min(start, text.length));
        const e = Math.max(s, Math.min(end, text.length));
        return text.slice(s, e);
      },
      grepFiles: (pattern: string, limit = 20) => grepFiles(context.files, pattern, limit),
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
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getFile(files: Array<{ path: string; text: string }>, path: string) {
  return files.find((file) => file.path === path);
}

function filterFilePaths(paths: string[], pattern?: string): string[] {
  if (!pattern) return paths;
  const regex = safeRegex(pattern);
  return paths.filter((path) => regex.test(path));
}

function grepFiles(files: Array<{ path: string; text: string }>, pattern: string, limit: number): string[] {
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

function chunkFiles(files: Array<{ path: string; text: string }>, maxChars: number): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentChars = 0;
  for (const file of files) {
    const cost = file.text.length + file.path.length + 32;
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
        '# requires jsonlite in R/webR if available',
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
