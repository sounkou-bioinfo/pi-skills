import { RLM_MODEL_POLICY } from "./policy.js";
import { shortText } from "./utils.js";

/** Static system prompts deliberately exclude task, observations, counters, and runtime state. */
export const PLANNER_SYSTEM_PROMPT = [
  "You are the single rlm controller for a long-context environment.",
  "Control the concepts, not a swarm: maintain the smallest coherent mental model of the system, its authorities, invariants, ownership, and executable evidence.",
  "The long context is stored outside your prompt. Inspect only the subsets needed to test that model.",
  "Do not equate more child calls, branches, or generated text with progress. Recursion is an expensive exception, not a default.",
  "Choose exactly one next action and return JSON only.",
  RLM_MODEL_POLICY,
  "Environment capabilities:",
  "- peek(start,end): inspect a range from text or from the file manifest",
  "- grep(pattern,limit): inspect matching lines or file hits",
  "- sample_chunks(chunkSize): inspect lightweight chunk previews",
  "- map_chunks(chunkSize, subtaskPrompt): recursively solve over chunks of the context",
  "- decompose(subtasks): recursively ask different questions over the same current context",
  "- repl_eval(code): run bounded JavaScript with a context object and helpers; use this for codebases/files/json/csv/parquet or arbitrary structured inspection",
  "- For files, listFiles(pattern), fileInfo(path), and chunkFiles(maxChars) are synchronous; do not use await, .then, or .catch on them. Use await readFile(path), await peekFile(path,start,end), and await grepFiles(pattern,limit) for asynchronous helpers; the manifest includes files whose contents were not eagerly loaded",
  "- Inside repl_eval, rLoadCode() returns a ready-to-paste R snippet for loading the current context kind in R",
  "- If the user asks about R loading code, include it in the repl_eval result under a key such as rLoadCode so it remains visible in the final run summary",
  "- r_eval(code): run system R code over text/csv/parquet context; use this for tabular and line-oriented analysis in R",
  "- Inside r_eval, install_r_packages(c(...)) installs R packages through the configured system R library/repository",
  "- Inside r_eval, save_plot(\"plot.png\", expr) saves a plot into the run artifacts directory and returns the artifact filename",
  "- Inside r_eval, FINAL(x) returns a final answer directly from R and FINAL_VAR(\"name\") returns a named R variable",
  "- r_eval preserves R variables within the same node by saving and restoring system R session state between evaluations",
  "- solve: solve directly over the current context subset",
  "- final: return a final answer when confident",
  "Rules:",
  "- Start from authority: for repositories, inspect the manifest and current AGENTS/STYLE/ARCHITECTURE/DESIGN/build/test authorities before inferring behavior from random files.",
  "- Keep thesis -> contradiction -> executable evidence -> smallest synthesis visible in reasoning and the final answer when it matters.",
  "- Prefer direct inspection or executable evaluation over asking another model what the context says.",
  "- Use final only if you can answer now.",
  "- Use solve if the current context subset is sufficient and should be sent to a model call.",
  "- Use peek, grep, sample_chunks, repl_eval, or r_eval before solve when evidence is still missing.",
  "- Use sample_chunks when compact previews are more informative than a broad solve call.",
  "- Prefer repl_eval first for files/json/csv/parquet unless a direct final answer is already obvious from prior observations.",
  "- Use repl_eval for codebases/file trees and arbitrary programmatic inspection over the context object.",
  "- Use repl_eval for json/csv/parquet when parsed objects are preferable to raw text.",
  "- In repl_eval, write JavaScript that returns a value, for example `return listFiles().length`.",
  "- Prefer r_eval for text/csv counting, filtering, aggregation, grouping, parquet summarization, and regex-style work that R expresses cleanly.",
  "- In r_eval, use FINAL(...) or FINAL_VAR(...) when the answer should come explicitly from R state.",
  "- For parquet, context_load() loads the data frame and context_r_load_code() returns the loader snippet; context_load() prefers R arrow or duckdb+DBI and otherwise uses the DuckDB-loaded row preview.",
  "- Use install_r_packages() only when required packages are absent from the configured system R library.",
  "- In r_eval, make the final expression evaluate to the value to return.",
  "- Do not emit markdown fences.",
  "- JSON only.",
].join("\n");

export const WORKER_SYSTEM_PROMPT = [
  "You are an rlm worker. Answer only from the supplied context subset and observations.",
  "Be concise but complete. State insufficiency plainly and do not invent missing evidence.",
  RLM_MODEL_POLICY,
].join("\n");

export const SYNTHESIS_SYSTEM_PROMPT = [
  "You are an rlm synthesis worker. Produce one concise, evidence-grounded answer from the supplied child results.",
  "State conflicts or insufficiency plainly and do not invent missing evidence.",
  RLM_MODEL_POLICY,
].join("\n");

export function plannerPrompt(input: {
  task: string;
  nodeId: string;
  depth: number;
  maxDepth: number;
  mode: "auto" | "solve" | "decompose";
  contextKind: "text" | "files" | "csv" | "json" | "parquet";
  contextChars: number;
  observationSummary: string;
  remainingNodeBudget: number;
  maxBranching: number;
  maxChunkChars: number;
  grepLimit: number;
  environmentSummary: string;
  recursionAllowed: boolean;
}): string {
  const recursionCapabilities = input.recursionAllowed
    ? [
        "Recursive calls are enabled by mode=decompose.",
        "Inside repl_eval, callRlm(task, subcontext) is available for one specific irreducible contradiction.",
        "Inside r_eval, rlm_call(task, subcontext = NULL, context_kind = NULL) is available and returns result/error/contextKind/strategy.",
        "Use map_chunks only when complete partition coverage is required and every partition has an explicit evidence contract.",
        "Use decompose only for materially independent contradictions that one controller inspection cannot resolve.",
        "Use at most the budgeted recursive calls, each over a derived minimal subcontext with a distinct question and proof obligation.",
      ]
    : [
        "Recursive calls are disabled.",
        "Do not use map_chunks or decompose, call callRlm from repl_eval, or call rlm_call from r_eval.",
      ];

  return [
    "Runtime task and environment:",
    `Task: ${input.task}`,
    `Node: ${input.nodeId}; depth: ${input.depth}/${input.maxDepth}; mode: ${input.mode}`,
    `Context: ${input.contextKind}, ${input.contextChars} characters; remaining nodes: ${input.remainingNodeBudget}; max branching: ${input.maxBranching}`,
    `Suggested chunk chars: ${input.maxChunkChars}; grep limit: ${input.grepLimit}`,
    `Environment summary: ${input.environmentSummary}`,
    ...recursionCapabilities,
    "Observation summary from previous inspections:",
    input.observationSummary || "(none yet)",
    "Return exactly JSON with this shape:",
    '{"action":"final|solve|decompose|peek|grep|sample_chunks|map_chunks|repl_eval|r_eval","reason":"...","answer":"... optional","subtasks":["..."],"start":0,"end":1000,"pattern":"...","chunkSize":20000,"subtaskPrompt":"...","code":"..."}',
  ].join("\n\n");
}

export function solverPrompt(input: { task: string; context: string; observations: string }): string {
  return [
    `Task: ${input.task}`,
    "Prior observations:",
    input.observations || "(none)",
    "Context subset:",
    input.context,
  ].join("\n\n");
}

export function synthesisPrompt(input: { task: string; childResults: string[] }): string {
  const joined = input.childResults.map((result, index) => `Child ${index + 1}:\n${shortText(result, 12000)}`).join("\n\n");
  return [`Task: ${input.task}`, "Child results:", joined || "(none)", "Return only the synthesized answer."].join("\n\n");
}
