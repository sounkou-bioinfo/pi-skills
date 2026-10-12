import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const vendor = path.join(repo, "vendor/pi-claude-code");
const generator = path.join(repo, "scripts/vendor_claude_code.mjs");
const inputs = path.join(repo, "scripts/vendor/pi-claude-code");
const manifest = JSON.parse(await readFile(path.join(inputs, "manifest.json"), "utf8"));
const root = await mkdtemp(path.join(tmpdir(), "pi-claude-code-tests-"));
try {
  execFileSync(process.execPath, [generator, "--check"], { cwd: repo, stdio: "inherit", timeout: 30_000 });
  const drifted = path.join(root, "drifted");
  await cp(vendor, drifted, { recursive: true });
  for (const file of ["src/provider.ts", "UPSTREAM.md", "unexpected.txt"]) {
    const target = path.join(drifted, file);
    const original = file === "unexpected.txt" ? undefined : await readFile(target);
    await writeFile(target, original ? Buffer.concat([original, Buffer.from("\nDrift fixture.\n")]) : "Unexpected file.\n");
    const result = spawnSync(process.execPath, [generator, "--check", "--output", drifted], {
      cwd: repo, encoding: "utf8", timeout: 30_000,
    });
    assert.equal(result.status, 1, `Vendor check rejects ${file} drift: ${result.stderr}`);
    assert.match(result.stderr, /Pristine upstream file inventory|Generated vendor equals/);
    if (original) await writeFile(target, original);
    else await rm(target);
  }
  console.log("PASS: source drift, overlay drift, and unexpected vendor files are rejected.");

  // Upstream's locked Pi types are separate from pi-skills' development SDK.
  const development = path.join(root, "upstream-tests");
  await cp(vendor, development, { recursive: true });
  execFileSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: development, stdio: "inherit", timeout: 180_000,
  });
  for (const command of ["check", "test"]) {
    execFileSync("npm", ["run", command], { cwd: development, stdio: "inherit", timeout: 120_000 });
  }

  const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", root], {
    cwd: repo, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 60_000,
  }));
  const consumer = path.join(root, "consumer");
  await mkdir(consumer);
  execFileSync("npm", ["install", "--ignore-scripts", "--omit=dev", "--legacy-peer-deps", "--no-package-lock", "--no-audit", "--no-fund", path.join(root, packed[0].filename)], {
    cwd: consumer, stdio: "inherit", timeout: 180_000,
  });
  const installed = path.join(consumer, "node_modules/pi-skills");
  for (const file of ["src/index.ts", "src/model-catalog.ts", "src/inert-mcp.mjs", "LICENSE", "UPSTREAM.md"]) {
    assert.deepEqual(await readFile(path.join(installed, "vendor/pi-claude-code", file)), await readFile(path.join(vendor, file)));
  }
  for (const name of ["pi-ai", "pi-coding-agent"]) {
    await assert.rejects(readFile(path.join(consumer, "node_modules/@earendil-works", name, "package.json")), { code: "ENOENT" });
  }

  const host = process.env.PI_CLAUDE_CODE_HOST_DIR ?? path.join(development, "node_modules/@earendil-works/pi-coding-agent");
  const version = JSON.parse(await readFile(path.join(host, "package.json"), "utf8")).version;
  const probe = `
    import { DefaultResourceLoader, SettingsManager } from ${JSON.stringify(pathToFileURL(path.join(host, "dist/index.js")).href)};
    const loader = new DefaultResourceLoader({
      cwd: ${JSON.stringify(root)}, agentDir: ${JSON.stringify(path.join(root, "agent"))},
      noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      settingsManager: SettingsManager.inMemory({ packages: [{
        source: ${JSON.stringify(installed)},
        extensions: ["vendor/pi-claude-code/src/index.ts"], skills: [], prompts: [], themes: [],
      }] }),
    });
    await loader.reload();
    const { extensions, errors, warnings, runtime } = loader.getExtensions();
    console.log(JSON.stringify({
      loaded: extensions.map(({ path }) => path), errors, warnings: warnings ?? [],
      commands: extensions.flatMap(({ commands }) => [...commands.keys()]),
      providers: runtime.pendingNativeProviderRegistrations.map(({ provider }) => ({
        id: provider.id, models: provider.getModels().map(({ id }) => id),
      })),
    }));
  `;
  const probeOptions = {
    cwd: root, encoding: "utf8", timeout: 30_000,
    env: { PATH: process.env.PATH, HOME: path.join(root, "home"), PI_CODING_AGENT_DIR: path.join(root, "agent"), PI_OFFLINE: "1" },
  };
  const loaded = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", probe], probeOptions));
  assert.deepEqual(loaded.errors, []);
  assert.deepEqual(loaded.warnings, []);
  assert.deepEqual(loaded.loaded, [path.join(installed, "vendor/pi-claude-code/src/index.ts")]);
  assert.deepEqual(loaded.commands, ["claude-code-status"]);
  assert.deepEqual(loaded.providers.map(({ id }) => id), ["claude-code"]);
  assert(loaded.providers[0].models.includes("claude-opus-5-5"));

  const installedVendor = path.join(installed, "vendor/pi-claude-code");
  for (const patch of [...manifest.patches].reverse()) {
    execFileSync("git", ["apply", "--reverse", path.join(inputs, "patches", patch)], { cwd: installedVendor, timeout: 30_000 });
  }
  const unpatched = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", probe], probeOptions));
  assert.equal(unpatched.errors.length, 1);
  assert.match(unpatched.errors[0].error, /Cannot find module ['"][^'"]*\/providers\/anthropic\.models['"]/);
  assert.deepEqual(unpatched.loaded, []);
  assert.deepEqual(unpatched.providers, []);
  console.log(`PASS: clean tarball installation registers one Claude Code provider and status command on Pi ${version}, Node ${process.version}, ${process.platform}/${process.arch}; the unpatched import fails. No Claude login or model requests.`);
} finally {
  await rm(root, { recursive: true, force: true });
}
