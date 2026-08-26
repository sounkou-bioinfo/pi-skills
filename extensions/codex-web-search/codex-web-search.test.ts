import assert from "node:assert/strict";
import test from "node:test";
import codexWebSearchExtension from "./index.js";

function jwt(payload: Record<string, unknown>): string {
	return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

test("searches with Codex OAuth and returns native web citations", async () => {
	let tool: any;
	codexWebSearchExtension({
		registerTool(definition: unknown) {
			tool = definition;
		},
	} as any);

	const model = { provider: "openai-codex", id: "gpt-5.4" };
	const token = jwt({
		"https://api.openai.com/auth": { chatgpt_account_id: "account-123" },
	});
	const context = {
		model,
		modelRegistry: {
			getAvailable: () => [model],
			getApiKeyAndHeaders: async () => ({
				ok: true,
				apiKey: token,
				headers: { "x-provider-header": "present", ignored: null },
			}),
		},
	};

	const events = [
		{
			type: "response.output_item.done",
			item: {
				type: "web_search_call",
				action: {
					sources: [{ title: "Example source", url: "https://example.org/article?utm_source=openai" }],
				},
			},
		},
		{
			type: "response.output_item.done",
			item: {
				type: "message",
				content: [{
					type: "output_text",
					text: "A grounded answer.",
					annotations: [{ type: "url_citation", title: "Duplicate", url: "https://example.org/article" }],
				}],
			},
		},
		{ type: "response.completed", response: { output: [] } },
	];
	const stream = `${events.map((event) => `data: ${JSON.stringify(event)}`).join("\n\n")}\n\ndata: [DONE]\n`;

	const originalFetch = globalThis.fetch;
	let requestUrl: string | undefined;
	let requestInit: RequestInit | undefined;
	globalThis.fetch = async (input, init) => {
		requestUrl = String(input);
		requestInit = init;
		return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
	};

	try {
		const result = await tool.execute("call-1", { query: "latest example" }, new AbortController().signal, undefined, context);
		assert.equal(requestUrl, "https://chatgpt.com/backend-api/codex/responses");
		assert.equal((requestInit?.headers as Record<string, string>).Authorization, `Bearer ${token}`);
		assert.equal((requestInit?.headers as Record<string, string>)["chatgpt-account-id"], "account-123");
		assert.equal((requestInit?.headers as Record<string, string>)["x-provider-header"], "present");

		const body = JSON.parse(String(requestInit?.body));
		assert.equal(body.model, "gpt-5.4");
		assert.deepEqual(body.tools, [{ type: "web_search" }]);
		assert.equal(body.tool_choice, "required");
		assert.match(result.content[0].text, /A grounded answer\./);
		assert.match(result.content[0].text, /https:\/\/example\.org\/article/);
		assert.doesNotMatch(result.content[0].text, /utm_source/);
		assert.equal(result.details.sources.length, 1);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("rejects an SSE stream that ends without a terminal event", async () => {
	let tool: any;
	codexWebSearchExtension({ registerTool: (definition: unknown) => { tool = definition; } } as any);
	const model = { provider: "openai-codex", id: "gpt-5.4" };
	const context = {
		model,
		modelRegistry: {
			getAvailable: () => [model],
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "token", headers: {} }),
		},
	};
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response(
		`data: ${JSON.stringify({ type: "response.output_item.done", item: { type: "message", content: [{ text: "partial" }] } })}\n`,
		{ status: 200 },
	);
	try {
		await assert.rejects(
			tool.execute("call-partial", { query: "example" }, new AbortController().signal, undefined, context),
			/stream ended before completion/,
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("rejects a whitespace-only query before resolving authentication", async () => {
	let tool: any;
	codexWebSearchExtension({ registerTool: (definition: unknown) => { tool = definition; } } as any);
	await assert.rejects(
		tool.execute("call-empty", { query: "   " }, undefined, undefined, {}),
		/query must not be empty/,
	);
});

test("fails clearly when Codex authentication is unavailable", async () => {
	let tool: any;
	codexWebSearchExtension({ registerTool: (definition: unknown) => { tool = definition; } } as any);
	const context = {
		model: undefined,
		modelRegistry: { getAvailable: () => [] },
	};

	await assert.rejects(
		tool.execute("call-2", { query: "example" }, new AbortController().signal, undefined, context),
		/Sign in with \/login/,
	);
});
