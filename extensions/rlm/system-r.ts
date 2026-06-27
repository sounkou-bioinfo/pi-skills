import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { rLoadCodeForContext, type ReplContext } from "./repl.js";

const rlmSignalPrefix = "__PI_RLM_SIGNAL__";
const resultMarker = "__PI_RLM_RESULT__";
const defaultRRepo = "https://cloud.r-project.org";

export interface RCallResult {
  result?: string;
  error?: string;
  contextKind?: string;
  strategy?: string;
}

export interface EvalWithROptions {
  scopeId?: string;
  artifactDir?: string;
  callRlm?: (task: string, subcontext: unknown, contextKind?: string) => Promise<RCallResult>;
  maxRecursiveCalls?: number;
  rBin?: string;
  rLibPaths?: string[];
  rRepos?: string;
}

export interface EvalWithRResult {
  output: string;
  signaledFinal: boolean;
  recursiveCalls: number;
}

export interface RSession {
  eval(code: string): Promise<EvalWithRResult>;
  close(): Promise<void>;
}

export async function evalWithR(
  code: string,
  context: Extract<ReplContext, { kind: "text" | "csv" | "parquet" }>,
  optionsOrScopeId: EvalWithROptions | string = "default",
  legacyArtifactDir?: string,
): Promise<EvalWithRResult> {
  const session = await createRSession(context, optionsOrScopeId, legacyArtifactDir);
  try {
    return await session.eval(code);
  } finally {
    await session.close();
  }
}

export async function createRSession(
  context: Extract<ReplContext, { kind: "text" | "csv" | "parquet" }>,
  optionsOrScopeId: EvalWithROptions | string = "default",
  legacyArtifactDir?: string,
): Promise<RSession> {
  const options: EvalWithROptions =
    typeof optionsOrScopeId === "string"
      ? { scopeId: optionsOrScopeId, artifactDir: legacyArtifactDir }
      : optionsOrScopeId;
  const scopeId = options.scopeId ?? "default";
  const artifactDir = options.artifactDir;
  const callRlm = options.callRlm;
  const maxRecursiveCalls = Math.max(1, options.maxRecursiveCalls ?? 8);
  const rBin = options.rBin ?? process.env.PI_RLM_R_BIN ?? "Rscript";
  const rLibPaths = options.rLibPaths ?? parseRLibPathsEnv(process.env.PI_RLM_R_LIBS);
  const rRepos = options.rRepos ?? process.env.PI_RLM_R_REPOS ?? defaultRRepo;

  const tempDir = await fs.mkdtemp(join(tmpdir(), `pi-rlm-r-${sanitizeScopeId(scopeId)}-`));
  const statePath = join(tempDir, "session.RData");
  const prepared = await prepareContext(context, tempDir, scopeId);
  const exportedArtifacts = new Set<string>();
  if (artifactDir) {
    await fs.mkdir(artifactDir, { recursive: true });
    for (const file of await listHostFilesSafe(artifactDir)) exportedArtifacts.add(file);
  }
  let closed = false;

  return {
    async eval(code: string): Promise<EvalWithRResult> {
      const callResults: RCallResult[] = [];
      for (let step = 0; step <= maxRecursiveCalls; step++) {
        const rawResult = await runEvaluation({
          rBin,
          tempDir,
          statePath,
          setupCode: buildSessionSetup({ context, prepared, artifactDir: artifactDir ?? "", rLibPaths, rRepos }),
          evalCode: buildEvaluationCode(code, callResults),
        });
        const signal = parseRlmSignal(rawResult.resultText.trim());
        if (!signal) {
          return {
            output: await appendArtifactSummary(artifactDir, combineStdoutAndResult(rawResult.stdoutBeforeMarker, rawResult.resultText), exportedArtifacts),
            signaledFinal: false,
            recursiveCalls: callResults.length,
          };
        }
        if (signal.kind === "final") {
          return {
            output: await appendArtifactSummary(artifactDir, formatSignalPayload(signal.payload), exportedArtifacts),
            signaledFinal: true,
            recursiveCalls: callResults.length,
          };
        }
        if (signal.kind !== "call") {
          return {
            output: `R error: unsupported RLM signal kind ${signal.kind}`,
            signaledFinal: false,
            recursiveCalls: callResults.length,
          };
        }
        if (!callRlm) {
          return {
            output: "R error: rlm_call() is not available in this context",
            signaledFinal: false,
            recursiveCalls: callResults.length,
          };
        }
        if (step === maxRecursiveCalls) {
          return {
            output: `R error: rlm_call() exceeded maxRecursiveCalls=${maxRecursiveCalls}`,
            signaledFinal: false,
            recursiveCalls: callResults.length,
          };
        }
        const payload = isRecord(signal.payload) ? signal.payload : {};
        const task = typeof payload.task === "string" ? payload.task : "";
        if (!task) {
          return {
            output: "R error: rlm_call() requested without a task",
            signaledFinal: false,
            recursiveCalls: callResults.length,
          };
        }
        const child = await callRlm(task, payload.subcontext, typeof payload.context_kind === "string" ? payload.context_kind : undefined);
        callResults.push(child);
      }

      return {
        output: `R error: rlm_call() exceeded maxRecursiveCalls=${maxRecursiveCalls}`,
        signaledFinal: false,
        recursiveCalls: maxRecursiveCalls,
      };
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
}

interface PreparedContext {
  setup: string[];
  loadBody?: string;
}

function buildSessionSetup(input: {
  context: Extract<ReplContext, { kind: "text" | "csv" | "parquet" }>;
  prepared: PreparedContext;
  artifactDir: string;
  rLibPaths: string[];
  rRepos: string;
}): string {
  const helperNames = [
    "artifact_dir",
    "context_path",
    "context_text",
    "context",
    "install_r_packages",
    "install_webr_packages",
    "save_plot",
    "context_lines",
    "context_grep",
    "context_chunks",
    "context_r_load_code",
    "context_load",
    "rlm_call",
    "FINAL",
    "FINAL_VAR",
  ];

  return [
    ...input.prepared.setup,
    `artifact_dir <- ${toRStringLiteral(input.artifactDir)}`,
    `.pi_r_lib_paths <- c(${input.rLibPaths.map(toRStringLiteral).join(", ")})`,
    'if (length(.pi_r_lib_paths)) .libPaths(unique(c(.pi_r_lib_paths, .libPaths())))',
    `options(repos = c(CRAN = ${toRStringLiteral(input.rRepos)}))`,
    'install_r_packages <- function(packages, repos = getOption("repos")[["CRAN"]], lib = .libPaths()[1]) {',
    '  packages <- unique(as.character(packages))',
    '  if (!length(packages)) return(invisible(character()))',
    '  missing <- packages[!vapply(packages, requireNamespace, logical(1), quietly = TRUE)]',
    '  if (length(missing)) utils::install.packages(missing, repos = repos, lib = lib)',
    '  invisible(packages)',
    '}',
    'install_webr_packages <- function(...) {',
    '  warning("install_webr_packages() is deprecated in pi-skills RLM; use install_r_packages() with system R instead.", call. = FALSE)',
    '  install_r_packages(...)',
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
    '    if (b == 92) return(paste0(intToUtf8(92), intToUtf8(92)))',
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
    `.pi_rlm_helper_names <- c(${helperNames.map(toRStringLiteral).join(", ")})`,
    'invisible(NULL)',
  ].join("\n");
}

function buildEvaluationCode(code: string, callResults: RCallResult[]): string {
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

async function prepareContext(context: Extract<ReplContext, { kind: "text" | "csv" | "parquet" }>, tempDir: string, scopeId: string): Promise<PreparedContext> {
  if (context.kind === "parquet") {
    return {
      setup: [
        `context_path <- ${toRStringLiteral(context.path)}`,
        `context_text <- ${toRStringLiteral(context.rows.map((row) => JSON.stringify(row)).join("\n"))}`,
        `context <- list(kind = "parquet", path = context_path, columns = c(${context.columns.map((column) => toRStringLiteral(column)).join(", ")}))`,
      ],
      loadBody: parquetLoadBody(context.columns, context.rows),
    };
  }

  const contextPath = join(tempDir, `context-${sanitizeScopeId(scopeId)}.${context.kind === "csv" ? "csv" : "txt"}`);
  await fs.writeFile(contextPath, context.text, "utf8");
  return {
    setup: [
      `context_path <- ${toRStringLiteral(contextPath)}`,
      'context_text <- paste(readLines(context_path, warn = FALSE, encoding = "UTF-8"), collapse = "\\n")',
      context.kind === "csv"
        ? `context <- list(kind = "csv", path = context_path, text = context_text, columns = c(${context.columns.map((column) => toRStringLiteral(column)).join(", ")}))`
        : 'context <- list(kind = "text", path = context_path, text = context_text)',
    ],
    loadBody: context.kind === "csv" ? 'utils::read.csv(context$path, stringsAsFactors = FALSE, check.names = FALSE)' : undefined,
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

interface RunEvaluationInput {
  rBin: string;
  tempDir: string;
  statePath: string;
  setupCode: string;
  evalCode: string;
}

async function runEvaluation(input: RunEvaluationInput): Promise<{ stdoutBeforeMarker: string; resultText: string }> {
  const scriptPath = join(input.tempDir, `eval-${Date.now()}-${Math.random().toString(36).slice(2)}.R`);
  const script = buildRScript(input.statePath, input.setupCode, input.evalCode);
  await fs.writeFile(scriptPath, script, { encoding: "utf8", mode: 0o600 });
  const { code, stdout, stderr } = await spawnR(input.rBin, scriptPath);
  try {
    await fs.unlink(scriptPath);
  } catch {
    // ignore temp cleanup failure
  }
  const markerIndex = stdout.lastIndexOf(`\n${resultMarker}\n`);
  const normalizedMarkerIndex = markerIndex >= 0 ? markerIndex + 1 : stdout.indexOf(`${resultMarker}\n`);
  if (normalizedMarkerIndex >= 0) {
    const before = stdout.slice(0, normalizedMarkerIndex).replace(new RegExp(`${escapeRegex(resultMarker)}\\n?$`), "");
    const after = stdout.slice(normalizedMarkerIndex + resultMarker.length + 1);
    return { stdoutBeforeMarker: before.trimEnd(), resultText: after.trim() };
  }
  const pieces = [];
  if (stdout.trim()) pieces.push(stdout.trim());
  if (stderr.trim()) pieces.push(stderr.trim());
  const message = pieces.join("\n").trim() || `R exited with code ${code}`;
  return { stdoutBeforeMarker: "", resultText: `R error${code === 0 ? "" : ` (exit ${code})`}:\n${message}` };
}

function buildRScript(statePath: string, setupCode: string, evalCode: string): string {
  return [
    'options(warn = 1)',
    `.pi_rlm_state_path <- ${toRStringLiteral(statePath)}`,
    'if (file.exists(.pi_rlm_state_path)) {',
    '  try(load(.pi_rlm_state_path, envir = .GlobalEnv), silent = TRUE)',
    '}',
    setupCode,
    '.pi_rlm_result <- tryCatch({',
    indentBlock(evalCode, '  '),
    '}, error = function(e) {',
    '  paste0("R error: ", conditionMessage(e))',
    '})',
    `if (!is.character(.pi_rlm_result) || length(.pi_rlm_result) != 1 || !startsWith(.pi_rlm_result, ${toRStringLiteral(rlmSignalPrefix)})) {`,
    '  .pi_rlm_all_names <- ls(.GlobalEnv, all.names = TRUE)',
    '  .pi_rlm_save_names <- setdiff(.pi_rlm_all_names, c(.pi_rlm_helper_names, grep("^\\\\.pi_rlm_", .pi_rlm_all_names, value = TRUE)))',
    '  try(save(list = .pi_rlm_save_names, file = .pi_rlm_state_path, envir = .GlobalEnv), silent = TRUE)',
    '}',
    `cat("\\n${resultMarker}\\n")`,
    'cat(as.character(.pi_rlm_result), sep = "\n")',
  ].join("\n");
}

function spawnR(rBin: string, scriptPath: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const lower = basename(rBin).toLowerCase();
  const args = lower === "r" || lower === "r.exe" ? ["--vanilla", "--slave", "-f", scriptPath] : ["--vanilla", scriptPath];
  return new Promise((resolve) => {
    const proc = spawn(rBin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    proc.on("error", (error) => {
      resolve({ code: 1, stdout, stderr: `${stderr}${stderr ? "\n" : ""}${error.message}` });
    });
    proc.on("close", (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

async function appendArtifactSummary(artifactDir: string | undefined, result: string, exportedArtifacts: Set<string>): Promise<string> {
  if (!artifactDir) return result;
  const files = await listHostFilesSafe(artifactDir);
  const newArtifacts = files.filter((file) => !exportedArtifacts.has(file));
  for (const file of newArtifacts) exportedArtifacts.add(file);
  if (newArtifacts.length === 0) return result;
  return [result, "", `artifacts_created:\n${newArtifacts.map((file) => `- ${file}`).join("\n")}`].filter(Boolean).join("\n");
}

async function listHostFilesSafe(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  try {
    return await listHostFiles(root);
  } catch {
    return [];
  }
}

async function listHostFiles(root: string): Promise<string[]> {
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
  return out.sort();
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

function combineStdoutAndResult(stdout: string, result: string): string {
  return [stdout.trim(), result.trim()].filter(Boolean).join("\n");
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

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sanitizeScopeId(scopeId: string): string {
  return scopeId.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function toRStringLiteral(value: string): string {
  return JSON.stringify(value);
}

function parseRLibPathsEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(/[:;]/).map((part) => part.trim()).filter(Boolean);
}

function indentBlock(text: string, indent: string): string {
  return text
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n");
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
