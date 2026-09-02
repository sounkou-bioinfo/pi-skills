import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import antiSlopExtension from "./index.js";

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  details: { path: string; language: string; jarl: boolean };
};

type RegisteredTool = {
  execute: (
    toolCallId: string,
    params: { path: string; language?: "auto" | "r" | "c"; config?: string; max_findings?: number; jarl?: boolean },
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: ExtensionContext,
  ) => Promise<ToolResult>;
};

type RegisteredCommand = {
  handler: (args: string, ctx: ExtensionContext) => Promise<void>;
};

test("forwards an explicit Jarl request to the vendored analyzer", async () => {
  let tool: RegisteredTool | undefined;
  let command: RegisteredCommand | undefined;
  const calls: Array<{ command: string; args: string[] }> = [];
  const notifications: string[] = [];
  const previousJarlBin = process.env.PI_ANTI_SLOP_JARL_BIN;
  process.env.PI_ANTI_SLOP_JARL_BIN = "/opt/jarl";

  try {
    const pi = {
      registerTool(definition: unknown) {
        tool = definition as RegisteredTool;
      },
      registerCommand(_name: string, definition: unknown) {
        command = definition as RegisteredCommand;
      },
      async exec(command: string, args: string[]) {
        calls.push({ command, args });
        return { code: 0, stdout: "analysis complete", stderr: "" };
      },
    } as unknown as ExtensionAPI;

    antiSlopExtension(pi);
    assert.ok(tool);
    const result = await tool.execute(
      "call-1",
      { path: "R/example.R", language: "r", max_findings: 12, jarl: true },
      undefined,
      undefined,
      { cwd: "/repo" } as ExtensionContext,
    );

    assert.equal(result.content[0]?.text, "analysis complete");
    assert.deepEqual(result.details, { path: "/repo/R/example.R", language: "r", jarl: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, "Rscript");
    assert.deepEqual(calls[0]?.args.slice(-4), ["12", "--jarl", "/opt/jarl", "/repo/R/example.R"]);

    assert.ok(command);
    const commandContext = {
      cwd: "/repo",
      ui: { notify(message: string) { notifications.push(message); } },
    } as unknown as ExtensionContext;
    await command.handler("--jarl", commandContext);
    assert.match(notifications[0] ?? "", /^Usage:/);
    assert.equal(calls.length, 1);
    await command.handler("--jarl\tR/example.R", commandContext);
    assert.deepEqual(calls[1]?.args.slice(-3), ["--jarl", "/opt/jarl", "/repo/R/example.R"]);
  } finally {
    if (previousJarlBin === undefined) delete process.env.PI_ANTI_SLOP_JARL_BIN;
    else process.env.PI_ANTI_SLOP_JARL_BIN = previousJarlBin;
  }
});
