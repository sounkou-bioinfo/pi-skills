import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { configureLocalReview, LOCAL_REVIEW_POLICY } from "../.plannotator-test-build/plannotator/config.js";
import { openHarness } from "./plannotator-harness.mjs";

const text = (value) => [{ type: "text", text: value }];

test("local review is loopback-only despite SSH detection and preserves the browser helper", () => {
  const env = { SSH_CONNECTION: "client port host port", BROWSER: "/vscode/browser.sh", PLANNOTATOR_PORT: "32100" };
  configureLocalReview(env);
  assert.equal(env.PLANNOTATOR_REMOTE, "0");
  assert.equal(env.PLANNOTATOR_SHARE, "disabled");
  assert.equal(env.BROWSER, "/vscode/browser.sh");
  assert.equal(env.PLANNOTATOR_PORT, "32100");
  assert.throws(() => configureLocalReview({ PLANNOTATOR_REMOTE: "1" }), /loopback port/);
  assert.throws(() => configureLocalReview({ PLANNOTATOR_URL_HOST: "public.example" }), /loopback/);
  assert.match(LOCAL_REVIEW_POLICY, /only when the user explicitly requests/);
  assert.match(LOCAL_REVIEW_POLICY, /not files or Git state/);
});

test("the source-loaded upstream workflow owns planning without competing goal tools", { timeout: 30000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-local-review-sdk-"));
  let h;
  try {
    h = await openHarness(root);
    assert.deepEqual(h.errors, []);
    const names = h.session.getAllTools().map((tool) => tool.name);
    assert(names.includes("plannotator_submit_plan"));
    assert(names.includes("plannotator_mark_done"));
    for (const name of ["create_goal", "get_goal", "update_goal", "propose_contract", "record_checkpoint", "request_human_input"]) assert(!names.includes(name));
    assert.equal((await h.request("plan-mode", { mode: "status" })).result.phase, "idle");
    await h.session.prompt("/plannotator-plan-mode");
    assert.equal((await h.request("plan-mode", { mode: "status" })).result.phase, "planning");
    assert.equal(h.requests.length, 0, "opening plan mode does not itself start a model");
    await h.session.prompt("Explore the task without publishing anything.");
    assert.equal(h.requests.length, 1);
    assert(h.requests[0].systemPrompt.includes(LOCAL_REVIEW_POLICY));
    await writeFile(path.join(h.cwd, "PLAN.md"), "# Plan\n\n- [ ] Inspect the fixture.\n");
    h.frames.push([{ type: "toolCall", id: "submit-headless", name: "plannotator_submit_plan", arguments: { filePath: "PLAN.md" } }]);
    await h.session.prompt("Submit the plan.");
    assert.equal(h.requests.length, 2);
    assert.equal((await h.request("plan-mode", { mode: "status" })).result.phase, "planning", "a headless submission cannot approve the plan");
    assert.deepEqual(await h.urls(), []);
    const submission = h.manager.getBranch().find((entry) => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolCallId === "submit-headless");
    assert.equal(submission.message.isError, true);
    assert.match(JSON.stringify(submission.message.content), /requires interactive Pi/);
    await h.session.prompt("/plannotator-plan-mode");
    assert.equal((await h.request("plan-mode", { mode: "status" })).result.phase, "idle");
    await delay(150);
    assert.equal(h.requests.length, 2, "there is no goal auto-continuation after leaving planning");
    assert.deepEqual(h.errors, []);
  } finally { await h?.close(); await rm(root, { recursive: true, force: true }); }
});

test("native tree exploration returns a summary to an assistant anchor and preserves the side branch and files", { timeout: 30000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-tree-review-sdk-"));
  const brief = "Goal: choose a parser. User decisions: none yet. Evidence: parser.txt. Uncertainty: malformed input behavior. Next: choose before implementing.";
  let h;
  try {
    h = await openHarness(root, [text("Implementation anchor: choose the parser, then implement."), text("Option A evidence."), text("Option B trade-offs."), text(brief)]);
    await h.session.prompt("Agree the objective before exploring.");
    const anchor = h.manager.getLeafId();
    assert.equal(h.manager.getEntry(anchor).message.role, "assistant");
    h.manager.appendLabelChange(anchor, "implementation-root");
    await h.session.prompt("Explore option A, read-only.");
    await h.session.prompt("Compare option B. Do not implement yet.");
    const exploration = h.manager.getLeafId();
    await writeFile(path.join(h.cwd, "scratch-evidence.txt"), "Tree navigation is not filesystem rollback.\n");
    const result = await h.session.navigateTree(anchor, { summarize: true,
      customInstructions: "Return goal, user decisions, evidence, uncertainty, and proposed next step. Distinguish user approval from agent suggestions.",
      label: "exploration-brief" });
    assert.equal(result.cancelled, false);
    assert.equal(result.editorText, undefined, "an assistant anchor resumes after its answer rather than restoring a user prompt");
    assert.equal(h.requests.length, 4, "three conversation turns plus one explicit branch-summary request");
    const summary = h.manager.getBranch().findLast((entry) => entry.type === "branch_summary");
    assert.equal(summary.type, "branch_summary");
    assert(summary.summary.endsWith(brief), "the native branch entry retains the generated brief");
    assert.equal(summary.parentId, anchor, "the summary begins the implementation branch at the selected anchor");
    assert(h.manager.getEntry(summary.fromId), "the native summary references an existing tree entry");
    assert.equal(h.manager.getLabel(anchor), "implementation-root");
    assert(h.manager.getEntry(exploration), "the explored branch remains inspectable");
    assert(!h.manager.getBranch().some((entry) => entry.id === exploration));
    assert.equal(await readFile(path.join(h.cwd, "scratch-evidence.txt"), "utf8"), "Tree navigation is not filesystem rollback.\n");
    await delay(150);
    assert.equal(h.requests.length, 4, "returning to the anchor does not start implementation");
    await h.session.prompt("I choose option A. Draft the implementation plan for local review.");
    assert.equal(h.requests.length, 5);
    const context = JSON.stringify(h.requests.at(-1).messages);
    assert(context.includes(brief));
    assert(!context.includes("Option B trade-offs."), "the summary replaces the side discussion in active context");
    assert.deepEqual(h.errors, []);
  } finally { await h?.close(); await rm(root, { recursive: true, force: true }); }
});
