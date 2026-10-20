import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { Type } from "typebox";

const repo = fileURLToPath(new URL("..", import.meta.url));
const host = path.join(repo, "node_modules/@earendil-works/pi-coding-agent");
const sdk = await import(pathToFileURL(path.join(host, "dist/index.js")).href);
const piAi = [path.join(host, "node_modules/@earendil-works/pi-ai"), path.join(host, "../pi-ai")].find((directory) => existsSync(directory));
const { createAssistantMessageEventStream, InMemoryCredentialStore } = await import(pathToFileURL(path.join(piAi, "dist/index.js")).href);

test("source-loaded cache extensions preserve provider prefixes, session reopen and active-branch omissions", { timeout: 30000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-cache-context-"));
  const cwd = path.join(root, "project"), agentDir = path.join(root, "agent");
  const environment = { HOME: path.join(root, "home"), XDG_CONFIG_HOME: path.join(root, "home/.config"),
    PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", PI_CONTEXT_TOOL_RESULT_BYTES: "4096", PI_CONTEXT_TOOL_RESULTS_TOTAL_BYTES: "16384" };
  const saved = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  let session;
  try {
    await mkdir(cwd); await mkdir(agentDir);
    Object.assign(process.env, environment);
    const runtime = await sdk.ModelRuntime.create({ credentials: new InMemoryCredentialStore(), authPath: path.join(agentDir, "auth.json"),
      modelsPath: path.join(agentDir, "models.json"), modelsStorePath: path.join(agentDir, "catalog.json") });
    const settings = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    const model = { id: "fixture", name: "Offline cache fixture", provider: "cache-test", api: "cache-test", baseUrl: "http://127.0.0.1:1",
      reasoning: false, input: ["text"], contextWindow: 1000000, maxTokens: 128, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    let manager = sdk.SessionManager.create(cwd, path.join(root, "sessions"));
    const requests = [], errors = [];
    let timestamp = Date.now();
    const loader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager: settings,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
      systemPromptOverride: () => "Stable offline cache fixture.", agentsFilesOverride: () => ({ agentsFiles: [] }),
      additionalExtensionPaths: [path.join(repo, "extensions/context-budget/index.ts"), path.join(repo, "extensions/cache-telemetry/index.ts")],
      extensionFactories: [(pi) => {
        pi.registerTool({ name: "read", label: "Fixture read", description: "Return deterministic inspection text", parameters: Type.Object({}),
          async execute() { return { content: [{ type: "text", text: "x".repeat(4000) }] }; } });
        pi.registerProvider("cache-test", { api: model.api, baseUrl: model.baseUrl, apiKey: "offline", models: [model],
          streamSimple(model, context, options) {
            requests.push({ messages: structuredClone(context.messages),
              trimCount: manager.getBranch().filter((e) => e.type === "custom" && e.customType === "context-budget-omissions-v1").length });
            const toolUse = context.messages.at(-1)?.role === "user";
            const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
              content: toolUse ? [{ type: "toolCall", id: `fixture-${requests.length}`, name: "read", arguments: {} }] : [{ type: "text", text: "Done." }],
              timestamp: ++timestamp, stopReason: toolUse ? "toolUse" : "stop",
              usage: { input: 5000, output: 100, cacheRead: 100000, cacheWrite: 0, totalTokens: 105100,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 1 } } };
            const stream = createAssistantMessageEventStream();
            queueMicrotask(async () => {
              try {
                await options?.onPayload?.({ messages: context.messages }, model);
                stream.push({ type: "start", partial: message });
                stream.push({ type: "done", reason: message.stopReason, message });
              } catch (error) {
                message.stopReason = "error";
                message.errorMessage = String(error);
                stream.push({ type: "error", reason: "error", error: message });
              }
              stream.end();
            });
            return stream;
          } });
      }],
    });
    const open = async () => {
      await loader.reload();
      assert.deepEqual(loader.getExtensions().errors, []);
      ({ session } = await sdk.createAgentSession({ cwd, agentDir, modelRuntime: runtime, settingsManager: settings,
        resourceLoader: loader, sessionManager: manager, tools: ["read"], model, thinkingLevel: "off" }));
      sdk.initTheme("dark", false);
      await session.bindExtensions({ mode: "print", onError: (error) => errors.push(error) });
      await runtime.setRuntimeApiKey(model.provider, "offline");
    };
    await open();
    for (let i = 0; i < 12; i++) await session.prompt(`Inspect fixture ${i}.`);
    assert.equal(requests.length, 24);
    let changed = 0;
    for (let i = 1; i < requests.length; i++) {
      const before = requests[i - 1], after = requests[i];
      if (before.trimCount === after.trimCount) {
        assert.equal(JSON.stringify(after.messages.slice(0, before.messages.length)), JSON.stringify(before.messages));
      } else changed++;
      const inspections = after.messages.filter((m) => m.role === "toolResult");
      assert(inspections.filter((m) => !m.content[0].text.startsWith("[Context budget:")).length * 4000 <= 16384,
        JSON.stringify({ i, trimCount: after.trimCount, inspections: inspections.map((m) => ({ toolName: m.toolName, text: m.content[0].text.slice(0,40) })), errors }));
      assert(!JSON.stringify(after.messages).includes("cache-telemetry-v1"));
    }
    assert.equal(changed, 3);
    const branch = manager.getBranch();
    const telemetry = branch.filter((e) => e.type === "custom" && e.customType === "cache-telemetry-v1");
    assert.equal(telemetry.length, 24);
    assert(telemetry.every((e) => e.data.provider === model.provider && e.data.classification === "hit"));
    const trims = branch.filter((e) => e.type === "custom" && e.customType === "context-budget-omissions-v1");
    assert.equal(telemetry.filter((e) => e.data.trimmedResults > 0).length, trims.length);
    assert.equal(telemetry.reduce((sum, e) => sum + (e.data.trimmedResults ?? 0), 0),
      trims.reduce((sum, e) => sum + e.data.length, 0));
    for (let i = 1; i < telemetry.length; i++) {
      assert.equal(telemetry[i].data.providerPayload.prefixStable, requests[i].trimCount === requests[i - 1].trimCount);
    }
    const file = manager.getSessionFile();
    session.dispose(); session = undefined;
    manager = sdk.SessionManager.open(file);
    await open();
    const count = requests.length;
    await session.prompt("/cache 2");
    assert.equal(requests.length, count, "the command never starts a model request");
    await session.prompt("Inspect after reopening.");
    assert.equal(requests.length, 26);
    const before = requests[23].messages.filter((m) => m.role === "toolResult");
    const after = requests[24].messages.filter((m) => m.role === "toolResult");
    assert.equal(JSON.stringify(after), JSON.stringify(before), "reopen restores exactly the previously sent inspection bytes");
    assert.equal(manager.getBranch().filter((e) => e.type === "custom" && e.customType === "cache-telemetry-v1").length, 26);
    const anchor = branch.filter((e) => e.type === "message" && e.message.role === "assistant" && e.message.stopReason === "stop")[1];
    await session.navigateTree(anchor.id, { summarize: false });
    await session.prompt("Inspect the selected branch.");
    const selected = requests[26].messages.filter((m) => m.role === "toolResult");
    assert.equal(selected.length, 2);
    assert(selected.every((m) => m.content[0].text === "x".repeat(4000)), "tree navigation restores the selected branch's omission decisions");
    assert.deepEqual(errors, []);
  } finally {
    if (session) { await session.abort(); session.dispose(); }
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
