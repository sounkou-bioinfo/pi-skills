import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const host = process.env.PI_MEMORY_HOST_DIR ?? path.join(repo, "node_modules/@earendil-works/pi-coding-agent");
const sdk = await import(pathToFileURL(path.join(host, "dist/index.js")).href);
// The host's pi-ai is nested under it or hoisted beside it.
const piAi = [path.join(host, "node_modules/@earendil-works/pi-ai"), path.join(host, "../pi-ai")].find((directory) => existsSync(directory));
const { createAssistantMessageEventStream, getCurrentSystemPrompt, getInitialSystemMessage, InMemoryCredentialStore } = await import(pathToFileURL(path.join(piAi, "dist/index.js")).href);

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const text = (message) => typeof message.content === "string" ? message.content : message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");

test("source-loaded memory keeps the prompt structured and stable while the projection follows new notes", { timeout: 60000 }, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-memory-sdk-"));
  const cwd = path.join(root, "project");
  const agentDir = path.join(root, "agent");
  const environment = {
    HOME: path.join(root, "home"), XDG_CONFIG_HOME: path.join(root, "home/.config"), PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1",
    PI_MEMORY_DB: path.join(root, "memory.sqlite"), PI_MEMORY_PROJECT: "sdk-fixture",
  };
  const saved = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  let session;
  try {
    await mkdir(cwd);
    await mkdir(agentDir);
    await mkdir(path.join(environment.HOME, ".config"), { recursive: true });
    Object.assign(process.env, environment);
    const requests = [];
    const frames = [];
    const errors = [];
    const modelRuntime = await sdk.ModelRuntime.create({ credentials: new InMemoryCredentialStore(), authPath: path.join(agentDir, "auth.json"), modelsPath: path.join(agentDir, "models.json"), modelsStorePath: path.join(agentDir, "catalog.json") });
    const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    const model = { id: "fixture", name: "Offline memory fixture", provider: "memory-test", api: "memory-test", baseUrl: "http://127.0.0.1:1", reasoning: false, input: ["text"], contextWindow: 100000, maxTokens: 128, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const loader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
      systemPromptOverride: () => "Fixture base prompt.", agentsFilesOverride: () => ({ agentsFiles: [] }),
      additionalExtensionPaths: [path.join(repo, "extensions/memory/index.ts")],
      extensionFactories: [(pi) => pi.registerProvider("memory-test", {
        api: model.api, baseUrl: model.baseUrl, apiKey: "offline-fixture", models: [model],
        streamSimple(model, context) {
          requests.push({
            systemPrompt: getCurrentSystemPrompt(context.messages),
            sections: Object.keys(getInitialSystemMessage(context.messages)?.sections ?? {}),
            roles: context.messages.map((message) => message.role),
            texts: context.messages.filter((message) => message.role === "user").map(text),
          });
          const content = frames.shift() ?? [{ type: "text", text: "Fixture response." }];
          const toolUse = content.some((part) => part.type === "toolCall");
          const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
            content, timestamp: Date.now(), stopReason: toolUse ? "toolUse" : "stop", usage };
          const stream = createAssistantMessageEventStream();
          stream.push({ type: "start", partial: message });
          stream.push({ type: "done", reason: toolUse ? "toolUse" : "stop", message });
          stream.end();
          return stream;
        },
      })],
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    ({ session } = await sdk.createAgentSession({ cwd, agentDir, modelRuntime, settingsManager, resourceLoader: loader,
      sessionManager: sdk.SessionManager.inMemory(cwd), model, thinkingLevel: "off" }));
    sdk.initTheme("dark", false);
    await session.bindExtensions({ mode: "print", onError: (error) => errors.push(error) });
    await modelRuntime.setRuntimeApiKey(model.provider, "offline-fixture");

    frames.push([{ type: "toolCall", id: "note-1", name: "memory", arguments: { op: "note", text: "The fixture aligner is minimap2.", subject: "fixture:aligner", predicate: "design:decision" } }]);
    await session.prompt("Record the aligner decision.");
    await session.prompt("Which aligner does the fixture use?");
    for (const message of session.messages) {
      if (message.role === "assistant") assert.notEqual(message.stopReason, "error", message.errorMessage);
    }
    assert.deepEqual(errors, []);
    assert.equal(requests.length, 3, "the note turn makes two requests and the next turn one");

    for (const request of requests) {
      assert.equal(request.roles.filter((role) => role === "system").length, 1, "the prompt is sent once, with no later prompt update");
      assert.equal(request.roles[0], "system");
      assert(request.sections.includes("permanent_memory"), "the policy is a named section of a structured prompt");
      assert.equal(request.systemPrompt, requests[0].systemPrompt, "notes never change the provider-visible prompt");
      assert(request.systemPrompt.startsWith("Fixture base prompt."));
      assert.equal(request.systemPrompt.split("<permanent_memory>\nPERMANENT MEMORY POLICY\n").length - 1, 1);
      assert(!request.systemPrompt.includes("minimap2"));

      const projections = request.texts.filter((entry) => entry.includes("<memory_projection"));
      assert.equal(projections.length, 1, "each request carries one projection; earlier ones are replaced");
      assert.equal(request.texts.at(-2), projections[0], "the projection sits immediately before the current user message");
    }
    const [noteRequest, noteResult, recall] = requests.map((request) => request.texts.find((entry) => entry.includes("<memory_projection")));
    assert(!noteRequest.includes("minimap2"));
    assert.equal(noteResult, noteRequest, "the projection is frozen through a turn's tool loop");
    assert.match(recall, /Project: sdk-fixture;/);
    assert.match(recall, /\[project:sdk-fixture; tx \d+; fixture:aligner design:decision\] The fixture aligner is minimap2\./);
    assert.equal(requests[2].texts.at(-1), "Which aligner does the fixture use?");
    assert(session.messages.every((message) => message.role !== "custom"), "the projection is request-local and is not stored in the session");

    await session.prompt("Which aligner does the fixture use?");
    assert.equal(requests.length, 4);
    assert.deepEqual(requests[3].texts.slice(0, requests[2].texts.length), requests[2].texts,
      "an unchanged fresh snapshot retains its earlier position across user turns");
    assert.equal(requests[3].texts.filter((entry) => entry.includes("<memory_projection")).length, 1);
    assert.equal(requests[3].systemPrompt, requests[2].systemPrompt);
    assert(session.messages.every((message) => message.role !== "custom"));

    const version = JSON.parse(await readFile(path.join(host, "package.json"), "utf8")).version;
    t.diagnostic(`Pi ${version}; offline provider boundary: prompt structure and projection placement, not provider cache hits or model use of memory`);
  } finally {
    if (session) { await session.abort(); session.dispose(); }
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
