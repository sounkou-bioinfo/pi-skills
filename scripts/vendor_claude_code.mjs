import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const inputs = path.join(repo, "scripts/vendor/pi-claude-code");
const manifest = JSON.parse(await readFile(path.join(inputs, "manifest.json"), "utf8"));
let output = path.join(repo, "vendor/pi-claude-code");
let source;
let check = false;
for (let i = 2; i < process.argv.length; i++) {
  const option = process.argv[i];
  if (option === "--check") check = true;
  else if ((option === "--source" || option === "--output") && process.argv[i + 1]) {
    const value = path.resolve(process.argv[++i]);
    if (option === "--source") source = value;
    else output = value;
  } else throw new Error(`Unknown or incomplete option: ${option}`);
}
assert(check !== Boolean(source), "Use --check or --source /path/to/upstream-checkout");

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
async function inventory(directory, prefix = "") {
  const files = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(files, await inventory(absolute, `${name}/`));
    else {
      assert(entry.isFile(), `Vendor inventory requires regular files: ${name}`);
      files[name] = sha256(await readFile(absolute));
    }
  }
  return files;
}
function applyPatches(directory, reverse = false) {
  const patches = reverse ? [...manifest.patches].reverse() : manifest.patches;
  for (const patch of patches) {
    const args = ["apply", ...(reverse ? ["--reverse"] : []), path.join(inputs, "patches", patch)];
    execFileSync("git", args, { cwd: directory, timeout: 30_000 });
  }
}

const scratch = await mkdtemp(path.join(tmpdir(), "pi-claude-code-vendor-"));
try {
  const staged = path.join(scratch, "source");
  if (check) {
    await cp(output, staged, { recursive: true });
    for (const file of manifest.overlays) await rm(path.join(staged, file));
    applyPatches(staged, true);
  } else {
    const archive = execFileSync("git", ["-C", source, "archive", "--format=tar", manifest.revision], {
      timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(sha256(archive), manifest.archiveSha256, "Pinned upstream Git archive SHA-256");
    const archivePath = path.join(scratch, "upstream.tar");
    await writeFile(archivePath, archive);
    await mkdir(staged);
    execFileSync("tar", ["-xf", archivePath, "-C", staged], { timeout: 30_000 });
  }
  assert.deepEqual(await inventory(staged), manifest.files, "Pristine upstream file inventory and SHA-256");
  applyPatches(staged);
  for (const file of manifest.overlays) {
    await cp(path.join(inputs, "overlay", file), path.join(staged, file));
  }
  if (check) {
    assert.deepEqual(await inventory(output), await inventory(staged), "Generated vendor equals patches plus overlays");
    console.log(`PASS: pi-claude-code ${manifest.revision}; pristine hashes and patch/overlay replay`);
  } else {
    await rm(output, { recursive: true, force: true });
    await cp(staged, output, { recursive: true });
    console.log(`Generated ${output} from ${manifest.repository}@${manifest.revision}`);
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
