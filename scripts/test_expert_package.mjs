import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const root = await mkdtemp(path.join(tmpdir(), "pi-expert-package-"));
try {
  const result = JSON.parse(execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", root], { cwd: repo, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
  const consumer = path.join(root, "consumer");
  await mkdir(consumer);
  execFileSync("npm", ["install", "--ignore-scripts", "--omit=dev", "--no-package-lock", "--no-audit", "--no-fund", path.join(root, result[0].filename)], { cwd: consumer, stdio: "inherit" });
  const installed = path.join(consumer, "node_modules/pi-skills");
  for (const file of ["extensions/expert-discipline/index.ts", "skills/architecture-refinement/SKILL.md"]) {
    assert.equal(await readFile(path.join(installed, file), "utf8"), await readFile(path.join(repo, file), "utf8"));
  }
  execFileSync(process.execPath, ["--test", path.join(repo, "scripts/expert-discipline.test.mjs")], {
    cwd: repo, stdio: "inherit", env: { ...process.env, PI_EXPERT_SOURCE: installed },
  });
  console.log("PASS: isolated runtime installation provides the activation nudge, discoverable skill, and explicit skill command outside the package checkout.");
} finally {
  await rm(root, { recursive: true, force: true });
}
