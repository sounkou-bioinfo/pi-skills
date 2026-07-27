import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = path.join(root, "node_modules", "pi-background-tasks", "src", "core", "registry.ts");

const vulnerable = `\tasync ensureRuntimeDir(ctx: BackgroundTaskContext): Promise<RuntimeDir> {
\t\tif (this.runtimeDir) return this.runtimeDir;
\t\tconst sessionId = sanitizePathSegment(ctx.sessionId ?? \`session-\${process.pid}\`);
\t\tconst runId = \`\${sessionId}-\${process.pid}\`;
\t\tconst runtimeDirAbs = join(ctx.cwd, ".pi", "tasks", runId);
\t\tconst runtimeDirDisplay = join(".pi", "tasks", runId);
\t\tawait mkdir(runtimeDirAbs, { recursive: true });
\t\tthis.runtimeDir = { abs: runtimeDirAbs, display: runtimeDirDisplay };
\t\treturn this.runtimeDir;
\t}`;

const fixed = `\tasync ensureRuntimeDir(ctx: BackgroundTaskContext): Promise<RuntimeDir> {
\t\tif (!this.runtimeDir) {
\t\t\tconst sessionId = sanitizePathSegment(ctx.sessionId ?? \`session-\${process.pid}\`);
\t\t\tconst runId = \`\${sessionId}-\${process.pid}\`;
\t\t\tthis.runtimeDir = {
\t\t\t\tabs: join(ctx.cwd, ".pi", "tasks", runId),
\t\t\t\tdisplay: join(".pi", "tasks", runId),
\t\t\t};
\t\t}
\t\tawait mkdir(this.runtimeDir.abs, { recursive: true });
\t\treturn this.runtimeDir;
\t}`;

const source = await readFile(registryPath, "utf8");
if (source.includes(fixed)) {
  console.log("pi-background-tasks runtime-directory patch is present");
  process.exit(0);
}
if (!source.includes(vulnerable)) {
  throw new Error(
    "pi-background-tasks registry.ts does not match pinned 0.6.0; review the dependency before updating this patch",
  );
}

const temporaryPath = `${registryPath}.${process.pid}.tmp`;
await writeFile(temporaryPath, source.replace(vulnerable, fixed), "utf8");
await rename(temporaryPath, registryPath);
console.log("patched pi-background-tasks 0.6.0 runtime-directory recovery");
