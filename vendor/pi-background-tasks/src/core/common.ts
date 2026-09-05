import { statSync } from "node:fs";
import { open } from "node:fs/promises";
import { DEFAULT_MAX_BYTES } from "@earendil-works/pi-coding-agent";

export type TaskStatus = "running" | "completed" | "failed" | "killed";
export type KillKind = "user" | "timeout" | "output_cap" | "shutdown";

export type TaskContextUsage = {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
};

export type TaskTokenUsage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	costTotal?: number;
};

export type TaskToolUsage = {
	total: number;
	failed: number;
	byName: Record<string, number>;
};

export type BgTaskSnapshot = {
	id: string;
	name?: string | undefined;
	command: string;
	description?: string | undefined;
	status: TaskStatus;
	outputPath: string;
	cwd: string;
	startTime: number;
	endTime?: number | undefined;
	exitCode?: number | null | undefined;
	signal?: string | null | undefined;
	pid?: number | undefined;
	bytesWritten: number;
	isAgent: boolean;
	error?: string | undefined;
	notified: boolean;
	notifyOnCompletion: boolean;
	triggerOnCompletion: boolean;
	timeoutSeconds?: number | undefined;
	contextUsage?: TaskContextUsage | undefined;
	tokenUsage?: TaskTokenUsage | undefined;
	toolUsage?: TaskToolUsage | undefined;
	model?: string | undefined;
};

export type BgTask = Omit<BgTaskSnapshot, "name"> & {
	name: string;
	outputAbsPath: string;
	metadataAbsPath: string;
	child?: import("./registry.js").BackgroundTaskChildProcess | undefined;
	stream?: import("node:fs").WriteStream | undefined;
	timeoutHandle?: NodeJS.Timeout | undefined;
	killKind?: KillKind | undefined;
	killSignalSent?: boolean | undefined;
	capExceeded?: boolean | undefined;
	finalized?: boolean | undefined;
	contextUsageBuffer?: string | undefined;
	/** True when this task launched a telemetry-wrapped Pi agent; its stdout carries control lines, not raw output. */
	telemetryWrapped?: boolean | undefined;
	/** Partial trailing stdout line held between chunks while reconstructing wrapped-agent control lines. */
	agentStdoutBuffer?: string | undefined;
	waiters: Array<() => void>;
};

export type BgRunDetails = {
	task: BgTaskSnapshot;
};

export type BgStatusDetails = {
	tasks: BgTaskSnapshot[];
};

export type BgLogsDetails = {
	task: BgTaskSnapshot;
	path: string;
	bytesRead: number;
	truncated: boolean;
	tail: boolean;
};

export type BgKillDetails = {
	task: BgTaskSnapshot;
	message: string;
};

export type StartTaskOptions = {
	name?: string | undefined;
	description?: string | undefined;
	isAgent?: boolean | undefined;
	timeoutSeconds?: number | undefined;
	notifyOnCompletion?: boolean | undefined;
	triggerOnCompletion?: boolean | undefined;
};

export const DEFAULT_LOG_BYTES = Math.min(DEFAULT_MAX_BYTES, 50 * 1024);
export const MAX_LOG_BYTES = Math.min(DEFAULT_MAX_BYTES, 50 * 1024);
export const COMMAND_PREVIEW_CHARS = 90;

export function sanitizePathSegment(value: string): string {
	const sanitized = value.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
	return sanitized || "session";
}

export function stripMatchingQuotes(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2) {
		const first = trimmed[0];
		const last = trimmed[trimmed.length - 1];
		if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
			return trimmed.slice(1, -1);
		}
	}
	return trimmed;
}

export function compactWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

export function truncateChars(value: string, maxChars: number): string {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function normalizeTaskName(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = compactWhitespace(stripMatchingQuotes(value));
	if (!normalized) return undefined;
	return truncateChars(normalized, 80);
}

export function deriveTaskNameFromCommand(command: string): string {
	const normalized = compactWhitespace(stripMatchingQuotes(command));
	if (!normalized) return "Background task";

	const packageScript = normalized.match(/^(npm|pnpm|yarn|bun)\s+(?:(run)\s+)?([^\s;&|]+)/);
	if (packageScript) {
		const runner = packageScript[1];
		const run = packageScript[2] ? " run" : "";
		const script = packageScript[3];
		return truncateChars(`${runner}${run} ${script}`, 48);
	}

	const words = normalized.split(/\s+/).slice(0, 5).join(" ");
	return truncateChars(words || normalized, 48);
}

export function taskDisplayName(task: { name?: string | undefined; description?: string | undefined; command?: string | undefined; id?: string | undefined }): string {
	return normalizeTaskName(task.name)
		?? normalizeTaskName(task.description)
		?? (task.command ? deriveTaskNameFromCommand(task.command) : undefined)
		?? task.id
		?? "Background task";
}

function parseNameValueAndRest(valueAndRest: string): { value: string; rest: string } | undefined {
	const input = valueAndRest.trimStart();
	if (!input) return undefined;
	const quote = input[0];
	if (quote === '"' || quote === "'") {
		let escaped = false;
		let value = "";
		for (let i = 1; i < input.length; i++) {
			const char = input.charAt(i);
			if (escaped) {
				value += char;
				escaped = false;
				continue;
			}
			if (char === "\\") {
				escaped = true;
				continue;
			}
			if (char === quote) {
				return { value, rest: input.slice(i + 1).trimStart() };
			}
			value += char;
		}
		return undefined;
	}
	const match = input.match(/^(\S+)(?:\s+([\s\S]*))?$/);
	if (!match) return undefined;
	const parsedValue = match[1];
	if (parsedValue === undefined) return undefined;
	return { value: parsedValue, rest: match[2]?.trimStart() ?? "" };
}

export function parseBgCommandArgs(args: string): { name?: string; command: string; isAgent: boolean } {
	let input = args.trim();
	let name: string | undefined;
	let isAgent = false;

	while (input) {
		let consumed = false;
		for (const prefix of ["--name=", "-n="]) {
			if (input.startsWith(prefix)) {
				const parsed = parseNameValueAndRest(input.slice(prefix.length));
				if (!parsed) throw new Error(`${prefix.slice(0, -1)} requires a task name`);
				name = normalizeTaskName(parsed.value);
				input = parsed.rest;
				consumed = true;
				break;
			}
		}
		if (consumed) continue;

		for (const prefix of ["--name", "-n"]) {
			if (input === prefix || input.startsWith(`${prefix} `) || input.startsWith(`${prefix}\t`)) {
				const parsed = parseNameValueAndRest(input.slice(prefix.length));
				if (!parsed) throw new Error(`${prefix} requires a task name`);
				name = normalizeTaskName(parsed.value);
				input = parsed.rest;
				consumed = true;
				break;
			}
		}
		if (consumed) continue;

		for (const flag of ["--agent", "--llm-agent"]) {
			if (input === flag || input.startsWith(`${flag} `) || input.startsWith(`${flag}\t`)) {
				isAgent = true;
				input = input.slice(flag.length).trimStart();
				consumed = true;
				break;
			}
		}
		if (consumed) continue;

		for (const flag of ["--script", "--no-agent"]) {
			if (input === flag || input.startsWith(`${flag} `) || input.startsWith(`${flag}\t`)) {
				isAgent = false;
				input = input.slice(flag.length).trimStart();
				consumed = true;
				break;
			}
		}
		if (consumed) continue;

		if (input === "--") {
			input = "";
			break;
		}
		if (input.startsWith("-- ")) {
			input = input.slice(3).trimStart();
			break;
		}
		break;
	}

	return name ? { name, command: input, isAgent } : { command: input, isAgent };
}

export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remSeconds = seconds % 60;
	if (minutes < 60) return `${minutes}m${remSeconds ? `${remSeconds}s` : ""}`;
	const hours = Math.floor(minutes / 60);
	const remMinutes = minutes % 60;
	return `${hours}h${remMinutes ? `${remMinutes}m` : ""}`;
}

export function formatCompactNumber(count: number): string {
	const normalized = Math.max(0, Math.floor(count));
	if (normalized < 1000) return normalized.toString();
	if (normalized < 10000) return `${(normalized / 1000).toFixed(1)}k`;
	if (normalized < 1000000) return `${Math.round(normalized / 1000)}k`;
	if (normalized < 10000000) return `${(normalized / 1000000).toFixed(1)}M`;
	return `${Math.round(normalized / 1000000)}M`;
}

export function formatContextUsageSummary(usage?: TaskContextUsage): string | undefined {
	if (!usage || !usage.contextWindow) return undefined;
	const window = formatCompactNumber(usage.contextWindow);
	if (usage.percent === null || usage.tokens === null) return `ctx=?/${window}`;
	return `ctx=${usage.percent.toFixed(1)}%/${window}`;
}

export function formatTokenUsageSummary(usage?: TaskTokenUsage): string | undefined {
	if (!usage || usage.totalTokens <= 0) return undefined;
	return `tokens=${formatCompactNumber(usage.totalTokens)}`;
}

export function formatToolUsageSummary(usage?: TaskToolUsage): string | undefined {
	if (!usage || (usage.total <= 0 && usage.failed <= 0)) return undefined;
	const failed = usage.failed > 0 ? ` failed=${usage.failed}` : "";
	return `tools=${usage.total}${failed}`;
}

export function formatModelSummary(model?: string): string | undefined {
	if (!model) return undefined;
	return `model=${model}`;
}

/**
 * Human-readable activity transcript for telemetry-wrapped Pi agents.
 *
 * The wrapper emits one `background-task-activity` control line per meaningful
 * child-agent event (assistant text, reasoning, tool start, tool end) so the
 * registry can render "what the agent is actually doing" into the task output
 * file instead of leaking raw telemetry JSON. Both the parser and the formatter
 * are pure so the visible transcript is fully unit-testable.
 */
export const AGENT_ACTIVITY_TYPE = "background-task-activity";
const AGENT_ACTIVITY_DETAIL_MAX = 80;

export type AgentActivity =
	| { kind: "assistant_text"; text: string }
	| { kind: "reasoning"; text: string }
	| { kind: "tool_start"; tool: string; argsSummary: string }
	| { kind: "tool_end"; tool: string; isError: boolean; error?: string };

function readActivityString(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

/** Narrow a parsed `background-task-activity` control payload into a typed {@link AgentActivity}. */
export function parseAgentActivity(payload: unknown): AgentActivity | undefined {
	if (typeof payload !== "object" || payload === null) return undefined;
	const record = payload as Record<string, unknown>;
	if (record["type"] !== AGENT_ACTIVITY_TYPE) return undefined;
	const kind = record["kind"];
	if (kind === "assistant_text" || kind === "reasoning") {
		const text = readActivityString(record, "text");
		if (text === undefined) return undefined;
		return { kind, text };
	}
	if (kind === "tool_start") {
		const tool = readActivityString(record, "tool");
		if (!tool) return undefined;
		return { kind, tool, argsSummary: readActivityString(record, "argsSummary") ?? "" };
	}
	if (kind === "tool_end") {
		const tool = readActivityString(record, "tool");
		if (!tool) return undefined;
		const activity: AgentActivity = { kind, tool, isError: record["isError"] === true };
		const error = readActivityString(record, "error");
		if (error !== undefined && error.trim().length > 0) activity.error = error;
		return activity;
	}
	return undefined;
}

/**
 * Render an {@link AgentActivity} into a single transcript line, or `undefined`
 * when the event carries nothing worth showing (blank text, a successful tool
 * end). Successful tool ends are intentionally silent: the matching `→` start
 * line already announced the call, and the next line implies completion.
 */
export function formatAgentActivityLine(activity: AgentActivity): string | undefined {
	if (activity.kind === "assistant_text") {
		const text = activity.text.replace(/\s+$/u, "");
		return text.trim().length > 0 ? text : undefined;
	}
	if (activity.kind === "reasoning") {
		const text = activity.text.replace(/\s+$/u, "");
		return text.trim().length > 0 ? `\u2026 ${text}` : undefined;
	}
	if (activity.kind === "tool_start") {
		const summary = compactWhitespace(activity.argsSummary);
		const suffix = summary.length > 0 ? ` ${truncateChars(summary, AGENT_ACTIVITY_DETAIL_MAX)}` : "";
		return `\u2192 ${activity.tool}${suffix}`;
	}
	if (!activity.isError) return undefined;
	const detail = activity.error ? `: ${truncateChars(compactWhitespace(activity.error), AGENT_ACTIVITY_DETAIL_MAX)}` : "";
	return `\u2717 ${activity.tool} failed${detail}`;
}

export function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function shellInvocation(
	command: string,
	platform: NodeJS.Platform = process.platform,
	env: NodeJS.ProcessEnv = process.env,
): { shell: string; args: string[] } {
	if (platform === "win32") {
		return { shell: env["ComSpec"] || "cmd.exe", args: ["/d", "/s", "/c", command] };
	}
	return { shell: env["SHELL"] || "/bin/sh", args: ["-c", command] };
}

export function normalizeMaxBytes(value: unknown, fallback = DEFAULT_LOG_BYTES): number {
	const raw = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
	return Math.max(1, Math.min(MAX_LOG_BYTES, raw));
}

export function snapshot(task: BgTask): BgTaskSnapshot {
	return {
		id: task.id,
		name: taskDisplayName(task),
		command: task.command,
		description: task.description,
		status: task.status,
		outputPath: task.outputPath,
		cwd: task.cwd,
		startTime: task.startTime,
		endTime: task.endTime,
		exitCode: task.exitCode,
		signal: task.signal,
		pid: task.pid,
		bytesWritten: task.bytesWritten,
		isAgent: task.isAgent,
		error: task.error,
		notified: task.notified,
		notifyOnCompletion: task.notifyOnCompletion,
		triggerOnCompletion: task.triggerOnCompletion,
		timeoutSeconds: task.timeoutSeconds,
		contextUsage: task.contextUsage,
		tokenUsage: task.tokenUsage,
		toolUsage: task.toolUsage,
		model: task.model,
	};
}

export function formatSnapshotList(tasks: BgTaskSnapshot[], now = Date.now()): string {
	if (tasks.length === 0) return "No background tasks in this Pi extension runtime.";
	return tasks.map((task) => {
		const statusIcon = task.status === "running" ? "▶" : task.status === "completed" ? "✓" : task.status === "killed" ? "■" : "✗";
		const age = formatDuration((task.endTime ?? now) - task.startTime);
		const code = task.exitCode !== undefined ? ` exit=${task.exitCode}` : "";
		const pid = task.pid ? ` pid=${task.pid}` : "";
		const error = task.error ? ` error=${truncateChars(task.error, 80)}` : "";
		const telemetry = [
			formatContextUsageSummary(task.contextUsage),
			formatModelSummary(task.model),
			formatTokenUsageSummary(task.tokenUsage),
			formatToolUsageSummary(task.toolUsage),
		].filter(Boolean).join(" ");
		const telemetryText = telemetry ? ` ${telemetry}` : "";
		return `${statusIcon} ${task.id} ${task.status} ${age}${code}${pid}${telemetryText} — ${truncateChars(taskDisplayName(task), COMMAND_PREVIEW_CHARS)}${error}\n    output: ${task.outputPath}`;
	}).join("\n");
}

export async function boundedRead(
	filePath: string,
	maxBytes: number,
	tail: boolean,
): Promise<{ content: string; truncated: boolean; bytesRead: number; totalBytes: number }> {
	const stats = statSync(filePath);
	const totalBytes = stats.size;
	const bytesToRead = Math.min(totalBytes, maxBytes);
	if (bytesToRead === 0) return { content: "", truncated: false, bytesRead: 0, totalBytes };

	const file = await open(filePath, "r");
	try {
		const buffer = Buffer.alloc(bytesToRead);
		const position = tail ? Math.max(0, totalBytes - bytesToRead) : 0;
		const { bytesRead } = await file.read(buffer, 0, bytesToRead, position);
		return {
			content: buffer.subarray(0, bytesRead).toString("utf8"),
			truncated: totalBytes > bytesRead,
			bytesRead,
			totalBytes,
		};
	} finally {
		await file.close();
	}
}

export function escapeXml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const UPDATE_COMMAND = "/bg-update";

type ParsedSemver = {
	major: number;
	minor: number;
	patch: number;
	prerelease: string[];
};

const SEMVER_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseSemver(value: string): ParsedSemver | undefined {
	if (typeof value !== "string") return undefined;
	const match = value.trim().match(SEMVER_PATTERN);
	if (!match) return undefined;
	const major = Number(match[1]);
	const minor = Number(match[2]);
	const patch = Number(match[3]);
	if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) return undefined;
	const prerelease = match[4] ? match[4].split(".") : [];
	return { major, minor, patch, prerelease };
}

function comparePrerelease(a: string[], b: string[]): number {
	if (a.length === 0 && b.length === 0) return 0;
	// A version without prerelease identifiers outranks the same core with prerelease identifiers.
	if (a.length === 0) return 1;
	if (b.length === 0) return -1;
	const shared = Math.min(a.length, b.length);
	for (let i = 0; i < shared; i++) {
		const idA = a[i];
		const idB = b[i];
		if (idA === undefined || idB === undefined) break;
		if (idA === idB) continue;
		const numericA = /^\d+$/.test(idA);
		const numericB = /^\d+$/.test(idB);
		if (numericA && numericB) {
			const diff = Number(idA) - Number(idB);
			if (diff !== 0) return diff < 0 ? -1 : 1;
			continue;
		}
		// Numeric identifiers always have lower precedence than non-numeric identifiers.
		if (numericA) return -1;
		if (numericB) return 1;
		return idA < idB ? -1 : 1;
	}
	if (a.length === b.length) return 0;
	return a.length < b.length ? -1 : 1;
}

/** Compare two semver strings. Returns -1/0/1, or undefined when either side is not valid semver. */
export function compareSemver(a: string, b: string): number | undefined {
	const left = parseSemver(a);
	const right = parseSemver(b);
	if (!left || !right) return undefined;
	if (left.major !== right.major) return left.major < right.major ? -1 : 1;
	if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
	if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
	return comparePrerelease(left.prerelease, right.prerelease);
}

export function isNewerVersion(latest: string, current: string): boolean {
	return compareSemver(latest, current) === 1;
}

/** Footer segment shown only when a newer published version exists; undefined otherwise. */
export function formatUpdateSegment(latest: string | undefined, current: string): string | undefined {
	if (!latest) return undefined;
	if (!isNewerVersion(latest, current)) return undefined;
	return `\u2b06 v${latest} ${UPDATE_COMMAND}`;
}
