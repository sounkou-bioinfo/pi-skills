#!/usr/bin/env node
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const repoRoot = new URL("..", import.meta.url).pathname;
const extensionPath = join(repoRoot, "extensions/rlm");
const tmpDir = "/tmp/pi-subagent-skills-validate";
const model = process.env.PI_RLM_VALIDATE_MODEL ?? "openai-codex/gpt-5.3-codex-spark";
const subModel = process.env.PI_RLM_VALIDATE_SUBMODEL ?? model;
const contextPath = process.env.PI_RLM_VALIDATE_CONTEXT ?? "/tmp/pi-rlm-r-context-big.txt";

mkdirSync(tmpDir, { recursive: true });

function runPi(label, task, timeoutSec = 240) {
  const outputPath = join(tmpDir, `${label}.json`);
  const userPrompt = `Use the rlm tool with op="start", task=${JSON.stringify(task)}, contextPath=${JSON.stringify(contextPath)}, mode="auto", backend="cli", async=false, model=${JSON.stringify(model)}, subModel=${JSON.stringify(subModel)}.`;
  const result = spawnSync(
    "pi",
    [
      "-p",
      "--mode",
      "json",
      "--no-session",
      "--extension",
      extensionPath,
      userPrompt,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: timeoutSec * 1000,
      maxBuffer: 20 * 1024 * 1024,
    },
  );

  const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  writeFileSync(outputPath, combined);

  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label}: pi exited with status ${result.status}\n${tail(combined)}`);
  }
  const details = extractRlmDetails(combined);
  if (!details) {
    throw new Error(`${label}: could not find rlm tool details\n${tail(combined)}`);
  }
  return { outputPath, details, combined };
}

function extractRlmDetails(text) {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      const details = findDetails(obj);
      if (details) return details;
    } catch {
      // ignore non-json lines
    }
  }
  return null;
}

function findDetails(obj) {
  if (!obj || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findDetails(item);
      if (found) return found;
    }
    return null;
  }
  if (obj.role === "toolResult" && obj.toolName === "rlm" && obj.details) return obj.details;
  if (obj.messages) return findDetails(obj.messages);
  if (obj.message) return findDetails(obj.message);
  if (obj.toolResults) return findDetails(obj.toolResults);
  return null;
}

function tail(text, lines = 40) {
  return text.split(/\r?\n/).slice(-lines).join("\n");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function summarize(details) {
  return {
    run_id: details.run_id,
    final: details.result?.final,
    strategy: summarizeStrategy(details.result?.root),
    nodes: details.result?.stats?.nodesVisited,
    durationMs: details.result?.stats?.durationMs,
  };
}

function summarizeStrategy(root) {
  if (!root) return "unknown";
  const obs = Array.isArray(root.observations) ? root.observations.map((x) => x?.text ?? "").join("\n") : "";
  const steps = [];
  if (obs.includes("repl_eval =>")) steps.push("repl_eval");
  if (obs.includes("r_eval =>")) steps.push("r_eval");
  if (root.result !== undefined) steps.push("final");
  return steps.join(" -> ") || root.decision?.action || "unknown";
}

const tests = [
  {
    label: "finalvar",
    task: 'Use r_eval only. In R, compute x <- 2 + 3 and call FINAL_VAR("x").',
    timeoutSec: 180,
    check(details) {
      assert(details.result?.final === "5", `expected final 5, got ${JSON.stringify(details.result?.final)}`);
    },
  },
  {
    label: "recursive",
    task: 'Use r_eval only. In R, do child <- rlm_call("Return exactly OK."); FINAL(child$result).',
    timeoutSec: 180,
    check(details) {
      assert(details.result?.final === "OK", `expected final OK, got ${JSON.stringify(details.result?.final)}`);
      assert((details.result?.stats?.nodesVisited ?? 0) >= 2, `expected recursive child visit, got ${details.result?.stats?.nodesVisited}`);
    },
  },
  {
    label: "install-first",
    task: 'Use r_eval only. In R, run install_webr_packages(c("jsonlite")); FINAL(requireNamespace("jsonlite", quietly = TRUE)).',
    timeoutSec: 240,
    check(details) {
      assert(details.result?.final === "true", `expected jsonlite install true, got ${JSON.stringify(details.result?.final)}`);
    },
  },
  {
    label: "install-second",
    task: 'Use r_eval only. In R, run install_webr_packages(c("jsonlite")); FINAL(requireNamespace("jsonlite", quietly = TRUE)).',
    timeoutSec: 240,
    check(details, state, result) {
      assert(details.result?.final === "true", `expected cached jsonlite install true, got ${JSON.stringify(details.result?.final)}`);
      assert(existsSync("/tmp/pi-webr-package-cache/jsonlite"), "expected /tmp/pi-webr-package-cache/jsonlite to exist");
      const downloaded = result.combined.includes("Downloading webR package: jsonlite");
      const first = state.get("install-first");
      if (first?.combined?.includes("Downloading webR package: jsonlite")) {
        assert(!downloaded, "expected second install to avoid a fresh jsonlite download message");
      }
    },
  },
  {
    label: "plot",
    task: 'Use r_eval only. In R, save_plot("plots/test-plot.png", plot(1:5, 1:5)); FINAL("done").',
    timeoutSec: 240,
    check(details) {
      const runId = details.run_id;
      const plotPath = `/tmp/pi-rlm-runs/${runId}/plots/test-plot.png`;
      assert(existsSync(plotPath), `expected plot artifact at ${plotPath}`);
      assert(String(details.result?.final ?? "").includes("done"), `expected final to contain done, got ${JSON.stringify(details.result?.final)}`);
    },
  },
];

const state = new Map();
const summary = [];
let failures = 0;

for (const test of tests) {
  try {
    const result = runPi(test.label, test.task, test.timeoutSec);
    test.check(result.details, state, result);
    state.set(test.label, result);
    summary.push({ label: test.label, status: "ok", ...summarize(result.details), outputPath: result.outputPath });
  } catch (error) {
    failures += 1;
    summary.push({ label: test.label, status: "failed", error: error instanceof Error ? error.message : String(error) });
  }
}

console.log(JSON.stringify({
  ok: failures === 0,
  model,
  subModel,
  contextPath,
  cacheDir: "/tmp/pi-webr-package-cache",
  summary,
}, null, 2));

process.exitCode = failures === 0 ? 0 : 1;
