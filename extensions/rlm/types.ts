export type RlmBackend = "cli" | "tmux";
export type RlmOp = "start" | "status" | "wait" | "cancel";
export type RlmMode = "auto" | "solve" | "decompose";
export type RlmContextKind = "text" | "files" | "csv" | "json" | "parquet";

export interface StartRunInput {
  task: string;
  context?: string;
  contextPath?: string;
  contextKind?: RlmContextKind;
  cwd: string;
  backend: RlmBackend;
  async: boolean;
  model: string;
  subModel: string;
  mode: RlmMode;
  maxDepth: number;
  maxNodes: number;
  maxBranching: number;
  concurrency: number;
  maxIterations: number;
  maxChunkChars: number;
  grepLimit: number;
  timeoutMs: number;
  piBin: string;
}

export interface RunArtifacts {
  dir: string;
  eventsPath: string;
  treePath: string;
  outputPath: string;
}

export interface RlmAction {
  action: "final" | "solve" | "decompose" | "peek" | "grep" | "map_chunks" | "sample_chunks" | "r_eval" | "repl_eval";
  reason: string;
  answer?: string;
  subtasks?: string[];
  start?: number;
  end?: number;
  pattern?: string;
  chunkSize?: number;
  subtaskPrompt?: string;
  code?: string;
}

export interface RlmObservation {
  kind: "peek" | "grep" | "note";
  text: string;
}

export interface RlmNode {
  id: string;
  depth: number;
  task: string;
  contextKind: RlmContextKind;
  contextChars: number;
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: number;
  finishedAt?: number;
  error?: string;
  decision?: { action: string; reason: string };
  observations: RlmObservation[];
  visualizerSession?: string;
  children: RlmNode[];
  result?: string;
}

export interface RlmRunResult {
  runId: string;
  backend: RlmBackend;
  final: string;
  root: RlmNode;
  artifacts: RunArtifacts;
  visualizerSession?: string;
  stats: {
    nodesVisited: number;
    maxDepthSeen: number;
    durationMs: number;
  };
}

export interface RunRecord {
  id: string;
  createdAt: number;
  startedAt: number;
  finishedAt?: number;
  status: "running" | "completed" | "failed" | "cancelled";
  input: StartRunInput;
  result?: RlmRunResult;
  error?: string;
  promise: Promise<RlmRunResult>;
  cancel: () => void;
}
