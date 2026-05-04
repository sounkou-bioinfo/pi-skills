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
}): string {
  return [
    "You are the controller for a recursive language model (RLM).",
    "The long context is stored outside your prompt. You never see all of it unless you intentionally inspect subsets.",
    "Choose exactly one next action in JSON only.",
    "",
    `Node: ${input.nodeId}`,
    `Depth: ${input.depth}/${input.maxDepth}`,
    `Mode: ${input.mode}`,
    `Task: ${input.task}`,
    `Context kind: ${input.contextKind}`,
    `Context characters available in environment: ${input.contextChars}`,
    `Remaining node budget: ${input.remainingNodeBudget}`,
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
    "- repl_eval(code): run JavaScript in a REPL with a context object and helpers; use this for codebases/files/json/csv/parquet or arbitrary structured inspection",
    "- Inside repl_eval you can use callRlm(task, subcontext) to launch recursive subcalls over derived subcontexts",
    "- Inside repl_eval you can use rLoadCode() to get a ready-to-paste R snippet for loading the current context kind in R",
    "- If the user asks about R loading code, include it in your repl_eval result under a key like rLoadCode so it is visible in the final run summary",
    "- r_eval(code): run R/webR code over text/csv/parquet context; use this for tabular and line-oriented analysis in R",
    "- Inside r_eval, install_webr_packages(c(...)) installs wasm-ready R packages from the webR binary repo (https://repo.r-wasm.org/)",
    "- Inside r_eval, save_plot(\"plot.png\", expr) saves a plot into the run artifacts directory and returns the artifact filename",
    "- Inside r_eval, rlm_call(task, subcontext = NULL, context_kind = NULL) launches a recursive child RLM call from R and returns a list with result/error/contextKind/strategy",
    "- Inside r_eval, FINAL(x) returns a final answer directly from R and FINAL_VAR(\"name\") returns the value of a named R variable",
    "- r_eval reuses a persistent webR session within the same node, so R variables created in one r_eval step remain available to later r_eval steps for that node",
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
    "- Use final only if you can answer now.",
    "- Use solve if the current context subset is sufficient and should be sent to a model call.",
    "- Use peek, grep, sample_chunks, repl_eval, or r_eval before solve when you still need evidence.",
    "- Use sample_chunks when you want compact previews before deciding how to recurse.",
    "- Use map_chunks when the task should be applied across the whole context in partitions.",
    "- Use decompose when the task naturally splits into distinct questions over the same context.",
    "- Prefer repl_eval first for files/json/csv/parquet context unless a direct final answer is already obvious from prior observations.",
    "- Use repl_eval when the context is a codebase/files tree or when you need arbitrary programmatic inspection over the context object.",
    "- Use repl_eval for json/csv/parquet when you want to work directly with parsed objects rather than raw text.",
    "- In repl_eval, write JavaScript that returns a value (for example `return listFiles().length`).",
    "- Prefer callRlm(task, subcontext) inside repl_eval when you derive a meaningful subset/object/chunk and want model judgment over that derived context.",
    "- Use callRlm(task, subcontext) inside repl_eval for semantic summarization, classification, or answering over a filtered subset.",
    "- Prefer r_eval for text/csv counting, line filtering, aggregation, grouping, and simple tabular computation before falling back to solve.",
    "- In r_eval, use rlm_call(...) when you want recursion to happen from inside the R/webR environment rather than from repl_eval.",
    "- In r_eval, use FINAL(...) or FINAL_VAR(...) when you want the answer to come explicitly from R state.",
    "- For parquet, you may use r_eval directly; inside r_eval, context_load() loads the parquet data frame and context_r_load_code() returns the loader snippet.",
    "- Use install_webr_packages() for webR-supported packages instead of assuming generic CRAN source installs will work unchanged.",
    "- In webR, parquet context_load() falls back to an embedded in-memory data frame if parquet reader packages are unavailable.",
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
