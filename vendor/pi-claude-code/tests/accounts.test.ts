import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  absoluteConfigDir,
  accountEnv,
  accountsPath,
  addAccount,
  nextAccount,
  readAccounts,
  removeAccount,
  selectAccount,
  updateAccounts,
  type ClaudeAccounts,
} from "../src/accounts.ts";
import { createClaudeCodeProvider } from "../src/provider.ts";

async function withAgentDir(run: (file: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "pi-claude-accounts-"));
  try {
    await run(accountsPath(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("account selection round-trips through a private state file", () =>
  withAgentDir(async (file) => {
    assert.deepEqual(await readAccounts(file), { accounts: {} });
    await updateAccounts(file, (state) => addAccount(state, "work", "/srv/claude-work"));
    const state = await updateAccounts(file, (current) => selectAccount(current, "work"));
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.deepEqual(await readAccounts(file), state);
    assert.deepEqual(accountEnv(state), { PI_CLAUDE_CODE_CONFIG_DIR: "/srv/claude-work", CLAUDE_CONFIG_DIR: "/srv/claude-work" });
    assert.equal(JSON.parse(await readFile(file, "utf8")).active, "work");
  }));

test("concurrent updates from several sessions are all kept", () =>
  withAgentDir(async (file) => {
    const names = Array.from({ length: 12 }, (_, index) => `acct${index}`);
    await Promise.all(names.map((name) => updateAccounts(file, (state) => addAccount(state, name, `/srv/${name}`))));
    assert.deepEqual(Object.keys((await readAccounts(file)).accounts).sort(), names.sort());

    const rotate = (state: ClaudeAccounts) => selectAccount(state, nextAccount(state)!);
    const picks = await Promise.all(names.map(() => updateAccounts(file, rotate)));
    assert.equal(new Set(picks.map((state) => state.active)).size, names.length, "each rotation sees the previous one");
  }));

test("a lock left by an exited process is broken; a live holder's lock is not", () =>
  withAgentDir(async (file) => {
    const exited = spawnSync(process.execPath, ["-e", ""]).pid;
    await writeFile(`${file}.lock`, `${exited}:abandoned`);
    await updateAccounts(file, (state) => addAccount(state, "work", "/srv/claude-work"));
    assert.deepEqual(Object.keys((await readAccounts(file)).accounts), ["work"]);
    assert.deepEqual((await readdir(dirname(file))).sort(), ["claude-code-accounts.json"], "no lock or temporary files remain");

    await writeFile(`${file}.lock`, `${process.pid}:held-elsewhere`);
    const waiting = updateAccounts(file, (state) => addAccount(state, "home", "/srv/claude-home"));
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.deepEqual(Object.keys((await readAccounts(file)).accounts), ["work"], "the live lock is respected");
    await rm(`${file}.lock`);
    await waiting;
    assert.deepEqual(Object.keys((await readAccounts(file)).accounts).sort(), ["home", "work"]);
  }));

test("a failed change leaves the previous state and releases the lock", () =>
  withAgentDir(async (file) => {
    await updateAccounts(file, (state) => addAccount(state, "work", "/srv/claude-work"));
    await assert.rejects(updateAccounts(file, (state) => selectAccount(state, "missing")), /Unknown Claude account/);
    assert.equal((await readAccounts(file)).active, undefined);
    assert.deepEqual(await readdir(dirname(file)), ["claude-code-accounts.json"]);
  }));

test("directories are made absolute once, against the caller's working directory", () => {
  assert.equal(absoluteConfigDir("~/.claude-work", "/project"), join(homedir(), ".claude-work"));
  assert.equal(absoluteConfigDir("logins/work", "/project"), "/project/logins/work");
  assert.equal(absoluteConfigDir(" /srv/claude ", "/project"), "/srv/claude");
  assert.throws(() => absoluteConfigDir("  ", "/project"), /must not be empty/);
  assert.throws(() => addAccount({ accounts: {} }, "work", "relative/dir"), /must be absolute/);
});

test("next rotates through named accounts and default restores the configured login", () => {
  const base = addAccount(addAccount({ accounts: {} }, "a", "/a"), "b", "/b");
  assert.equal(nextAccount(base), "a");
  assert.equal(nextAccount(selectAccount(base, "a")), "b");
  assert.equal(nextAccount(selectAccount(base, "b")), "a");
  assert.equal(nextAccount(selectAccount(addAccount({ accounts: {} }, "solo", "/s"), "solo")), undefined);
  assert.equal(accountEnv(selectAccount(selectAccount(base, "a"), "default")), undefined);
  assert.equal(removeAccount(selectAccount(base, "a"), "a").active, undefined);
  assert.throws(() => selectAccount(base, "missing"), /Unknown Claude account/);
  for (const verb of ["default", "list", "next", "add", "remove"]) assert.throws(() => addAccount(base, verb, "/x"), /reserved/);
  assert.throws(() => addAccount(base, "../escape", "/x"), /Account names/);
});

test("inherited object names are not accounts", () => {
  for (const name of ["constructor", "toString", "hasOwnProperty"]) {
    assert.throws(() => selectAccount({ accounts: {} }, name), /Unknown Claude account/);
    assert.throws(() => removeAccount({ accounts: {} }, name), /Unknown Claude account/);
  }
});

test("malformed state files are rejected and a stale selection falls back", () =>
  withAgentDir(async (file) => {
    for (const bad of ["[]", "null", '{"accounts": []}', '{"accounts": {"w": "relative"}}', '{"accounts": {"default": "/d"}}']) {
      await writeFile(file, bad);
      await assert.rejects(readAccounts(file), new RegExp(file.replaceAll("/", "\\/")));
    }
    await writeFile(file, JSON.stringify({ active: "constructor", accounts: { work: "/w" } }));
    assert.equal((await readAccounts(file)).active, undefined);
  }));

test("requests, status, and discovery use the selection another session wrote", () =>
  withAgentDir(async (file) => {
    const provider = createClaudeCodeProvider({ accounts: () => readAccounts(file) });
    const isolated = createClaudeCodeProvider();
    const ctx = {
      env: async (name: string) => (name === "PI_CLAUDE_CODE_CONFIG_DIR" ? "/srv/claude-settings" : undefined),
      fileExists: async () => false,
    };
    const configDir = async (target: typeof provider) =>
      (await target.auth.apiKey!.resolve!({ ctx, signal: new AbortController().signal } as never))!.env?.PI_CLAUDE_CODE_CONFIG_DIR;

    assert.equal(await configDir(provider), "/srv/claude-settings");
    await updateAccounts(file, (state) => selectAccount(addAccount(state, "work", "/srv/claude-work"), "work"));
    assert.equal(await configDir(provider), "/srv/claude-work");
    assert.equal(await configDir(isolated), "/srv/claude-settings", "a provider without accounts keeps its settings");
    await updateAccounts(file, (state) => selectAccount(state, "default"));
    assert.equal(await configDir(provider), "/srv/claude-settings");
  }));
