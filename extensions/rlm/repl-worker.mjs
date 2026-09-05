// Standalone worker source: no TypeScript loader or host event-loop execution.
import { parentPort, workerData } from "node:worker_threads";
import { promises as fs } from "node:fs";
import { resolve, sep } from "node:path";
import { createContext, Script } from "node:vm";
export function shortText(text, maxChars = 160) {
    if (text.length <= maxChars)
        return text;
    return `${text.slice(0, maxChars - 3)}...`;
}
export function chunkText(text, chunkSize) {
    if (text.length <= chunkSize)
        return [text];
    const chunks = [];
    let offset = 0;
    while (offset < text.length) {
        let end = Math.min(text.length, offset + chunkSize);
        if (end < text.length) {
            const newline = text.lastIndexOf("\n", end);
            if (newline > offset + Math.floor(chunkSize / 2))
                end = newline;
        }
        chunks.push(text.slice(offset, end));
        offset = end;
    }
    return chunks;
}
export function grepText(text, pattern, limit) {
    let regex;
    try {
        regex = new RegExp(pattern, "i");
    }
    catch {
        regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    }
    const lines = text.split(/\r?\n/);
    const matches = [];
    for (let i = 0; i < lines.length && matches.length < limit; i++) {
        if (regex.test(lines[i]))
            matches.push(`${i + 1}: ${lines[i]}`);
    }
    return matches;
}
const MAX_REPL_RESULT_CHARS = 100_000;
const MAX_LAZY_FILE_BYTES = 1_000_000;
const REPL_SYNC_TIMEOUT_MS = 1_000;
export async function evalInRepl(code, context, options = {}) {
    const helpers = createHelpers(context, options);
    for (const helper of Object.values(helpers)) {
        if (typeof helper === "function")
            Object.setPrototypeOf(helper, null);
    }
    const sandbox = Object.assign(Object.create(null), helpers);
    const vmContext = createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
    try {
        const script = new Script(`(async () => {\n"use strict";\n${code}\n})()`, { filename: "rlm-repl.js" });
        const pending = script.runInContext(vmContext, { timeout: REPL_SYNC_TIMEOUT_MS });
        const result = await pending;
        return formatResult(result);
    }
    catch (error) {
        const message = error instanceof Error ? error.stack || error.message : String(error);
        return `repl error: ${message}`;
    }
}
function createHelpers(context, options) {
    const base = {
        callRlm: async (task, subcontext) => {
            if (!options.callRlm)
                throw new Error("callRlm is not available in this REPL");
            return options.callRlm(task, subcontext);
        },
        rLoadCode: () => workerData.rLoadCode,
    };
    if (context.kind === "text") {
        const lines = context.text.split(/\r?\n/);
        return {
            ...base,
            context: {
                kind: "text",
                chars: context.text.length,
                text: context.text,
                lines,
            },
            contextText: context.text,
            contextLines: () => [...lines],
            grepText: (pattern, limit = 20) => grepText(context.text, pattern, limit),
            chunkText: (size = 40000) => chunkText(context.text, size),
        };
    }
    if (context.kind === "files") {
        const loadedFiles = context.files.filter((file) => file.text !== undefined);
        return {
            ...base,
            context: {
                kind: "files",
                root: context.root,
                fileCount: context.files.length,
                loadedFileCount: loadedFiles.length,
                loadedChars: loadedFiles.reduce((sum, file) => sum + (file.text?.length ?? 0), 0),
                files: context.files.map((file) => ({
                    path: file.path,
                    bytes: file.size,
                    loaded: file.text !== undefined,
                    omittedReason: file.omittedReason,
                })),
            },
            listFiles: (pattern) => filterFilePaths(context.files.map((file) => file.path), pattern),
            fileInfo: (path) => {
                const file = getFile(context.files, path);
                return file ? { path: file.path, bytes: file.size, loaded: file.text !== undefined, omittedReason: file.omittedReason } : null;
            },
            readFile: async (path) => loadFileText(context.root, getFile(context.files, path)),
            peekFile: async (path, start = 0, end = 2000) => {
                const text = (await loadFileText(context.root, getFile(context.files, path))) ?? "";
                const s = Math.max(0, Math.min(start, text.length));
                const e = Math.max(s, Math.min(end, text.length));
                return text.slice(s, e);
            },
            grepFiles: async (pattern, limit = 20) => grepFiles(context.root, context.files, pattern, limit),
            chunkFiles: (maxChars = 40000) => chunkFiles(context.files, maxChars),
        };
    }
    if (context.kind === "csv") {
        return {
            ...base,
            context: {
                kind: "csv",
                text: context.text,
                columns: context.columns,
                rowCount: context.rows.length,
                rows: context.rows,
            },
            csvColumns: () => [...context.columns],
            csvRows: () => context.rows.map((row) => ({ ...row })),
            csvColumn: (name) => context.rows.map((row) => row[name]),
        };
    }
    if (context.kind === "json") {
        return {
            ...base,
            context: {
                kind: "json",
                value: context.value,
            },
            jsonValue: context.value,
            jsonKeys: () => (isRecord(context.value) ? Object.keys(context.value) : []),
            jsonEntries: () => (isRecord(context.value) ? Object.entries(context.value) : []),
        };
    }
    return {
        ...base,
        context: {
            kind: "parquet",
            path: context.path,
            columns: context.columns,
            rowCount: context.rows.length,
            rows: context.rows,
        },
        parquetPath: context.path,
        parquetColumns: () => [...context.columns],
        parquetRows: () => context.rows.map((row) => ({ ...row })),
    };
}
function formatResult(value) {
    let formatted;
    if (value === undefined || value === null)
        formatted = "";
    else if (typeof value === "string")
        formatted = value;
    else if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
        formatted = String(value);
    else {
        try {
            formatted = JSON.stringify(value, null, 2);
        }
        catch {
            formatted = String(value);
        }
    }
    return shortText(formatted, MAX_REPL_RESULT_CHARS);
}
function getFile(files, path) {
    return files.find((file) => file.path === path);
}
async function loadFileText(root, file) {
    if (!file || file.omittedReason === "binary" || file.omittedReason === "unreadable")
        return null;
    if (file.text !== undefined)
        return file.text;
    if (file.size > MAX_LAZY_FILE_BYTES)
        return null;
    const rootPath = resolve(root);
    const fullPath = resolve(rootPath, file.path);
    if (fullPath !== rootPath && !fullPath.startsWith(`${rootPath}${sep}`))
        return null;
    try {
        const readablePath = await fs.realpath(fullPath);
        if (readablePath !== rootPath && !readablePath.startsWith(`${rootPath}${sep}`))
            return null;
        const stat = await fs.stat(readablePath);
        if (!stat.isFile() || stat.size > MAX_LAZY_FILE_BYTES)
            return null;
        const data = await fs.readFile(readablePath);
        if (data.length > MAX_LAZY_FILE_BYTES || data.includes(0))
            return null;
        return data.toString("utf8");
    }
    catch {
        return null;
    }
}
function filterFilePaths(paths, pattern) {
    if (!pattern)
        return paths;
    const regex = safeRegex(pattern);
    return paths.filter((path) => regex.test(path));
}
async function grepFiles(root, files, pattern, limit) {
    const regex = safeRegex(pattern);
    const matches = [];
    for (const file of files) {
        if (matches.length >= limit)
            break;
        if (regex.test(file.path))
            matches.push(`${file.path}:<path>`);
        const text = await loadFileText(root, file);
        if (text === null)
            continue;
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length && matches.length < limit; i++) {
            if (regex.test(lines[i]))
                matches.push(`${file.path}:${i + 1}: ${lines[i]}`);
        }
    }
    return matches;
}
function chunkFiles(files, maxChars) {
    const chunks = [];
    let current = [];
    let currentChars = 0;
    for (const file of files) {
        const cost = (file.text?.length ?? 0) + file.path.length + 32;
        if (current.length > 0 && currentChars + cost > maxChars) {
            chunks.push(current);
            current = [];
            currentChars = 0;
        }
        current.push(file.path);
        currentChars += cost;
    }
    if (current.length > 0)
        chunks.push(current);
    return chunks;
}
function safeRegex(pattern) {
    try {
        return new RegExp(pattern, "i");
    }
    catch {
        return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    }
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

let nextRequest = 0;
const requests = new Map();
parentPort.on("message", ({ id, result, error }) => {
  const request = requests.get(id);
  if (!request) return;
  requests.delete(id);
  if (error) request.reject(new Error(error));
  else request.resolve(result);
});
const result = await evalInRepl(workerData.code, workerData.context, {
  callRlm: (task, context) => new Promise((resolve, reject) => {
    const id = ++nextRequest;
    requests.set(id, { resolve, reject });
    parentPort.postMessage({ type: "callRlm", id, task, context });
  }),
});
parentPort.postMessage({ type: "result", result });
parentPort.close();
