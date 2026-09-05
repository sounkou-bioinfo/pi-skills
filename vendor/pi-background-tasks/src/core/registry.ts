import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatSize } from "@earendil-works/pi-coding-agent";
import {
	boundedRead,
	deriveTaskNameFromCommand,
	escapeXml,
	formatAgentActivityLine,
	formatDuration,
	normalizeTaskName,
	parseAgentActivity,
	sanitizePathSegment,
	shellInvocation,
	shellQuote,
	snapshot,
	stripMatchingQuotes,
	taskDisplayName,
	type BgLogsDetails,
	type BgTask,
	type BgTaskSnapshot,
	type KillKind,
	type StartTaskOptions,
	type TaskContextUsage,
	type TaskStatus,
	type TaskTokenUsage,
	type TaskToolUsage,
} from "./common.js";

export const MAX_OUTPUT_BYTES = Number(process.env["PI_BG_MAX_OUTPUT_BYTES"] ?? 20 * 1024 * 1024);
export const KILL_GRACE_MS = 3000;
export const STOP_WAIT_MS = KILL_GRACE_MS + 1500;
export const MAX_RECENT_TASKS = 100;
const TELEMETRY_BUFFER_CHARS = 512 * 1024;

export type BackgroundTaskContext = {
	cwd: string;
	sessionId?: string;
	modelRegistry: Pick<ExtensionContext["modelRegistry"], "getAll">;
	model?: ExtensionContext["model"] | undefined;
};

type OutputEventSource = { on(event: "data", listener: (data: Buffer | string) => void): unknown };

export type BackgroundTaskChildProcess = {
	pid?: number | undefined;
	stdout?: OutputEventSource | null | undefined;
	stderr?: OutputEventSource | null | undefined;
	kill(signal?: NodeJS.Signals | string | number): boolean;
	on(event: "error", listener: (error: Error) => void): unknown;
	on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
};
export type BackgroundTaskSpawn = (command: string, args: string[], options: SpawnOptions) => BackgroundTaskChildProcess;
type KillProcessFn = (pid: number, signal?: NodeJS.Signals | number) => boolean;

export type CompletionNotificationMessage = {
	customType: "background-task-notification";
	content: string;
	display: true;
	details: BgTaskSnapshot;
};

export type CompletionNotificationOptions = {
	deliverAs: "followUp";
	triggerTurn: boolean;
};

export type CompletionNotificationSender = (
	message: CompletionNotificationMessage,
	options: CompletionNotificationOptions,
) => void;

export type BackgroundTaskRegistryOptions = {
	onChange?: () => void;
	sendCompletionNotification: CompletionNotificationSender;
	spawn?: BackgroundTaskSpawn;
	killProcess?: KillProcessFn;
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	makeTaskId?: () => string;
	now?: () => number;
	maxOutputBytes?: number;
	maxRecentTasks?: number;
	killGraceMs?: number;
	stopWaitMs?: number;
	logger?: Pick<Console, "error">;
};

type RuntimeDir = { abs: string; display: string };

type ModelWindowIndex = {
	byQualifiedId: Record<string, number>;
	byId: Record<string, number>;
	defaultModel?: string | undefined;
	defaultProvider?: string | undefined;
	defaultContextWindow?: number | undefined;
};

function defaultTaskId(): string {
	return `b${randomBytes(4).toString("hex")}`;
}

export function commandMayLaunchPiAgent(command: string, env: NodeJS.ProcessEnv = process.env): boolean {
	if (env["PI_BG_DISABLE_PI_TELEMETRY"] === "1") return false;
	return /(^|[\s;&|()])pi(?=\s)(?=[^\n;&|]*(?:\s-p(?:\s|$)|\s--print(?:\s|$)|\s--mode(?:=|\s+)json\b))/m.test(command);
}

export function buildModelWindowIndex(ctx: Pick<BackgroundTaskContext, "modelRegistry" | "model">): ModelWindowIndex {
	const byQualifiedId: Record<string, number> = {};
	const candidatesById = new Map<string, Set<number>>();
	for (const model of ctx.modelRegistry.getAll()) {
		const contextWindow = typeof model.contextWindow === "number" && Number.isFinite(model.contextWindow) && model.contextWindow > 0
			? Math.floor(model.contextWindow)
			: undefined;
		if (!contextWindow) continue;
		byQualifiedId[`${model.provider}/${model.id}`] = contextWindow;
		let candidates = candidatesById.get(model.id);
		if (!candidates) {
			candidates = new Set<number>();
			candidatesById.set(model.id, candidates);
		}
		candidates.add(contextWindow);
	}
	const byId: Record<string, number> = {};
	for (const [id, windows] of candidatesById) {
		const onlyWindow = windows.values().next();
		if (windows.size === 1 && !onlyWindow.done) byId[id] = onlyWindow.value;
	}
	const current = ctx.model;
	return {
		byQualifiedId,
		byId,
		defaultModel: current?.id,
		defaultProvider: current?.provider,
		defaultContextWindow: current?.contextWindow,
	};
}

export function createPiTelemetryWrapperSource(index: ModelWindowIndex): string {
	return `#!/usr/bin/env node
const { spawn } = require("node:child_process");
const index = ${JSON.stringify(index)};

const tokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
let costTotal = 0;
let hasCostTotal = false;
let agentModel;
const toolUsage = { total: 0, failed: 0, byName: {} };
const seenToolCallIds = new Set();
const failedToolCallIds = new Set();

function nonNegativeInteger(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function normalizeUsage(usage) {
  if (!usage) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
  const input = nonNegativeInteger(usage.input);
  const output = nonNegativeInteger(usage.output);
  const cacheRead = nonNegativeInteger(usage.cacheRead);
  const cacheWrite = nonNegativeInteger(usage.cacheWrite);
  const explicitTotal = nonNegativeInteger(usage.totalTokens);
  const totalTokens = explicitTotal || (input + output + cacheRead + cacheWrite);
  const cost = usage.cost && typeof usage.cost.total === "number" && Number.isFinite(usage.cost.total) && usage.cost.total >= 0
    ? usage.cost.total
    : undefined;
  return { input, output, cacheRead, cacheWrite, totalTokens, cost };
}

function addTokenUsage(usage) {
  const normalized = normalizeUsage(usage);
  if (!normalized.totalTokens) return normalized;
  tokenUsage.input += normalized.input;
  tokenUsage.output += normalized.output;
  tokenUsage.cacheRead += normalized.cacheRead;
  tokenUsage.cacheWrite += normalized.cacheWrite;
  tokenUsage.totalTokens += normalized.totalTokens;
  if (normalized.cost !== undefined) {
    costTotal += normalized.cost;
    hasCostTotal = true;
  }
  return normalized;
}

function currentTokenUsage() {
  if (!tokenUsage.totalTokens) return undefined;
  const out = { ...tokenUsage };
  if (hasCostTotal) out.costTotal = costTotal;
  return out;
}

function markToolStarted(id, name) {
  const key = id ? String(id) : undefined;
  if (key && seenToolCallIds.has(key)) return;
  if (key) seenToolCallIds.add(key);
  const toolName = name ? String(name) : "unknown";
  toolUsage.total += 1;
  toolUsage.byName[toolName] = (toolUsage.byName[toolName] || 0) + 1;
}

function markToolFailed(id) {
  const key = id ? String(id) : undefined;
  if (key && failedToolCallIds.has(key)) return;
  if (key) failedToolCallIds.add(key);
  toolUsage.failed += 1;
}

function currentToolUsage() {
  if (!toolUsage.total && !toolUsage.failed) return undefined;
  return { total: toolUsage.total, failed: toolUsage.failed, byName: { ...toolUsage.byName } };
}

function emitUnifiedTelemetry(payload) {
  const out = { type: "background-task-telemetry", ...payload };
  const tokens = currentTokenUsage();
  const tools = currentToolUsage();
  if (tokens && !out.tokenUsage) out.tokenUsage = tokens;
  if (tools && !out.toolUsage) out.toolUsage = tools;
  if (agentModel && !out.model) out.model = agentModel;
  process.stdout.write(JSON.stringify(out) + "\\n");
}

function emitActivity(activity) {
  process.stdout.write(JSON.stringify({ type: "background-task-activity", ...activity }) + "\\n");
}

function summarizeArgs(args) {
  if (!args || typeof args !== "object") return "";
  const pick = (value) => {
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 200);
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return undefined;
  };
  const preferred = ["path", "file_path", "file", "filename", "command", "cmd", "pattern", "query", "url", "name", "value", "text", "message"];
  for (const key of preferred) { const summary = pick(args[key]); if (summary) return summary; }
  for (const key of Object.keys(args)) { const summary = pick(args[key]); if (summary) return summary; }
  return "";
}

function emitAssistantActivity(message) {
  const content = message && Array.isArray(message.content) ? message.content : [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
      emitActivity({ kind: "assistant_text", text: part.text });
    } else if (part.type === "thinking" || part.type === "reasoning") {
      const text = typeof part.text === "string" ? part.text : (typeof part.thinking === "string" ? part.thinking : "");
      if (text.trim()) emitActivity({ kind: "reasoning", text: text });
    }
  }
}

function resolveModelName(fromMessage, fromArgs, providerFromArgs) {
  const message = fromMessage ? String(fromMessage) : "";
  const args = fromArgs ? String(fromArgs) : "";
  const bareOf = (value) => value.includes("/") ? value.split("/").pop() : value;
  if (message && message.includes("/")) return message;
  if (args && args.includes("/") && (!message || bareOf(args) === message)) return args;
  const primary = message || args;
  if (!primary) return undefined;
  if (primary.includes("/")) return primary;
  if (providerFromArgs) return providerFromArgs + "/" + primary;
  if (index.defaultProvider) return index.defaultProvider + "/" + primary;
  return primary;
}

function parseInvocation(argv) {
  const out = [];
  let model;
  let provider;
  let hasMode = false;
  let modeValue;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-p" || arg === "--print") continue;
    if (arg === "--mode") {
      hasMode = true;
      modeValue = argv[i + 1];
      out.push(arg);
      if (i + 1 < argv.length) out.push(argv[++i]);
      continue;
    }
    if (arg.startsWith("--mode=")) {
      hasMode = true;
      modeValue = arg.slice("--mode=".length);
      out.push(arg);
      continue;
    }
    if (arg === "--model" && i + 1 < argv.length) {
      model = argv[i + 1];
      out.push(arg, argv[++i]);
      continue;
    }
    if (arg.startsWith("--model=")) model = arg.slice("--model=".length);
    if (arg === "--provider" && i + 1 < argv.length) {
      provider = argv[i + 1];
      out.push(arg, argv[++i]);
      continue;
    }
    if (arg.startsWith("--provider=")) provider = arg.slice("--provider=".length);
    out.push(arg);
  }
  if (hasMode && modeValue !== "json") return { args: argv, parseJson: false, model, provider };
  if (!hasMode) out.unshift("--mode", "json");
  return { args: out, parseJson: true, model, provider };
}

function resolveWindow(modelFromArgs, providerFromArgs, modelFromMessage) {
  const candidates = [];
  if (modelFromMessage) candidates.push(modelFromMessage);
  if (modelFromArgs) candidates.push(modelFromArgs);
  if (modelFromArgs && providerFromArgs && !modelFromArgs.includes("/")) candidates.push(providerFromArgs + "/" + modelFromArgs);
  if (modelFromArgs && index.defaultProvider && !modelFromArgs.includes("/")) candidates.push(index.defaultProvider + "/" + modelFromArgs);
  if (index.defaultModel && index.defaultProvider) candidates.push(index.defaultProvider + "/" + index.defaultModel);
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (index.byQualifiedId[candidate]) return index.byQualifiedId[candidate];
    const bare = String(candidate).includes("/") ? String(candidate).split("/").pop() : String(candidate);
    if (bare && index.byId[bare]) return index.byId[bare];
  }
  return index.defaultContextWindow || 0;
}

function countToolCallsFromMessage(message) {
  const content = message && Array.isArray(message.content) ? message.content : [];
  for (const part of content) {
    if (part && part.type === "toolCall") markToolStarted(part.id, part.name);
  }
}

function emitMessageTelemetry(message, modelFromArgs, providerFromArgs) {
  const usage = addTokenUsage(message && message.usage);
  const resolvedModel = resolveModelName(message && message.model, modelFromArgs, providerFromArgs);
  if (resolvedModel) agentModel = resolvedModel;
  const contextWindow = resolveWindow(modelFromArgs, providerFromArgs, message && message.model);
  const contextUsage = usage.totalTokens && contextWindow
    ? { tokens: usage.totalTokens, contextWindow, percent: (usage.totalTokens / contextWindow) * 100 }
    : undefined;
  if (contextUsage) process.stdout.write(JSON.stringify({ type: "background-task-context-usage", ...contextUsage }) + "\\n");
  const payload = {};
  if (contextUsage) payload.contextUsage = contextUsage;
  emitUnifiedTelemetry(payload);
}

function emitToolTelemetry() {
  emitUnifiedTelemetry({});
}

const parsed = parseInvocation(process.argv.slice(2));
const child = spawn("pi", parsed.args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
let buffer = "";

if (!parsed.parseJson) {
  child.stdout.pipe(process.stdout);
} else {
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\\n");
    buffer = lines.pop() || "";
    for (const line of lines) processLine(line);
  });
}
child.stderr.on("data", (chunk) => process.stderr.write(chunk));
child.on("error", (error) => {
  process.stderr.write("[pi-bg telemetry wrapper error: " + error.message + "]\\n");
});
child.on("close", (code, signal) => {
  if (parsed.parseJson && buffer.trim()) processLine(buffer);
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

function processLine(line) {
  if (!line.trim()) return;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    process.stdout.write(line + "\\n");
    return;
  }
  if (event.type === "tool_execution_start") {
    const toolName = event.toolName || event.tool_name || "tool";
    markToolStarted(event.toolCallId || event.tool_call_id, toolName);
    emitActivity({ kind: "tool_start", tool: String(toolName), argsSummary: summarizeArgs(event.args || event.arguments || event.input || event.parameters) });
    emitToolTelemetry();
    return;
  }
  if (event.type === "tool_execution_end") {
    const toolName = event.toolName || event.tool_name || "tool";
    if (event.isError) markToolFailed(event.toolCallId || event.tool_call_id);
    emitActivity({ kind: "tool_end", tool: String(toolName), isError: !!event.isError, error: typeof event.error === "string" ? event.error : undefined });
    emitToolTelemetry();
    return;
  }
  if (event.type === "message_end" && event.message && event.message.role === "assistant") {
    emitAssistantActivity(event.message);
    countToolCallsFromMessage(event.message);
    emitMessageTelemetry(event.message, parsed.model, parsed.provider);
  }
}
`;
}

function normalizeContextUsage(value: unknown): TaskContextUsage | undefined {
	if (!value || typeof value !== "object") return undefined;
	const input = value as Record<string, unknown>;
	const rawContextWindow = input["contextWindow"];
	const contextWindow = typeof rawContextWindow === "number" && Number.isFinite(rawContextWindow) && rawContextWindow > 0
		? Math.floor(rawContextWindow)
		: undefined;
	if (!contextWindow) return undefined;
	const rawTokens = input["tokens"];
	const tokens = rawTokens === null
		? null
		: typeof rawTokens === "number" && Number.isFinite(rawTokens) && rawTokens >= 0
			? Math.floor(rawTokens)
			: null;
	const rawPercent = input["percent"];
	const percent = rawPercent === null
		? null
		: typeof rawPercent === "number" && Number.isFinite(rawPercent) && rawPercent >= 0
			? rawPercent
			: tokens === null
				? null
				: (tokens / contextWindow) * 100;
	return { tokens, contextWindow, percent };
}

function parseContextUsageXml(xml: string): TaskContextUsage | undefined {
	const readNumber = (tag: string): number | null | undefined => {
		const match = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`, "i"));
		if (!match) return undefined;
		const raw = match[1]?.trim();
		if (raw === "null" || raw === "?") return null;
		const parsed = Number(raw);
		return Number.isFinite(parsed) ? parsed : undefined;
	};
	const tokens = readNumber("tokens");
	const contextWindow = readNumber("context-window") ?? readNumber("contextWindow");
	const percent = readNumber("percent");
	return normalizeContextUsage({ tokens, contextWindow, percent });
}

function nonNegativeInteger(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function normalizeModel(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	return trimmed.length > 120 ? trimmed.slice(0, 120) : trimmed;
}

function normalizeTokenUsage(value: unknown): TaskTokenUsage | undefined {
	if (!value || typeof value !== "object") return undefined;
	const input = value as Record<string, unknown>;
	const usage: TaskTokenUsage = {
		input: nonNegativeInteger(input["input"]),
		output: nonNegativeInteger(input["output"]),
		cacheRead: nonNegativeInteger(input["cacheRead"]),
		cacheWrite: nonNegativeInteger(input["cacheWrite"]),
		totalTokens: nonNegativeInteger(input["totalTokens"]),
	};
	if (!usage.totalTokens) usage.totalTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
	const rawCostTotal = input["costTotal"];
	if (typeof rawCostTotal === "number" && Number.isFinite(rawCostTotal) && rawCostTotal >= 0) usage.costTotal = rawCostTotal;
	return usage.totalTokens > 0 ? usage : undefined;
}

function normalizeToolUsage(value: unknown): TaskToolUsage | undefined {
	if (!value || typeof value !== "object") return undefined;
	const input = value as Record<string, unknown>;
	const byName: Record<string, number> = {};
	const rawByName = input["byName"];
	if (rawByName && typeof rawByName === "object") {
		for (const [name, count] of Object.entries(rawByName)) {
			const normalized = nonNegativeInteger(count);
			if (normalized > 0) byName[name] = normalized;
		}
	}
	const byNameTotal = Object.values(byName).reduce((sum, count) => sum + count, 0);
	const failed = nonNegativeInteger(input["failed"]);
	const total = Math.max(nonNegativeInteger(input["total"]), byNameTotal, failed);
	return total > 0 || failed > 0 ? { total, failed, byName } : undefined;
}

type TelemetryDelta = {
	context?: TaskContextUsage | undefined;
	tokens?: TaskTokenUsage | undefined;
	tools?: TaskToolUsage | undefined;
	model?: string | undefined;
};

export class BackgroundTaskRegistry {
	private readonly tasks = new Map<string, BgTask>();
	private runtimeDir: RuntimeDir | undefined;
	private shuttingDown = false;
	private readonly spawn: BackgroundTaskSpawn;
	private readonly killProcess: KillProcessFn;
	private readonly platform: NodeJS.Platform;
	private readonly env: NodeJS.ProcessEnv;
	private readonly makeTaskIdFn: () => string;
	private readonly now: () => number;
	private readonly maxOutputBytes: number;
	private readonly maxRecentTasks: number;
	private readonly killGraceMs: number;
	private readonly stopWaitMs: number;
	private readonly logger: Pick<Console, "error">;
	private readonly onChange: () => void;
	private readonly sendCompletionNotification: CompletionNotificationSender;

	constructor(options: BackgroundTaskRegistryOptions) {
		this.spawn = options.spawn ?? ((command, args, spawnOptions) => nodeSpawn(command, args, spawnOptions));
		this.killProcess = options.killProcess ?? process.kill.bind(process);
		this.platform = options.platform ?? process.platform;
		this.env = options.env ?? process.env;
		this.makeTaskIdFn = options.makeTaskId ?? defaultTaskId;
		this.now = options.now ?? Date.now;
		this.maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES;
		this.maxRecentTasks = options.maxRecentTasks ?? MAX_RECENT_TASKS;
		this.killGraceMs = options.killGraceMs ?? KILL_GRACE_MS;
		this.stopWaitMs = options.stopWaitMs ?? STOP_WAIT_MS;
		this.logger = options.logger ?? console;
		this.onChange = options.onChange ?? (() => {});
		this.sendCompletionNotification = options.sendCompletionNotification;
	}

	isShuttingDown(): boolean {
		return this.shuttingDown;
	}

	setShuttingDown(value: boolean): void {
		this.shuttingDown = value;
	}

	allTasks(): BgTask[] {
		return [...this.tasks.values()];
	}

	snapshot(task: BgTask): BgTaskSnapshot {
		return snapshot(task);
	}

	async ensureRuntimeDir(ctx: BackgroundTaskContext): Promise<RuntimeDir> {
		if (!this.runtimeDir) {
			const sessionId = sanitizePathSegment(ctx.sessionId ?? `session-${process.pid}`);
			const runId = `${sessionId}-${process.pid}`;
			this.runtimeDir = {
				abs: join(ctx.cwd, ".pi", "tasks", runId),
				display: join(".pi", "tasks", runId),
			};
		}
		await mkdir(this.runtimeDir.abs, { recursive: true });
		return this.runtimeDir;
	}

	async startTask(ctx: BackgroundTaskContext, command: string, options: StartTaskOptions = {}): Promise<BgTask> {
		const normalizedCommand = stripMatchingQuotes(command);
		if (!normalizedCommand) throw new Error("Background command is empty");
		if (this.shuttingDown) throw new Error("Cannot start a background task while Pi is shutting down");

		const dir = await this.ensureRuntimeDir(ctx);
		const id = this.makeTaskIdFn();
		const outputAbsPath = join(dir.abs, `${id}.output`);
		const metadataAbsPath = join(dir.abs, `${id}.json`);
		const outputPath = join(dir.display, `${id}.output`);
		const timeoutSeconds =
			typeof options.timeoutSeconds === "number" && Number.isFinite(options.timeoutSeconds) && options.timeoutSeconds > 0
				? Math.floor(options.timeoutSeconds)
				: undefined;
		const taskName = normalizeTaskName(options.name) ?? normalizeTaskName(options.description) ?? deriveTaskNameFromCommand(normalizedCommand);
		const isAgent = options.isAgent ?? false;

		const task: BgTask = {
			id,
			name: taskName,
			command: normalizedCommand,
			description: options.description?.trim() || undefined,
			status: "running",
			outputPath,
			outputAbsPath,
			metadataAbsPath,
			cwd: ctx.cwd,
			startTime: this.now(),
			exitCode: undefined,
			pid: undefined,
			bytesWritten: 0,
			isAgent,
			notified: false,
			notifyOnCompletion: options.notifyOnCompletion ?? true,
			triggerOnCompletion: options.triggerOnCompletion ?? false,
			timeoutSeconds,
			waiters: [],
		};
		this.tasks.set(id, task);

		const stream = createWriteStream(outputAbsPath, { flags: "a", encoding: "utf8" });
		task.stream = stream;
		stream.on("error", (error) => {
			task.error = `Output file write failed: ${error.message}`;
			if (task.status === "running") {
				task.killKind = "output_cap";
				try {
					this.requestKill(task, "SIGTERM");
				} catch (killError) {
					void this.finalizeTask(
						task,
						"failed",
						null,
						undefined,
						`${task.error}; kill failed: ${killError instanceof Error ? killError.message : String(killError)}`,
					);
				}
			}
		});

		try {
			let commandToSpawn = normalizedCommand;
			if (isAgent && commandMayLaunchPiAgent(normalizedCommand, this.env)) {
				const wrapperAbsPath = join(dir.abs, `${id}.pi-telemetry-wrapper.cjs`);
				await writeFile(wrapperAbsPath, createPiTelemetryWrapperSource(buildModelWindowIndex(ctx)), "utf8");
				commandToSpawn = `pi() { node ${shellQuote(wrapperAbsPath)} "$@"; }\n${normalizedCommand}`;
				task.telemetryWrapped = true;
			}
			const invocation = shellInvocation(commandToSpawn, this.platform, this.env);
			const child = this.spawn(invocation.shell, invocation.args, {
				cwd: ctx.cwd,
				detached: this.platform !== "win32",
				stdio: ["ignore", "pipe", "pipe"],
				env: this.env,
				windowsHide: true,
			});

			task.child = child;
			task.pid = child.pid;

			child.stdout?.on("data", (data) => this.appendChildOutput(task, data, "stdout"));
			child.stderr?.on("data", (data) => this.appendChildOutput(task, data, "stderr"));

			child.on("error", (error) => {
				this.writeNotice(task, `\n[background task spawn error: ${error.message}]\n`);
				void this.finalizeTask(task, "failed", null, undefined, error.message);
			});

			child.on("close", (code, signalName) => {
				let status: TaskStatus;
				let error: string | undefined;
				if (task.killKind === "user" || task.killKind === "shutdown") {
					status = "killed";
				} else if (task.killKind === "timeout") {
					status = "failed";
					error = task.error || `Timed out after ${task.timeoutSeconds}s`;
				} else if (task.killKind === "output_cap") {
					status = "failed";
					error = task.error || `Output exceeded cap of ${formatSize(this.maxOutputBytes)}`;
				} else if (code === 0 && !signalName) {
					status = "completed";
				} else {
					status = "failed";
					error = `Exited with code ${code ?? "null"}${signalName ? ` (${signalName})` : ""}`;
				}
				void this.finalizeTask(task, status, code, signalName, error);
			});

			if (timeoutSeconds) {
				task.timeoutHandle = setTimeout(() => {
					if (task.status !== "running") return;
					task.killKind = "timeout";
					task.error = `Timed out after ${timeoutSeconds}s`;
					this.writeNotice(task, `\n[background task timeout: ${task.error}]\n`);
					try {
						this.requestKill(task, "SIGTERM");
					} catch (error) {
						void this.finalizeTask(task, "failed", null, undefined, `${task.error}; kill failed: ${error instanceof Error ? error.message : String(error)}`);
					}
				}, timeoutSeconds * 1000);
			}

			await this.writeMetadata(task);
			this.onChange();
			return task;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.writeNotice(task, `\n[background task spawn exception: ${message}]\n`);
			await this.finalizeTask(task, "failed", null, undefined, message);
			throw new Error(`Failed to start background task: ${message}`);
		}
	}

	resolveTask(idOrPrefix: string): BgTask {
		const id = idOrPrefix.trim();
		if (!id) throw new Error("Task ID is required");
		const exact = this.tasks.get(id);
		if (exact) return exact;
		const matches = [...this.tasks.values()].filter((task) => task.id.startsWith(id));
		const onlyMatch = matches[0];
		if (matches.length === 1 && onlyMatch) return onlyMatch;
		if (matches.length > 1) throw new Error(`Ambiguous task ID prefix "${id}": ${matches.map((task) => task.id).join(", ")}`);
		throw new Error(`Unknown background task ID: ${id}`);
	}

	async stopTask(task: BgTask, kind: KillKind, reason?: string): Promise<BgTask> {
		if (task.status !== "running") {
			throw new Error(`Task ${task.id} is ${task.status}, not running`);
		}
		task.killKind = kind;
		if (reason) task.error = reason;
		this.requestKill(task, "SIGTERM");
		const stopped = await this.waitForEnd(task, this.stopWaitMs);
		if (!stopped) {
			throw new Error(`Task ${task.id} did not exit within ${formatDuration(this.stopWaitMs)} after SIGTERM/SIGKILL`);
		}
		return task;
	}

	async stopAllRunning(kind: KillKind, reason?: string): Promise<{ stopped: number; failures: string[] }> {
		const running = this.allTasks().filter((task) => task.status === "running");
		const failures: string[] = [];
		let stopped = 0;
		await Promise.all(
			running.map(async (task) => {
				try {
					await this.stopTask(task, kind, reason);
					stopped++;
				} catch (error) {
					failures.push(`${taskDisplayName(task)} (${task.id}): ${error instanceof Error ? error.message : String(error)}`);
				}
			}),
		);
		return { stopped, failures };
	}

	async getTaskLogs(task: BgTask, maxBytes: number, tail: boolean): Promise<{ text: string; details: BgLogsDetails }> {
		if (!existsSync(task.outputAbsPath)) {
			throw new Error(`Output file does not exist for ${task.id}: ${task.outputPath}`);
		}
		const read = await boundedRead(task.outputAbsPath, maxBytes, tail);
		const direction = tail ? "tail" : "head";
		let text = read.content || "(no output yet)";
		if (read.truncated) {
			const omitted = read.totalBytes - read.bytesRead;
			const notice = `\n\n[Showing ${direction} ${formatSize(read.bytesRead)} of ${formatSize(read.totalBytes)}; ${formatSize(omitted)} omitted. Full output: ${task.outputPath}]`;
			text = tail ? `${notice}\n\n${text}` : `${text}${notice}`;
		} else {
			text += `\n\n[Full output: ${task.outputPath}]`;
		}
		return {
			text,
			details: {
				task: snapshot(task),
				path: task.outputPath,
				bytesRead: read.bytesRead,
				truncated: read.truncated,
				tail,
			},
		};
	}

	private async writeMetadata(task: BgTask): Promise<void> {
		await writeFile(task.metadataAbsPath, `${JSON.stringify(snapshot(task), null, 2)}\n`, "utf8");
	}

	private ingestTelemetry(task: BgTask, text: string): void {
		if (!text) return;
		const telemetryText = `${task.contextUsageBuffer ?? ""}${text}`;
		let latestContext = task.contextUsage;
		let latestTokens = task.tokenUsage;
		let latestTools = task.toolUsage;
		let latestModel = task.model;
		for (const line of telemetryText.split(/\r?\n/)) {
			if (!line.includes("background-task-")) continue;
			const trimmed = line.trim();
			if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
				try {
					const parsed = JSON.parse(trimmed);
					if (parsed?.type === "background-task-context-usage") {
						latestContext = normalizeContextUsage(parsed) ?? latestContext;
					} else if (parsed?.type === "background-task-telemetry") {
						latestContext = normalizeContextUsage(parsed.contextUsage) ?? latestContext;
						latestTokens = normalizeTokenUsage(parsed.tokenUsage) ?? latestTokens;
						latestTools = normalizeToolUsage(parsed.toolUsage) ?? latestTools;
						latestModel = normalizeModel(parsed.model) ?? latestModel;
					}
				} catch {
					// Ignore malformed optional telemetry; task output remains authoritative for debugging.
				}
			}
		}
		const xmlMatches = telemetryText.matchAll(/<background-task-context-usage>[\s\S]*?<\/background-task-context-usage>/gi);
		for (const match of xmlMatches) latestContext = parseContextUsageXml(match[0]) ?? latestContext;

		const lastNewline = Math.max(telemetryText.lastIndexOf("\n"), telemetryText.lastIndexOf("\r"));
		let retained = lastNewline >= 0 ? telemetryText.slice(lastNewline + 1) : telemetryText;
		const lastXmlOpen = telemetryText.toLowerCase().lastIndexOf("<background-task-context-usage");
		const lastXmlClose = telemetryText.toLowerCase().lastIndexOf("</background-task-context-usage>");
		if (lastXmlOpen > lastXmlClose) retained = telemetryText.slice(lastXmlOpen);
		task.contextUsageBuffer = retained.slice(-TELEMETRY_BUFFER_CHARS);

		this.commitTelemetry(task, { context: latestContext, tokens: latestTokens, tools: latestTools, model: latestModel });
	}

	/** Apply the latest parsed telemetry to a task, persisting metadata and notifying the UI only on change. */
	private commitTelemetry(task: BgTask, next: TelemetryDelta): void {
		const before = JSON.stringify({ contextUsage: task.contextUsage, tokenUsage: task.tokenUsage, toolUsage: task.toolUsage, model: task.model });
		if (next.context !== undefined) task.contextUsage = next.context;
		if (next.tokens !== undefined) task.tokenUsage = next.tokens;
		if (next.tools !== undefined) task.toolUsage = next.tools;
		if (next.model !== undefined) task.model = next.model;
		const after = JSON.stringify({ contextUsage: task.contextUsage, tokenUsage: task.tokenUsage, toolUsage: task.toolUsage, model: task.model });
		if (before !== after) {
			this.onChange();
			void this.writeMetadata(task).catch((error) => {
				this.logger.error(`[background-tasks] failed to write telemetry metadata for ${task.id}:`, error);
			});
		}
	}

	/** Cap-enforcing sink for all persisted task output; terminates the task once the byte cap is exceeded. */
	private writeToStream(task: BgTask, buffer: Buffer): void {
		if (!task.stream || task.stream.destroyed) return;
		if (buffer.length === 0) return;

		const nextBytes = task.bytesWritten + buffer.length;
		if (nextBytes <= this.maxOutputBytes) {
			task.stream.write(buffer);
			task.bytesWritten = nextBytes;
			return;
		}

		const remaining = Math.max(0, this.maxOutputBytes - task.bytesWritten);
		if (remaining > 0) {
			task.stream.write(buffer.subarray(0, remaining));
			task.bytesWritten += remaining;
		}

		if (!task.capExceeded) {
			task.capExceeded = true;
			task.error = `Output exceeded cap of ${formatSize(this.maxOutputBytes)}; terminating task`;
			const notice = `\n\n[background task error: ${task.error}]\n`;
			task.stream.write(notice);
			task.bytesWritten += Buffer.byteLength(notice, "utf8");
			task.killKind = "output_cap";
			try {
				this.requestKill(task, "SIGTERM");
			} catch (error) {
				task.error = `${task.error}; kill failed: ${error instanceof Error ? error.message : String(error)}`;
				void this.finalizeTask(task, "failed", null, undefined, task.error);
			}
		}
	}

	/** Persist an internally generated notice (spawn/timeout/cap diagnostics) verbatim. */
	private writeNotice(task: BgTask, text: string): void {
		if (!text) return;
		this.writeToStream(task, Buffer.from(text, "utf8"));
	}

	private appendChildOutput(task: BgTask, data: Buffer | string, source: "stdout" | "stderr"): void {
		if (!task.stream || task.stream.destroyed) return;
		const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
		if (buffer.length === 0) return;
		if (task.telemetryWrapped) {
			// Wrapped Pi agents stream control lines on stdout (telemetry + activity); child
			// stderr is raw diagnostics and is always passed through to the transcript verbatim.
			if (source === "stdout") this.processAgentStdout(task, buffer.toString("utf8"));
			else this.writeToStream(task, buffer);
			return;
		}
		this.ingestTelemetry(task, buffer.toString("utf8"));
		this.writeToStream(task, buffer);
	}

	/** Reconstruct wrapped-agent stdout into whole control lines, routing telemetry to metrics and activity to the transcript. */
	private processAgentStdout(task: BgTask, text: string): void {
		const buffered = `${task.agentStdoutBuffer ?? ""}${text}`;
		const lastNewline = buffered.lastIndexOf("\n");
		task.agentStdoutBuffer = lastNewline >= 0 ? buffered.slice(lastNewline + 1) : buffered;
		if (lastNewline < 0) return;
		const latest: TelemetryDelta = {};
		for (const line of buffered.slice(0, lastNewline).split("\n")) this.consumeAgentLine(task, line, latest);
		this.commitTelemetry(task, latest);
	}

	/** Flush a trailing partial wrapped-agent line on finalize so the last transcript fragment is never lost. */
	private flushAgentStdout(task: BgTask): void {
		const remainder = task.agentStdoutBuffer;
		if (!remainder) return;
		task.agentStdoutBuffer = "";
		const latest: TelemetryDelta = {};
		this.consumeAgentLine(task, remainder, latest);
		this.commitTelemetry(task, latest);
	}

	private consumeAgentLine(task: BgTask, rawLine: string, latest: TelemetryDelta): void {
		const line = rawLine.replace(/\r$/, "");
		const trimmed = line.trim();
		if (!trimmed) return;
		if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
			this.writeNotice(task, `${line}\n`);
			return;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			this.writeNotice(task, `${line}\n`);
			return;
		}
		if (typeof parsed !== "object" || parsed === null) {
			this.writeNotice(task, `${line}\n`);
			return;
		}
		const record = parsed as Record<string, unknown>;
		const type = record["type"];
		if (type === "background-task-context-usage") {
			const context = normalizeContextUsage(parsed);
			if (context) latest.context = context;
			return;
		}
		if (type === "background-task-telemetry") {
			const context = normalizeContextUsage(record["contextUsage"]);
			if (context) latest.context = context;
			const tokens = normalizeTokenUsage(record["tokenUsage"]);
			if (tokens) latest.tokens = tokens;
			const tools = normalizeToolUsage(record["toolUsage"]);
			if (tools) latest.tools = tools;
			const model = normalizeModel(record["model"]);
			if (model) latest.model = model;
			return;
		}
		const activity = parseAgentActivity(parsed);
		if (activity) {
			const formatted = formatAgentActivityLine(activity);
			if (formatted) this.writeNotice(task, `${formatted}\n`);
			return;
		}
		// Unknown JSON object: pass through to the transcript rather than silently dropping it.
		this.writeNotice(task, `${line}\n`);
	}

	private requestKill(task: BgTask, signal: NodeJS.Signals = "SIGTERM"): void {
		if (task.status !== "running") {
			throw new Error(`Task ${task.id} is ${task.status}, not running`);
		}
		if (!task.child) {
			throw new Error(`Task ${task.id} has no child process handle`);
		}
		if (!task.pid) {
			throw new Error(`Task ${task.id} has no process id`);
		}
		if (task.killSignalSent && signal === "SIGTERM") return;

		const errors: string[] = [];
		let killed = false;

		if (this.platform !== "win32") {
			try {
				this.killProcess(-task.pid, signal);
				killed = true;
			} catch (error) {
				errors.push(`process group kill failed: ${error instanceof Error ? error.message : String(error)}`);
			}
		}

		if (!killed) {
			try {
				task.child.kill(signal);
				killed = true;
			} catch (error) {
				errors.push(`child kill failed: ${error instanceof Error ? error.message : String(error)}`);
			}
		}

		if (!killed) {
			throw new Error(`Could not kill task ${task.id}: ${errors.join("; ")}`);
		}

		task.killSignalSent = true;
		setTimeout(() => {
			if (task.status !== "running") return;
			try {
				this.requestKill(task, "SIGKILL");
			} catch (error) {
				task.error = `SIGKILL failed: ${error instanceof Error ? error.message : String(error)}`;
				void this.writeMetadata(task).catch((metadataError) => {
					this.logger.error(`[background-tasks] failed to write metadata for ${task.id}:`, metadataError);
				});
			}
		}, this.killGraceMs).unref?.();
	}

	private waitForEnd(task: BgTask, timeoutMs: number): Promise<boolean> {
		if (task.status !== "running") return Promise.resolve(true);
		return new Promise((resolve) => {
			const timeout = setTimeout(() => {
				const idx = task.waiters.indexOf(done);
				if (idx >= 0) task.waiters.splice(idx, 1);
				resolve(false);
			}, timeoutMs);
			const done = () => {
				clearTimeout(timeout);
				resolve(true);
			};
			task.waiters.push(done);
		});
	}

	private async notifyCompletion(task: BgTask): Promise<void> {
		if (!task.notifyOnCompletion || task.notified || this.shuttingDown) return;
		task.notified = true;
		const exit = task.exitCode === undefined ? "" : `\n  <exit-code>${task.exitCode}</exit-code>`;
		const error = task.error ? `\n  <error>${escapeXml(task.error)}</error>` : "";
		const taskName = taskDisplayName(task);
		const content = [
			"<background-task-notification>",
			`  <task-id>${task.id}</task-id>`,
			`  <task-name>${escapeXml(taskName)}</task-name>`,
			`  <status>${task.status}</status>`,
			exit,
			error,
			`  <output-file>${escapeXml(task.outputPath)}</output-file>`,
			`  <summary>${escapeXml(`Background task ${JSON.stringify(taskName)} ${task.status}`)}</summary>`,
			"</background-task-notification>",
		]
			.filter(Boolean)
			.join("\n");

		try {
			this.sendCompletionNotification(
				{
					customType: "background-task-notification",
					content,
					display: true,
					details: snapshot(task),
				},
				{ deliverAs: "followUp", triggerTurn: task.triggerOnCompletion },
			);
		} catch (error) {
			task.notified = false;
			throw new Error(`Failed to send background task notification for ${task.id}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async finalizeTask(task: BgTask, status: TaskStatus, exitCode: number | null, signal?: string | null, error?: string): Promise<void> {
		if (task.finalized) return;
		task.finalized = true;
		if (task.timeoutHandle) clearTimeout(task.timeoutHandle);
		task.status = status;
		task.exitCode = exitCode;
		task.signal = signal ?? null;
		task.endTime = this.now();
		if (error) task.error = error;
		if (task.telemetryWrapped) this.flushAgentStdout(task);
		if (task.stream && !task.stream.destroyed) task.stream.end();

		for (const waiter of task.waiters.splice(0)) waiter();

		try {
			await this.writeMetadata(task);
		} catch (metadataError) {
			this.logger.error(`[background-tasks] failed to write metadata for ${task.id}:`, metadataError);
		}

		this.onChange();
		try {
			await this.notifyCompletion(task);
		} catch (notificationError) {
			this.logger.error(`[background-tasks] notification failed for ${task.id}:`, notificationError);
		}
		try {
			await this.writeMetadata(task);
		} catch (metadataError) {
			this.logger.error(`[background-tasks] failed to update notification metadata for ${task.id}:`, metadataError);
		}
		this.pruneOldTasks();
	}

	private pruneOldTasks(): void {
		if (this.tasks.size <= this.maxRecentTasks) return;
		const removable = [...this.tasks.values()]
			.filter((task) => task.status !== "running")
			.sort((a, b) => (a.endTime ?? a.startTime) - (b.endTime ?? b.startTime));
		while (this.tasks.size > this.maxRecentTasks && removable.length > 0) {
			const task = removable.shift();
			if (task) this.tasks.delete(task.id);
		}
	}
}
