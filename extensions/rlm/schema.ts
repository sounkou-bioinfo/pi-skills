import { StringEnum } from "@mariozechner/pi-ai";
import { Static, Type } from "@sinclair/typebox";

const opSchema = StringEnum(["start", "status", "wait", "cancel"] as const);
const backendSchema = StringEnum(["cli", "tmux"] as const);
const modeSchema = StringEnum(["auto", "solve", "decompose"] as const);
const contextKindSchema = StringEnum(["text", "files", "csv", "json", "parquet"] as const);

export const rlmToolParamsSchema = Type.Object({
  op: Type.Optional(opSchema),
  id: Type.Optional(Type.String({ description: "Run ID for status/wait/cancel" })),
  task: Type.Optional(Type.String({ description: "Question or task to answer over the provided context" })),
  context: Type.Optional(Type.String({ description: "Inline context to store in the RLM environment" })),
  contextPath: Type.Optional(Type.String({ description: "Path to a file or directory whose contents become the RLM context" })),
  contextKind: Type.Optional(contextKindSchema),
  backend: Type.Optional(backendSchema),
  mode: Type.Optional(modeSchema),
  async: Type.Optional(Type.Boolean({ description: "Return immediately and run in background" })),
  model: Type.Optional(Type.String({ description: "Root model. Default: openai-codex/gpt-5.4" })),
  subModel: Type.Optional(Type.String({ description: "Recursive subcall model. Default: openai-codex/gpt-5.3-codex-spark" })),
  cwd: Type.Optional(Type.String({ description: "Working directory for model subprocesses and relative paths" })),
  maxDepth: Type.Optional(Type.Integer({ minimum: 0, maximum: 8 })),
  maxNodes: Type.Optional(Type.Integer({ minimum: 1, maximum: 300 })),
  maxBranching: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
  concurrency: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
  maxIterations: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
  maxChunkChars: Type.Optional(Type.Integer({ minimum: 500, maximum: 500000 })),
  grepLimit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 3600000 })),
  waitTimeoutMs: Type.Optional(Type.Integer({ minimum: 100, maximum: 3600000 })),
  piBin: Type.Optional(Type.String({ description: "Override pi binary path" })),
});

export type RlmToolParams = Static<typeof rlmToolParamsSchema>;
