import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, Theme, ThemeColor, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { formatSize } from "@earendil-works/pi-coding-agent";
import { COMPLETION_READY, COMPLETION_OBSERVED } from "../../../extensions/completions/index.js";
import { Text, type KeyId } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import {
	DEFAULT_LOG_BYTES,
	MAX_LOG_BYTES,
	deriveTaskNameFromCommand,
	formatSnapshotList,
	normalizeMaxBytes,
	normalizeTaskName,
	parseBgCommandArgs,
	taskDisplayName,
	truncateChars,
	type BgKillDetails,
	type BgLogsDetails,
	type BgRunDetails,
	type BgStatusDetails,
	type BgTask,
	type BgTaskSnapshot,
	type StartTaskOptions,
} from "./core/common.js";
import { BackgroundTaskRegistry } from "./core/registry.js";
import { BackgroundTasksManager, type BackgroundTaskForUi, type TaskManagerResult } from "./ui/background-tasks-manager.js";

/**
 * Project-local Pi background task manager.
 *
 * Scope:
 * - Explicit background shell jobs only: /bg and bg_run spawn commands directly.
 * - No Ctrl+B support for backgrounding an already-running built-in bash tool.
 * - No detached/restart reattachment: live child processes belong to this Pi
 *   extension runtime and are killed on session shutdown/reload.
 */

const STATUS_INTERVAL_MS = 1000;
const COMMAND_PREVIEW_CHARS = 90;
const LIGHT_BLUE_BG = "\x1b[48;2;183;223;255m";
const LIGHT_BLUE_FG = "\x1b[38;2;11;70;110m";
const ANSI_RESET = "\x1b[0m";

function lightBlue(value: string): string {
	return `${LIGHT_BLUE_BG}${LIGHT_BLUE_FG}${value}${ANSI_RESET}`;
}

function textContent(text: string) {
	return [{ type: "text" as const, text }];
}

type TextToolResult = { content?: readonly { type: string; text?: string }[] };

const BgRunParams = Type.Object({
	name: Type.String({ description: "Short human-readable task name shown in the bg footer dock. Required; use 2-6 words, not the raw command." }),
	command: Type.String({ description: "Shell command to start in the background" }),
	isAgent: Type.Boolean({ description: "Required. Set true only when this background task launches an LLM/agent process, such as a child `pi -p ...` or `pi --mode json ...`, so Pi-agent telemetry can be collected. Set false for scripts, tests, servers, sleeps, and ordinary shell commands." }),
	description: Type.Optional(Type.String({ description: "Optional longer human-readable context for the task" })),
	timeoutSeconds: Type.Optional(Type.Number({ description: "Optional timeout; task is failed and killed when exceeded" })),
	notifyOnCompletion: Type.Optional(Type.Boolean({ description: "Whether to show a completion notification. Default: true." })),
	triggerOnCompletion: Type.Optional(Type.Boolean({ description: "Whether completion should trigger a follow-up agent turn. Default: true for bg_run." })),
});

const BgStatusParams = Type.Object({
	taskId: Type.Optional(Type.String({ description: "Optional task ID or unambiguous prefix. If omitted, all running/recent tasks are returned." })),
});

const BgLogsParams = Type.Object({
	taskId: Type.String({ description: "Task ID or unambiguous prefix" }),
	maxBytes: Type.Optional(Type.Number({ description: `Maximum bytes to return, capped at ${formatSize(MAX_LOG_BYTES)}. Default: ${formatSize(DEFAULT_LOG_BYTES)}.` })),
	tail: Type.Optional(Type.Boolean({ description: "Read the tail of the log when true, head when false. Default: true." })),
});

const BgKillParams = Type.Object({
	taskId: Type.String({ description: "Task ID or unambiguous prefix to stop" }),
});

type BgRunParamsValue = Static<typeof BgRunParams>;
type BgStatusParamsValue = Static<typeof BgStatusParams>;
type BgLogsParamsValue = Static<typeof BgLogsParams>;
type BgKillParamsValue = Static<typeof BgKillParams>;

function renderPlainResult(result: TextToolResult, _options: ToolRenderResultOptions, _theme: Theme) {
	const text = result.content?.map((part) => part.type === "text" ? (part.text ?? "") : "").join("\n") ?? "";
	return new Text(text, 0, 0);
}

export default function backgroundTasksExtension(pi: ExtensionAPI): void {
	const seenTaskIds = new Set<string>();
	let currentCtx: ExtensionContext | undefined;
	let dockOpen = false;
	let statusInterval: NodeJS.Timeout | undefined;

	const registry = new BackgroundTaskRegistry({
		onChange: () => updateUi(),
		sendCompletionNotification: (message, options) => {
			if (!currentCtx) return;
			pi.events.emit(COMPLETION_READY, {
				sessionId: currentCtx.sessionManager.getSessionId(),
				key: `bg:${message.details.id}`,
				content: message.content,
				wake: options.triggerTurn,
			});
		},
	});

	function observeTasks(ctx: ExtensionContext, tasks: BgTask[]): void {
		pi.events.emit(COMPLETION_OBSERVED, {
			sessionId: ctx.sessionManager.getSessionId(),
			keys: tasks.filter((task) => task.status !== "running").map((task) => `bg:${task.id}`),
		});
	}

	function unseenFinishedTasks(): BgTask[] {
		return registry.allTasks().filter((task) => task.status !== "running" && !seenTaskIds.has(task.id));
	}

	function clearFinishedNotices(ctx = currentCtx): number {
		const unseen = unseenFinishedTasks();
		for (const task of unseen) seenTaskIds.add(task.id);
		if (ctx) observeTasks(ctx, unseen);
		updateUi(ctx);
		return unseen.length;
	}

	function notifyClearFinishedNotices(ctx: ExtensionContext): void {
		currentCtx = ctx;
		const cleared = clearFinishedNotices(ctx);
		if (!ctx.hasUI) return;
		ctx.ui.notify(
			cleared > 0
				? `Cleared ${cleared} finished background task notice${cleared === 1 ? "" : "s"}.`
				: "No finished background task notices to clear.",
			cleared > 0 ? "info" : "warning",
		);
	}

	function updateUi(ctx = currentCtx): void {
		if (registry.isShuttingDown() || !ctx) return;
		try {
			if (!ctx.hasUI) return;
			const allTasks = registry.allTasks();
			const running = allTasks.filter((task) => task.status === "running");
			const unseenFailed = allTasks.filter((task) => task.status === "failed" && !seenTaskIds.has(task.id));
			const unseenStopped = allTasks.filter((task) => task.status === "killed" && !seenTaskIds.has(task.id));
			const unseenDone = allTasks.filter((task) => task.status === "completed" && !seenTaskIds.has(task.id));
			const unseenFinishedCount = unseenFailed.length + unseenStopped.length + unseenDone.length;
			ctx.ui.setWidget("background-tasks", undefined);
			if (running.length === 0 && unseenFinishedCount === 0) {
				ctx.ui.setStatus("background-tasks", undefined);
				return;
			}

			const parts: string[] = [];
			if (running.length > 0) parts.push(`${running.length} running`);
			if (unseenFailed.length > 0) parts.push(`${unseenFailed.length} failed`);
			if (unseenStopped.length > 0) parts.push(`${unseenStopped.length} stopped`);
			if (unseenDone.length > 0) parts.push(`${unseenDone.length} done`);
			const entryHint = dockOpen ? "focused" : `Shift↓${unseenFinishedCount > 0 ? " · /bg-clear" : ""}`;
			const segments = [...parts, entryHint];
			const label = ` bg ${segments.join(" · ")} `;
			ctx.ui.setStatus("background-tasks", lightBlue(label));
		} catch (error) {
			console.error(`[background-tasks] UI update failed: ${error instanceof Error ? error.message : String(error)}`);
			currentCtx = undefined;
		}
	}

	async function startTask(ctx: ExtensionContext, command: string, options: StartTaskOptions = {}): Promise<BgTask> {
		currentCtx = ctx;
		return registry.startTask(ctx, command, options);
	}

	async function openTaskManager(ctx: ExtensionCommandContext | ExtensionContext, initialTaskId?: string): Promise<void> {
		currentCtx = ctx;
		if (!ctx.hasUI) {
			ctx.ui.notify("Background task manager requires an interactive Pi UI. Use /jobs, /logs, or the bg_status/bg_logs tools in non-interactive mode.", "error");
			return;
		}
		dockOpen = true;
		updateUi(ctx);
		try {
			await ctx.ui.custom<TaskManagerResult>(
				(tui, theme, _keybindings, done) => {
					const managerOptions = {
						getTasks: () => registry.allTasks(),
						stopTask: async (task: BackgroundTaskForUi) => {
							await registry.stopTask(registry.resolveTask(task.id), "user");
							updateUi(ctx);
						},
						stopAllRunning: async () => {
							const result = await registry.stopAllRunning("user");
							updateUi(ctx);
							return result;
						},
						rerunTask: async (task: BackgroundTaskForUi) => {
							const rerunOptions: StartTaskOptions = {
								name: taskDisplayName(task),
								isAgent: task.isAgent,
								notifyOnCompletion: true,
								triggerOnCompletion: false,
							};
							if (task.description !== undefined) rerunOptions.description = task.description;
							if (task.timeoutSeconds !== undefined) rerunOptions.timeoutSeconds = task.timeoutSeconds;
							const rerun = await startTask(ctx, task.command, rerunOptions);
							updateUi(ctx);
							return rerun;
						},
						showOutputPath: (task: BackgroundTaskForUi) => {
							ctx.ui.notify(`Output path for ${taskDisplayName(task)} (${task.id}):\n${task.outputPath}`, "info");
						},
						markSeen: (taskId: string) => {
							seenTaskIds.add(taskId);
							updateUi(ctx);
						},
						markFinishedSeen: (taskIds: string[]) => {
							for (const taskId of taskIds) seenTaskIds.add(taskId);
							updateUi(ctx);
						},
						isSeen: (taskId: string) => seenTaskIds.has(taskId),
					};
					if (initialTaskId) return new BackgroundTasksManager(tui, theme, done, { ...managerOptions, initialTaskId });
					return new BackgroundTasksManager(tui, theme, done, managerOptions);
				},
				{
					overlay: true,
					overlayOptions: { anchor: "bottom-center", width: "96%", minWidth: 64, maxHeight: "60%", margin: { bottom: 1, left: 1, right: 1 } },
				},
			);
		} finally {
			dockOpen = false;
			updateUi(ctx);
		}
	}

	pi.registerMessageRenderer<BgTaskSnapshot>("background-task-notification", (message, _options, theme) => {
		const task = message.details;
		const status = task?.status ?? "completed";
		const color: ThemeColor = status === "completed" ? "success" : status === "failed" ? "error" : status === "killed" ? "warning" : "accent";
		const id = task?.id ?? "background task";
		const name = task ? taskDisplayName(task) : "Background task";
		const output = task?.outputPath ? `\n${theme.fg("dim", `Output: ${task.outputPath}`)}` : "";
		const error = task?.error ? `\n${theme.fg("error", task.error)}` : "";
		return new Text(`${theme.fg(color, `[bg ${status}]`)} ${theme.fg("accent", name)} ${theme.fg("dim", `(${id})`)}${output}${error}`, 0, 0);
	});

	pi.on("session_start", async (_event, ctx) => {
		registry.setShuttingDown(false);
		currentCtx = ctx;
		await registry.ensureRuntimeDir({ ...ctx, sessionId: ctx.sessionManager.getSessionId() });
		updateUi(ctx);
		if (statusInterval) clearInterval(statusInterval);
		statusInterval = setInterval(() => updateUi(), STATUS_INTERVAL_MS);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		registry.setShuttingDown(true);
		currentCtx = undefined;
		if (statusInterval) {
			clearInterval(statusInterval);
			statusInterval = undefined;
		}
		const running = registry.allTasks().filter((task) => task.status === "running");
		if (running.length === 0) return;

		const failures: string[] = [];
		await Promise.all(
			running.map(async (task) => {
				try {
					await registry.stopTask(task, "shutdown", "Killed during Pi session shutdown/reload");
				} catch (error) {
					const message = `${task.id}: ${error instanceof Error ? error.message : String(error)}`;
					failures.push(message);
					console.error(`[background-tasks] shutdown cleanup failed for ${message}`);
				}
			}),
		);
		if (failures.length > 0 && ctx.hasUI) {
			ctx.ui.notify(`Background task cleanup failed:\n${failures.join("\n")}`, "error");
		}
	});

	pi.registerCommand("bg", {
		description: "Start a shell command as a tracked background task: /bg [--agent] [--name \"Task name\"] <command>",
		handler: async (args, ctx) => {
			try {
				const parsed = parseBgCommandArgs(args);
				const taskOptions: StartTaskOptions = { isAgent: parsed.isAgent, notifyOnCompletion: true, triggerOnCompletion: false };
				if (parsed.name !== undefined) taskOptions.name = parsed.name;
				const task = await startTask(ctx, parsed.command, taskOptions);
				ctx.ui.notify(`Started ${taskDisplayName(task)} (${task.id})\nOutput: ${task.outputPath}\nCommand: ${task.command}`, "info");
			} catch (error) {
				ctx.ui.notify(`Background task failed to start: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});

	pi.registerCommand("tasks", {
		description: "Open the Claude-like background task manager UI",
		handler: async (args, ctx) => {
			const taskId = args.trim() || undefined;
			await openTaskManager(ctx, taskId);
		},
	});

	pi.registerCommand("bg-tasks", {
		description: "Open the background task manager UI",
		handler: async (args, ctx) => {
			const taskId = args.trim() || undefined;
			await openTaskManager(ctx, taskId);
		},
	});

	pi.registerCommand("bg-clear", {
		description: "Clear finished background task footer notices",
		handler: async (_args, ctx) => {
			notifyClearFinishedNotices(ctx);
		},
	});

	pi.registerCommand("bg-update", {
		description: "Explain how to update the vendored background task manager",
		handler: async (_args, ctx) => {
			ctx.ui.notify("This manager is vendored by pi-skills. Update pi-skills, then /reload after tasks finish. Do not install a competing standalone pi-background-tasks copy.", "info");
		},
	});

	pi.registerShortcut("shift+down" satisfies KeyId, {
		description: "Open focused background task footer dock",
		handler: async (ctx) => {
			await openTaskManager(ctx);
		},
	});

	pi.registerShortcut("ctrl+alt+c" satisfies KeyId, {
		description: "Clear finished background task footer notices (terminal-dependent fallback for /bg-clear)",
		handler: (ctx) => notifyClearFinishedNotices(ctx),
	});

	pi.registerCommand("jobs", {
		description: "List running and recent background tasks",
		handler: async (_args, ctx) => {
			currentCtx = ctx;
			ctx.ui.notify(formatSnapshotList(registry.allTasks().map((task) => registry.snapshot(task))), "info");
			updateUi(ctx);
		},
	});

	pi.registerCommand("logs", {
		description: "Show bounded output from a background task: /logs <id> [maxBytes]",
		getArgumentCompletions: (prefix) => {
			const matches = registry.allTasks()
				.filter((task) => task.id.startsWith(prefix.trim()))
				.slice(0, 20)
				.map((task) => ({ value: task.id, label: `${task.id} ${taskDisplayName(task)}`, description: `${task.status} — ${truncateChars(task.command, 60)}` }));
			return matches.length > 0 ? matches : null;
		},
		handler: async (args, ctx) => {
			try {
				currentCtx = ctx;
				const [id, bytes] = args.trim().split(/\s+/, 2);
				const task = registry.resolveTask(id || "");
				const maxBytes = normalizeMaxBytes(Number(bytes), DEFAULT_LOG_BYTES);
				const logs = await registry.getTaskLogs(task, maxBytes, true);
				ctx.ui.notify(logs.text, "info");
			} catch (error) {
				ctx.ui.notify(`Background logs error: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});

	pi.registerCommand("kill", {
		description: "Stop a running background task: /kill <id>",
		getArgumentCompletions: (prefix) => {
			const matches = registry.allTasks()
				.filter((task) => task.status === "running" && task.id.startsWith(prefix.trim()))
				.slice(0, 20)
				.map((task) => ({ value: task.id, label: `${task.id} ${taskDisplayName(task)}`, description: truncateChars(task.command, 70) }));
			return matches.length > 0 ? matches : null;
		},
		handler: async (args, ctx) => {
			try {
				currentCtx = ctx;
				const task = registry.resolveTask(args.trim());
				await registry.stopTask(task, "user");
				ctx.ui.notify(`Killed ${taskDisplayName(task)} (${task.id}). Output: ${task.outputPath}`, "info");
				updateUi(ctx);
			} catch (error) {
				ctx.ui.notify(`Background kill error: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});

	pi.registerTool<typeof BgRunParams, BgRunDetails>({
		name: "bg_run",
		label: "Background Run",
		description: `Start a named long-running shell command in the background and return immediately with a task ID and output path. Output is written to .pi/tasks and model-visible logs are bounded to ${formatSize(MAX_LOG_BYTES)}.`,
		promptSnippet: "Start named long-running shell commands in the background and return a task ID plus output file path",
		promptGuidelines: [
			"Use bg_run instead of bash for commands expected to run for a long time, such as test suites, dev servers, watchers, builds, or sleeps.",
			"Always set isAgent: true only when the background task launches an LLM/agent process; set isAgent: false for scripts, tests, dev servers, sleeps, and ordinary shell commands.",
			"When using bg_run, always set name to a concise 2-6 word human-readable label for the footer task dock; do not use the raw command as the name unless it is already short and meaningful.",
			"After bg_run, use bg_status and bg_logs to inspect progress; do not assume the background task completed until status says completed, failed, or killed.",
			"When a <background-task-notification> appears, react to it: inspect bg_status/bg_logs as needed, then report completion, failure, or next steps to the user.",
		],
		parameters: BgRunParams,
		prepareArguments(args): BgRunParamsValue {
			if (!args || typeof args !== "object") throw new Error("bg_run arguments must be an object");
			const input = args as Record<string, unknown>;
			if (typeof input["command"] !== "string") throw new Error("bg_run requires command string");
			if (typeof input["isAgent"] !== "boolean") {
				throw new Error("bg_run requires isAgent boolean. Set true only for LLM/agent tasks; set false for scripts, tests, servers, sleeps, and ordinary shell commands.");
			}
			const prepared: BgRunParamsValue = {
				command: input["command"],
				name: normalizeTaskName(input["name"]) ?? normalizeTaskName(input["description"]) ?? deriveTaskNameFromCommand(input["command"]),
				isAgent: input["isAgent"],
			};
			if (typeof input["description"] === "string") prepared.description = input["description"];
			if (typeof input["timeoutSeconds"] === "number") prepared.timeoutSeconds = input["timeoutSeconds"];
			if (typeof input["notifyOnCompletion"] === "boolean") prepared.notifyOnCompletion = input["notifyOnCompletion"];
			if (typeof input["triggerOnCompletion"] === "boolean") prepared.triggerOnCompletion = input["triggerOnCompletion"];
			return prepared;
		},
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (typeof params.isAgent !== "boolean") {
				throw new Error("bg_run requires isAgent boolean. Set true only for LLM/agent tasks; set false for scripts, tests, servers, sleeps, and ordinary shell commands.");
			}
			const taskOptions: StartTaskOptions = {
				name: params.name,
				isAgent: params.isAgent,
				notifyOnCompletion: params.notifyOnCompletion ?? true,
				triggerOnCompletion: params.triggerOnCompletion ?? true,
			};
			if (params.description !== undefined) taskOptions.description = params.description;
			if (params.timeoutSeconds !== undefined) taskOptions.timeoutSeconds = params.timeoutSeconds;
			const task = await startTask(ctx, params.command, taskOptions);
			observeTasks(ctx, [task]);
			return {
				content: textContent(`Started background task ${taskDisplayName(task)} (${task.id})\nStatus: ${task.status}\nPID: ${task.pid ?? "unknown"}\nOutput: ${task.outputPath}`),
				details: { task: registry.snapshot(task) },
			};
		},
		renderCall(args, theme) {
			return new Text(`${theme.fg("toolTitle", theme.bold("bg_run "))}${theme.fg("muted", truncateChars(taskDisplayName(args), COMMAND_PREVIEW_CHARS))}`, 0, 0);
		},
		renderResult(result, _options, theme) {
			const task = result.details?.task;
			if (!task) return renderPlainResult(result, _options, theme);
			return new Text(`${theme.fg("success", "✓ started")} ${theme.fg("accent", taskDisplayName(task))} ${theme.fg("dim", `(${task.id})`)}\n${theme.fg("dim", `Output: ${task.outputPath}`)}`, 0, 0);
		},
	});

	pi.registerTool<typeof BgStatusParams, BgStatusDetails>({
		name: "bg_status",
		label: "Background Status",
		description: "Inspect one background task or list all running/recent background tasks.",
		promptSnippet: "Inspect status for one or all background tasks",
		promptGuidelines: ["Use bg_status before bg_logs when you need to know whether a background task is still running or has finished."],
		parameters: BgStatusParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const selected = params.taskId ? [registry.resolveTask(params.taskId)] : registry.allTasks();
			const snapshots = selected.map((task) => registry.snapshot(task));
			observeTasks(ctx, selected);
			return {
				content: textContent(formatSnapshotList(snapshots)),
				details: { tasks: snapshots },
			};
		},
		renderCall(args, theme) {
			return new Text(`${theme.fg("toolTitle", theme.bold("bg_status"))}${args.taskId ? ` ${theme.fg("accent", args.taskId)}` : ""}`, 0, 0);
		},
		renderResult: renderPlainResult,
	});

	pi.registerTool<typeof BgLogsParams, BgLogsDetails>({
		name: "bg_logs",
		label: "Background Logs",
		description: `Read bounded output from a background task. Output is capped at ${formatSize(MAX_LOG_BYTES)} for model safety and points to the full output file when truncated.`,
		promptSnippet: "Read bounded output from a background task log",
		promptGuidelines: ["Use bg_logs with a modest maxBytes value to inspect background task progress without flooding context."],
		parameters: BgLogsParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const task = registry.resolveTask(params.taskId);
			const logs = await registry.getTaskLogs(task, normalizeMaxBytes(params.maxBytes), params.tail ?? true);
			observeTasks(ctx, [task]);
			return {
				content: textContent(`${formatSnapshotList([registry.snapshot(task)])}\n\n${logs.text}`),
				details: logs.details,
			};
		},
		renderCall(args, theme) {
			return new Text(`${theme.fg("toolTitle", theme.bold("bg_logs "))}${theme.fg("accent", args.taskId)}`, 0, 0);
		},
		renderResult(result, { expanded }, theme) {
			const details = result.details;
			if (!details) return renderPlainResult(result, { expanded, isPartial: false }, theme);
			let text = `${theme.fg("accent", taskDisplayName(details.task))} ${theme.fg("dim", `(${details.task.id})`)} ${theme.fg("muted", details.tail ? "tail" : "head")} ${formatSize(details.bytesRead)}`;
			if (details.truncated) text += theme.fg("warning", " (truncated)");
			text += `\n${theme.fg("dim", `Full output: ${details.path}`)}`;
			if (expanded) {
				const content = result.content?.[0];
				if (content?.type === "text") text += `\n${theme.fg("toolOutput", content.text.split("\n").slice(0, 30).join("\n"))}`;
			}
			return new Text(text, 0, 0);
		},
	});

	pi.registerTool<typeof BgKillParams, BgKillDetails>({
		name: "bg_kill",
		label: "Background Kill",
		description: "Stop a running background task by ID. Fails loudly if the task is unknown or already finished.",
		promptSnippet: "Stop a running background task by ID",
		promptGuidelines: ["Use bg_kill when the user asks to stop a background task or when a bg_run command is no longer needed."],
		parameters: BgKillParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const task = registry.resolveTask(params.taskId);
			await registry.stopTask(task, "user");
			observeTasks(ctx, [task]);
			const message = `Killed background task ${taskDisplayName(task)} (${task.id}). Output: ${task.outputPath}`;
			return {
				content: textContent(message),
				details: { task: registry.snapshot(task), message },
			};
		},
		renderCall(args, theme) {
			return new Text(`${theme.fg("toolTitle", theme.bold("bg_kill "))}${theme.fg("accent", args.taskId)}`, 0, 0);
		},
		renderResult(result, _options, theme) {
			const task = result.details?.task;
			if (!task) return renderPlainResult(result, _options, theme);
			return new Text(`${theme.fg("warning", "■ killed")} ${theme.fg("accent", taskDisplayName(task))} ${theme.fg("dim", `(${task.id})`)}\n${theme.fg("dim", `Output: ${task.outputPath}`)}`, 0, 0);
		},
	});
}
