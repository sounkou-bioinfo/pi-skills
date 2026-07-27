import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BackgroundTaskRegistry,
  type BackgroundTaskChildProcess,
  type BackgroundTaskContext,
} from "../node_modules/pi-background-tasks/src/core/registry.js";

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
} finally {
  await rm(root, { recursive: true, force: true });
}
