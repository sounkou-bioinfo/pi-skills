import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rename, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const root = await mkdtemp(path.join(tmpdir(), "pi-plannotator-package-"));
try {
  const result = JSON.parse(execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", root], { cwd: repo, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
  const archive = path.join(root, result[0].filename);
  const consumer = path.join(root, "consumer");
  await mkdir(consumer);
  execFileSync("npm", ["install", "--ignore-scripts", "--omit=dev", "--no-package-lock", "--no-audit", "--no-fund", archive], { cwd: consumer, stdio: "inherit" });
  const installed = path.join(consumer, "node_modules/pi-skills");
  const manifest = JSON.parse(await readFile(path.join(installed, "package.json"), "utf8"));
  assert.equal(manifest.dependencies["@plannotator/pi-extension"], "0.27.14");
  execFileSync(process.execPath, [path.join(repo, "scripts/test_plannotator_ui.mjs")], {
    cwd: repo, stdio: "inherit", env: { ...process.env, PI_PLANNOTATOR_SOURCE: installed },
  });
  const dependency = path.dirname(createRequire(path.join(installed, "package.json")).resolve("@plannotator/pi-extension/index.ts"));
  assert((await realpath(dependency)).startsWith(`${consumer}${path.sep}`), "asset-failure testing is confined to the temporary installation");
  await rename(path.join(dependency, "plannotator.html"), path.join(dependency, "plannotator.html.missing"));
  const host = process.env.PI_PLANNOTATOR_HOST_DIR ?? path.join(repo, "node_modules/@earendil-works/pi-coding-agent");
  execFileSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    const { DefaultResourceLoader } = await import(${JSON.stringify(pathToFileURL(path.join(host, "dist/index.js")).href)});
    const loader = new DefaultResourceLoader({ cwd: ${JSON.stringify(root)}, agentDir: ${JSON.stringify(path.join(root, "asset-check-agent"))}, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, additionalExtensionPaths: [${JSON.stringify(path.join(installed, "extensions/plannotator/index.ts"))}] });
    await loader.reload();
    const { extensions, errors } = loader.getExtensions();
    assert.equal(extensions.length, 0);
    assert.equal(errors.length, 1);
    assert.match(errors[0].error, /review assets are missing/);
  `], { cwd: root, stdio: "inherit" });
  console.log("PASS: isolated runtime install provides browser/SSH review; missing review assets fail source loading instead of granting approval.");
} finally {
  await rm(root, { recursive: true, force: true });
}
