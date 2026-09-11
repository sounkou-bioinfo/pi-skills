import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const source = process.env.PI_WORKBENCH_SOURCE ?? repo;
const cli = process.env.PI_WORKBENCH_CLI ?? path.join(repo, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
const hostBin = process.env.PI_WORKBENCH_BIN_DIR ?? path.join(homedir(), ".pi/agent/bin");
const root = await mkdtemp(path.join(tmpdir(), "pi-workbench-pty-"));
const socket = `pi-workbench-test-${process.pid}`;
const callsFile = path.join(root, "model-calls");
const providerFile = path.join(root, "offline-provider.mjs");
const tmux = (...args) => execFileSync("tmux", ["-L", socket, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const screen = () => tmux("capture-pane", "-p", "-t", "workbench");
const key = (...keys) => tmux("send-keys", "-t", "workbench", ...keys);
const command = (text) => { tmux("send-keys", "-t", "workbench", "-l", text); key("Enter"); };
const calls = async () => existsSync(callsFile) ? (await readFile(callsFile, "utf8")).trim().split("\n").length : 0;
async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 160; attempt++) {
    if (await predicate()) return;
    await delay(50);
  }
  assert.fail(`${label}\n${screen()}`);
}
async function readPlan() {
  for (let page = 0; page < 50 && !screen().includes("Plan shown"); page++) { key("Space"); await delay(30); }
  assert(screen().includes("Plan shown"), screen());
}
async function capture(name) {
  if (!process.env.PI_WORKBENCH_PREVIEW_DIR) return;
  await mkdir(process.env.PI_WORKBENCH_PREVIEW_DIR, { recursive: true });
  await writeFile(path.join(process.env.PI_WORKBENCH_PREVIEW_DIR, name), screen());
}
let started = false;
try {
  const bin = path.join(root, "agent/bin");
  await mkdir(bin, { recursive: true });
  for (const tool of ["fd", "rg"]) {
    assert(existsSync(path.join(hostBin, tool)), `PTY prerequisite missing: ${hostBin}/${tool}; set PI_WORKBENCH_BIN_DIR to installed Pi helper binaries.`);
    await symlink(path.join(hostBin, tool), path.join(bin, tool));
  }
  await writeFile(providerFile, `import { appendFileSync } from "node:fs";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
export default function(pi) {
  pi.on("session_start", (_event, ctx) => ctx.ui.setStatus("pty-ready", "PTY READY"));
  pi.registerProvider("workbench-pty", {
    api: "workbench-pty", baseUrl: "http://127.0.0.1:1", apiKey: "offline-only",
    models: [{ id: "scripted", name: "Offline PTY fixture", reasoning: false, input: ["text"], contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context) {
      appendFileSync(${JSON.stringify(callsFile)}, "called\\n");
      const user = context.messages.filter(message => message.role === "user").at(-1);
      const text = typeof user?.content === "string" ? user.content : user?.content.map(part => part.text ?? "").join("");
      const needsInput = text === "ASK_FOR_INPUT";
      const content = needsInput
        ? [{ type: "toolCall", id: "question", name: "request_human_input", arguments: { question: "Which outcome should I pursue?", reason: "The task needs a human decision." } }]
        : [{ type: "text", text: "Scripted preview response; no project work performed." }];
      const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, content,
        stopReason: needsInput ? "toolUse" : "stop", timestamp: Date.now(),
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "start", partial: message });
      if (needsInput) {
        stream.push({ type: "toolcall_start", contentIndex: 0, partial: message });
        stream.push({ type: "toolcall_end", contentIndex: 0, toolCall: content[0], partial: message });
      }
      stream.push({ type: "done", reason: needsInput ? "toolUse" : "stop", message });
      stream.end();
      return stream;
    }
  });
}
`);
  tmux("-f", "/dev/null", "new-session", "-d", "-s", "workbench", "-x", "80", "-y", "30", "-c", root,
    "env", "-i", `PATH=${process.env.PATH}`, `HOME=${root}`, "TERM=xterm-256color", "PI_SKIP_VERSION_CHECK=1", `PI_CODING_AGENT_DIR=${path.join(root, "agent")}`,
    process.execPath, cli, "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes",
    "-e", path.join(source, "extensions/goals/index.ts"), "-e", path.join(source, "extensions/completions/index.ts"),
    "-e", providerFile, "--provider", "workbench-pty", "--model", "scripted");
  started = true;
  await waitFor(() => screen().includes("PTY READY"), "Pi must finish session initialization before commands");
  command("/goals Inspect the directory --no-auto");
  await waitFor(() => screen().includes("Goal active: Inspect the directory"), "goal command must execute");
  const contract = { acceptance: "Names of files in this directory", invariants: "No files changed", autonomy: "List the directory", escalation: "Your request is ambiguous" };
  command(`/workbench contract ${JSON.stringify(contract)}`);
  await waitFor(() => screen().includes("Work paused"), "prepared plan must be paused");
  command("/workbench");
  await waitFor(() => screen().includes("Approve & start"), "plain-language task card must open");
  assert(!screen().includes('"acceptance"'), "the task card must not display JSON");
  assert.equal(screen().split("\n")[0].trim(), "Review work", "the card must cover the chat, not overlap its text");
  assert(!screen().includes("PTY READY"), "the review surface must cover background status text");
  await capture("review-80.txt");
  key("e");
  await waitFor(() => screen().includes("Change the plan"), "change action must open a field picker");
  key("Enter");
  await waitFor(() => screen().includes("shift+enter"), "field editor must open");
  key("C-a", "C-k");
  tmux("send-keys", "-t", "workbench", "-l", "A short directory summary.");
  key("Enter");
  await waitFor(() => screen().includes("Approve & start"), "edited plan must return to review");
  key("Escape");
  await waitFor(() => !screen().includes("Approve & start"), "cancel must restore input focus");
  assert.equal(await calls(), 0, "editing and cancellation must not start a model");
  command("/workbench");
  await waitFor(() => screen().includes("Approve & start"), "review must reopen");
  assert(screen().includes("Names of files in this directory"), "cancelled edits must not replace the approved contract");
  tmux("resize-window", "-t", "workbench", "-x", "40", "-y", "24");
  await delay(80);
  await capture("review-40.txt");
  assert.equal(screen().split("\n")[0].trim(), "Review work", "the resized card must cover the full screen");
  await readPlan();
  key("a");
  await waitFor(async () => (await calls()) === 1 && screen().includes("Working"), "approval must start exactly one model turn");
  await delay(180);
  assert.equal(await calls(), 1);
  command("/goals auto on");
  await waitFor(() => screen().includes("auto-continue enabled"), "auto continuation must be enabled for the hold test");
  command("ASK_FOR_INPUT");
  await waitFor(() => screen().includes("Needs your input"), "agent input request must pause work");
  await delay(250);
  assert.equal(await calls(), 2, "the input request must not cause an automatic continuation loop");
  await capture("needs-input-40.txt");
  command("/goals auto off");
  await waitFor(() => screen().includes("auto-continue disabled"), "auto flag can change without answering the question");
  command("/workbench");
  await waitFor(() => screen().includes("Reply & start"), "held task must offer an explicit human reply");
  await readPlan();
  key("a");
  await waitFor(() => screen().includes("Your answer:"), "reply action must ask for the human answer");
  tmux("send-keys", "-t", "workbench", "-l", "Keep the inspection read-only.");
  key("Enter");
  await waitFor(async () => (await calls()) === 3 && screen().includes("Working"), "human answer must explicitly restart work");
  await delay(180);
  assert.equal(await calls(), 3);
  command("/workbench pause");
  await waitFor(() => screen().includes("Work paused"), "manual pause remains available");
  console.log("PASS: actual task-card review/change/cancel/start, 80/40-column resize, explicit needs_input hold and human reply; scripted provider only.");
} finally {
  if (started) tmux("kill-server");
  await rm(root, { recursive: true, force: true });
}
