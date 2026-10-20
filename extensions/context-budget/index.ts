import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const DEFAULT_TOOL_RESULT_BYTES = 12 * 1024;
const DEFAULT_TOTAL_TOOL_RESULT_BYTES = 64 * 1024;
const MIN_TOOL_RESULT_BYTES = 4 * 1024;
const MAX_TOOL_RESULT_BYTES = 50 * 1024;
const MIN_TOTAL_TOOL_RESULT_BYTES = 16 * 1024;
const MAX_TOTAL_TOOL_RESULT_BYTES = 512 * 1024;
const STATE_TYPE = "context-budget-omissions-v1";
// Provider prompt caches used here expire after at most one hour without use.
export const CACHE_LIFETIME_MS = 60 * 60 * 1000;
const BOUNDED_TOOLS = new Set(["bash", "read", "grep", "find", "ls"]);
const OMITTED_MARKER = "\n\n[Context budget: middle omitted. Re-run read with offset/limit or use a narrower bash/search command.]\n\n";

type TextPart = { type: "text"; text: string };
type CandidateToolResult = {
  role?: string;
  toolCallId?: string;
  toolName?: string;
  content?: Array<{ type: string; text?: string }>;
};

export default function contextBudgetExtension(pi: ExtensionAPI): void {
  const maxBytes = configuredByteLimit(process.env.PI_CONTEXT_TOOL_RESULT_BYTES);
  const totalBytes = configuredTotalByteLimit(process.env.PI_CONTEXT_TOOL_RESULTS_TOTAL_BYTES);
  let omitted = new Set<string>();
  let compacted = false;
  const restore = (_event: unknown, ctx: ExtensionContext) => {
    omitted = new Set(ctx.sessionManager.getBranch().flatMap((entry) =>
      entry.type === "custom" && entry.customType === STATE_TYPE && Array.isArray(entry.data)
        ? entry.data.filter((id: unknown): id is string => typeof id === "string") : []));
  };
  pi.on("session_start", restore);
  pi.on("session_tree", restore);
  pi.on("session_compact", () => { compacted = true; });
  pi.on("context", async (event) => {
    const before = new Set(omitted);
    const cold = compacted || cacheExpired(event.messages, Date.now());
    compacted = false;
    const messages = boundInspectionResults(event.messages, maxBytes, totalBytes, omitted, cold);
    const added = [...omitted].filter((id) => !before.has(id));
    if (added.length) pi.appendEntry(STATE_TYPE, added);
    return { messages };
  });
}

export function boundToolResult<T>(message: T, maxBytes = DEFAULT_TOOL_RESULT_BYTES): T {
  const candidate = message as CandidateToolResult;
  if (candidate.role !== "toolResult" || !candidate.toolName || !BOUNDED_TOOLS.has(candidate.toolName)) return message;
  if (!candidate.content || candidate.content.some((part) => part.type !== "text" || typeof part.text !== "string")) return message;

  const text = candidate.content.map((part) => part.text ?? "").join("\n");
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return message;

  const markerBytes = Buffer.byteLength(OMITTED_MARKER, "utf8");
  const available = Math.max(0, maxBytes - markerBytes);
  const head = utf8Prefix(text, Math.floor(available * 0.75));
  const tail = utf8Suffix(text, available - Buffer.byteLength(head, "utf8"));
  return {
    ...message as object,
    content: [{ type: "text", text: head + OMITTED_MARKER + tail } satisfies TextPart],
  } as T;
}

// True when the newest assistant reply is older than the cache lifetime, so the
// provider will rewrite the whole prompt whatever this request contains.
export function cacheExpired(messages: readonly unknown[], now: number): boolean {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index] as { role?: string; timestamp?: number };
    if (message.role === "assistant" && typeof message.timestamp === "number") {
      return now - message.timestamp > CACHE_LIFETIME_MS;
    }
  }
  return false;
}

// Freeze omissions by toolCallId, so a sent result keeps its bytes. Crossing the
// budget re-trims to half of it (or the newest result's size); each such re-trim
// invalidates the prompt prefix once. When the cache is already cold (idle past
// its lifetime or just compacted), re-trim to the same target as soon as retained
// text exceeds it: the prefix is rewritten anyway, so the headroom is free.
// Reuse the omission set across requests and restore it from the active branch.
export function boundInspectionResults<T>(
  messages: T[],
  maxBytes = DEFAULT_TOOL_RESULT_BYTES,
  totalBytes = DEFAULT_TOTAL_TOOL_RESULT_BYTES,
  omitted = new Set<string>(),
  cold = false,
): T[] {
  const bounded = messages.map((message) => boundToolResult(message, Math.min(maxBytes, totalBytes)));
  const inspections: Array<{ index: number; id: string; toolName: string; bytes: number }> = [];
  for (let index = 0; index < bounded.length; index++) {
    const message = bounded[index] as CandidateToolResult;
    if (message.role !== "toolResult" || !message.toolName || !BOUNDED_TOOLS.has(message.toolName)) continue;
    if (!message.content || message.content.some((part) => part.type !== "text" || typeof part.text !== "string")) continue;
    inspections.push({ index, id: message.toolCallId ?? `index:${index}`, toolName: message.toolName,
      bytes: Buffer.byteLength(message.content.map((part) => part.text ?? "").join("\n"), "utf8") });
  }
  const eligible = inspections.filter(({ id }) => !omitted.has(id));
  const retainedBytes = eligible.reduce((sum, result) => sum + result.bytes, 0);
  const target = Math.max(Math.floor(totalBytes / 2), eligible.at(-1)?.bytes ?? 0);
  if (retainedBytes > (cold ? target : totalBytes)) {
    let retained = 0;
    let evict = false;
    for (const result of eligible.slice().reverse()) {
      if (evict || retained + result.bytes > target) {
        evict = true;
        omitted.add(result.id);
      } else retained += result.bytes;
    }
  }
  for (const { index, id, toolName, bytes } of inspections) {
    if (omitted.has(id)) bounded[index] = stubResult(bounded[index] as object, toolName, bytes) as T;
  }
  return bounded;
}

function stubResult(message: object, toolName: string, bytes: number): object {
  return {
    ...message,
    content: [{
      type: "text",
      text: `[Context budget: earlier ${toolName} result (${bytes} bytes after per-result bounding) omitted. Re-run the recorded tool call if it is needed.]`,
    } satisfies TextPart],
  };
}

function configuredByteLimit(value: string | undefined): number {
  return configuredLimit(value, DEFAULT_TOOL_RESULT_BYTES, MIN_TOOL_RESULT_BYTES, MAX_TOOL_RESULT_BYTES);
}

function configuredTotalByteLimit(value: string | undefined): number {
  return configuredLimit(value, DEFAULT_TOTAL_TOOL_RESULT_BYTES, MIN_TOTAL_TOOL_RESULT_BYTES, MAX_TOTAL_TOOL_RESULT_BYTES);
}

function configuredLimit(value: string | undefined, defaultValue: number, minimum: number, maximum: number): number {
  if (!value) return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return defaultValue;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function utf8Prefix(text: string, maxBytes: number): string {
  let bytes = 0;
  let result = "";
  for (const character of text) {
    const width = Buffer.byteLength(character, "utf8");
    if (bytes + width > maxBytes) break;
    result += character;
    bytes += width;
  }
  return result;
}

function utf8Suffix(text: string, maxBytes: number): string {
  let bytes = 0;
  const result: string[] = [];
  for (const character of Array.from(text).reverse()) {
    const width = Buffer.byteLength(character, "utf8");
    if (bytes + width > maxBytes) break;
    result.push(character);
    bytes += width;
  }
  return result.reverse().join("");
}
