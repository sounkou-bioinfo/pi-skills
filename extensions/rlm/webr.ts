import { dirname, join } from "node:path";
import { TextEncoder, TextDecoder } from "node:util";
import type { WebR } from "webr";
import { rLoadCodeForContext, type ReplContext } from "./repl.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const defaultWebRRepo = "https://repo.r-wasm.org/";
const rlmSignalPrefix = "__PI_RLM_SIGNAL__";
const sharedWebRPackageCacheDir = "/tmp/pi-webr-package-cache";

export interface WebRCallResult {
  result?: string;
  error?: string;
  contextKind?: string;
  strategy?: string;
}

export interface EvalWithWebROptions {
  scopeId?: string;
  artifactDir?: string;
  callRlm?: (task: string, subcontext: unknown, contextKind?: string) => Promise<WebRCallResult>;
  maxRecursiveCalls?: number;
}

export interface EvalWithWebRResult {
  output: string;
  signaledFinal: boolean;
  recursiveCalls: number;
}

export interface WebRSession {
  eval(code: string): Promise<EvalWithWebRResult>;
  close(): Promise<void>;
}

export async function evalWithWebR(
  code: string,
  context: Extract<ReplContext, { kind: "text" | "csv" | "parquet" }>,
  optionsOrScopeId: EvalWithWebROptions | string = "default",
  legacyArtifactDir?: string,
): Promise<EvalWithWebRResult> {
  const session = await createWebRSession(context, optionsOrScopeId, legacyArtifactDir);
  try {
    return await session.eval(code);
  } finally {
    await session.close();
  }
}

export async function createWebRSession(
  context: Extract<ReplContext, { kind: "text" | "csv" | "parquet" }>,
  optionsOrScopeId: EvalWithWebROptions | string = "default",
  legacyArtifactDir?: string,
): Promise<WebRSession> {
  const options: EvalWithWebROptions =
    typeof optionsOrScopeId === "string"
      ? { scopeId: optionsOrScopeId, artifactDir: legacyArtifactDir }
      : optionsOrScopeId;
  const scopeId = options.scopeId ?? "default";
  const artifactDir = options.artifactDir;
  const callRlm = options.callRlm;
  const maxRecursiveCalls = Math.max(1, options.maxRecursiveCalls ?? 8);

  const webR = await createWebR();
  const tempPaths: string[] = [];
  const exportedArtifacts = new Set<string>();
  let closed = false;

  const prepared = await prepareContext(webR, context, scopeId);
  tempPaths.push(...prepared.tempPaths);
  const webRArtifactDir = `/tmp/pi-rlm-artifacts-${sanitizeScopeId(scopeId)}`;
  const webRPackageLibDir = `/tmp/pi-webr-lib-${sanitizeScopeId(scopeId)}`;
  if (artifactDir) await ensureWebRDir(webR, webRArtifactDir);
  await ensureWebRDir(webR, webRPackageLibDir);
  await restoreWebRPackageCache(webR, webRPackageLibDir, sharedWebRPackageCacheDir);
  await webR.evalRVoid(buildSessionSetup({ context, prepared, artifactDir: artifactDir ? webRArtifactDir : "", packageLibDir: webRPackageLibDir }));

  return {
    async eval(code: string): Promise<EvalWithWebRResult> {
      const callResults: WebRCallResult[] = [];
      for (let step = 0; step <= maxRecursiveCalls; step++) {
        const rawResult = await webR.evalRString(buildEvaluationCode(code, callResults));
        const signal = parseRlmSignal(rawResult);
        if (!signal) {
          return {
            output: await appendArtifactSummary(webR, webRArtifactDir, artifactDir, rawResult, exportedArtifacts),
            
            signaledFinal: false,
            recursiveCalls: callResults.length,
          };
        }
        if (signal.kind === "final") {
          return {
            output: await appendArtifactSummary(webR, webRArtifactDir, artifactDir, formatSignalPayload(signal.payload), exportedArtifacts),
            signaledFinal: true,
            recursiveCalls: callResults.length,
          };
        }
        if (signal.kind !== "call") {
          return {
            output: `webR error: unsupported RLM signal kind ${signal.kind}`,
            signaledFinal: false,
            recursiveCalls: callResults.length,
          };
        }
        if (!callRlm) {
          return {
            output: "webR error: rlm_call() is not available in this context",
            signaledFinal: false,
            recursiveCalls: callResults.length,
          };
        }
        if (step === maxRecursiveCalls) {
          return {
            output: `webR error: rlm_call() exceeded maxRecursiveCalls=${maxRecursiveCalls}`,
            signaledFinal: false,
            recursiveCalls: callResults.length,
          };
        }
        const payload = isRecord(signal.payload) ? signal.payload : {};
        const task = typeof payload.task === "string" ? payload.task : "";
        if (!task) {
          return {
            output: "webR error: rlm_call() requested without a task",
            signaledFinal: false,
            recursiveCalls: callResults.length,
          };
        }
        const child = await callRlm(task, payload.subcontext, typeof payload.context_kind === "string" ? payload.context_kind : undefined);
        callResults.push(child);
      }

      return {
        output: `webR error: rlm_call() exceeded maxRecursiveCalls=${maxRecursiveCalls}`,
        signaledFinal: false,
        recursiveCalls: maxRecursiveCalls,
      };
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await syncWebRPackageCache(webR, webRPackageLibDir, sharedWebRPackageCacheDir);
      for (const tempPath of tempPaths) {
        try {
          await webR.FS.unlink(tempPath);
        } catch {
          // ignore cleanup failures
        }
      }
      try {
        webR.close();
      } catch {
        // ignore shutdown failures
      }
    },
  };
}

function buildSessionSetup(input: {
  context: Extract<ReplContext, { kind: "text" | "csv" | "parquet" }>;
  prepared: { setup: string[]; tempPaths: string[]; loadBody?: string };
  artifactDir: string;
  packageLibDir: string;
}): string {
  return [
    ...input.prepared.setup,
    `artifact_dir <- ${toRStringLiteral(input.artifactDir)}`,
    `.pi_pkg_lib <- ${toRStringLiteral(input.packageLibDir)}`,
    `options(repos = c(CRAN = ${toRStringLiteral(defaultWebRRepo)}))`,
    '.libPaths(unique(c(.pi_pkg_lib, .libPaths())))',
    'install_webr_packages <- function(packages, repos = getOption("repos")[["CRAN"]]) {',
    '  packages <- unique(as.character(packages))',
    '  if (!length(packages)) return(invisible(character()))',
    '  if (!requireNamespace("webr", quietly = TRUE)) stop("The webR support package is not available")',
    '  old_libpaths <- .libPaths()',
    '  on.exit(.libPaths(old_libpaths), add = TRUE)',
    '  .libPaths(unique(c(.pi_pkg_lib, old_libpaths)))',
    '  missing <- packages[!vapply(packages, requireNamespace, logical(1), quietly = TRUE)]',
    '  if (length(missing)) webr::install(missing, repos = repos)',
    '  invisible(packages)',
    '}',
    'save_plot <- function(filename, expr, device = c("png", "pdf", "svg"), width = 800, height = 600, pointsize = 12, bg = "white", ...) {',
    '  if (!nzchar(artifact_dir)) stop("artifact_dir is not configured")',
    '  device <- match.arg(device)',
    '  path <- file.path(artifact_dir, filename)',
    '  dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)',
    '  if (device == "png") {',
    '    grDevices::png(path, width = width, height = height, pointsize = pointsize, bg = bg, ...)',
    '  } else if (device == "pdf") {',
    '    grDevices::pdf(path, width = width / 72, height = height / 72, pointsize = pointsize, bg = bg, ...)',
    '  } else if (device == "svg") {',
    '    grDevices::svg(path, width = width / 72, height = height / 72, pointsize = pointsize, bg = bg, ...)',
    '  }',
    '  on.exit(try(grDevices::dev.off(), silent = TRUE), add = TRUE)',
    '  eval(substitute(expr), envir = parent.frame())',
    '  filename',
    '}',
    'context_lines <- function() strsplit(context_text, "\\n", fixed = TRUE)[[1]]',
    'context_grep <- function(pattern, limit = 20) {',
    '  hits <- grep(pattern, context_lines(), value = TRUE, ignore.case = TRUE, perl = TRUE)',
    '  utils::head(hits, limit)',
    '}',
    'context_chunks <- function(n = 40000) {',
    '  if (!nzchar(context_text)) return(list())',
    '  starts <- seq.int(1, nchar(context_text), by = n)',
    '  lapply(starts, function(s) substr(context_text, s, min(nchar(context_text), s + n - 1)))',
    '}',
    `context_r_load_code <- function() ${toRStringLiteral(rLoadCodeForContext(input.context))}`,
    'context_load <- function() {',
    input.prepared.loadBody ?? rLoadCodeForContext(input.context),
    '}',
    '.pi_rlm_escape_json_string <- function(x) {',
    '  x <- enc2utf8(as.character(x))',
    '  bytes <- utf8ToInt(x)',
    '  parts <- vapply(bytes, function(b) {',
    '    ch <- intToUtf8(b)',
    '    if (b == 34) return(paste0(intToUtf8(92), intToUtf8(34)))',
    '    if (b == 92) return(intToUtf8(92))',
    '    if (b == 10) return(paste0(intToUtf8(92), "n"))',
    '    if (b == 13) return(paste0(intToUtf8(92), "r"))',
    '    if (b == 9) return(paste0(intToUtf8(92), "t"))',
    '    if (b < 32) return(paste0(intToUtf8(92), "u", sprintf("%04x", b)))',
    '    ch',
    '  }, character(1))',
    '  paste0(intToUtf8(34), paste(parts, collapse = ""), intToUtf8(34))',
    '}',
    '.pi_rlm_to_json <- function(x) {',
    '  if (is.null(x)) return("null")',
    '  if (is.character(x)) {',
    '    if (length(x) == 1) return(.pi_rlm_escape_json_string(x))',
    '    return(paste0("[", paste(vapply(x, .pi_rlm_escape_json_string, character(1)), collapse = ","), "]"))',
    '  }',
    '  if (is.logical(x)) {',
    '    vals <- ifelse(is.na(x), "null", ifelse(x, "true", "false"))',
    '    if (length(vals) == 1) return(vals)',
    '    return(paste0("[", paste(vals, collapse = ","), "]"))',
    '  }',
    '  if (is.numeric(x) || is.integer(x)) {',
    '    vals <- ifelse(is.na(x) | !is.finite(x), "null", as.character(x))',
    '    if (length(vals) == 1) return(vals)',
    '    return(paste0("[", paste(vals, collapse = ","), "]"))',
    '  }',
    '  if (is.data.frame(x)) {',
    '    rows <- lapply(seq_len(nrow(x)), function(i) as.list(x[i, , drop = FALSE]))',
    '    return(.pi_rlm_to_json(rows))',
    '  }',
    '  if (is.list(x)) {',
    '    nms <- names(x)',
    '    if (!is.null(nms) && any(nzchar(nms))) {',
    '      parts <- Map(function(k, v) paste0(.pi_rlm_escape_json_string(k), ":", .pi_rlm_to_json(v)), ifelse(nzchar(nms), nms, paste0("V", seq_along(x))), x)',
    '      return(paste0("{", paste(unlist(parts), collapse = ","), "}"))',
    '    }',
    '    return(paste0("[", paste(vapply(x, .pi_rlm_to_json, character(1)), collapse = ","), "]"))',
    '  }',
    '  .pi_rlm_escape_json_string(paste(capture.output(print(x)), collapse = "\\n"))',
    '}',
    '.pi_rlm_prefetched <- list()',
    '.pi_rlm_call_index <- 0L',
    '.pi_rlm_signal <- function(kind, payload) {',
    '  q <- intToUtf8(34)',
    '  json <- paste0("{", q, "kind", q, ":", .pi_rlm_to_json(kind), ",", q, "payload", q, ":", .pi_rlm_to_json(payload), "}")',
    `  stop(paste0(${toRStringLiteral(rlmSignalPrefix)}, json), call. = FALSE)`,
    '}',
    'rlm_call <- function(task, subcontext = NULL, context_kind = NULL) {',
    '  .pi_rlm_call_index <<- .pi_rlm_call_index + 1L',
    '  idx <- .pi_rlm_call_index',
    '  if (length(.pi_rlm_prefetched) >= idx && !is.null(.pi_rlm_prefetched[[idx]])) return(.pi_rlm_prefetched[[idx]])',
    '  .pi_rlm_signal("call", list(task = as.character(task)[1], context_kind = if (is.null(context_kind)) NULL else as.character(context_kind)[1], subcontext = subcontext))',
    '}',
    'FINAL <- function(x) .pi_rlm_signal("final", x)',
    'FINAL_VAR <- function(name) {',
    '  key <- as.character(name)[1]',
    '  if (!nzchar(key)) stop("FINAL_VAR requires a variable name")',
    '  FINAL(get(key, envir = .GlobalEnv))',
    '}',
    'invisible(NULL)',
  ].join("\n");
}

function buildEvaluationCode(code: string, callResults: WebRCallResult[]): string {
  return [
    `.pi_rlm_prefetched <- ${toRLiteral(callResults)}`,
    'if (is.null(.pi_rlm_prefetched)) .pi_rlm_prefetched <- list()',
    '.pi_rlm_call_index <- 0L',
    `.pi_rlm_user_code <- ${toRStringLiteral(code)}`,
    '.pi_rlm_user_value <- tryCatch(eval(parse(text = .pi_rlm_user_code), envir = .GlobalEnv), error = function(e) {',
    '  msg <- conditionMessage(e)',
    `  if (startsWith(msg, ${toRStringLiteral(rlmSignalPrefix)})) return(msg)`,
    '  stop(e)',
    '})',
    'if (is.character(.pi_rlm_user_value) && length(.pi_rlm_user_value) == 1 && startsWith(.pi_rlm_user_value, ' + toRStringLiteral(rlmSignalPrefix) + ')) {',
    '  .pi_rlm_user_value',
    '} else if (length(.pi_rlm_user_value) == 0) {',
    '  ""',
    '} else {',
    '  paste(as.character(.pi_rlm_user_value), collapse = "\\n")',
    '}',
  ].join("\n");
}

async function appendArtifactSummary(
  webR: WebR,
  sourceRoot: string,
  artifactDir: string | undefined,
  result: string,
  exportedArtifacts?: Set<string>,
): Promise<string> {
  if (!artifactDir) return result;
  const copiedArtifacts = await exportWebRArtifacts(webR, sourceRoot, artifactDir);
  const newArtifacts = exportedArtifacts ? copiedArtifacts.filter((file) => !exportedArtifacts.has(file)) : copiedArtifacts;
  for (const file of newArtifacts) exportedArtifacts?.add(file);
  if (newArtifacts.length === 0) return result;
  return [result, "", `artifacts_created:\n${newArtifacts.map((file) => `- ${file}`).join("\n")}`].filter(Boolean).join("\n");
}

async function prepareContext(webR: WebR, context: Extract<ReplContext, { kind: "text" | "csv" | "parquet" }>, scopeId: string): Promise<{ setup: string[]; tempPaths: string[]; loadBody?: string }> {
  if (context.kind === "parquet") {
    const parquetPath = `/tmp/pi-rlm-context-${sanitizeScopeId(scopeId)}.parquet`;
    const bytes = await readBytes(context.path);
    await webR.FS.writeFile(parquetPath, bytes);
    return {
      tempPaths: [parquetPath],
      setup: [
        `context_path <- ${toRStringLiteral(parquetPath)}`,
        `context_text <- ${toRStringLiteral(context.rows.map((row) => JSON.stringify(row)).join("\n"))}`,
        `context <- list(kind = "parquet", path = context_path, columns = c(${context.columns.map((column) => toRStringLiteral(column)).join(", ")}))`,
      ],
      loadBody: parquetLoadBody(context.columns, context.rows),
    };
  }

  const contextPath = `/tmp/pi-rlm-context-${sanitizeScopeId(scopeId)}.txt`;
  const contextText = context.text;
  await webR.FS.writeFile(contextPath, encoder.encode(contextText));
  return {
    tempPaths: [contextPath],
    setup: [
      `context_path <- ${toRStringLiteral(contextPath)}`,
      'context_text <- paste(readLines(context_path, warn = FALSE, encoding = "UTF-8"), collapse = "\\n")',
      context.kind === "csv"
        ? `context <- list(kind = "csv", path = context_path, text = context_text, columns = c(${context.columns.map((column) => toRStringLiteral(column)).join(", ")}))`
        : 'context <- list(kind = "text", path = context_path, text = context_text)',
    ],
  };
}

function parquetLoadBody(columns: string[], rows: Array<Record<string, unknown>>): string {
  const inlineDataFrame = toRDataFrame(columns, rows);
  return [
    'if (requireNamespace("arrow", quietly = TRUE)) {',
    '  return(arrow::read_parquet(context$path))',
    '} else if (requireNamespace("duckdb", quietly = TRUE) && requireNamespace("DBI", quietly = TRUE)) {',
    '  con <- DBI::dbConnect(duckdb::duckdb(), dbdir = ":memory:")',
    '  on.exit(DBI::dbDisconnect(con, shutdown = TRUE), add = TRUE)',
    '  return(DBI::dbGetQuery(con, paste0("SELECT * FROM read_parquet(", shQuote(context$path), ")")))',
    '}',
    inlineDataFrame,
  ].join("\n");
}

function toRDataFrame(columns: string[], rows: Array<Record<string, unknown>>): string {
  const assignments = columns.map((column) => `${toRName(column)} = ${toRVectorLiteral(rows.map((row) => row[column]))}`);
  if (assignments.length === 0) return "data.frame()";
  return `data.frame(${assignments.join(", ")}, check.names = FALSE, stringsAsFactors = FALSE)`;
}

function toRName(name: string): string {
  return /^[A-Za-z.][A-Za-z0-9._]*$/.test(name) ? name : `\`${name.replace(/`/g, "\\`")}\``;
}

function toRVectorLiteral(values: unknown[]): string {
  return `c(${values.map(toRValueLiteral).join(", ")})`;
}

function toRValueLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NA";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NA_real_";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "bigint") return `${value}`;
  return toRStringLiteral(String(value));
}

async function readBytes(path: string): Promise<Uint8Array> {
  const fs = await import("node:fs/promises");
  return fs.readFile(path);
}

async function exportWebRArtifacts(webR: WebR, sourceRoot: string, destRoot: string): Promise<string[]> {
  const fs = await import("node:fs/promises");
  const files = await listWebRFiles(webR, sourceRoot);
  const copied: string[] = [];
  for (const rel of files) {
    const sourcePath = `${sourceRoot}/${rel}`;
    const destPath = join(destRoot, rel);
    const bytes = await webR.FS.readFile(sourcePath);
    await fs.mkdir(dirname(destPath), { recursive: true });
    await fs.writeFile(destPath, bytes);
    copied.push(rel);
  }
  return copied.sort();
}

async function listWebRFiles(webR: WebR, root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, prefix = ""): Promise<void> {
    let node;
    try {
      node = await webR.FS.lookupPath(dir);
    } catch {
      return;
    }
    for (const entry of Object.values(node.contents ?? {})) {
      const full = `${dir}/${entry.name}`;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isFolder) await walk(full, rel);
      else out.push(rel);
    }
  }
  await walk(root);
  return out;
}

async function ensureWebRDir(webR: WebR, path: string): Promise<void> {
  const parts = path.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    try {
      await webR.FS.lookupPath(current);
    } catch {
      await webR.FS.mkdir(current);
    }
  }
}

function parseRlmSignal(result: string): { kind: string; payload: unknown } | null {
  if (!result.startsWith(rlmSignalPrefix)) return null;
  try {
    const parsed = JSON.parse(result.slice(rlmSignalPrefix.length));
    return isRecord(parsed) && typeof parsed.kind === "string" ? { kind: parsed.kind, payload: parsed.payload } : null;
  } catch {
    return null;
  }
}

function formatSignalPayload(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toRLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "string") return toRStringLiteral(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NA_real_";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "bigint") return String(value);
  if (Array.isArray(value)) return `list(${value.map((item) => toRLiteral(item)).join(", ")})`;
  if (isRecord(value)) {
    const entries = Object.entries(value).map(([key, item]) => `${toRName(key)} = ${toRLiteral(item)}`);
    return `list(${entries.join(", ")})`;
  }
  return toRStringLiteral(String(value));
}

async function restoreWebRPackageCache(webR: WebR, destRoot: string, cacheRoot: string): Promise<void> {
  const fs = await import("node:fs/promises");
  try {
    await fs.access(cacheRoot);
  } catch {
    return;
  }
  const files = await listHostFiles(cacheRoot);
  for (const rel of files) {
    const sourcePath = join(cacheRoot, rel);
    const destPath = `${destRoot}/${rel}`;
    const bytes = await fs.readFile(sourcePath);
    await ensureWebRDir(webR, dirname(destPath));
    await webR.FS.writeFile(destPath, bytes);
  }
}

async function syncWebRPackageCache(webR: WebR, sourceRoot: string, cacheRoot: string): Promise<void> {
  const fs = await import("node:fs/promises");
  const files = await listWebRFiles(webR, sourceRoot);
  for (const rel of files) {
    const sourcePath = `${sourceRoot}/${rel}`;
    const destPath = join(cacheRoot, rel);
    const bytes = await webR.FS.readFile(sourcePath);
    await fs.mkdir(dirname(destPath), { recursive: true });
    await fs.writeFile(destPath, bytes);
  }
}

async function listHostFiles(root: string): Promise<string[]> {
  const fs = await import("node:fs/promises");
  const out: string[] = [];
  async function walk(dir: string, prefix = ""): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, rel);
      else out.push(rel);
    }
  }
  await walk(root);
  return out;
}

function sanitizeScopeId(scopeId: string): string {
  return scopeId.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function toRStringLiteral(value: string): string {
  return JSON.stringify(value);
}

async function createWebR(): Promise<WebR> {
  const mod = await import("webr");
  const webR = new mod.WebR({ interactive: false });
  await webR.init();
  return webR;
}

export function decodeBytes(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}
