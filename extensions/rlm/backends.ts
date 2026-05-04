import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Message } from "@mariozechner/pi-ai";
import { qualifyModel } from "./utils.js";

export interface CompletionResult {
  text: string;
  messages: Message[];
  stderr: string;
  exitCode: number;
}

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
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-rlm-prompt-"));
  const systemPromptPath = path.join(tmpDir, "system.md");
  await fs.promises.writeFile(systemPromptPath, input.systemPrompt, "utf8");

  try {
    const args = [
      "--mode",
      "json",
      "-p",
      "--no-session",
      "--model",
      qualifyModel(input.model),
      "--append-system-prompt",
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

      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d) => (stdout += d.toString()));
      proc.stderr.on("data", (d) => (stderr += d.toString()));
      proc.on("error", () => resolve({ text: "", messages: [], stderr: stderr || "Failed to spawn pi", exitCode: 1 }));
      proc.on("close", (code) => {
        const lines = stdout.split(/\r?\n/).filter(Boolean);
        const messages: Message[] = [];
        for (const line of lines) {
          try {
            const event = JSON.parse(line) as any;
            if (event.type === "message_end" && event.message) messages.push(event.message as Message);
          } catch {
            // ignore non-json noise
          }
        }
        let text = "";
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          if (msg.role === "assistant") {
            for (const part of msg.content) {
              if (part.type === "text") {
                text = part.text;
                break;
              }
            }
            if (text) break;
          }
        }
        resolve({ text, messages, stderr, exitCode: code ?? 0 });
      });

      if (input.signal) {
        const kill = () => proc.kill("SIGTERM");
        if (input.signal.aborted) kill();
        else input.signal.addEventListener("abort", kill, { once: true });
      }
    });
  } finally {
    try {
      await fs.promises.unlink(systemPromptPath);
      await fs.promises.rmdir(tmpDir);
    } catch {
      // ignore
    }
  }
}
