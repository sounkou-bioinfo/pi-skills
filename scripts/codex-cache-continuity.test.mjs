import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const host = process.env.PI_CACHE_HOST_DIR
  ? path.resolve(process.env.PI_CACHE_HOST_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "..");
const piAi = [path.join(host, "node_modules/@earendil-works/pi-ai"), path.join(host, "../pi-ai")]
  .find((directory) => existsSync(directory));
if (!piAi) throw new Error("Cannot locate the host's @earendil-works/pi-ai package");
const codex = await import(pathToFileURL(path.join(piAi, "dist/api/openai-codex-responses.js")).href);

const model = {
  id: "gpt-5.4", name: "GPT-5.4", api: "openai-codex-responses", provider: "openai-codex",
  baseUrl: "https://chatgpt.com/backend-api/codex", reasoning: true, input: ["text", "image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 272000, maxTokens: 128000,
};
const apiKey = `x.${Buffer.from(JSON.stringify({
  "https://api.openai.com/auth": { chatgpt_account_id: "offline-test" },
})).toString("base64url")}.x`;
const system = { role: "system", content: "Stable system", timestamp: 1 };
const user1 = { role: "user", content: "Inspect", timestamp: 2 };
const user2 = { role: "user", content: "Next", timestamp: 6 };

class FakeWebSocket extends EventTarget {
  static requests = [];
  static responseNumber = 0;
  static firstResponseUsesTool = false;
  readyState = 0;

  static reset({ firstResponseUsesTool = false } = {}) {
    FakeWebSocket.requests = [];
    FakeWebSocket.responseNumber = 0;
    FakeWebSocket.firstResponseUsesTool = firstResponseUsesTool;
  }

  constructor() {
    super();
    queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); });
  }

  send(text) {
    FakeWebSocket.requests.push(JSON.parse(text));
    const number = ++FakeWebSocket.responseNumber;
    const primaryItem = FakeWebSocket.firstResponseUsesTool && number === 1
      ? { id: "fc_1", call_id: "call_1", type: "function_call", name: "read",
          arguments: JSON.stringify({ path: "a" }), status: "completed" }
      : { id: `msg_${number}`, type: "message", role: "assistant", status: "completed",
          content: [{ type: "output_text", text: `answer ${number}`, annotations: [] }] };
    const reasoningItem = { id: `rs_${number}`, type: "reasoning", status: "completed",
      summary: [{ type: "summary_text", text: `reasoning ${number}` }], encrypted_content: `encrypted_${number}` };
    const output = [reasoningItem, primaryItem];
    const response = {
      id: `resp_${number}`, object: "response", created_at: number, status: "completed", model: model.id,
      output,
      usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110,
        input_tokens_details: { cached_tokens: number === 1 ? 0 : 100 },
        output_tokens_details: { reasoning_tokens: 5 } },
    };
    const events = [{ type: "response.created", response: { id: response.id } }];
    output.forEach((item, output_index) => {
      events.push({ type: "response.output_item.added", output_index, item });
      events.push({ type: "response.output_item.done", output_index, item });
    });
    events.push({ type: "response.completed", response });
    for (const event of events) {
      queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(event) })));
    }
  }

  close(code = 1000, reason = "") {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent("close", { code, reason, wasClean: true }));
  }
}

const run = (sessionId, messages) => codex.stream(model, { messages }, {
  apiKey, transport: "auto", sessionId, reasoningEffort: "medium",
  websocketConnectTimeoutMs: 100, websocketIdleTimeoutMs: 100,
}).result();

async function withFakeWebSocket(sessionId, options, body) {
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  FakeWebSocket.reset(options);
  codex.resetOpenAICodexWebSocketDebugStats(sessionId);
  try {
    await body();
  } finally {
    codex.closeOpenAICodexWebSocketSessions(sessionId);
    globalThis.WebSocket = originalWebSocket;
  }
}

test("Codex sends deltas across tool continuation and the following user turn", async () => {
  const sessionId = "codex-cache-positive";
  await withFakeWebSocket(sessionId, { firstResponseUsesTool: true }, async () => {
    const toolCallMessage = await run(sessionId, [system, user1]);
    toolCallMessage.timestamp = 3;
    assert.equal(toolCallMessage.stopReason, "toolUse");
    const toolCall = toolCallMessage.content.find((block) => block.type === "toolCall");
    assert.ok(toolCall);
    const toolResult = { role: "toolResult", toolCallId: toolCall.id, toolName: toolCall.name,
      content: [{ type: "text", text: "A" }], isError: false, timestamp: 4 };

    const answer = await run(sessionId, [system, user1, toolCallMessage, toolResult]);
    answer.timestamp = 5;
    assert.equal(answer.stopReason, "stop");
    const final = await run(sessionId, [system, user1, toolCallMessage, toolResult, answer, user2]);
    assert.equal(final.stopReason, "stop");

    const requests = FakeWebSocket.requests;
    assert.equal(requests.length, 3);
    assert.equal(requests[0].previous_response_id, undefined);
    assert.equal(requests[1].previous_response_id, "resp_1");
    assert.deepEqual(requests[1].input.map((item) => item.type), ["function_call_output"]);
    assert.equal(requests[2].previous_response_id, "resp_2");
    assert.deepEqual(requests[2].input.map((item) => item.role), ["user"]);

    const stats = codex.getOpenAICodexWebSocketDebugStats(sessionId);
    assert.equal(stats.connectionsCreated, 1);
    assert.equal(stats.connectionsReused, 2);
    assert.equal(stats.fullContextRequests, 1);
    assert.equal(stats.deltaRequests, 2);
    assert.equal(stats.websocketFailures, 0);
    assert.equal(stats.sseFallbacks, 0);
  });
});

test("Codex sends full context when non-input request fields change", async () => {
  const sessionId = "codex-cache-static-drift";
  await withFakeWebSocket(sessionId, {}, async () => {
    const answer = await run(sessionId, [system, user1]);
    answer.timestamp = 3;
    const changedSystem = { ...system, content: "Changed system" };
    await run(sessionId, [changedSystem, user1, answer, user2]);

    assert.equal(FakeWebSocket.requests[1].previous_response_id, undefined);
    assert.deepEqual(FakeWebSocket.requests[1].input.map((item) => item.type ?? item.role),
      ["user", "reasoning", "message", "user"]);
  });
});

test("Codex sends full context when earlier history changes", async () => {
  const sessionId = "codex-cache-history-drift";
  await withFakeWebSocket(sessionId, { firstResponseUsesTool: true }, async () => {
    const toolCallMessage = await run(sessionId, [system, user1]);
    toolCallMessage.timestamp = 3;
    const toolCall = toolCallMessage.content.find((block) => block.type === "toolCall");
    assert.ok(toolCall);
    const toolResult = { role: "toolResult", toolCallId: toolCall.id, toolName: toolCall.name,
      content: [{ type: "text", text: "A" }], isError: false, timestamp: 4 };
    const answer = await run(sessionId, [system, user1, toolCallMessage, toolResult]);
    answer.timestamp = 5;
    const rewrittenUser = { ...user1, content: "Rewritten history" };
    await run(sessionId, [system, rewrittenUser, toolCallMessage, toolResult, answer, user2]);

    assert.equal(FakeWebSocket.requests[1].previous_response_id, "resp_1");
    assert.equal(FakeWebSocket.requests[2].previous_response_id, undefined);
    assert.ok(FakeWebSocket.requests[2].input.length > 1);
  });
});

test("Codex does not claim continuation after its cached connection is closed", async () => {
  const sessionId = "codex-cache-reconnect";
  await withFakeWebSocket(sessionId, {}, async () => {
    const answer = await run(sessionId, [system, user1]);
    answer.timestamp = 3;
    codex.closeOpenAICodexWebSocketSessions(sessionId);
    await run(sessionId, [system, user1, answer, user2]);

    assert.equal(FakeWebSocket.requests[1].previous_response_id, undefined);
    assert.deepEqual(FakeWebSocket.requests[1].input.map((item) => item.type ?? item.role),
      ["user", "reasoning", "message", "user"]);
  });
});
