import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import backgroundTasksExtension from "../vendor/pi-background-tasks/src/extension.js";
import completionsExtension from "../extensions/completions/index.js";
import {
  BackgroundTaskRegistry,
  type BackgroundTaskChildProcess,
  type BackgroundTaskContext,
} from "../vendor/pi-background-tasks/src/core/registry.js";

class FakeChild extends EventEmitter implements BackgroundTaskChildProcess {
  readonly pid = 42123;
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();

  kill(): boolean {
    return true;
  }
}

const root = await mkdtemp(path.join(tmpdir(), "pi-background-runtime-dir-"));
try {
  const cwd = path.join(root, "project");
  await mkdir(cwd, { recursive: true });
  const child = new FakeChild();
  const errors: unknown[][] = [];
  const registry = new BackgroundTaskRegistry({
    makeTaskId: () => "brecovery",
    spawn: () => child,
    sendCompletionNotification: () => {},
    logger: { error: (...values: unknown[]) => errors.push(values) },
  });
  const context: BackgroundTaskContext = {
    cwd,
    sessionId: "runtime-dir-test",
    modelRegistry: { getAll: () => [] },
    model: undefined,
  };

  await registry.ensureRuntimeDir(context);
  const runtimeDirectory = path.join(cwd, ".pi", "tasks", `runtime-dir-test-${process.pid}`);
  await rm(runtimeDirectory, { recursive: true, force: true });

  const task = await registry.startTask(context, "pi -p test", {
    name: "Runtime directory recovery",
    isAgent: true,
    notifyOnCompletion: false,
  });
  assert.equal(task.status, "running");
  assert.equal(existsSync(task.metadataAbsPath), true);
  assert.equal(
    (await readdir(runtimeDirectory)).some((entry) => entry === "brecovery.pi-telemetry-wrapper.cjs"),
    true,
  );
  child.emit("close", 0, null);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(task.status, "completed");
  assert.deepEqual(errors, []);

  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    const signalledChild = new FakeChild();
    const notifications: any[] = [];
    const signalRegistry = new BackgroundTaskRegistry({
      spawn: () => signalledChild,
      sendCompletionNotification: (message) => notifications.push(message),
    });
    const signalledTask = await signalRegistry.startTask(context, "command", { notifyOnCompletion: true });
    signalledChild.emit("close", null, signal);
    await waitUntil(() => notifications.length === 1);
    assert.equal(signalledTask.status, "failed");
    assert.equal(signalledTask.signal, signal);
    assert.equal(signalledTask.exitCode, null);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].details.status, "failed");
  }

  const bus = new EventEmitter();
  const hooks = new Map<string, Array<(...args: any[]) => any>>();
  const tools = new Map<string, any>();
  const sent: any[] = [];
  let idle = false;
  let ready = 0;
  const pi = {
    on(name: string, fn: (...args: any[]) => any) { hooks.set(name, [...(hooks.get(name) ?? []), fn]); },
    registerTool(tool: any) { tools.set(tool.name, tool); },
    registerCommand() {}, registerShortcut() {}, registerMessageRenderer() {},
    sendMessage(message: any, options: any) { sent.push({ message, options }); },
    events: {
      on(name: string, fn: (...args: any[]) => any) { bus.on(name, fn); return () => { bus.off(name, fn); }; },
      emit(name: string, value: any) { if (name === "pi-skills:completion-ready") ready++; bus.emit(name, value); },
    },
  };
  const ctx = {
    ...context, hasUI: false, isIdle: () => idle,
    sessionManager: { getSessionId: () => "integration" },
    ui: { notify() {}, setStatus() {}, setWidget() {} },
  };
  completionsExtension(pi as any);
  backgroundTasksExtension(pi as any);
  const event = async (name: string) => { for (const fn of hooks.get(name) ?? []) await fn({}, ctx); };
  async function waitUntil(predicate: () => boolean): Promise<void> {
    for (let i = 0; i < 1000; i++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail("background integration did not settle");
  }
  const start = () => tools.get("bg_run").execute("run", {
    name: "Notification integration", command: 'node -e "setTimeout(() => console.log(42), 30)"', isAgent: false,
  }, undefined, undefined, ctx);
  await event("session_start");
  try {
    const observed = await start();
    await waitUntil(() => ready === 1);
    assert.equal(sent.length, 0);
    await tools.get("bg_status").execute("status", { taskId: observed.details.task.id }, undefined, undefined, ctx);
    const logs = await tools.get("bg_logs").execute("logs", { taskId: observed.details.task.id }, undefined, undefined, ctx);
    assert.match(logs.content[0].text, /completed/);
    assert.match(logs.content[0].text, /exit=0/);
    idle = true;
    await event("agent_end");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(sent.length, 0, "the actual status/log tools must suppress the late wake");
    idle = false;
    const firstUnread = await start();
    const secondUnread = await start();
    await waitUntil(() => ready === 3);
    idle = true;
    await event("agent_end");
    await waitUntil(() => sent.length === 1);
    assert(sent[0].message.content.includes(firstUnread.details.task.id));
    assert(sent[0].message.content.includes(secondUnread.details.task.id));
    assert.deepEqual(sent[0].options, { triggerTurn: true });
  } finally {
    await event("session_shutdown");
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
