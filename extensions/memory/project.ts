import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type ProjectContext = {
  id?: string;
  graph?: string;
  root: string;
  identity: "override" | "origin" | "local" | "none";
  revision?: string;
  branch?: string;
  dirty?: boolean;
};

// Identity only: credentials, query strings and fragments never enter memory.
export function canonicalRemote(remote: string): string | undefined {
  const scp = /^([^/@:]+@)?([^/:]+):(.+)$/.exec(remote);
  let host: string;
  let pathname: string;
  if (scp && !remote.includes("://") && !/^[A-Za-z]:[\\/]/.test(remote)) {
    host = scp[2].toLowerCase();
    pathname = scp[3];
  } else {
    let url: URL;
    try { url = new URL(remote); } catch { return undefined; }
    if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol)) return undefined;
    host = url.hostname.toLowerCase();
    if (url.port && !(url.protocol === "ssh:" && url.port === "22")) host += `:${url.port}`;
    pathname = url.pathname;
  }
  pathname = pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
  if (!host || !pathname || /[\r\n?#]/.test(pathname)) return undefined;
  if (host === "github.com") pathname = pathname.toLowerCase();
  return `${host}/${pathname}`;
}

export async function resolveProject(cwd: string, override?: string): Promise<ProjectContext> {
  const explicit = override?.trim();
  if (override !== undefined && (!explicit || /[\r\n]/.test(explicit) || Buffer.byteLength(explicit) > 180)) {
    throw new Error("PI_MEMORY_PROJECT must be one line of 1–180 UTF-8 bytes");
  }
  const root = await git(cwd, ["rev-parse", "--show-toplevel"]);
  if (!root) return explicit
    ? { id: explicit, graph: `project:${explicit}`, root: path.resolve(cwd), identity: "override" }
    : { root: path.resolve(cwd), identity: "none" };

  const [origin, common, revision, branch, status] = await Promise.all([
    git(root, ["remote", "get-url", "origin"]),
    git(root, ["rev-parse", "--git-common-dir"]),
    git(root, ["rev-parse", "--verify", "HEAD"]),
    git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    git(root, ["status", "--porcelain", "--untracked-files=normal"]),
  ]);
  const remote = origin && canonicalRemote(origin);
  const identity = explicit ? "override" : remote ? "origin" : "local";
  const key = explicit ?? (remote
    ? `git:${remote}`
    : `local:${createHash("sha256").update(path.resolve(root, common ?? ".git")).digest("hex")}`);
  // Long remote locators retain stable identity without exceeding graph labels.
  const id = Buffer.byteLength(key) <= 180 ? key : `git:${createHash("sha256").update(key).digest("hex")}`;
  return { id, graph: `project:${id}`, root, identity, revision, branch, dirty: status === undefined ? undefined : status.length > 0 };
}

async function git(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const result = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-C", cwd, ...args], {
      encoding: "utf8", timeout: 2000, maxBuffer: 32 * 1024,
    });
    return result.stdout.trim();
  } catch (error) {
    const failure = error as { code?: string | number; stdout?: string };
    const code = failure.code;
    // Porcelain emits nothing for clean trees. A bounded nonempty prefix is
    // sufficient for this boolean; unlike identity, it needs no full listing.
    if (args[0] === "status" && code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" && failure.stdout) return "dirty";
    if (code === 1 || code === 2 || code === 128 || code === "ENOENT") return undefined;
    throw new Error("Unable to inspect project Git metadata within its time/output bound", { cause: error });
  }
}
