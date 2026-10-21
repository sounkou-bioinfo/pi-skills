import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { normalizeContext } from "@earendil-works/pi-ai";
import {
  cachedClaudeProcessCount,
  closeClaudeProcesses,
  discoverClaudeModels,
  rewriteInitialRequest,
  runClaudeRequest,
} from "../src/claude-cli.ts";
import { createClaudeCodeProvider } from "../src/provider.ts";
import { streamClaudeCode } from "../src/stream.ts";

test("stabilizes Claude Code's native replay reminders and cache breakpoint", () => {
  const canonical = [{ type: "text", text: "inspect" }];
  const prefix = [{ type: "text", text: "account reminder" }];
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
  const current = {
    messages: [
      { role: "user", content: [{ type: "text", text: "changed reminder" }, ...canonical] },
      { role: "system", content: "environment reminder" },
      { role: "assistant", content: [{ type: "text", text: "first reply" }] },
      { role: "user", content: [...prefix, { type: "text", text: "follow up" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "old result" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "t2", name: "read", input: {} }] },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t2", content: "current result\naccount reminder" }],
      },
      {
        role: "system",
        content: [
          {
            type: "text",
            text: "date reminder",
            cache_control: { type: "ephemeral", ttl: "1h" },
          },
        ],
      },
    ],
  };

  const rewritten = JSON.parse(
    rewriteInitialRequest(Buffer.from(JSON.stringify(current)), prefix, canonical, initialSystemMessages).toString("utf8"),
  ) as typeof current;
  assert.deepEqual(rewritten.messages[0]?.content, [...prefix, ...canonical]);
  assert.equal(
    ((rewritten.messages[1]?.content as Array<Record<string, unknown>>)[0]?.text as string),
    "environment reminder\ndate reminder",
  );
  assert.equal(
    ((rewritten.messages[1]?.content as Array<Record<string, unknown>>)[0]?.cache_control),
    undefined,
  );
  assert.equal(rewritten.messages.length, 8);
  assert.deepEqual(rewritten.messages[3]?.content, [{ type: "text", text: "follow up" }]);
  assert.equal(
    ((rewritten.messages[5]?.content as Array<Record<string, unknown>>)[0]?.content as string),
    "old result",
  );
  assert.deepEqual(
    (rewritten.messages[5]?.content as Array<Record<string, unknown>>).at(-1)?.cache_control,
    { type: "ephemeral", ttl: "1h" },
  );
  assert.equal(
    ((rewritten.messages[7]?.content as Array<Record<string, unknown>>)[0]?.content as string),
    "current result",
  );
  assert.deepEqual(
    (rewritten.messages.at(-1)?.content as Array<Record<string, unknown>>).at(-1)?.cache_control,
    { type: "ephemeral", ttl: "1h" },
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
  const stripMarkers = (messages: any[]) => messages.map((message) => ({
    ...message,
    content: Array.isArray(message.content) ? message.content.map(({ cache_control, ...block }: any) => block) : message.content,
  }));
  for (const history of [[], imported]) {
    const body = Buffer.from(JSON.stringify({ messages: [firstUser, environment, ...history, date] }));
    const first = rewriteInitialRequest(body, undefined, firstUser.content);
    const expected = [firstUser, environment, date, ...history];
    assert.deepEqual(stripMarkers(JSON.parse(first.toString()).messages), expected);
    assert.deepEqual(rewriteInitialRequest(first, undefined, firstUser.content), first, "normalization is idempotent");
    assert.deepEqual(rewriteInitialRequest(first, [], firstUser.content, [environment, date]), first,
      "a restored snapshot preserves a user-only native bootstrap");

    const continuation = [
      { role: "assistant", content: [{ type: "text", text: "done" }] },
      { role: "user", content: [{ type: "text", text: "next" }] },
    ];
    const native = Buffer.from(JSON.stringify({ messages: [firstUser, environment, ...history, ...continuation, date] }));
    const next = rewriteInitialRequest(native, [], firstUser.content, [environment, date]);
    assert.deepEqual(stripMarkers(JSON.parse(next.toString()).messages), [...expected, ...continuation]);
    assert.equal(JSON.parse(body.toString()).messages.at(-1).content[0].text, date.content[0].text);
  }
});

test("snapshot cleanup preserves distinct trailing system messages", () => {
  const initial = { role: "system", content: "Environment includes boundary" };
  const tail = { role: "system", content: "boundary" };
  const firstUser = { role: "user", content: [{ type: "text", text: "inspect" }] };
  const rewritten = JSON.parse(rewriteInitialRequest(Buffer.from(JSON.stringify({ messages: [firstUser, initial,
    { role: "assistant", content: [{ type: "text", text: "done" }] }, tail] })), [], firstUser.content, [initial]).toString());
  assert.equal(rewritten.messages.at(-1).role, "system");
  assert.equal(rewritten.messages.at(-1).content[0].text, tail.content);
});

test("query prefixes remain at their anchor and do not restore edited or missing user content", () => {
  const canonical = [{ text: "current", type: "text" }];
  const prefix = [{ type: "text", text: "<system-reminder>Native startup context</system-reminder>" }];
  const query = { userIndex: 1, prefix,
    canonicalHash: createHash("sha256").update(JSON.stringify(canonical)).digest("hex") };
  const original = { role: "user", content: [{ type: "text", text: "history" }] };
  for (const content of [canonical, [{ type: "text", text: "edited" }]]) {
    const body = Buffer.from(JSON.stringify({ messages: [original,
      { role: "assistant", content: [{ type: "text", text: "past" }] }, { role: "user", content }] }));
    const restored = JSON.parse(rewriteInitialRequest(body, [], original.content, [], [], query).toString());
    assert.equal(restored.messages[0].content[0].text, "history");
    assert.equal(restored.messages.at(-1).content.length, content === canonical ? 2 : 1);
    assert.equal(restored.messages.at(-1).content.at(-1).text, content[0].text);
    assert.deepEqual(rewriteInitialRequest(Buffer.from(JSON.stringify(restored)), [], original.content, [], [], query), Buffer.from(JSON.stringify(restored)));
  }
  const missing = JSON.parse(rewriteInitialRequest(Buffer.from(JSON.stringify({ messages: [original] })), [], original.content, [], [], query).toString());
  assert.equal(missing.messages[0].content.length, 1);
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
    rewriteInitialRequest(Buffer.from(JSON.stringify(body)), undefined, body.messages[0]!.content, undefined, [
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
    const rewrite = (body: Buffer) => rewriteInitialRequest(body, undefined, input.messages[0]!.content, undefined, nativeInjections);
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
let queries = 0;
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
  if (queries++ === 0) {
    const current = body.messages.findLast((message) => message.role === 'user');
    const reminder = '<system-reminder>Native startup context</system-reminder>';
    if (current.content[0].type === 'tool_result') current.content[0].content += '\\n' + reminder;
    else current.content.unshift({ type: 'text', text: reminder });
  }
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
    assert.equal(first.initialQueryPrefix?.userIndex, 2);
    assert.deepEqual(first.initialQueryPrefix?.prefix, [{ type: "text", text: "<system-reminder>Native startup context</system-reminder>" }]);
    assert.deepEqual(received, observed);
    assert.equal(cachedClaudeProcessCount(), 0, "a native inert tool result cannot be retained");
    const followup = [...frames, { type: "assistant", message: { role: "assistant", content: first.message.content } },
      { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: "real result" }] } }]
      .map((frame, index, all) => index < all.length - 1 ? { ...frame, shouldQuery: false as const } : frame);
    const snapshot = { initialUserPrefix: first.initialUserPrefix, initialSystemMessages: first.initialSystemMessages,
      initialQueryPrefix: first.initialQueryPrefix };
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

test("runs a request through a stream-json Claude executable", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-claude-code-test-"));
  const workingRoot = await realpath(root);
  const executable = join(root, "fake-claude.mjs");
  await writeFile(
    executable,
    `#!/usr/bin/env node
import readline from "node:readline";
import {appendFileSync, readFileSync} from "node:fs";
if (process.argv.includes("auth") && process.argv.includes("status")) {
  console.log(JSON.stringify({loggedIn: true, authMethod: "claude.ai", subscriptionType: "test"}));
  process.exit(0);
}
if (process.cwd() !== process.env.EXPECTED_CWD) throw new Error(\`wrong cwd: \${process.cwd()}\`);
if (process.env.PROCESS_LOG) appendFileSync(process.env.PROCESS_LOG, \`\${process.pid}\\n\`);
const systemIndex = process.argv.indexOf("--system-prompt-file");
if (systemIndex >= 0 && readFileSync(process.argv[systemIndex + 1], "utf8") !== process.env.EXPECTED_SYSTEM_PROMPT) {
  throw new Error("wrong system prompt");
}
const input = readline.createInterface({input: process.stdin, crlfDelay: Infinity});
let queryCount = 0;
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
    console.log(JSON.stringify({type: "result", num_turns: 0}));
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
    console.log(JSON.stringify({type: "result", subtype: "error_max_turns", is_error: true, usage}));
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
  console.log(JSON.stringify({type: "result", subtype: "success", is_error: false, usage}));
}
`,
    "utf8",
  );
  await chmod(executable, 0o755);

  const events: string[] = [];
  try {
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

    const discovered = await discoverClaudeModels(
      { PI_CLAUDE_CODE_COMMAND: executable, EXPECTED_CWD: process.cwd() },
      undefined,
      5_000,
    );
    assert.deepEqual(discovered.map((model) => model.value), ["default", "sonnet"]);

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
      toolNames: new Set(),
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
      toolNames: new Set<string>(),
      env: {
        PI_CLAUDE_CODE_COMMAND: executable,
        EXPECTED_CWD: workingRoot,
        EXPECTED_SYSTEM_PROMPT: "system",
        PROCESS_LOG: processLog,
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
        { type: "assistant", message: { role: "assistant", content: first.message.content } },
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
      toolNames: new Set(["echo"]),
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
  } finally {
    await closeClaudeProcesses();
    await rm(root, { recursive: true, force: true });
  }
});
