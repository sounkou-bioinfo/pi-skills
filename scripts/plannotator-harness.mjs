import assert from "node:assert/strict";
import { readFile, mkdir, writeFile, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export const repo = fileURLToPath(new URL("..", import.meta.url));
const helperBin = process.env.PI_PLANNOTATOR_BIN_DIR ?? path.join(homedir(), ".pi/agent/bin");
const host = process.env.PI_PLANNOTATOR_HOST_DIR ?? path.join(repo, "node_modules/@earendil-works/pi-coding-agent");
export const sdk = await import(pathToFileURL(path.join(host, "dist/index.js")).href);
const { createAssistantMessageEventStream, InMemoryCredentialStore } = await import(pathToFileURL(path.join(host, "node_modules/@earendil-works/pi-ai/dist/index.js")).href);

export async function until(predicate, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(25);
  }
  assert.fail(label);
}

export async function openHarness(root, frames = [], source = process.env.PI_PLANNOTATOR_SOURCE ?? repo) {
  const cwd = path.join(root, "project");
  const agentDir = path.join(root, "agent");
  const urlsFile = path.join(root, "browser-urls");
  const browser = path.join(root, "browser.mjs");
  const bin = helperBin;
  await mkdir(cwd, { recursive: true });
  await mkdir(path.join(agentDir, "bin"), { recursive: true });
  for (const name of ["fd", "rg"]) {
    assert(existsSync(path.join(bin, name)), `Missing Pi helper ${bin}/${name}`);
    await symlink(path.join(bin, name), path.join(agentDir, "bin", name));
  }
  await writeFile(browser, `#!/usr/bin/env node\nimport { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(urlsFile)}, process.argv[2] + "\\n");\n`, { mode: 0o755 });
  const environment = { HOME: path.join(root, "home"), XDG_CONFIG_HOME: path.join(root, "home/.config"),
    PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", BROWSER: browser,
    SSH_CONNECTION: "127.0.0.1 51000 127.0.0.1 22", PLANNOTATOR_PORT: "0",
    PLANNOTATOR_REMOTE: undefined, PLANNOTATOR_URL_HOST: undefined, PLANNOTATOR_BROWSER: undefined,
    PLANNOTATOR_SHARE: undefined, OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined,
    GH_TOKEN: undefined, GITHUB_TOKEN: undefined };
  const saved = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  const requests = [];
  const errors = [];
  const bus = sdk.createEventBus();
  const modelRuntime = await sdk.ModelRuntime.create({ credentials: new InMemoryCredentialStore(), authPath: path.join(agentDir, "auth.json"), modelsPath: path.join(agentDir, "models.json"), modelsStorePath: path.join(agentDir, "catalog.json") });
  const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const model = { id: "fixture", name: "Offline review fixture", provider: "local-review-test", api: "local-review-test",
    baseUrl: "http://127.0.0.1:1", reasoning: false, input: ["text"], contextWindow: 100000, maxTokens: 2048,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const loader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager, eventBus: bus,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    agentsFilesOverride: () => ({ agentsFiles: [] }),
    additionalExtensionPaths: [path.join(source, "extensions/plannotator/index.ts")],
    extensionFactories: [(pi) => pi.registerProvider("local-review-test", {
      api: "local-review-test", baseUrl: "http://127.0.0.1:1", apiKey: "offline-fixture",
      models: [model],
      streamSimple(model, context) {
        requests.push({ systemPrompt: context.systemPrompt, messages: structuredClone(context.messages) });
        const content = frames.shift() ?? [{ type: "text", text: "Ready for the user's next instruction." }];
        const toolUse = content.some((part) => part.type === "toolCall");
        const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
          content, timestamp: Date.now(), stopReason: toolUse ? "toolUse" : "stop",
          usage: { input: 5, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 10,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        const stream = createAssistantMessageEventStream();
        stream.push({ type: "start", partial: message });
        content.forEach((part, contentIndex) => {
          if (part.type === "toolCall") {
            stream.push({ type: "toolcall_start", contentIndex, partial: message });
            stream.push({ type: "toolcall_end", contentIndex, toolCall: part, partial: message });
          }
        });
        stream.push({ type: "done", reason: toolUse ? "toolUse" : "stop", message });
        stream.end();
        return stream;
      },
    })],
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const manager = sdk.SessionManager.create(cwd, path.join(root, "sessions"));
  const { session } = await sdk.createAgentSession({ cwd, agentDir, modelRuntime, resourceLoader: loader,
    settingsManager, sessionManager: manager, model, thinkingLevel: "off" });
  sdk.initTheme("dark", false);
  await session.bindExtensions({ mode: "print", onError: (error) => errors.push(error) });
  await modelRuntime.setRuntimeApiKey("local-review-test", "offline-fixture");
  assert.equal(session.model?.provider, "local-review-test", "only the offline provider may run in this fixture");
  session.subscribe((event) => {
    if (event.type === "message_end" && event.message.role === "assistant" && event.message.stopReason === "error") errors.push(event.message.errorMessage ?? "Provider error");
  });
  const urls = async () => existsSync(urlsFile) ? (await readFile(urlsFile, "utf8")).trim().split("\n").filter(Boolean) : [];
  return { session, manager, bus, cwd, requests, errors, urls, frames,
    request(action, payload = {}) {
      return new Promise((resolve) => bus.emit("plannotator:request", { requestId: crypto.randomUUID(), action, payload, respond: resolve }));
    },
    async nextUrl(count = 1) {
      await until(async () => (await urls()).length >= count, `Browser URL ${count} was not opened: ${JSON.stringify(errors)}`);
      return (await urls())[count - 1];
    },
    async close() {
      for (const url of await urls()) {
        try { await fetch(new URL("/api/shutdown", url), { method: "POST", signal: AbortSignal.timeout(1000) }); }
        catch (error) { if (error?.cause?.code !== "ECONNREFUSED" && error?.name !== "TimeoutError") throw error; }
      }
      await session.abort();
      await session.extensionRunner?.emit({ type: "session_shutdown" });
      session.dispose();
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    },
  };
}
