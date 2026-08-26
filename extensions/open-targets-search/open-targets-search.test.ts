import assert from "node:assert/strict";
import test from "node:test";
import openTargetsSearchExtension from "./index.js";

function registeredTool(): any {
	let tool: any;
	openTargetsSearchExtension({
		registerTool(definition: unknown) {
			tool = definition;
		},
	} as any);
	return tool;
}

test("searches Open Targets with GraphQL variables and returns evidence", async () => {
	const tool = registeredTool();
	const originalFetch = globalThis.fetch;
	let requestUrl: string | undefined;
	let requestInit: RequestInit | undefined;
	globalThis.fetch = async (input, init) => {
		requestUrl = String(input);
		requestInit = init;
		return new Response(JSON.stringify({
			data: {
				search: {
					total: 38,
					hits: [{ id: "ENSG00000012048", name: "BRCA1", entity: "target", category: ["protein_coding"], description: "BRCA1 DNA repair associated", highlights: ["<em>BRCA1</em>"], score: 5829.375 }],
					aggregations: null,
				},
			},
		}), { status: 200, headers: { "content-type": "application/json" } });
	};

	try {
		const result = await tool.execute("call-1", {
			query: "BRCA1",
			entity_names: ["target"],
			page_index: 1,
			page_size: 2,
		}, new AbortController().signal);
		assert.equal(requestUrl, "https://api.platform.opentargets.org/api/v4/graphql");
		const body = JSON.parse(String(requestInit?.body));
		assert.equal(body.operationName, "Search");
		assert.equal(body.variables.queryString, "BRCA1");
		assert.deepEqual(body.variables.entityNames, ["target"]);
		assert.deepEqual(body.variables.page, { index: 1, size: 2 });
		assert.match(body.query, /search\(queryString: \$queryString/);
		assert.equal(result.details.total, 38);
		assert.equal(result.details.has_more, true);
		assert.match(result.content[0].text, /ENSG00000012048/);
		assert.match(result.content[0].text, /graphql\/schema/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("rejects GraphQL errors instead of returning partial data", async () => {
	const tool = registeredTool();
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response(JSON.stringify({
		errors: [{ message: "Unknown entity" }],
		data: { search: null },
	}), { status: 200, headers: { "content-type": "application/json" } });
	try {
		await assert.rejects(
			tool.execute("call-error", { query: "not-a-real-entity" }),
			/Open Targets GraphQL query failed: Unknown entity/,
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("rejects empty queries before making a request", async () => {
	const tool = registeredTool();
	const originalFetch = globalThis.fetch;
	let calls = 0;
	globalThis.fetch = async () => {
		calls += 1;
		return new Response("{}", { status: 200 });
	};
	try {
		await assert.rejects(
			tool.execute("call-empty", { query: "   " }),
			/query must not be empty/,
		);
		await assert.rejects(
			tool.execute("call-too-large", { query: "BRCA1", page_size: 3001 }),
			/page_size must be between 1 and 3000/,
		);
		assert.equal(calls, 0);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("reports bounded HTTP failures", async () => {
	const tool = registeredTool();
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response("upstream unavailable", { status: 503, statusText: "Service Unavailable" });
	try {
		await assert.rejects(
			tool.execute("call-http-error", { query: "BRCA1" }),
			/Open Targets request failed \(503 Service Unavailable\): upstream unavailable/,
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
