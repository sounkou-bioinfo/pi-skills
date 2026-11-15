import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Exercise Pi's module aliases, not Node's direct package resolution.
const { loadExtensions } = await import(
  new URL("./core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href
);

test("loads an installed extension without local peer dependencies", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-claude-code-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp(new URL("../src/", import.meta.url), join(directory, "src"), { recursive: true });

  const result = await loadExtensions([join(directory, "src/index.ts")], directory);
  assert.deepEqual(result.errors, []);
  assert.equal(result.extensions.length, 1);
  assert.equal(result.extensions[0].commands.has("claude-code-status"), true);
  const registrations = result.runtime.pendingNativeProviderRegistrations;
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].provider.id, "claude-code");
  assert.ok(registrations[0].provider.getModels().length > 0);
});
