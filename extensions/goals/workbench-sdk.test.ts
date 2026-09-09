import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createAssistantMessageEventStream, InMemoryCredentialStore, type AssistantMessage, type ToolCall } from "@earendil-works/pi-ai";
import { createAgentSession, createEventBus, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { COMPLETION_READY } from "../completions/index.js";
import { readWorkbench, workbenchEvidence } from "./workbench.js";

const contract = {
  acceptance: "Observe independently specified file contents.", invariants: "Preserve input fixtures.",
  autonomy: "Run local shell probes in the isolated test directory.", escalation: "Pause for review of the recorded evidence.",
};
const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const call = (id: string, name: string, args: Record<string, unknown>): ToolCall => ({ type: "toolCall", id, name, arguments: args });

type Frame = ToolCall[] | (() => ToolCall[]);
async function sdk(root: string, frames: Frame[], sessionFile?: string) {
  let requests = 0;
  const errors: string[] = [];
  const bus = createEventBus();
  const manager = sessionFile ? SessionManager.open(sessionFile) : SessionManager.create(root, join(root, "sessions"));
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new DefaultResourceLoader({
    cwd: root, agentDir: join(root, "agent"), settingsManager: settings, eventBus: bus,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    agentsFilesOverride: () => ({ agentsFiles: [] }), systemPromptOverride: () => "Deterministic offline workbench integration.",
    additionalExtensionPaths: [fileURLToPath(new URL("./index.js", import.meta.url)), fileURLToPath(new URL("../completions/index.js", import.meta.url))],
    extensionFactories: [(pi) => {
      pi.registerProvider("workbench-test", {
        baseUrl: "http://127.0.0.1:1", apiKey: "offline-fixture", api: "workbench-test",
        models: [{ id: "scripted", name: "Scripted offline fixture", reasoning: false, input: ["text"], cost, contextWindow: 100000, maxTokens: 1000 }],
        streamSimple(model) {
          const frame = frames[requests++];
          const calls = typeof frame === "function" ? frame() : frame ?? [];
          const message: AssistantMessage = {
            role: "assistant", api: model.api, provider: model.provider, model: model.id,
            content: calls.length ? calls : [{ type: "text", text: "Stopped." }],
            stopReason: calls.length ? "toolUse" : "stop", timestamp: Date.now(),
            usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { ...cost, total: 0 } },
          };
          const stream = createAssistantMessageEventStream();
          stream.push({ type: "start", partial: message });
          for (const [contentIndex, toolCall] of calls.entries()) {
            stream.push({ type: "toolcall_start", contentIndex, partial: message });
            stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: message });
          }
          stream.push({ type: "done", reason: calls.length ? "toolUse" : "stop", message });
          stream.end();
          return stream;
        },
      });
    }],
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), authPath: join(root, "auth.json"), modelsPath: join(root, "models.json") });
  const { session } = await createAgentSession({
    cwd: root, agentDir: join(root, "agent"), resourceLoader: loader, sessionManager: manager, settingsManager: settings,
    modelRuntime: runtime, tools: ["bash", "get_goal", "record_checkpoint", "propose_contract"], thinkingLevel: "off",
    model: { id: "scripted", name: "Scripted offline fixture", provider: "workbench-test", api: "workbench-test", baseUrl: "http://127.0.0.1:1", reasoning: false, input: ["text"], cost, contextWindow: 100000, maxTokens: 1000 },
  });
  await session.bindExtensions({ mode: "print", onError: (error) => errors.push(error.error) });
  assert(session.getActiveToolNames().includes("record_checkpoint"), JSON.stringify({ active: session.getActiveToolNames(), registered: session.getAllTools().map((tool) => tool.name) }));
  return {
    session, manager, bus, errors, requests: () => requests,
    async configure(allowance: number) {
      await session.prompt("/goals Verify probe outputs --no-auto");
      await session.prompt(`/workbench contract ${JSON.stringify(contract)}`);
      await session.prompt(`/workbench resume ${allowance}`);
      assert.deepEqual(errors, []);
      assert.equal(requests, 0, "user commands must not invoke the provider");
    },
    async close() {
      await session.abort();
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      session.dispose();
    },
  };
}

test("real SDK blocks excess shell calls and suppresses goal continuation", { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-workbench-sdk-"));
  const paths = ["one", "two", "three", "four"].map((name) => join(root, name));
  const probes = paths.map((path, index) => call(`shell-${index}`, "bash", { command: `printf observed > ${JSON.stringify(path)}` }));
  const h = await sdk(root, [probes.slice(0, 3), probes.slice(3)]);
  try {
    await h.configure(2);
    await h.session.prompt("/goals auto on");
    await h.session.prompt("Run the probes.");
    await h.session.waitForIdle();
    assert.deepEqual(paths.map(existsSync), [true, true, false, false]);
    assert.equal(h.requests(), 2, "mixed allowed/blocked batch can take one follow-up; wholly blocked batch terminates");
    const state = readWorkbench(h.manager.getBranch())!;
    assert.equal(state.phase, "paused");
    assert.equal(state.admissions, 2);
    const blocked = workbenchEvidence(h.manager.getBranch()).filter((item) => item.isError);
    assert(blocked.length >= 2);
    assert(blocked.every((item) => /Workbench paused/.test(item.output)));
    assert.equal(h.session.pendingMessageCount, 0);
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("real checkpoint retains inspectable evidence and pauses without approving the goal", { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-workbench-checkpoint-"));
  let evidenceId = "";
  let h: Awaited<ReturnType<typeof sdk>>;
  h = await sdk(root, [
    [call("observation", "bash", { command: "printf 'GT=0|.\\n'" })],
    () => {
      evidenceId = workbenchEvidence(h.manager.getBranch())[0].id;
      return [call("checkpoint", "record_checkpoint", { statement: "Observed the fixture output", evidenceIds: [evidenceId], uncertainty: "One fixture only", nextDecision: "Review scope" })];
    },
  ]);
  try {
    await h.configure(10);
    await h.session.prompt("Observe and record.");
    assert.equal(h.requests(), 2, JSON.stringify({ errors: h.errors, evidence: workbenchEvidence(h.manager.getBranch()) }));
    const state = readWorkbench(h.manager.getBranch())!;
    assert.equal(state.phase, "paused");
    assert.deepEqual(state.checkpoint?.evidenceIds, [evidenceId]);
    await h.session.prompt(`/workbench evidence ${evidenceId}`);
    assert(h.manager.getBranch().some((entry) => entry.type === "custom_message" && entry.customType === "pi-workbench-view" && String(entry.content).includes("GT=0|.")));
    await h.session.prompt("/workbench resume 3");
    assert.equal(h.requests(), 2);
    assert.equal(readWorkbench(h.manager.getBranch())?.phase, "running");
    const sessionFile = h.manager.getSessionFile()!;
    await h.close();
    h = await sdk(root, [], sessionFile);
    assert.equal(readWorkbench(h.manager.getBranch())?.phase, "paused", "disk restoration requires user renewal");
    assert.equal(h.requests(), 0);
    assert.equal(readWorkbench(h.manager.getBranch())?.checkpoint?.evidenceIds[0], evidenceId);
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("completion notices remain visible without waking a paused real session", { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-workbench-completion-"));
  const h = await sdk(root, []);
  try {
    await h.configure(2);
    await h.session.prompt("/workbench pause");
    h.bus.emit(COMPLETION_READY, { sessionId: h.manager.getSessionId(), key: "fixture:done", content: "Worker evidence available", wake: true });
    await delay(180);
    assert.equal(h.requests(), 0);
    const notices = h.manager.getBranch().filter((entry) => entry.type === "custom_message" && entry.customType === "task-completions");
    assert.equal(notices.length, 1);
    await h.session.prompt("/workbench resume 2");
    await delay(180);
    assert.equal(h.requests(), 0, "observed completion must not become a deferred wake after renewal");
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("pause allows an admitted shell operation to finish and blocks its successor", { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-workbench-pause-"));
  const first = join(root, "first");
  const second = join(root, "second");
  const h = await sdk(root, [
    [call("running", "bash", { command: `printf started > ${JSON.stringify(first)}; sleep 0.3; printf finished >> ${JSON.stringify(first)}` })],
    [call("next", "bash", { command: `printf unexpected > ${JSON.stringify(second)}` })],
  ]);
  try {
    await h.configure(10);
    const running = h.session.prompt("Run the first operation.");
    for (let attempt = 0; attempt < 100 && !existsSync(first); attempt++) await delay(10);
    assert(existsSync(first), "the admitted operation must start before pause");
    await h.session.prompt("/workbench pause");
    await running;
    assert.equal(await readFile(first, "utf8"), "startedfinished");
    assert.equal(existsSync(second), false);
    assert.equal(h.requests(), 2);
    assert.deepEqual(h.errors, []);
  } finally {
    await h.close();
    await rm(root, { recursive: true, force: true });
  }
});
