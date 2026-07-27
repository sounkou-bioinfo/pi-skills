import { StringEnum } from "@earendil-works/pi-ai";
import { Static, Type } from "typebox";

const opSchema = StringEnum(["start", "status", "wait", "cancel"] as const);
const backendSchema = StringEnum(["cli", "tmux"] as const);
const modeSchema = StringEnum(
  ["auto", "solve", "decompose"] as const,
  { description: "auto keeps one controller; decompose explicitly permits recursive child calls; solve makes one direct model call" },
);
const contextKindSchema = StringEnum(["text", "files", "csv", "json", "parquet"] as const);

export const rlmToolParamsSchema = Type.Object({
  op: Type.Optional(opSchema),
  id: Type.Optional(Type.String({ description: "Run ID for status/wait/cancel" })),
  task: Type.Optional(Type.String({ description: "Question or task to answer over the provided context" })),
  context: Type.Optional(Type.String({ maxLength: 5_000_000, description: "Inline context, capped at 5M characters; use contextPath for larger inputs" })),
  contextPath: Type.Optional(Type.String({ description: "Path to a file or directory whose contents become the RLM context" })),
  contextKind: Type.Optional(contextKindSchema),
  backend: Type.Optional(backendSchema),
  mode: Type.Optional(modeSchema),
  async: Type.Optional(Type.Boolean({ description: "Detach and return a run ID so the Pi session stays interactive. Default: true; set false only for a short call that should block." })),
  model: Type.Optional(Type.String({ description: "Root model. Default: openai-codex/gpt-5.4" })),
  subModel: Type.Optional(Type.String({ description: "Recursive subcall model. Default: openai-codex/gpt-5.3-codex-spark" })),
  cwd: Type.Optional(Type.String({ description: "Working directory for model subprocesses and relative paths" })),
  maxDepth: Type.Optional(Type.Integer({ minimum: 0, maximum: 3, description: "Recursive depth; default 1 and used only in mode=decompose" })),
  maxNodes: Type.Optional(Type.Integer({ minimum: 1, maximum: 8, description: "Hard node budget; default 4" })),
  maxBranching: Type.Optional(Type.Integer({ minimum: 1, maximum: 2, description: "Child calls per decomposition; default 2" })),
  concurrency: Type.Optional(Type.Integer({ minimum: 1, maximum: 1, description: "Child calls are serialized to prevent subprocess sprawl" })),
  maxIterations: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
  maxChunkChars: Type.Optional(Type.Integer({ minimum: 500, maximum: 500000 })),
  grepLimit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 3600000 })),
  waitTimeoutMs: Type.Optional(Type.Integer({ minimum: 100, maximum: 3600000 })),
  piBin: Type.Optional(Type.String({ description: "Override pi binary path" })),
  rBin: Type.Optional(Type.String({ description: "System R interpreter for r_eval. Defaults to PI_RLM_R_BIN or Rscript." })),
  rLibPaths: Type.Optional(Type.Array(Type.String(), { description: "R library paths to prepend to .libPaths() for r_eval." })),
  rRepos: Type.Optional(Type.String({ description: "CRAN-style repository URL for install_r_packages(). Defaults to PI_RLM_R_REPOS or cloud.r-project.org." })),
});

export type RlmToolParams = Static<typeof rlmToolParamsSchema>;
