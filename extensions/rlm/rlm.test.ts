import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { completeWithCli } from "./backends.js";
import { loadFileContext } from "./engine.js";
import { notifyWhenComplete, resolveStartInput } from "./index.js";
import { evalInRepl } from "./repl.js";
import { RunStore } from "./runs.js";
import { evalWithR } from "./system-r.js";
import type { RlmRunResult, RunRecord, StartRunInput } from "./types.js";

test("RLM starts detached by default but permits an explicit blocking call", () => {
  assert.equal(resolveStartInput({ task: "inspect", context: "x" }, "/tmp").async, true);
  assert.equal(resolveStartInput({ task: "inspect", context: "x", async: false }, "/tmp").async, false);
});

test("detached RLM completion emits one bounded follow-up wakeup", async () => {
  const sent: Array<{ message: unknown; options: unknown }> = [];
  const pi = {
    sendMessage(message: unknown, options: unknown) {
      sent.push({ message, options });
    },
  } as unknown as ExtensionAPI;
  const result = fakeResult("notify", "/tmp");
  result.final = "x".repeat(5000);
  const record: RunRecord = {
    id: "notify",
    createdAt: Date.now(),
    status: "completed",
    artifactsDir: result.artifacts.dir,
    input: startInput(),
    result,
    promise: Promise.resolve(result),
    cancel() {},
  };

  await notifyWhenComplete(pi, record, () => false);

  assert.equal(sent.length, 1);
  const message = sent[0]?.message as { customType: string; content: string };
  assert.equal(message.customType, "rlm-completion");
  assert.match(message.content, /RLM background run notify completed/);
  assert(message.content.length < 2300);
  assert.deepEqual(sent[0]?.options, { deliverAs: "followUp", triggerTurn: true });
});

test("file context uses a Git-aware manifest and prioritizes authorities", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-rlm-context-test-"));
  try {
    execFileSync("git", ["init", "-q", root]);
    await writeFile(join(root, ".gitignore"), "ignored/\n", "utf8");
    await writeFile(join(root, "AGENTS.md"), "authority\n", "utf8");
    await writeFile(join(root, "functions.yaml"), "functions: []\n", "utf8");
    await symlink("AGENTS.md", join(root, "CLAUDE.md"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "main.c"), "int main(void) { return 0; }\n", "utf8");
    await writeFile(join(root, "src", "untracked.c"), "int untracked(void) { return 1; }\n", "utf8");
    await writeFile(join(root, "large.txt"), "x".repeat(600_000), "utf8");
    await writeFile(join(root, "binary.dat"), Buffer.from([65, 0, 66]));
    await mkdir(join(root, "ignored"));
    await writeFile(join(root, "ignored", "artifact.txt"), "not context\n", "utf8");
    execFileSync("git", ["-C", root, "add", ".gitignore", "AGENTS.md", "CLAUDE.md", "functions.yaml", "src/main.c", "large.txt", "binary.dat"]);

    const files = await loadFileContext(root);
    assert.equal(files[0]?.path, "AGENTS.md");
    assert(files.some((file) => file.path === "src/main.c" && file.text?.includes("main")));
    assert(files.some((file) => file.path === "CLAUDE.md" && file.text?.includes("authority")));
    assert(files.some((file) => file.path === "src/untracked.c" && file.text?.includes("untracked")));
    assert.equal(files.find((file) => file.path === "large.txt")?.omittedReason, "too_large");
    assert.equal(files.find((file) => file.path === "binary.dat")?.omittedReason, "binary");
    assert(!files.some((file) => file.path.includes("artifact.txt")));
    const lazyRead = await evalInRepl('return await readFile("large.txt")', { kind: "files", root, files });
    assert(lazyRead.startsWith("x".repeat(100)));
    assert(lazyRead.endsWith("..."));
    assert.equal(await evalInRepl("return typeof process", { kind: "files", root, files }), "undefined");
    assert((await evalInRepl('return readFile.constructor("return process")()', { kind: "files", root, files })).startsWith("repl error:"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI completion streams JSON events and disables nested orchestration surfaces", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-rlm-backend-test-"));
  const fakePi = join(root, "fake-pi.mjs");
  const hangingPi = join(root, "hanging-pi.mjs");
  const argsPath = join(root, "args.json");
  const oldArgsPath = process.env.FAKE_PI_ARGS_PATH;
  try {
    await writeFile(
      fakePi,
      [
        "#!/usr/bin/env node",
        'import { writeFileSync } from "node:fs";',
        'writeFileSync(process.env.FAKE_PI_ARGS_PATH, JSON.stringify(process.argv.slice(2)));',
        'const payload = "x".repeat(10000);',
        'for (let i = 0; i < 2000; i++) process.stdout.write(JSON.stringify({type:"message_update", delta:payload}) + "\\n");',
        'process.stdout.write(JSON.stringify({type:"message_end", message:{role:"assistant", content:[{type:"text", text:"bounded result"}]}}) + "\\n");',
      ].join("\n"),
      { encoding: "utf8", mode: 0o700 },
    );
    await writeFile(hangingPi, '#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n', { encoding: "utf8", mode: 0o700 });
    process.env.FAKE_PI_ARGS_PATH = argsPath;
    const result = await completeWithCli({
      model: "openai-codex/test",
      prompt: "test",
      systemPrompt: "controller",
      cwd: root,
      piBin: fakePi,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.text, "bounded result");
    const args = JSON.parse(await readFile(argsPath, "utf8")) as string[];
    for (const flag of ["--no-tools", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--system-prompt"]) {
      assert(args.includes(flag), `missing child isolation flag ${flag}`);
    }
    assert(!args.includes("--append-system-prompt"));

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20).unref();
    const aborted = await completeWithCli({
      model: "openai-codex/test",
      prompt: "test",
      systemPrompt: "controller",
      cwd: root,
      piBin: hangingPi,
      signal: controller.signal,
    });
    assert.equal(aborted.exitCode, 130);
  } finally {
    if (oldArgsPath === undefined) delete process.env.FAKE_PI_ARGS_PATH;
    else process.env.FAKE_PI_ARGS_PATH = oldArgsPath;
    await rm(root, { recursive: true, force: true });
  }
});

test("system R evaluation is real and abortable", async () => {
  const context = { kind: "text" as const, text: "alpha\nbeta\n" };
  const result = await evalWithR("length(context_lines())", context, { rBin: "Rscript" });
  assert.equal(result.output.trim(), "2");

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20).unref();
  const aborted = await evalWithR("Sys.sleep(10); 1", context, { rBin: "Rscript", signal: controller.signal });
  assert.match(aborted.output, /R error/);
});

test("run store serializes controllers and persists terminal records", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-rlm-store-test-"));
  const gates: Array<() => void> = [];
  let active = 0;
  let maximumActive = 0;
  try {
    const store = new RunStore(1, root);
    const executor = async (runId: string): Promise<RlmRunResult> => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => gates.push(resolve));
      active--;
      const result = fakeResult(runId, root);
      await mkdir(result.artifacts.dir, { recursive: true });
      await writeFile(result.artifacts.treePath, JSON.stringify(result.root), "utf8");
      await writeFile(result.artifacts.outputPath, result.final, "utf8");
      return result;
    };
    const first = store.start(startInput(), executor);
    const second = store.start(startInput(), executor);
    assert.equal(first.status, "running");
    assert.equal(second.status, "queued");

    gates.shift()?.();
    await first.promise;
    assert.equal(first.input.context, undefined);
    await waitFor(() => second.status === "running");
    gates.shift()?.();
    await second.promise;
    assert.equal(maximumActive, 1);
    assert.equal(second.status, "completed");

    const hydrated = new RunStore(1, root).get(second.id);
    assert.equal(hydrated?.status, "completed");
    assert.equal(hydrated?.result?.final, "ok");

    const shutdownStore = new RunStore(1, join(root, "shutdown"));
    const blocked = (_runId: string, signal: AbortSignal) => new Promise<RlmRunResult>((_resolve, reject) => {
      const abort = () => reject(new Error("cancelled"));
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
    const activeRun = shutdownStore.start(startInput(), blocked);
    const queuedRun = shutdownStore.start(startInput(), blocked);
    await shutdownStore.shutdown();
    assert.equal(activeRun.status, "cancelled");
    assert.equal(queuedRun.status, "cancelled");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function startInput(): StartRunInput {
  return {
    task: "test",
    context: "small",
    cwd: process.cwd(),
    backend: "cli",
    async: true,
    model: "openai-codex/test",
    subModel: "openai-codex/test",
    mode: "auto",
    maxDepth: 1,
    maxNodes: 4,
    maxBranching: 2,
    concurrency: 1,
    maxIterations: 2,
    maxChunkChars: 1000,
    grepLimit: 10,
    timeoutMs: 1000,
    piBin: "pi",
    rBin: "Rscript",
    rLibPaths: [],
    rRepos: "https://cloud.r-project.org",
  };
}

function fakeResult(runId: string, dir: string): RlmRunResult {
  return {
    runId,
    backend: "cli",
    final: "ok",
    root: {
      id: "n1",
      depth: 0,
      task: "test",
      contextKind: "text",
      contextChars: 5,
      status: "completed",
      startedAt: Date.now(),
      finishedAt: Date.now(),
      observations: [],
      children: [],
      result: "ok",
    },
    artifacts: {
      dir: join(dir, runId),
      eventsPath: join(dir, runId, "events.jsonl"),
      treePath: join(dir, runId, "tree.json"),
      outputPath: join(dir, runId, "output.md"),
    },
    stats: { nodesVisited: 1, maxDepthSeen: 0, durationMs: 1 },
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition was not reached");
}
