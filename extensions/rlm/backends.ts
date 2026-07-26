import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { qualifyModel } from "./utils.js";

export interface CompletionResult {
  text: string;
  stderr: string;
  exitCode: number;
}

const MAX_STDERR_CHARS = 100_000;
const MAX_EVENT_LINE_CHARS = 2_000_000;
const MAX_RESPONSE_CHARS = 100_000;

function getPiInvocation(piBin: string, args: string[]): { command: string; args: string[] } {
  if (piBin !== "pi") return { command: piBin, args };
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) return { command: process.execPath, args };
  return { command: "pi", args };
}

export async function completeWithCli(input: {
  model: string;
  prompt: string;
  systemPrompt: string;
  cwd: string;
  piBin: string;
  signal?: AbortSignal;
}): Promise<CompletionResult> {
  const releaseSlot = await processSlots.acquire(input.signal);
  let tmpDir: string | undefined;

  try {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-rlm-prompt-"));
    const systemPromptPath = path.join(tmpDir, "system.md");
    await fs.promises.writeFile(systemPromptPath, input.systemPrompt, "utf8");
    const args = [
      "--mode",
      "json",
      "-p",
      "--no-session",
      "--no-tools",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
      "--model",
      qualifyModel(input.model),
      "--system-prompt",
      systemPromptPath,
      input.prompt,
    ];
    const invocation = getPiInvocation(input.piBin, args);

    return await new Promise<CompletionResult>((resolve) => {
      const proc = spawn(invocation.command, invocation.args, {
        cwd: input.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let settled = false;
      let lineBuffer = "";
      let stderr = "";
      let responseText = "";
      let streamError = "";
      let killTimer: NodeJS.Timeout | undefined;

      const appendBounded = (current: string, addition: string, maxChars: number): string => {
        if (current.length >= maxChars) return current;
        return current + addition.slice(0, maxChars - current.length);
      };
      const consumeLine = (line: string): void => {
        if (!line) return;
        if (line.length > MAX_EVENT_LINE_CHARS) {
          streamError ||= `pi emitted a JSON event larger than ${MAX_EVENT_LINE_CHARS} characters`;
          return;
        }
        try {
          const event = JSON.parse(line) as { type?: string; message?: { role?: string; content?: Array<{ type?: string; text?: string }> } };
          if (event.type !== "message_end" || event.message?.role !== "assistant" || !Array.isArray(event.message.content)) return;
          const text = event.message.content
            .filter((part) => part.type === "text" && typeof part.text === "string")
            .map((part) => part.text as string)
            .join("\n");
          responseText = text.length <= MAX_RESPONSE_CHARS ? text : `${text.slice(0, MAX_RESPONSE_CHARS)}\n[response truncated by RLM]`;
        } catch {
          // Ignore non-JSON startup noise without retaining it.
        }
      };
      const consumeStdout = (chunk: Buffer | string): void => {
        lineBuffer += chunk.toString();
        let newline = lineBuffer.indexOf("\n");
        while (newline >= 0) {
          const line = lineBuffer.slice(0, newline).replace(/\r$/, "");
          lineBuffer = lineBuffer.slice(newline + 1);
          consumeLine(line);
          newline = lineBuffer.indexOf("\n");
        }
        if (lineBuffer.length > MAX_EVENT_LINE_CHARS) {
          streamError ||= `pi emitted an unterminated JSON event larger than ${MAX_EVENT_LINE_CHARS} characters`;
          lineBuffer = "";
        }
      };
      const finish = (result: CompletionResult): void => {
        if (settled) return;
        settled = true;
        if (killTimer) clearTimeout(killTimer);
        if (input.signal) input.signal.removeEventListener("abort", kill);
        resolve(result);
      };
      const kill = (): void => {
        proc.kill("SIGTERM");
        killTimer = setTimeout(() => proc.kill("SIGKILL"), 5000);
        killTimer.unref();
      };

      proc.stdout.on("data", consumeStdout);
      proc.stderr.on("data", (chunk) => {
        stderr = appendBounded(stderr, chunk.toString(), MAX_STDERR_CHARS);
      });
      proc.on("error", (error) => finish({ text: "", stderr: stderr || error.message || "Failed to spawn pi", exitCode: 1 }));
      proc.on("close", (code, closeSignal) => {
        if (lineBuffer) consumeLine(lineBuffer.replace(/\r$/, ""));
        const aborted = input.signal?.aborted ?? false;
        const exitCode = aborted ? 130 : closeSignal ? 128 : (code ?? 1);
        const diagnostic = [stderr, streamError, aborted ? "RLM model call aborted" : ""].filter(Boolean).join("\n");
        finish({ text: responseText, stderr: diagnostic, exitCode });
      });

      if (input.signal) {
        if (input.signal.aborted) kill();
        else input.signal.addEventListener("abort", kill, { once: true });
      }
    });
  } finally {
    releaseSlot();
    if (tmpDir) await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}

class AsyncSemaphore {
  private active = 0;
  private readonly waiters: Array<{
    resolve: (release: () => void) => void;
    reject: (error: Error) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
  }> = [];

  constructor(private readonly limit: number) {}

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new Error("RLM model call aborted before start"));
    return new Promise((resolve, reject) => {
      const waiter: (typeof this.waiters)[number] = { resolve, reject, signal };
      if (signal) {
        waiter.onAbort = () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new Error("RLM model call aborted while queued"));
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.waiters.push(waiter);
      this.dispatch();
    });
  }

  private dispatch(): void {
    while (this.active < this.limit && this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      if (waiter.signal?.aborted) continue;
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
      this.active++;
      let released = false;
      waiter.resolve(() => {
        if (released) return;
        released = true;
        this.active--;
        this.dispatch();
      });
    }
  }
}

const processSlots = new AsyncSemaphore(1);
