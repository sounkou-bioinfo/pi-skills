import { shortText } from "./utils.js";

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
  return [
    "You are the single controller for a long-context language model environment.",
    "Control the concepts, not a swarm: maintain the smallest coherent mental model of the system, its authorities, invariants, ownership, and executable evidence.",
    "The long context is stored outside your prompt. Inspect only the subsets needed to test that model.",
    "Do not equate more child calls, branches, or generated text with progress. Recursion is an expensive exception, not a default.",
    "Choose exactly one next action in JSON only.",
    "",
    `Node: ${input.nodeId}`,
    `Depth: ${input.depth}/${input.maxDepth}`,
    `Mode: ${input.mode}`,
    `Task: ${input.task}`,
    `Context kind: ${input.contextKind}`,
    `Context characters available in environment: ${input.contextChars}`,
    `Remaining node budget: ${input.remainingNodeBudget}`,
    `Recursive child calls allowed: ${input.recursionAllowed ? "yes (mode=decompose)" : "no"}`,
    `Max branching: ${input.maxBranching}`,
    `Suggested max chunk chars: ${input.maxChunkChars}`,
    `Suggested grep result limit: ${input.grepLimit}`,
    "",
    "Environment capabilities:",
    `- summary: ${input.environmentSummary}`,
    "- peek(start,end): inspect a range from text or from the file manifest",
    "- grep(pattern,limit): inspect matching lines or file hits",
    "- sample_chunks(chunkSize): inspect lightweight chunk previews",
    "- map_chunks(chunkSize, subtaskPrompt): recursively solve over chunks of the context",
    "- decompose(subtasks): recursively ask different questions over the same current context",
    "- repl_eval(code): run bounded JavaScript with a context object and helpers; use this for codebases/files/json/csv/parquet or arbitrary structured inspection",
    "- For files, use listFiles(pattern), fileInfo(path), await readFile(path), await peekFile(path,start,end), await grepFiles(pattern,limit), and chunkFiles(maxChars); the manifest includes files whose contents were not eagerly loaded",
    `- Inside repl_eval, callRlm(task, subcontext) is ${input.recursionAllowed ? "available for a specific irreducible contradiction" : "disabled"}`,
    "- Inside repl_eval you can use rLoadCode() to get a ready-to-paste R snippet for loading the current context kind in R",
    "- If the user asks about R loading code, include it in your repl_eval result under a key like rLoadCode so it is visible in the final run summary",
    "- r_eval(code): run system R code over text/csv/parquet context; use this for tabular and line-oriented analysis in R",
    "- Inside r_eval, install_r_packages(c(...)) installs R packages through the configured system R library/repository",
    "- Inside r_eval, save_plot(\"plot.png\", expr) saves a plot into the run artifacts directory and returns the artifact filename",
    `- Inside r_eval, rlm_call(task, subcontext = NULL, context_kind = NULL) is ${input.recursionAllowed ? "available and returns result/error/contextKind/strategy" : "disabled"}`,
    "- Inside r_eval, FINAL(x) returns a final answer directly from R and FINAL_VAR(\"name\") returns the value of a named R variable",
    "- r_eval preserves R variables within the same node by saving/restoring system R session state between evaluations",
    "- solve: solve directly over the current context subset",
    "- final: return final answer if confident",
    "",
    "Observation summary from previous inspections:",
    input.observationSummary || "(none yet)",
    "",
    "Return JSON with exactly this shape:",
    '{"action":"final|solve|decompose|peek|grep|sample_chunks|map_chunks|repl_eval|r_eval","reason":"...","answer":"... optional","subtasks":["..."],"start":0,"end":1000,"pattern":"...","chunkSize":20000,"subtaskPrompt":"...","code":"..."}',
    "",
    "Rules:",
    "- Start from authority: for repositories, inspect the manifest and current AGENTS/STYLE/ARCHITECTURE/DESIGN/build/test authorities before inferring behavior from random files.",
    "- Keep thesis -> contradiction -> executable evidence -> smallest synthesis visible in your reasoning and final answer when it matters.",
    "- Prefer direct inspection or executable evaluation over asking another model what the context says.",
    "- Use final only if you can answer now.",
    "- Use solve if the current context subset is sufficient and should be sent to a model call.",
    "- Use peek, grep, sample_chunks, repl_eval, or r_eval before solve when you still need evidence.",
    "- Use sample_chunks when compact previews are more informative than a broad solve call.",
    `- ${input.recursionAllowed ? "Use map_chunks only when complete partition coverage is required and each partition has an explicit evidence contract." : "Do not use map_chunks; recursion is disabled."}`,
    `- ${input.recursionAllowed ? "Use decompose only for materially independent contradictions that cannot be resolved by one controller inspection." : "Do not use decompose; recursion is disabled."}`,
    "- Prefer repl_eval first for files/json/csv/parquet context unless a direct final answer is already obvious from prior observations.",
    "- Use repl_eval when the context is a codebase/files tree or when you need arbitrary programmatic inspection over the context object.",
    "- Use repl_eval for json/csv/parquet when you want to work directly with parsed objects rather than raw text.",
    "- In repl_eval, write JavaScript that returns a value (for example `return listFiles().length`).",
    `- ${input.recursionAllowed ? "Use at most the budgeted callRlm calls, each over a derived minimal subcontext with a distinct question and proof obligation." : "Do not call callRlm from repl_eval."}`,
    "- Prefer r_eval for text/csv counting, line filtering, aggregation, grouping, and simple tabular computation before falling back to solve.",
    `- ${input.recursionAllowed ? "In r_eval, reserve rlm_call(...) for one specific semantic question that R computation cannot answer." : "Do not use rlm_call(); it is disabled."}`,
    "- In r_eval, use FINAL(...) or FINAL_VAR(...) when you want the answer to come explicitly from R state.",
    "- For parquet, you may use r_eval directly; inside r_eval, context_load() loads the parquet data frame and context_r_load_code() returns the loader snippet.",
    "- Use install_r_packages() when you need packages available in the configured system R library.",
    "- For parquet, context_load() prefers R arrow or duckdb+DBI and otherwise uses the DuckDB-loaded row preview embedded by the parent runtime.",
    "- Use r_eval for tabular counting, line filtering, aggregation, grouping, parquet summarization, or regex-style work that R can express cleanly.",
    "- In r_eval, make the final expression evaluate to the value you want returned.",
    "- Do not emit markdown fences.",
    "- JSON only.",
  ].join("\n");
}

export function solverPrompt(input: {
  task: string;
  context: string;
  observations: string;
}): string {
  return [
    "Answer the task using the provided context subset.",
    "Be concise but complete. If evidence is insufficient, say so plainly.",
    "",
    `Task: ${input.task}`,
    "",
    "Prior observations:",
    input.observations || "(none)",
    "",
    "Context subset:",
    input.context,
  ].join("\n");
}

export function synthesisPrompt(input: {
  task: string;
  childResults: string[];
}): string {
  const joined = input.childResults.map((r, i) => `Child ${i + 1}:\n${shortText(r, 12000)}`).join("\n\n");
  return [
    "Synthesize recursive child results into one final answer for the original task.",
    `Task: ${input.task}`,
    "",
    "Child results:",
    joined || "(none)",
    "",
    "Return only the synthesized answer.",
  ].join("\n");
}
