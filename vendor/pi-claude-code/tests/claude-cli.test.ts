import assert from "node:assert/strict";
import * as http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isRetryableAssistantError, normalizeContext, type AssistantMessage } from "@earendil-works/pi-ai";
import {
  cachedClaudeProcessCount,
  closeClaudeProcesses,
  discoverClaudeModels,
  getClaudeStatus,
  rewriteInitialRequest,
  runClaudeRequest,
} from "../src/claude-cli.ts";
import type { NativeFrame } from "../src/native-types.ts";
import { createClaudeCodeProvider } from "../src/provider.ts";
import { streamClaudeCode } from "../src/stream.ts";

type Block = Record<string, unknown>;
type WireMessage = { role: string; content: unknown };

const text = (value: string): Block => ({ type: "text", text: value });
const memory = "<system-reminder>[MEMORY.md contents]</system-reminder>";
const account = "<system-reminder># userEmail\nuser@example.com</system-reminder>";

/** Canonical frames for the non-system messages of a wire request without reminders. */
function framesFor(messages: WireMessage[]): NativeFrame[] {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      type: message.role as "user" | "assistant",
      message: { role: message.role as "user" | "assistant", content: structuredClone(message.content) as unknown[] },
    }));
}

function rewrite(
  wire: WireMessage[],
  frames: NativeFrame[],
  initialSystemMessages?: unknown[],
  injections?: Parameters<typeof rewriteInitialRequest>[3],
): WireMessage[] {
  const body = Buffer.from(JSON.stringify({ messages: wire }));
  return (JSON.parse(rewriteInitialRequest(body, frames, initialSystemMessages, injections).toString("utf8")) as {
    messages: WireMessage[];
  }).messages;
}

const withoutMarkers = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, child) => (key === "cache_control" ? undefined : child)));

test("stabilizes Claude Code's native replay reminders and cache breakpoint", () => {
  const initialSystemMessages = [
    {
      role: "system",
      content: [
        {
          type: "text",
          text: "environment reminder\ndate reminder",
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
      ],
    },
  ];
  const canonical = [
    { role: "user", content: [text("inspect")] },
    { role: "assistant", content: [text("first reply")] },
    { role: "user", content: [text("follow up")] },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "old result" }] },
    { role: "assistant", content: [{ type: "tool_use", id: "t2", name: "read", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: "current result" }] },
  ];
  const current = [
    { role: "user", content: [text("changed reminder"), text("inspect")] },
    { role: "system", content: "environment reminder" },
    { role: "assistant", content: [text("first reply")] },
    { role: "user", content: [text(account), text("follow up")] },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "old result" }] },
    { role: "assistant", content: [{ type: "tool_use", id: "t2", name: "read", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: `current result\n${account}` }] },
    {
      role: "system",
      content: [{ type: "text", text: "date reminder", cache_control: { type: "ephemeral", ttl: "1h" } }],
    },
  ];

  const rewritten = rewrite(current, framesFor(canonical), initialSystemMessages);
  assert.equal(rewritten.length, 8);
  assert.equal(((rewritten[1]?.content as Block[])[0]?.text as string), "environment reminder\ndate reminder");
  assert.equal((rewritten[1]?.content as Block[])[0]?.cache_control, undefined);
  assert.deepEqual(
    withoutMarkers(rewritten.filter((message) => message.role !== "system")),
    withoutMarkers(canonical),
  );
  assert.deepEqual((rewritten[5]?.content as Block[]).at(-1)?.cache_control, { type: "ephemeral", ttl: "1h" });
  assert.deepEqual((rewritten.at(-1)?.content as Block[]).at(-1)?.cache_control, { type: "ephemeral", ttl: "1h" });
});

test("strips reminders when the first user message carries none (issue #27)", () => {
  const canonical = [
    { role: "user", content: [text("inspect")] },
    { role: "assistant", content: [text("first reply")] },
    { role: "user", content: [text("follow up")] },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "result" }] },
  ];
  const wire = [
    { role: "user", content: [text("inspect")] },
    { role: "assistant", content: [text("first reply")] },
    { role: "user", content: [text(memory), text(account), text("follow up")] },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: `result\n${memory}${account}` }] },
  ];
  // No captured system messages: stripping must not depend on them.
  assert.deepEqual(withoutMarkers(rewrite(wire, framesFor(canonical))), canonical);
  assert.deepEqual(
    withoutMarkers(
      rewrite(wire, framesFor(canonical), [{ role: "system", content: "environment reminder" }]).filter(
        (message) => message.role !== "system",
      ),
    ),
    canonical,
  );
});

test("strips reminder tails from tool results whatever their separator or subset", () => {
  const canonicalResult = { type: "tool_result", tool_use_id: "t1", content: "result" };
  const frames = framesFor([
    { role: "user", content: [text("inspect")] },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read", input: {} }] },
    { role: "user", content: [canonicalResult] },
  ]);
  for (const tail of [
    `\n${memory}\n${account}`,
    `\n\n${memory}\n\n${account}`,
    `\n\n${account}`,
    `\n${account}`,
    account,
  ]) {
    const rewritten = rewrite(
      [
        { role: "user", content: [text("inspect")] },
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: `result${tail}` }] },
      ],
      frames,
    );
    assert.deepEqual((rewritten[2]?.content as Block[])[0]?.content, "result", JSON.stringify(tail));
  }
});

test("strips reminder blocks from text-array tool results and keeps Claude Code's images", () => {
  const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "original" } };
  const resized = { type: "image", source: { type: "base64", media_type: "image/png", data: "resized" } };
  const note = text("[Image: original 4000x4000, displayed at 2000x2000. Multiply coordinates by 2.00 to map to original image.]");
  const frames = framesFor([
    { role: "user", content: [text("look"), image] },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [text("result"), image] }] },
  ]);
  const rewritten = rewrite(
    [
      { role: "user", content: [text(memory), text("look"), resized, note] },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read", input: {} }] },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: [text("result"), image, text(`\n${account}`)] },
          text(memory),
        ],
      },
    ],
    frames,
  );
  assert.deepEqual(withoutMarkers(rewritten[0]?.content), [text("look"), resized, note]);
  assert.deepEqual(withoutMarkers(rewritten[2]?.content), [
    { type: "tool_result", tool_use_id: "t1", content: [text("result"), image] },
  ]);
});

test("keeps user-authored reminder-like text and ordinary output unchanged", () => {
  const canonical = [
    { role: "user", content: [text("<system-reminder>mine</system-reminder>"), text("inspect")] },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read", input: {} }] },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t1", content: `file says\n${account}`, is_error: false },
        text("<system-reminder>also mine</system-reminder>"),
      ],
    },
  ];
  const wire = structuredClone(canonical);
  (wire[2]!.content as Block[])[0]!.content = `file says\n${account}\n${memory}`;
  assert.deepEqual(withoutMarkers(rewrite(wire, framesFor(canonical))), canonical);
  assert.deepEqual(withoutMarkers(rewrite(structuredClone(canonical), framesFor(canonical))), canonical);
});

test("moves a breakpoint on a dropped reminder to the canonical tail", () => {
  const marker = { type: "ephemeral", ttl: "1h" };
  const rewritten = rewrite(
    [{ role: "user", content: [text("inspect"), { ...text(memory), cache_control: marker }] }],
    framesFor([{ role: "user", content: [text("inspect")] }]),
  );
  assert.deepEqual(rewritten[0]?.content, [{ ...text("inspect"), cache_control: marker }]);
});

test("refuses requests that do not line up with Pi's history", () => {
  const frames = framesFor([
    { role: "user", content: [text("inspect")] },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "result" }] },
  ]);
  assert.throws(() => rewrite([{ role: "user", content: [text("inspect")] }], frames), /1 user messages where Pi's history has 2/);
  assert.throws(
    () =>
      rewrite(
        [
          { role: "user", content: [text("inspect")] },
          { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "other", content: "result" }] },
        ],
        frames,
      ),
    /lost a tool_result block in user message 1/,
  );
});

test("initial native reminders keep their positions across handoff, tool replay, and user continuation", () => {
  const firstUser = { role: "user", content: [{ type: "text", text: "inspect" }] };
  const environment = { role: "system", content: "Environment", output_config: { effort: "low" } };
  const date = { role: "system", content: [{ type: "text", text: "Today's date is 2026-10-20." }] };
  const imported = [
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "mcp__pi__read", input: { path: "a" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "file" }] },
  ];
  for (const history of [[], imported]) {
    const frames = framesFor([firstUser, ...history] as WireMessage[]);
    const body = Buffer.from(JSON.stringify({ messages: [firstUser, environment, ...history, date] }));
    const first = rewriteInitialRequest(body, frames, undefined);
    const expected = [firstUser, environment, date, ...history];
    assert.deepEqual(withoutMarkers(JSON.parse(first.toString()).messages), withoutMarkers(expected));
    assert.deepEqual(rewriteInitialRequest(first, frames, undefined), first, "normalization is idempotent");
    assert.deepEqual(rewriteInitialRequest(first, frames, [environment, date]), first,
      "a restored snapshot preserves a user-only native bootstrap");

    const continuation = [
      { role: "assistant", content: [{ type: "text", text: "done" }] },
      { role: "user", content: [{ type: "text", text: "next" }] },
    ];
    const native = Buffer.from(JSON.stringify({ messages: [firstUser, environment, ...history, ...continuation, date] }));
    const next = rewriteInitialRequest(native, framesFor([firstUser, ...history, ...continuation] as WireMessage[]), [environment, date]);
    assert.deepEqual(withoutMarkers(JSON.parse(next.toString()).messages), withoutMarkers([...expected, ...continuation]));
    assert.equal(JSON.parse(body.toString()).messages.at(-1).content[0].text, date.content[0].text);
  }
});

test("snapshot cleanup preserves distinct trailing system messages", () => {
  const initial = { role: "system", content: "Environment includes boundary" };
  const tail = { role: "system", content: "boundary" };
  const firstUser = { role: "user", content: [{ type: "text", text: "inspect" }] };
  const reply = { role: "assistant", content: [{ type: "text", text: "done" }] };
  const rewritten = JSON.parse(rewriteInitialRequest(Buffer.from(JSON.stringify({ messages: [firstUser, initial, reply, tail] })),
    framesFor([firstUser, reply] as WireMessage[]), [initial]).toString());
  assert.equal(rewritten.messages.at(-1).role, "system");
  assert.equal(rewritten.messages.at(-1).content[0].text, tail.content);
});

test("injects native system history at assistant boundaries", () => {
  const body = {
    system: [
      { type: "text", text: "identity", cache_control: { type: "ephemeral", ttl: "1h" } },
      { type: "text", text: "prompt", cache_control: { type: "ephemeral", ttl: "1h" } },
    ],
    messages: [
      { role: "user", content: [{ type: "text", text: "first" }] },
      { role: "system", content: [{ type: "text", text: "environment" }] },
      { role: "assistant", content: [{ type: "text", text: "answer" }] },
      { role: "user", content: [{ type: "text", text: "second" }] },
      { role: "system", content: [{ type: "text", text: "token reminder" }] },
    ],
  };
  const rewritten = JSON.parse(
    rewriteInitialRequest(Buffer.from(JSON.stringify(body)), framesFor(body.messages), undefined, [
      {
        beforeAssistant: 0,
        content: [{ type: "tool_addition", tool: { type: "tool_reference", name: "mcp__pi__beta" } }],
      },
      {
        beforeAssistant: null,
        content: [{ type: "tool_removal", tool: { type: "tool_reference", name: "mcp__pi__alpha" } }],
      },
    ]).toString("utf8"),
  ) as typeof body;

  assert.deepEqual(rewritten.messages.map((message) => message.role), [
    "user",
    "system",
    "system",
    "system",
    "assistant",
    "user",
    "system",
  ]);
  assert.equal(
    ((rewritten.messages[3]?.content as Array<Record<string, unknown>>)[0] as Record<string, unknown>).type,
    "tool_addition",
  );
  assert.equal(
    ((rewritten.messages.at(-1)?.content as Array<Record<string, unknown>>)[0] as Record<string, unknown>).type,
    "tool_removal",
  );
  assert.equal((rewritten.system[0] as Record<string, unknown>).cache_control, undefined);
  assert.deepEqual((rewritten.system[1] as Record<string, unknown>).cache_control, {
    type: "ephemeral",
    ttl: "1h",
  });
  assert.deepEqual(
    (rewritten.messages.at(-1)?.content as Array<Record<string, unknown>>).at(-1)?.cache_control,
    { type: "ephemeral", ttl: "1h" },
  );
});

test("keeps one breakpoint in a pre-marked multi-block final message (issue #10)", () => {
  // Shape Claude Code sends for Fable after a tool result: a trailing system
  // message whose first block is already marked.
  const marker = { type: "ephemeral", ttl: "1h" };
  const body = {
    system: [
      { type: "text", text: "billing" },
      { type: "text", text: "identity", cache_control: marker },
      { type: "text", text: "prompt", cache_control: marker },
    ],
    tools: [{ name: "mcp__pi__bash", input_schema: { type: "object" }, cache_control: marker }],
    messages: [
      { role: "user", content: [{ type: "text", text: "run it" }] },
      { role: "system", content: "environment" },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "mcp__pi__bash", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "hi" }] },
      {
        role: "system",
        content: [
          { type: "text", text: "date reminder", cache_control: marker },
          { type: "text", text: "parallel tool nudge" },
        ],
      },
    ],
  };
  const rewritten = JSON.parse(
    rewriteInitialRequest(
      Buffer.from(JSON.stringify(body)),
      framesFor(body.messages),
      [{ role: "system", content: [{ type: "text", text: "environment", cache_control: marker }] }],
      [],
    ).toString("utf8"),
  );
  const count = (value: unknown): number =>
    Array.isArray(value)
      ? value.reduce((sum: number, child) => sum + count(child), 0)
      : value && typeof value === "object"
        ? Object.entries(value).reduce(
            (sum: number, [key, child]) => sum + (key === "cache_control" ? 1 : count(child)),
            0,
          )
        : 0;
  assert.ok(count(rewritten) <= 4, `found ${count(rewritten)} cache_control markers`);
  const final = rewritten.messages.at(-1).content as Array<Record<string, unknown>>;
  assert.equal(final[0]?.cache_control, undefined);
  assert.deepEqual(final.at(-1)?.cache_control, marker);
});

const userFrame = (text: string) => ({
  type: "user" as const,
  message: { role: "user" as const, content: [{ type: "text", text }] },
});

for (const key of [
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_FOUNDRY_API_KEY",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
]) {
  test(`rejects ${key} for model discovery and requests`, async () => {
    const env = { [key]: "1", ANTHROPIC_API_KEY: "pi-test-dummy" };
    const error = new RegExp(`refuses conflicting auth/backend overrides:.*${key}`);
    await assert.rejects(discoverClaudeModels(env), error);
    await assert.rejects(
      runClaudeRequest({
        model: "sonnet",
        frames: [],
        systemPrompt: "",
        manifest: [],
        extraBody: {},
        env,
      }),
      error,
    );
  });
}

test("runs a request through a stream-json Claude executable with an inherited API key", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-claude-code-test-"));
  const workingRoot = await realpath(root);
  const script = join(root, "fake-claude.mjs");
  await writeFile(
    script,
    `#!/usr/bin/env node
import readline from "node:readline";
import {appendFileSync, readFileSync} from "node:fs";
if ("ANTHROPIC_API_KEY" in process.env) throw new Error("API key leaked to Claude child");
if (process.argv.includes("auth") && process.argv.includes("status")) {
  console.log(JSON.stringify({loggedIn: true, authMethod: "claude.ai", subscriptionType: "test"}));
  process.exit(0);
}
if (process.argv.includes("--system-prompt-file")) {
  for (const name of ["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "DISABLE_TELEMETRY", "DISABLE_ERROR_REPORTING"]) {
    if (process.env[name] !== "1") throw new Error(\`worker privacy flag missing: \${name}\`);
  }
}
if (process.cwd() !== process.env.EXPECTED_CWD) throw new Error(\`wrong cwd: \${process.cwd()}\`);
if (process.env.CLAUDE_CODE_ENTRYPOINT !== "pi-agent") throw new Error(\`wrong entrypoint: \${process.env.CLAUDE_CODE_ENTRYPOINT}\`);
if (process.env.CLAUDE_CODE_DISABLE_FILE_MENTIONS !== "1") throw new Error("file mentions enabled");
if (process.env.PROCESS_LOG) appendFileSync(process.env.PROCESS_LOG, \`\${process.pid}\\n\`);
const systemIndex = process.argv.indexOf("--system-prompt-file");
if (systemIndex >= 0 && readFileSync(process.argv[systemIndex + 1], "utf8") !== process.env.EXPECTED_SYSTEM_PROMPT) {
  throw new Error("wrong system prompt");
}
const input = readline.createInterface({input: process.stdin, crlfDelay: Infinity});
let queryCount = 0;
// Real Claude Code echoes a frame's uuid on that frame's result.
const echoUuid = frame => frame.uuid ? {user_message_uuids: [frame.uuid]} : {};
const strayResult = {type: "result", subtype: "error_during_execution", is_error: true, num_turns: 0};
for await (const line of input) {
  const frame = JSON.parse(line);
  if (frame.type === "control_request" && frame.request?.subtype === "initialize") {
    console.log(JSON.stringify({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: frame.request_id,
        response: {
          models: [
            {value: "default", resolvedModel: "claude-opus-5-5[1m]", displayName: "Default", description: "Opus with 1M context"},
            {value: "sonnet", resolvedModel: "claude-sonnet-5", displayName: "Sonnet", description: "Efficient", supportsAdaptiveThinking: true}
          ]
        }
      }
    }));
    continue;
  }
  if (frame.shouldQuery === false) {
    console.log(JSON.stringify({type: "result", num_turns: 0, ...echoUuid(frame)}));
    continue;
  }
  if (frame.type !== "user") continue;
  queryCount += 1;
  const requestedTool = frame.message?.content?.some?.(block => block.type === "text" && block.text === "call-tool");
  const text = queryCount === 1 ? "ok" : \`ok\${queryCount}\`;
  const id = queryCount === 1 ? "m_fake" : \`m_fake_\${queryCount}\`;
  const usage = {input_tokens: 3, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0};
  if (requestedTool) {
    const content = [{type: "tool_use", id: "tool_fake", name: "mcp__pi__echo", input: {value: "test"}}];
    console.log(JSON.stringify({type: "stream_event", event: {type: "message_stop"}}));
    console.log(JSON.stringify({type: "assistant", message: {id, role: "assistant", content, stop_reason: "tool_use", usage}}));
    console.log(JSON.stringify({type: "result", subtype: "error_max_turns", is_error: true, usage, ...echoUuid(frame)}));
    continue;
  }
  if (process.env.NATIVE_ERROR) {
    const content = [{type: "text", text: "Usage limit"}];
    console.log(JSON.stringify({type: "assistant", error: "rate_limit", message: {id, role: "assistant", content, usage}}));
    console.log(JSON.stringify({type: "result", subtype: "success", is_error: true, usage, ...echoUuid(frame)}));
    continue;
  }
  const events = [
    {type: "message_start", message: {id, role: "assistant", content: [], usage}},
    {type: "content_block_start", index: 0, content_block: {type: "text", text: ""}},
    {type: "content_block_delta", index: 0, delta: {type: "text_delta", text}},
    {type: "content_block_stop", index: 0},
    {type: "message_delta", delta: {stop_reason: "end_turn"}, usage},
    {type: "message_stop"}
  ];
  for (const event of events) console.log(JSON.stringify({type: "stream_event", event}));
  console.log(JSON.stringify({type: "assistant", message: {id, role: "assistant", content: [{type: "text", text}], stop_reason: "end_turn", usage}}));
  console.log(JSON.stringify({type: "result", subtype: "success", is_error: false, usage, ...echoUuid(frame)}));
  // A result no turn waits for stays buffered until the next turn reads it.
  if (process.env.STALE_RESULT === "foreign") console.log(JSON.stringify({...strayResult, user_message_uuids: ["other"]}));
  if (process.env.STALE_RESULT === "bare") console.log(JSON.stringify(strayResult));
}
`,
    "utf8",
  );
  // Windows cannot execute a shebang script directly; go through a .cmd shim,
  // which also exercises the extension's cmd.exe launch path.
  const executable = process.platform === "win32" ? join(root, "fake-claude.cmd") : script;
  if (executable !== script) {
    await writeFile(executable, `@ECHO off\r\n"${process.execPath}" "${script}" %*\r\n`, "utf8");
  }
  await chmod(executable, 0o755);

  const events: string[] = [];
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  try {
    process.env.ANTHROPIC_API_KEY = "pi-test-dummy";
    const provider = createClaudeCodeProvider();
    const authCheck = await provider.auth.apiKey?.check?.({
      ctx: {
        env: async (name) => (name === "PI_CLAUDE_CODE_COMMAND" ? executable : undefined),
        fileExists: async () => false,
      },
      signal: new AbortController().signal,
    });
    assert.equal(authCheck?.type, "oauth");
    assert.equal(provider.auth.oauth?.isSubscription, true);
    await assert.rejects(
      provider.auth.oauth!.login({
        signal: new AbortController().signal,
        prompt: async () => "",
        notify: () => {},
      }),
      /claude auth login/,
    );

    const explicitEnv = Object.freeze({
      PATH: process.env.PATH,
      PI_CLAUDE_CODE_COMMAND: executable,
      EXPECTED_CWD: process.cwd(),
      ANTHROPIC_API_KEY: "pi-test-explicit-dummy",
    });
    assert.equal((await getClaudeStatus(explicitEnv)).subscription, true);
    for (const env of [
      { PI_CLAUDE_CODE_COMMAND: executable, EXPECTED_CWD: process.cwd() },
      explicitEnv,
    ]) {
      const discovered = await discoverClaudeModels(env, undefined, 5_000);
      assert.deepEqual(discovered.map((model) => model.value), ["default", "sonnet"]);
    }

    const result = await runClaudeRequest({
      model: "sonnet",
      cwd: workingRoot,
      frames: [
        { type: "user", message: { role: "user", content: [{ type: "text", text: "old" }] }, shouldQuery: false },
        { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "old reply" }] } },
        { type: "user", message: { role: "user", content: [{ type: "text", text: "new" }] } },
      ],
      systemPrompt: "system",
      manifest: [],
      extraBody: { tools: [] },
      env: {
        PI_CLAUDE_CODE_COMMAND: executable,
        EXPECTED_CWD: workingRoot,
        EXPECTED_SYSTEM_PROMPT: "system",
      },
      timeoutMs: 5_000,
      onEvent: (event) => events.push(event.type),
    });
    assert.equal(result.message.id, "m_fake");
    assert.equal(result.message.stop_reason, "end_turn");
    assert.equal(result.usage.input_tokens, 3);
    assert.equal(result.relay.upstreamRequests, 0);
    assert.equal(events.at(-1), "message_stop");

    const processLog = join(root, "processes.log");
    const common = {
      model: "sonnet",
      cwd: workingRoot,
      systemPrompt: "system",
      manifest: [],
      extraBody: { tools: [] },
      env: {
        PI_CLAUDE_CODE_COMMAND: executable,
        EXPECTED_CWD: workingRoot,
        EXPECTED_SYSTEM_PROMPT: "system",
        PROCESS_LOG: processLog,
        ANTHROPIC_API_KEY: explicitEnv.ANTHROPIC_API_KEY,
      },
      timeoutMs: 5_000,
    };
    const first = await runClaudeRequest({
      ...common,
      sessionId: "stable-session",
      frames: [{ type: "user", message: { role: "user", content: [{ type: "text", text: "one" }] } }],
    });
    const second = await runClaudeRequest({
      ...common,
      sessionId: "stable-session",
      frames: [
        {
          type: "user",
          message: { role: "user", content: [{ type: "text", text: "one" }] },
          shouldQuery: false,
        },
        // prepareFrames tags replayed turns with their model; that must not break continuation.
        { type: "assistant", message: { role: "assistant", content: first.message.content, model: "opus" } },
        { type: "user", message: { role: "user", content: [{ type: "text", text: "two" }] } },
      ],
    });
    assert.equal(second.message.id, "m_fake_2");
    assert.equal((await readFile(processLog, "utf8")).trim().split("\n").length, 1);
    assert.equal(cachedClaudeProcessCount(), 1);

    // A branch mismatch replaces the warm process instead of risking stale
    // hidden Claude state.
    const branched = await runClaudeRequest({
      ...common,
      sessionId: "stable-session",
      frames: [{ type: "user", message: { role: "user", content: [{ type: "text", text: "branch" }] } }],
    });
    assert.equal(branched.message.id, "m_fake");
    assert.equal((await readFile(processLog, "utf8")).trim().split("\n").length, 2);

    // Retained workers are deliberately bounded. Creating two more sessions
    // evicts the least-recently-used idle worker and leaves only two alive.
    for (const sessionId of ["second-session", "third-session"]) {
      await runClaudeRequest({
        ...common,
        sessionId,
        frames: [{ type: "user", message: { role: "user", content: [{ type: "text", text: sessionId }] } }],
      });
    }
    assert.equal(cachedClaudeProcessCount(), 2);
    assert.equal((await readFile(processLog, "utf8")).trim().split("\n").length, 4);

    // A tool call makes Claude's hidden history diverge because its inert MCP
    // server has already returned a denial. Never retain that process; replay
    // the real Pi tool result in a fresh process on the next request.
    const toolCommon = {
      ...common,
      manifest: [
        {
          name: "echo",
          description: "Echo a value",
          inputSchema: { type: "object", properties: { value: { type: "string" } } },
        },
      ],
      extraBody: {
        tools: [
          {
            name: "mcp__pi__echo",
            description: "Echo a value",
            input_schema: { type: "object", properties: { value: { type: "string" } } },
          },
        ],
      },
    };
    const toolCall = await runClaudeRequest({
      ...toolCommon,
      sessionId: "tool-session",
      frames: [{ type: "user", message: { role: "user", content: [{ type: "text", text: "call-tool" }] } }],
    });
    assert.equal(toolCall.message.stop_reason, "tool_use");
    assert.equal(cachedClaudeProcessCount(), 1);
    const afterTool = await runClaudeRequest({
      ...toolCommon,
      sessionId: "tool-session",
      frames: [
        {
          type: "user",
          message: { role: "user", content: [{ type: "text", text: "call-tool" }] },
          shouldQuery: false,
        },
        { type: "assistant", message: { role: "assistant", content: toolCall.message.content } },
        {
          type: "user",
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "tool_fake", content: "echoed" }],
          },
        },
      ],
    });
    assert.equal(afterTool.message.id, "m_fake");
    assert.equal((await readFile(processLog, "utf8")).trim().split("\n").length, 6);
    assert.equal(explicitEnv.ANTHROPIC_API_KEY === "pi-test-explicit-dummy", true);
    assert.equal(common.env.ANTHROPIC_API_KEY === "pi-test-explicit-dummy", true);
    assert.equal(process.env.ANTHROPIC_API_KEY === "pi-test-dummy", true);

    // A late result for another user message must not end the next warm turn.
    const warmTurns = async (sessionId: string, extra: Record<string, string>) => {
      const warm = { ...common, env: { ...common.env, ...extra }, sessionId };
      const one = await runClaudeRequest({ ...warm, frames: [userFrame("one")] });
      return runClaudeRequest({
        ...warm,
        frames: [
          { ...userFrame("one"), shouldQuery: false },
          { type: "assistant", message: { role: "assistant", content: one.message.content } },
          userFrame("two"),
        ],
      });
    };
    const foreign = await warmTurns("foreign-session", { STALE_RESULT: "foreign" });
    assert.equal(foreign.message.id, "m_fake_2");
    assert.equal((await readFile(processLog, "utf8")).trim().split("\n").length, 7);

    // A stray result without a uuid fails the warm turn before any output, so
    // it is replayed once on a fresh process.
    const bare = await warmTurns("bare-session", { STALE_RESULT: "bare" });
    assert.equal(bare.message.id, "m_fake");
    assert.equal((await readFile(processLog, "utf8")).trim().split("\n").length, 9);

    // A native error assistant reports its text, not an incomplete response.
    await assert.rejects(
      runClaudeRequest({ ...common, env: { ...common.env, NATIVE_ERROR: "1" }, frames: [userFrame("one")] }),
      /Claude Code API error: Usage limit/,
    );
  } finally {
    if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalApiKey;
    await closeClaudeProcesses();
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * Run one turn through a fake Claude Code that, like the real one, reads the
 * relayed response and retries once natively. `upstream` answers the relayed
 * request; without it the relay points at a closed port.
 */
async function failingUpstreamTurn(
  upstream?: (request: http.IncomingMessage, response: http.ServerResponse) => void,
): Promise<{ message: string; retryable: boolean }> {
  let server: http.Server | undefined;
  let port: number;
  if (upstream) {
    server = http.createServer(upstream);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing address");
    port = address.port;
  } else {
    // Reserve a port, then close it so connecting is refused.
    const probe = http.createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    port = (probe.address() as { port: number }).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
  }

  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-claude-code-upstream-")));
  const executable = join(root, "fake-claude.mjs");
  await writeFile(
    executable,
    `#!/usr/bin/env node
import readline from "node:readline";
if (process.argv.includes("auth") && process.argv.includes("status")) {
  console.log(JSON.stringify({loggedIn: true, authMethod: "claude.ai", subscriptionType: "max"}));
  process.exit(0);
}
const input = readline.createInterface({input: process.stdin, crlfDelay: Infinity});
for await (const line of input) {
  const frame = JSON.parse(line);
  if (frame.type !== "user") continue;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(\`\${process.env.ANTHROPIC_BASE_URL}/v1/messages\`, {
        method: "POST",
        body: JSON.stringify({messages: [frame.message]}),
      });
      await response.text();
    } catch {}
  }
  console.log(JSON.stringify({type: "result", subtype: "error_during_execution", is_error: true}));
}
`,
    "utf8",
  );
  await chmod(executable, 0o755);

  try {
    const error = await runClaudeRequest({
      model: "sonnet",
      cwd: root,
      frames: [{ type: "user", message: { role: "user", content: [{ type: "text", text: "hi" }] } }],
      systemPrompt: "system",
      manifest: [],
      extraBody: { tools: [] },
      env: { PI_CLAUDE_CODE_COMMAND: executable },
      upstreamUrl: `http://127.0.0.1:${port}`,
      timeoutMs: 5_000,
    }).then(
      () => assert.fail("expected the upstream failure to fail the turn"),
      (error: Error) => error,
    );
    const failed = { role: "assistant", stopReason: "error", errorMessage: error.message } as AssistantMessage;
    return { message: error.message, retryable: isRetryableAssistantError(failed) };
  } finally {
    closeClaudeProcesses();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}

test("reports a dropped upstream stream as a retryable error", async () => {
  // Anthropic answers 200, starts streaming, then the connection drops.
  const { message, retryable } = await failingUpstreamTurn(async (request, response) => {
    for await (const _chunk of request);
    response.writeHead(200, { "content-type": "text/event-stream" });
    const usage = { input_tokens: 2, output_tokens: 0 };
    response.write(
      `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "m1", role: "assistant", content: [], usage } })}\n\n`,
    );
    setTimeout(() => response.socket?.destroy(), 20);
  });
  assert.match(message, /status 200, capture incomplete/);
  assert.match(message, /native retries denied 1/);
  assert.equal(retryable, true);
});

test("reports an upstream connection lost before a response as a retryable error", async () => {
  // The connection drops before Anthropic sends a status.
  const hangUp = await failingUpstreamTurn(async (request) => {
    for await (const _chunk of request);
    request.socket.destroy();
  });
  assert.match(hangUp.message, /connection lost before a response \(status unknown/);
  assert.match(hangUp.message, /relay failure Error: socket hang up/);
  assert.equal(hangUp.retryable, true);

  // The connection is refused outright; the reason lives in the error code.
  const refused = await failingUpstreamTurn();
  assert.match(refused.message, /connection lost before a response \(status unknown/);
  assert.match(refused.message, /ECONNREFUSED/);
  assert.equal(refused.retryable, true);
});

test("reports upstream 5xx as retryable and keeps 4xx non-retryable", async () => {
  // 529 (overloaded) is not in Pi's status list and may come without a body.
  const overloaded = await failingUpstreamTurn(async (request, response) => {
    for await (const _chunk of request);
    response.writeHead(529).end();
  });
  assert.match(overloaded.message, /upstream server error \(status 529/);
  assert.equal(overloaded.retryable, true);

  const invalid = await failingUpstreamTurn(async (request, response) => {
    for await (const _chunk of request);
    response
      .writeHead(400, { "content-type": "application/json" })
      .end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "bad request" } }));
  });
  assert.match(invalid.message, /Incomplete Claude Code upstream response \(status 400.*upstream said: bad request/);
  assert.equal(invalid.retryable, false);
});

test("replay budgets four protocol cache markers without changing nested tool data", () => {
  const marker = { type: "ephemeral", ttl: "1h" };
  const input = {
    tools: [{ name: "read", input_schema: { type: "object" }, cache_control: marker },
      { name: "later", input_schema: { type: "object" }, defer_loading: true }],
    system: [{ type: "text", text: "system", cache_control: marker }, { type: "text", text: "stable suffix" }],
    messages: [
      { role: "user", content: [{ type: "text", text: "one" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read",
        input: { cache_control: "application data" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "two" }] },
      { role: "assistant", content: [{ type: "text", text: "answer" }] },
      { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AA==" }, cache_control: marker }] },
      { role: "system", content: [{ type: "text", text: "trailing reminder" }] },
    ],
  };
  for (const nativeInjections of [undefined, []]) {
    const rewrite = (body: Buffer) => rewriteInitialRequest(body, framesFor(input.messages as WireMessage[]), undefined, nativeInjections);
    const once = rewrite(Buffer.from(JSON.stringify(input)));
    const final = JSON.parse(once.toString());
    const blocks = [...final.tools, ...final.system, ...final.messages.flatMap((message: any) => message.content)];
    assert.equal(blocks.filter((block: any) => block.cache_control).length, 4);
    assert.deepEqual(final.tools[0].cache_control, marker);
    assert.equal(final.tools[1].cache_control, undefined);
    assert.equal(final.system[0].cache_control, undefined);
    assert.deepEqual(final.system[1].cache_control, marker);
    const users = final.messages.filter((message: any) => message.role === "user");
    assert.deepEqual(users.at(-2).content[0].cache_control, marker);
    assert.equal(users.at(-1).content[0].type, "image");
    assert.deepEqual(users.at(-1).content[0].cache_control, marker);
    assert.equal(final.messages.find((message: any) => message.role === "system").content[0].cache_control, undefined);
    assert.equal(final.messages.find((message: any) => message.role === "assistant").content[0].input.cache_control, "application data");
    assert.deepEqual(rewrite(once), once);
    final.cache_control = marker;
    final.system.unshift({ type: "text", text: "another system block", cache_control: marker });
    final.tools.unshift({ name: "other", input_schema: { type: "object" }, cache_control: marker });
    final.messages[0].content[0].cache_control = marker;
    const normalized = JSON.parse(rewrite(Buffer.from(JSON.stringify(final))).toString());
    assert.equal(normalized.cache_control, undefined);
    assert.equal([...normalized.tools, ...normalized.system, ...normalized.messages.flatMap((m: any) => m.content)]
      .filter((block: any) => block.cache_control).length, 4);
  }
});

test("native prefixes survive tool-worker replacement and warm continuation through payload hooks and the relay", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-claude-payload-"));
  const command = join(root, "claude.mjs");
  const received: any[] = [];
  const upstream = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    received.push(JSON.parse(body));
    const usage = { input_tokens: 2, output_tokens: 1 };
    const toolTurn = received.length === 1;
    const events = [
      { type: "message_start", message: { id: "reply", role: "assistant", content: [], usage } },
      { type: "content_block_start", index: 0, content_block: toolTurn
        ? { type: "tool_use", id: "t2", name: "mcp__pi__read", input: {} } : { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: toolTurn
        ? { type: "input_json_delta", partial_json: '{"path":"b"}' } : { type: "text_delta", text: "hello" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: toolTurn ? "tool_use" : "end_turn" }, usage },
      { type: "message_stop" },
    ];
    response.writeHead(200, { "content-type": "text/event-stream", "x-fixture-tool-turn": String(toolTurn) });
    response.end(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address() as { port: number };
  await writeFile(command, `#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import readline from 'node:readline';
if (process.argv.includes('auth')) {
  console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'fixture' }));
  process.exit(0);
}
const settings = JSON.parse(readFileSync(process.argv[process.argv.indexOf('--settings') + 1], 'utf8'));
const extra = JSON.parse(settings.env.CLAUDE_CODE_EXTRA_BODY);
const history = [];
const marker = { type: 'ephemeral', ttl: '1h' };
for await (const line of readline.createInterface({ input: process.stdin })) {
  const frame = JSON.parse(line);
  if (frame.type === 'control_request') {
    console.log(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: frame.request_id, response: {} } }));
    continue;
  }
  history.push(frame.message);
  if (frame.shouldQuery === false) {
    console.log(JSON.stringify({ type: 'result', num_turns: 0 }));
    continue;
  }
  const body = { ...extra, system: [{ type: 'text', text: 'system', cache_control: marker }],
    messages: [history[0], { role: 'system', content: 'Environment' }, ...history.slice(1),
      { role: 'system', content: [{ type: 'text', text: "Today's date is 2026-10-20." }] }] };
  history.at(-1).content.at(-1).cache_control = marker;
  const response = await fetch(process.env.ANTHROPIC_BASE_URL + '/v1/messages', { method: 'POST', body: JSON.stringify(body) });
  await response.text();
  const toolTurn = response.headers.get('x-fixture-tool-turn') === 'true';
  const message = { id: 'reply', role: 'assistant', content: toolTurn
    ? [{ type: 'tool_use', id: 't2', name: 'mcp__pi__read', input: { path: 'b' } }] : [{ type: 'text', text: 'hello' }],
    stop_reason: toolTurn ? 'tool_use' : 'end_turn', usage: { input_tokens: 2, output_tokens: 1 } };
  history.push({ role: message.role, content: message.content });
  if (toolTurn) history.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'inert' }] });
  console.log(JSON.stringify({ type: 'stream_event', event: { type: 'message_stop' } }));
  console.log(JSON.stringify({ type: 'assistant', message }));
  console.log(JSON.stringify({ type: 'result', subtype: toolTurn ? 'error_max_turns' : 'success', is_error: toolTurn }));
}
`, "utf8");
  await chmod(command, 0o755);
  const frames: any[] = [
    { type: "user", message: { role: "user", content: [{ type: "text", text: "one" }] }, shouldQuery: false },
    { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "mcp__pi__read", input: { path: "a" } }] }, shouldQuery: false },
    { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "two" }] }, shouldQuery: false },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hello" }] }, shouldQuery: false },
    { type: "user", message: { role: "user", content: [{ type: "text", text: "three" }] } },
  ];
  const input = { model: "sonnet", systemPrompt: "system", frames, manifest: [],
    extraBody: { tools: [{ name: "mcp__pi__read", input_schema: { type: "object" }, cache_control: { type: "ephemeral", ttl: "1h" } }] },
    nativeSystemInjections: [], toolNames: new Set(["read"]), timeoutMs: 5000,
    env: { PI_CLAUDE_CODE_COMMAND: command }, upstreamUrl: `http://127.0.0.1:${address.port}`, sessionId: "payload-boundary" };
  const observed: any[] = [];
  try {
    const first = await runClaudeRequest({ ...input, onPayload: async (payload) => {
      await Promise.resolve();
      const body = payload as any;
      assert.equal([...body.tools, ...body.system, ...body.messages.flatMap((m: any) => m.content)]
        .filter((block: any) => block.cache_control).length, 4);
      body.metadata = { user_id: "mutated" };
      observed.push(structuredClone(body));
    } });
    assert.equal(first.relay.upstreamRequests, 1);
    assert.deepEqual(received, observed);
    assert.equal(cachedClaudeProcessCount(), 0, "a native inert tool result cannot be retained");
    const followup = [...frames, { type: "assistant", message: { role: "assistant", content: first.message.content } },
      { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: "real result" }] } }]
      .map((frame, index, all) => index < all.length - 1 ? { ...frame, shouldQuery: false as const } : frame);
    const snapshot = { initialSystemMessages: first.initialSystemMessages };
    const second = await runClaudeRequest({ ...input, ...snapshot, frames: followup as any, onPayload: async (payload) => {
      const replacement = { ...(payload as any), metadata: { user_id: "replaced" } };
      observed.push(structuredClone(replacement));
      return replacement;
    } });
    assert.equal(cachedClaudeProcessCount(), 1);
    const nextUser = [...followup, { type: "assistant", message: { role: "assistant", content: second.message.content } },
      { type: "user", message: { role: "user", content: [{ type: "text", text: "four" }] } }];
    await runClaudeRequest({ ...input, ...snapshot, frames: nextUser as any, onPayload: (payload) => {
      observed.push(structuredClone(payload));
    } });
    assert.deepEqual(received, observed);
    assert.equal(received.length, 3);
    const messages = received.map((body) => body.messages.map((message: any) => ({ ...message,
      content: Array.isArray(message.content) ? message.content.map(({ cache_control, ...block }: any) => block) : message.content,
    })));
    assert.deepEqual(messages[1].slice(0, messages[0].length), messages[0]);
    assert.deepEqual(messages[2].slice(0, messages[1].length), messages[1]);
    assert.equal(JSON.stringify(received).includes('"content":"inert"'), false);
    await assert.rejects(runClaudeRequest({ ...input, onPayload: () => { throw new Error("hook rejected"); } }));
    assert.equal(received.length, 3);

    // Block HTTPS independently of the hook so a regression stays offline.
    let externalRequests = 0;
    t.mock.method(https, "request", () => { externalRequests++; throw new Error("HTTPS forbidden in fixture"); });
    syncBuiltinESMExports();
    let hookCalls = 0;
    const model: any = { id: "claude-sonnet-5", name: "fixture", api: "claude-code-stream-json",
      provider: "claude-code", reasoning: true, input: ["text"], baseUrl: "process://claude-code",
      contextWindow: 200000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const result = await streamClaudeCode(model, normalizeContext({ messages: [{ role: "user", content: "inspect", timestamp: 1 }] }), {
      env: input.env, timeoutMs: 5000, onPayload: async (payload, actualModel) => {
        assert.equal(actualModel, model);
        assert.ok((payload as any).messages.length);
        hookCalls++;
        throw new Error("offline stop before upstream");
      },
    }).result();
    assert.equal(hookCalls, 1);
    assert.equal(externalRequests, 0);
    assert.equal(result.stopReason, "error");
    assert.equal(received.length, 3);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await closeClaudeProcesses();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("reports a transient upstream stream error as retryable and keeps others non-retryable", async () => {
  // Anthropic answers 200, starts streaming, then sends an error event instead of message_stop.
  const streamError = (type: string, message: string) =>
    failingUpstreamTurn(async (request, response) => {
      for await (const _chunk of request);
      response.writeHead(200, { "content-type": "text/event-stream" });
      const usage = { input_tokens: 2, output_tokens: 0 };
      response.write(
        `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "m1", role: "assistant", content: [], usage } })}\n\n`,
      );
      response.end(`event: error\ndata: ${JSON.stringify({ type: "error", error: { type, message } })}\n\n`);
    });

  const apiError = await streamError("api_error", "Unable to complete this request right now. Please try again.");
  assert.match(apiError.message, /upstream server error \(status 200, capture incomplete/);
  assert.match(apiError.message, /upstream said: api_error: Unable to complete this request/);
  assert.equal(apiError.retryable, true);

  const overloaded = await streamError("overloaded_error", "Overloaded");
  assert.match(overloaded.message, /upstream server error \(status 200/);
  assert.equal(overloaded.retryable, true);

  const invalid = await streamError("invalid_request_error", "bad request");
  assert.match(invalid.message, /Incomplete Claude Code upstream response \(status 200.*upstream said: invalid_request_error: bad request/);
  assert.equal(invalid.retryable, false);
});
