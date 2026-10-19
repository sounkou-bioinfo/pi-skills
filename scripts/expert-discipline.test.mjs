import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const source = process.env.PI_EXPERT_SOURCE ?? repo;
const host = process.env.PI_EXPERT_HOST_DIR ?? path.join(repo, "node_modules/@earendil-works/pi-coding-agent");
const sdk = await import(pathToFileURL(path.join(host, "dist/index.js")).href);
// The host's pi-ai is nested under it or hoisted beside it.
const piAi = [path.join(host, "node_modules/@earendil-works/pi-ai"), path.join(host, "../pi-ai")].find((directory) => existsSync(directory));
const { createAssistantMessageEventStream, getCurrentSystemPrompt, getInitialSystemMessage, InMemoryCredentialStore } = await import(pathToFileURL(path.join(piAi, "dist/index.js")).href);

for (const withSkill of [true, false]) {
  test(`source-loaded nudge reaches another project's provider with skill discovery ${withSkill ? "enabled" : "disabled"}`, { timeout: 30000 }, async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), "pi-architecture-nudge-"));
    const cwd = path.join(root, "other-project");
    const agentDir = path.join(root, "agent");
    const environment = { HOME: path.join(root, "home"), XDG_CONFIG_HOME: path.join(root, "home/.config"), PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" };
    const saved = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
    let session;
    try {
      await mkdir(cwd);
      await mkdir(agentDir);
      Object.assign(process.env, environment);
      const requests = [];
      const errors = [];
      const modelRuntime = await sdk.ModelRuntime.create({ credentials: new InMemoryCredentialStore(), authPath: path.join(agentDir, "auth.json"), modelsPath: path.join(agentDir, "models.json"), modelsStorePath: path.join(agentDir, "catalog.json") });
      const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
      const model = { id: "fixture", name: "Offline nudge fixture", provider: "architecture-test", api: "architecture-test", baseUrl: "http://127.0.0.1:1", reasoning: false, input: ["text"], contextWindow: 100000, maxTokens: 128, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
      const skillPath = path.join(source, "skills/architecture-refinement/SKILL.md");
      const loader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager,
        noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
        systemPromptOverride: () => "Fixture base prompt.", agentsFilesOverride: () => ({ agentsFiles: [] }),
        additionalExtensionPaths: [path.join(source, "extensions/expert-discipline/index.ts")],
        additionalSkillPaths: withSkill ? [skillPath] : [],
        extensionFactories: [(pi) => pi.registerProvider("architecture-test", {
          api: model.api, baseUrl: model.baseUrl, apiKey: "offline-fixture", models: [model],
          streamSimple(model, context) {
            requests.push({
              systemPrompt: getCurrentSystemPrompt(context.messages),
              sections: Object.keys(getInitialSystemMessage(context.messages)?.sections ?? {}),
              messages: structuredClone(context.messages).filter((message) => message.role !== "system"),
            });
            const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
              content: [{ type: "text", text: "Fixture response." }], timestamp: Date.now(), stopReason: "stop",
              usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
            const stream = createAssistantMessageEventStream();
            stream.push({ type: "start", partial: message });
            stream.push({ type: "done", reason: "stop", message });
            stream.end();
            return stream;
          },
        })],
      });
      await loader.reload();
      assert.deepEqual(loader.getExtensions().errors, []);
      assert.deepEqual(loader.getSkills().diagnostics, []);
      assert.deepEqual(loader.getSkills().skills.map((skill) => skill.filePath), withSkill ? [skillPath] : []);
      ({ session } = await sdk.createAgentSession({ cwd, agentDir, modelRuntime, settingsManager, resourceLoader: loader,
        sessionManager: sdk.SessionManager.inMemory(cwd), tools: ["read"], model, thinkingLevel: "off" }));
      sdk.initTheme("dark", false);
      await session.bindExtensions({ mode: "print", onError: (error) => errors.push(error) });
      await modelRuntime.setRuntimeApiKey(model.provider, "offline-fixture");
      assert.equal(session.model?.provider, "architecture-test");
      await session.prompt("Review this project's uncertain architecture.");
      await session.prompt("Refine the issue using the available evidence.");
      for (const message of session.messages) {
        if (message.role === "assistant") assert.notEqual(message.stopReason, "error", message.errorMessage);
      }
      assert.equal(requests.length, 2);
      assert.equal(requests[1].systemPrompt, requests[0].systemPrompt, "stable context retains identical provider-visible system-prompt bytes across turns");
      for (const request of requests) {
        assert(request.systemPrompt.startsWith("Fixture base prompt."));
        for (const section of ["expert_decision_discipline", "architecture_refinement"]) {
          assert(request.sections.includes(section), "the prompt stays structured, with each policy as a named section");
          assert.equal(request.systemPrompt.split(`<${section}>`).length - 1, 1);
        }
        assert.match(request.systemPrompt, /When architecture-refinement is available in the skill list/);
        assert.match(request.systemPrompt, /Do not wait for the user to name the skill/);
        assert.match(request.systemPrompt, /Do not run independent models on one unchanged question merely to rank outputs/);
        assert.match(request.systemPrompt, /revisit with new evidence, or honor user-requested comparisons/);
        assert.equal(request.systemPrompt.includes(`<location>${skillPath}</location>`), withSkill);
        assert(!request.systemPrompt.includes("## Explore, challenge, and consolidate"), "the full workflow is loaded on demand");
      }
      assert.deepEqual(requests[0].messages.map((message) => message.role), ["user"]);
      assert.deepEqual(session.messages.map((message) => message.role), ["system", "user", "assistant", "user", "assistant"],
        "one leading prompt serves both turns; the nudge adds no prompt update, conversation message, or tool call");
      if (withSkill) {
        await session.prompt("/skill:architecture-refinement Examine the next bounded experiment.");
        assert.equal(requests.length, 3);
        const expanded = JSON.stringify(requests[2].messages.at(-1));
        assert(expanded.includes("## Bring our R-developer EDA ethos to coding"));
        assert(expanded.includes("Examine the next bounded experiment."));
      }
      assert.deepEqual(errors, []);
      const version = JSON.parse(await readFile(path.join(host, "package.json"), "utf8")).version;
      const hash = createHash("sha256").update(await readFile(skillPath)).digest("hex");
      t.diagnostic(`Pi ${version}; source=${source}; skill SHA256=${hash}; offline prompt/discovery/command boundary, not model adherence`);
    } finally {
      if (session) { await session.abort(); session.dispose(); }
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      await rm(root, { recursive: true, force: true });
    }
  });
}
