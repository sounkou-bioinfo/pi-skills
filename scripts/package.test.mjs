import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const documents = [
  "README.md", "README.Rmd", "AGENTS.md", "CHANGELOG.md",
  "EXTENSION_QA_STANDARD.md", "EXTENSION_TESTING_PLAYBOOK.md", "TEST_PLAN.md",
];

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await filesUnder(name));
    else files.push(name);
  }
  return files;
}

const docs = await filesUnder("docs");
documents.push(...docs.filter((file) => file.endsWith(".md")));
const cache = await mkdtemp(path.join(tmpdir(), "pi-skills-pack-test-"));
let packed;
try {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: root,
    env: {
      ...process.env,
      npm_config_cache: cache,
      npm_config_userconfig: path.join(cache, "user.npmrc"),
      npm_config_globalconfig: path.join(cache, "global.npmrc"),
      npm_config_offline: "true",
      npm_config_update_notifier: "false",
    },
    encoding: "utf8", timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
  });
  const packages = JSON.parse(output);
  assert.equal(packages.length, 1);
  packed = new Set(packages[0].files.map((file) => file.path));
} finally {
  await rm(cache, { recursive: true, force: true });
}

function ships(destination) {
  return packed.has(destination) || [...packed].some((file) => file.startsWith(`${destination}/`));
}

test("pack includes runtime sources, workers, SQL, skills, vendor license and local QA docs", async () => {
  const required = [...documents, ...docs, "LICENSE"];
  for (const directory of ["extensions", "skills", "vendor/pi-background-tasks"]) {
    required.push(...(await filesUnder(directory)).filter((file) => !file.endsWith(".test.ts")));
  }
  for (const file of required) assert(packed.has(file), `missing packed asset: ${file}`);
  for (const file of packed) {
    assert(!file.startsWith(".pi/"), `session artifact shipped: ${file}`);
    assert(!/^[^/]*test-build\//.test(file), `test build shipped: ${file}`);
    assert(!file.startsWith("node_modules/"), `unexpected bundled dependency: ${file}`);
  }
});

test("first-party inline Markdown links resolve to files or directories in the package", async () => {
  for (const document of documents) {
    // This check covers inline links and file destinations, not heading anchors
    // or a general Markdown grammar. Vendor historical links are not local policy.
    const source = (await readFile(path.join(root, document), "utf8")).replace(/```[^]*?```/g, "");
    for (const match of source.matchAll(/\[[^\]\n]*\]\(([^\s)]+)\)/g)) {
      const href = match[1];
      if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(href)) continue;
      const destination = decodeURIComponent(href.split(/[?#]/)[0]);
      const absolute = path.resolve(root, path.dirname(document), destination);
      await access(absolute);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      assert(ships(relative), `${document}: link not shipped: ${href}`);
    }
  }
});

test("vendored instructions are explicitly labeled as upstream history", async () => {
  for (const file of ["README.md", "TESTING.md", "TEST_PLAN.md", "PUBLISHING.md"]) {
    const source = await readFile(path.join(root, "vendor/pi-background-tasks", file), "utf8");
    assert(source.startsWith("> **Upstream reference"), `unqualified upstream claims: ${file}`);
  }
});
