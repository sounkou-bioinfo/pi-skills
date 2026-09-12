import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { homedir, networkInterfaces, tmpdir, userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";

const repo = fileURLToPath(new URL("..", import.meta.url));
const source = process.env.PI_PLANNOTATOR_SOURCE ?? repo;
const host = process.env.PI_PLANNOTATOR_HOST_DIR ?? path.join(repo, "node_modules/@earendil-works/pi-coding-agent");
const chrome = process.env.PI_PLANNOTATOR_CHROMIUM ?? path.join(homedir(), ".cache/ms-playwright/chromium-1228/chrome-linux64/chrome");
const helperBin = process.env.PI_PLANNOTATOR_BIN_DIR ?? path.join(homedir(), ".pi/agent/bin");
const root = await mkdtemp(path.join(tmpdir(), "pi-plannotator-ui-"));
const project = path.join(root, "project");
const socket = `pi-plannotator-test-${process.pid}`;
const urlsFile = path.join(root, "browser-urls");
const callsFile = path.join(root, "model-calls");
const children = [];
const diagnostics = [];
let browser;
let page;
let started = false;
const tmux = (...args) => execFileSync("tmux", ["-L", socket, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const screen = () => tmux("capture-pane", "-p", "-t", "review");
const command = (text) => { tmux("send-keys", "-t", "review", "-l", text); tmux("send-keys", "-t", "review", "Enter"); };
const lines = async (file) => existsSync(file) ? (await readFile(file, "utf8")).trim().split("\n").filter(Boolean) : [];
async function until(predicate, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await delay(50); }
  assert.fail(`${label}\n${started ? screen() : ""}\n${diagnostics.join("\n")}`);
}
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function listening(host, port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port: Number(port) });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
    socket.setTimeout(800, () => { socket.destroy(); resolve(false); });
  });
}
function child(command, args) {
  const process = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
  process.stderr.on("data", (chunk) => diagnostics.push(String(chunk)));
  process.on("error", (error) => diagnostics.push(`${command}: ${error.message}`));
  children.push(process);
  return process;
}
const git = (...args) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false", "-c", "user.name=Review Fixture", "-c", "user.email=review@example.invalid", ...args], { cwd: project, encoding: "utf8", env: { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: path.join(root, "absent-gitconfig") } });
async function screenshot(page, name) {
  if (!process.env.PI_PLANNOTATOR_PREVIEW_DIR) return;
  await mkdir(process.env.PI_PLANNOTATOR_PREVIEW_DIR, { recursive: true });
  await page.screenshot({ path: path.join(process.env.PI_PLANNOTATOR_PREVIEW_DIR, name), fullPage: true });
}
try {
  assert(existsSync("/usr/sbin/sshd"), "OpenSSH server prerequisite missing: /usr/sbin/sshd");
  assert(existsSync(chrome), `Browser prerequisite missing: ${chrome}; set PI_PLANNOTATOR_CHROMIUM to an installed Chromium executable.`);
  await mkdir(project, { recursive: true });
  await mkdir(path.join(root, "agent/bin"), { recursive: true });
  for (const name of ["fd", "rg"]) {
    assert(existsSync(path.join(helperBin, name)), `Missing Pi helper ${helperBin}/${name}`);
    await symlink(path.join(helperBin, name), path.join(root, "agent/bin", name));
  }
  git("init", "-q", "-b", "main");
  await writeFile(path.join(project, "example.txt"), "before local review\n");
  git("add", "example.txt"); git("commit", "-qm", "Fixture baseline");
  const baseline = git("rev-parse", "HEAD").trim();
  git("init", "--bare", "-q", path.join(root, "remote.git"));
  git("remote", "add", "origin", path.join(root, "remote.git"));
  await writeFile(path.join(project, "PLAN.md"), "# Local review fixture\n\n- [ ] Update example.txt after human approval.\n\nKeep all work local. Do not publish.\n");
  const opener = path.join(root, "browser.mjs");
  await writeFile(opener, `#!/usr/bin/env node\nimport { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(urlsFile)}, process.argv[2] + "\\n");\n`, { mode: 0o755 });
  const provider = path.join(root, "provider.mjs");
  await writeFile(provider, `import { appendFileSync } from "node:fs";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
export default function(pi) {
  let execution = 0;
  let assessed = false;
  let revised = false;
  pi.on("session_start", (_event, ctx) => ctx.ui.setStatus("fixture", "TEST READY"));
  pi.registerProvider("review-fixture", { api: "review-fixture", baseUrl: "http://127.0.0.1:1", apiKey: "offline-fixture",
    models: [{ id: "fixture", name: "Offline review fixture", reasoning: false, input: ["text"], contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context) {
      appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(context.messages) + "\\n");
      const text = message => typeof message.content === "string" ? message.content : message.content?.map(part => part.text ?? "").join("");
      const submit = context.messages.findLastIndex(message => message.role === "user" && text(message).trim() === "SUBMIT_PLAN");
      const submitted = context.messages.slice(submit + 1).some(message => message.role === "toolResult" && message.toolName === "plannotator_submit_plan");
      const approved = context.messages.slice(submit + 1).some(message => message.role === "user" && text(message).includes("Continue with the approved plan."));
      const review = context.messages.some(message => message.role === "user" && text(message).includes("Replace the line with: after local diff feedback."));
      const apply = context.messages.some(message => message.role === "user" && text(message).trim() === "APPLY_REVIEWED_FIX");
      let content;
      if (review && !assessed) {
        assessed = true;
        content = [{ type: "toolCall", id: "inspect-feedback", name: "read", arguments: { path: "example.txt" } }];
      }
      else if (review && apply && !revised) {
        revised = true;
        content = [{ type: "toolCall", id: "revise-fixture", name: "write", arguments: { path: "example.txt", content: "after local diff feedback\\n" } }];
      }
      else if (submit >= 0 && !submitted) content = [{ type: "toolCall", id: "submit-" + Date.now(), name: "plannotator_submit_plan", arguments: { filePath: "PLAN.md" } }];
      else if (approved && execution++ === 0) content = [{ type: "toolCall", id: "write-fixture", name: "write", arguments: { path: "example.txt", content: "after local approval\\n" } }];
      else if (approved && execution === 2) content = [{ type: "toolCall", id: "done", name: "plannotator_mark_done", arguments: { step: 1 } }];
      else content = [{ type: "text", text: review && !revised ? "VERDICT READY. Confirmed: example.txt contains the fixture line. The requested local wording change is in scope; waiting for your go-ahead." : "LOCAL REVIEW READY. No publication performed." }];
      const toolUse = content[0].type === "toolCall";
      const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, content, timestamp: Date.now(), stopReason: toolUse ? "toolUse" : "stop", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "start", partial: message });
      if (toolUse) { stream.push({ type: "toolcall_start", contentIndex: 0, partial: message }); stream.push({ type: "toolcall_end", contentIndex: 0, toolCall: content[0], partial: message }); }
      stream.push({ type: "done", reason: toolUse ? "toolUse" : "stop", message }); stream.end(); return stream;
    }
  });
}
`);
  const sshPort = await freePort();
  for (const name of ["host_key", "client_key"]) execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", path.join(root, name)]);
  const config = path.join(root, "sshd_config");
  await writeFile(config, `Port ${sshPort}\nListenAddress 127.0.0.1\nHostKey ${root}/host_key\nPidFile ${root}/sshd.pid\nAuthorizedKeysFile ${root}/client_key.pub\nStrictModes no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM yes\nPermitRootLogin prohibit-password\nAllowUsers ${userInfo().username}\nAllowTcpForwarding local\nPermitOpen 127.0.0.1:*\nLogLevel ERROR\n`);
  child("/usr/sbin/sshd", ["-D", "-e", "-f", config]);
  browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route("**/*", (route) => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  tmux("-f", "/dev/null", "new-session", "-d", "-s", "review", "-x", "100", "-y", "30", "-c", project,
    "env", "-i", `PATH=${process.env.PATH}`, `HOME=${root}`, "TERM=xterm-256color", "PI_OFFLINE=1", "PI_SKIP_VERSION_CHECK=1",
    `PI_CODING_AGENT_DIR=${root}/agent`, `BROWSER=${opener}`, "SSH_CONNECTION=127.0.0.1 51000 127.0.0.1 22",
    process.execPath, path.join(host, "dist/cli.js"), "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files",
    "-e", path.join(source, "extensions/plannotator/index.ts"), "-e", provider, "--provider", "review-fixture", "--model", "fixture", "--plan");
  started = true;
  await until(() => screen().includes("TEST READY"), "Pi must finish startup before commands");
  async function openReview(number) {
    await until(async () => (await lines(urlsFile)).length >= number, `Review ${number} must open through the browser helper`);
    const remote = new URL((await lines(urlsFile))[number - 1]);
    assert(["localhost", "127.0.0.1"].includes(remote.hostname), "the browser helper receives a loopback URL");
    const address = Object.values(networkInterfaces()).flat().find((entry) => entry?.family === "IPv4" && !entry.internal)?.address;
    assert(address, "A non-loopback interface is required to test that review is not publicly bound.");
    assert.equal(await listening(address, remote.port), false, "the review port must reject non-loopback connections");
    const localPort = await freePort();
    child("ssh", ["-F", "/dev/null", "-N", "-i", path.join(root, "client_key"), "-p", String(sshPort),
      "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no", "-o", `UserKnownHostsFile=${root}/known_hosts`,
      "-o", "ExitOnForwardFailure=yes", "-o", "ConnectTimeout=5", "-L", `127.0.0.1:${localPort}:127.0.0.1:${remote.port}`, `${userInfo().username}@127.0.0.1`]);
    const local = new URL(remote); local.hostname = "127.0.0.1"; local.port = String(localPort);
    await until(() => listening("127.0.0.1", localPort), "The private SSH forward must be listening before browser navigation");
    await page.goto(local.href, { waitUntil: "domcontentloaded" });
    return remote;
  }
  command("SUBMIT_PLAN");
  await openReview(1);
  await page.getByRole("button", { name: /^Approve/i }).first().waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await screenshot(page, "plan-desktop.png");
  assert.equal((await lines(callsFile)).length, 1, "work waits while the human reviews");
  assert.equal(await readFile(path.join(project, "example.txt"), "utf8"), "before local review\n");
  await page.getByTitle("Add global comment", { exact: true }).click();
  await page.locator("textarea").last().fill("Keep the change local and review its diff before publication.");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Send Feedback", exact: true }).click();
  await until(async () => (await lines(callsFile)).length === 2, "feedback must return to Pi without implementation");
  assert.equal(await readFile(path.join(project, "example.txt"), "utf8"), "before local review\n");
  assert((await readFile(callsFile, "utf8")).includes("Keep the change local and review its diff before publication."), "human feedback reaches the model context");
  await writeFile(path.join(project, "PLAN.md"), "# Local review fixture\n\n- [ ] Update example.txt after human approval.\n\nReview the local diff before publishing.\n");
  command("SUBMIT_PLAN");
  await openReview(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  const sidebar = page.getByRole("button", { name: "Collapse sidebar", exact: true }).first();
  if (await sidebar.isVisible()) await sidebar.click();
  await page.getByText("Review the local diff before publishing.", { exact: true }).waitFor();
  await screenshot(page, "plan-narrow.png");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await until(async () => (await lines(callsFile)).length >= 6 && (await readFile(path.join(project, "example.txt"), "utf8")) === "after local approval\n", "approval must start local implementation and complete its checklist");
  await delay(200);
  const implementationCalls = (await lines(callsFile)).length;
  assert([6, 7].includes(implementationCalls), "only the implementation tool loop and at most one completion-context turn may run");
  if (implementationCalls === 7) assert((await lines(callsFile)).at(-1).includes("Plan Complete"), "the extra context turn belongs to the completed plan");
  const completion = JSON.parse((await lines(callsFile)).at(-1)).findLast((message) => message.role === "toolResult" && message.toolName === "plannotator_mark_done");
  assert(completion && !completion.isError, "the approved checklist completes through the real tool");
  command("/plannotator-review");
  await openReview(3);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByText("example.txt", { exact: false }).first().waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Got it", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByText("Hover cards", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByText("after local approval", { exact: false }).first().waitFor();
  await screenshot(page, "local-diff.png");
  assert(await page.getByText("PLAN.md", { exact: false }).count(), "untracked plan must be available in local review");
  assert.equal((await lines(callsFile)).length, implementationCalls, "opening a local diff review does not start a model");
  await page.getByRole("button", { name: "Comment", exact: true }).first().click();
  await page.locator("textarea").last().fill("Replace the line with: after local diff feedback.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: /^Send Feedback/i }).click();
  await until(async () => (await lines(callsFile)).length === implementationCalls + 2 && screen().includes("VERDICT READY"), "code feedback returns for inspection and discussion before edits");
  assert.equal(await readFile(path.join(project, "example.txt"), "utf8"), "after local approval\n", "findings do not authorize immediate edits");
  command("APPLY_REVIEWED_FIX");
  await until(async () => (await lines(callsFile)).length === implementationCalls + 4 && (await readFile(path.join(project, "example.txt"), "utf8")) === "after local diff feedback\n", "an explicit user decision starts the reviewed revision");
  command("/plannotator-review");
  const finalReview = await openReview(4);
  await page.getByRole("button", { name: "Close review without feedback", exact: true }).waitFor();
  if (await page.getByRole("button", { name: "Got it", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Got it", exact: true }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByText("Hover cards", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Done", exact: true }).click();
  }
  await page.getByText("after local diff feedback", { exact: false }).first().waitFor();
  await screenshot(page, "local-diff-revised.png");
  const [exit] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === "/api/exit"),
    page.getByRole("button", { name: "Close review without feedback", exact: true }).click(),
  ]);
  assert.equal(exit.ok(), true);
  await until(async () => !(await listening("127.0.0.1", finalReview.port)), "closing the review stops its listener without approval");
  await delay(200);
  assert.equal((await lines(callsFile)).length, implementationCalls + 4, "closing code review does not wake the model");
  assert.equal(git("rev-parse", "HEAD").trim(), baseline);
  assert.equal(git("--git-dir", path.join(root, "remote.git"), "for-each-ref").trim(), "", "local approval/review must not publish refs");
  assert.deepEqual(errors, []);
  console.log(`PASS: actual Pi CLI and Chromium through private SSH; plan feedback/approval, code feedback/revision and close; ${implementationCalls + 4} offline model requests, no published refs.`);
} catch (error) {
  if (page && !page.isClosed()) await screenshot(page, "failure.png");
  throw error;
} finally {
  if (started && process.env.PI_PLANNOTATOR_PREVIEW_DIR) {
    await mkdir(process.env.PI_PLANNOTATOR_PREVIEW_DIR, { recursive: true });
    await writeFile(path.join(process.env.PI_PLANNOTATOR_PREVIEW_DIR, "terminal.txt"), screen());
    if (existsSync(callsFile)) await writeFile(path.join(process.env.PI_PLANNOTATOR_PREVIEW_DIR, "model-calls.jsonl"), await readFile(callsFile));
  }
  await browser?.close();
  if (started) tmux("kill-server");
  for (const process of children.reverse()) {
    if (process.pid && process.exitCode === null && process.signalCode === null) { const exited = new Promise((resolve) => process.once("exit", resolve)); process.kill("SIGTERM"); await exited; }
  }
  await rm(root, { recursive: true, force: true });
}
