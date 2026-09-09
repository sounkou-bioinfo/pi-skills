import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const root = await mkdtemp(path.join(tmpdir(), "pi-workbench-pty-"));
const socket = `pi-workbench-test-${process.pid}`;
const sessionFile = path.join(root, "session.jsonl");
const providerFile = path.join(root, "offline-provider.mjs");
const modelCalled = path.join(root, "model-called");
const tmux = (...args) => execFileSync("tmux", ["-L", socket, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const screen = () => tmux("capture-pane", "-p", "-t", "workbench");
const key = (...keys) => tmux("send-keys", "-t", "workbench", ...keys);
const command = (text) => { tmux("send-keys", "-t", "workbench", "-l", text); key("Enter"); };
async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 160; attempt++) {
    if (await predicate()) return;
    await delay(50);
  }
  assert.fail(`${label}\n${screen()}`);
}

try {
  await writeFile(providerFile, `import { writeFileSync } from "node:fs";
export default function(pi) {
  pi.registerProvider("workbench-pty", {
    api: "workbench-pty", baseUrl: "http://127.0.0.1:1", apiKey: "offline-only",
    models: [{ id: "scripted", name: "Offline PTY sentinel", reasoning: false, input: ["text"], contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple() { writeFileSync(${JSON.stringify(modelCalled)}, "called"); throw new Error("Command-only PTY test must not invoke a model"); }
  });
}
`);
  tmux("-f", "/dev/null", "new-session", "-d", "-s", "workbench", "-x", "80", "-y", "30", "-c", root,
    "env", "-i", `PATH=${process.env.PATH}`, `HOME=${root}`, "TERM=xterm-256color", "PI_SKIP_VERSION_CHECK=1", `PI_CODING_AGENT_DIR=${path.join(root, "agent")}`,
    process.execPath, path.join(repo, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
    "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--session", sessionFile,
    "-e", path.join(repo, "extensions/goals/index.ts"), "-e", providerFile, "--provider", "workbench-pty", "--model", "scripted");
  await waitFor(() => /(?:π|pi v|No model|ctrl|Ctrl)/.test(screen()), "Pi terminal must become ready");
  command("/goals Preserve GT semantics --no-auto");
  await waitFor(() => screen().includes("Preserve GT semantics"), "goal command must render");
  const contract = { acceptance: "Fixture agrees", invariants: "Keep missingness", autonomy: "Local tests", escalation: "Ask before changing semantics" };
  command(`/workbench contract ${JSON.stringify(contract)}`);
  await waitFor(() => screen().includes("Workbench PAUSED"), "approved contract must render paused");
  command("/workbench resume 2");
  await waitFor(() => screen().includes("Workbench RUNNING"), "renewed allowance must render");
  command("/workbench show");
  await waitFor(() => screen().includes("Esc close"), "read-only view must open");
  key("PageDown");
  await waitFor(() => screen().includes("Agent checkpoint"), "view must scroll to checkpoint section");
  key("Escape");
  await waitFor(() => !screen().includes("Esc close"), "Escape must return input focus");
  tmux("resize-window", "-t", "workbench", "-x", "40", "-y", "24");
  command("/workbench pause");
  await waitFor(() => screen().includes("Workbench PAUSED"), "pause command must work after narrow resize");
  command("/workbench contract");
  await waitFor(() => screen().includes("Workbench contract"), "native contract editor must open");
  key("Escape");
  await waitFor(() => !screen().includes("Workbench contract"), "editor cancellation must return input focus");
  command("/workbench show");
  await waitFor(() => screen().includes("Tool admissions:"), "narrow evidence view must render without overflow");
  key("Escape");
  await waitFor(() => !screen().includes("Esc close"), "narrow view must return input focus");
  command("/workbench off");
  await waitFor(() => screen().includes("Workbench disabled"), "off command must restore normal goal display");
  key("C-d");
  await delay(100);
  assert(!existsSync(modelCalled), "command-only terminal smoke must not invoke a model");
  console.log("PASS: actual Pi TUI commands, review scrolling, editor cancellation, 80/40-column resize and input focus; no model calls.");
} finally {
  try { tmux("kill-server"); } catch (error) { if (!/no server running|error connecting|No such file/.test(String(error.stderr))) throw error; }
  await rm(root, { recursive: true, force: true });
}
