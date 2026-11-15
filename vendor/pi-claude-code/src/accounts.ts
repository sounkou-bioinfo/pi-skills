import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

/**
 * Named Claude Code logins. Each account is an absolute Claude Code config
 * directory holding its own subscription login; the active account is passed
 * to Claude Code as `CLAUDE_CONFIG_DIR`.
 */
export interface ClaudeAccounts {
  active?: string;
  accounts: Record<string, string>;
}

export const DEFAULT_ACCOUNT = "default";
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
/** Command verbs and the configured login cannot name an account. */
export const RESERVED_NAMES = new Set([DEFAULT_ACCOUNT, "list", "next", "add", "remove"]);
const LOCK_TIMEOUT_MS = 10_000;

export function accountsPath(agentDir: string): string {
  return join(agentDir, "claude-code-accounts.json");
}

/** Resolve `~` and relative directories once, against the caller's working directory. */
export function absoluteConfigDir(dir: string, cwd: string): string {
  const trimmed = dir.trim();
  if (!trimmed) throw new Error("Claude account directory must not be empty");
  if (trimmed === "~" || trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(1));
  return isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
}

function hasAccount(state: ClaudeAccounts, name: string): boolean {
  return Object.hasOwn(state.accounts, name);
}

export async function readAccounts(file: string): Promise<ClaudeAccounts> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { accounts: {} };
    throw error;
  }
  const value: unknown = JSON.parse(text);
  const raw = (value as { accounts?: unknown } | null)?.accounts;
  if (typeof value !== "object" || value === null || typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${file}: expected {"accounts": {"<name>": "<absolute config dir>"}}`);
  }
  const accounts: Record<string, string> = {};
  for (const [name, dir] of Object.entries(raw)) {
    if (!NAME.test(name) || RESERVED_NAMES.has(name) || typeof dir !== "string" || !isAbsolute(dir)) {
      throw new Error(`${file}: account ${JSON.stringify(name)} needs a valid name and an absolute directory`);
    }
    accounts[name] = dir;
  }
  const active = (value as { active?: unknown }).active;
  return typeof active === "string" && Object.hasOwn(accounts, active) ? { active, accounts } : { accounts };
}

async function writeAccounts(file: string, state: ClaudeAccounts): Promise<void> {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

const readText = (path: string) => readFile(path, "utf8").catch(() => undefined);

function ownerAlive(token: string): boolean {
  const pid = Number(token.split(":", 1)[0]);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Remove a lock whose owner process has exited. The lock is moved aside first;
 * if another contender replaced it in the meantime, the live lock is linked back.
 */
async function breakAbandonedLock(lock: string, abandoned: string): Promise<void> {
  const aside = `${lock}.${randomUUID()}.stale`;
  try {
    await rename(lock, aside);
  } catch {
    return;
  }
  if ((await readText(aside)) !== abandoned) await link(aside, lock).catch(() => undefined);
  await rm(aside, { force: true });
}

/** Lock files hold `<pid>:<uuid>`; only a lock whose process has exited is broken. */
async function acquireLock(lock: string): Promise<string> {
  const token = `${process.pid}:${randomUUID()}`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    const staged = `${lock}.${randomUUID()}.new`;
    try {
      await writeFile(staged, token, { mode: 0o600 });
      await link(staged, lock);
      return token;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally {
      await rm(staged, { force: true });
    }
    const holder = await readText(lock);
    if (holder !== undefined && !ownerAlive(holder)) await breakAbandonedLock(lock, holder);
    else if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${lock}; remove it if no Pi session is changing Claude accounts`);
    }
    else await sleep(25);
  }
}

async function releaseLock(lock: string, token: string): Promise<void> {
  if ((await readText(lock)) === token) await rm(lock, { force: true });
}

/** Read, change, and replace the account file under a cross-process lock. */
export async function updateAccounts(
  file: string,
  change: (state: ClaudeAccounts) => ClaudeAccounts,
): Promise<ClaudeAccounts> {
  await mkdir(dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  const token = await acquireLock(lock);
  try {
    const state = change(await readAccounts(file));
    await writeAccounts(file, state);
    return state;
  } finally {
    await releaseLock(lock, token);
  }
}

/** Environment override for the active account, or undefined for the configured login. */
export function accountEnv(state: ClaudeAccounts): Record<string, string> | undefined {
  const dir = state.active ? state.accounts[state.active] : undefined;
  return dir ? { PI_CLAUDE_CODE_CONFIG_DIR: dir, CLAUDE_CONFIG_DIR: dir } : undefined;
}

export function addAccount(state: ClaudeAccounts, name: string, dir: string): ClaudeAccounts {
  if (!NAME.test(name) || RESERVED_NAMES.has(name)) {
    throw new Error(
      `Account names use letters, digits, '.', '_' or '-'; ${[...RESERVED_NAMES].map((n) => `"${n}"`).join(", ")} are reserved`,
    );
  }
  if (!isAbsolute(dir)) throw new Error(`Claude account directory must be absolute: ${dir}`);
  return { ...state, accounts: { ...state.accounts, [name]: dir } };
}

export function removeAccount(state: ClaudeAccounts, name: string): ClaudeAccounts {
  if (!hasAccount(state, name)) throw new Error(`Unknown Claude account "${name}"`);
  const accounts = Object.fromEntries(Object.entries(state.accounts).filter(([key]) => key !== name));
  return state.active === name ? { accounts } : { active: state.active, accounts };
}

export function selectAccount(state: ClaudeAccounts, name: string): ClaudeAccounts {
  if (name === DEFAULT_ACCOUNT) return { accounts: state.accounts };
  if (!hasAccount(state, name)) throw new Error(`Unknown Claude account "${name}"`);
  return { ...state, active: name };
}

/** The account after the active one, wrapping around; used when a plan limit is exhausted. */
export function nextAccount(state: ClaudeAccounts): string | undefined {
  const names = Object.keys(state.accounts);
  if (names.length === 0) return undefined;
  const index = state.active ? names.indexOf(state.active) : -1;
  const next = names[(index + 1) % names.length];
  return next === state.active ? undefined : next;
}
