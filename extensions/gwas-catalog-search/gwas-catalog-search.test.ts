import assert from "node:assert/strict";
import test from "node:test";
import gwasCatalogSearchExtension from "./index.js";

function registeredTool(): any {
	let tool: any;
	gwasCatalogSearchExtension({
		registerTool(definition: unknown) {
			tool = definition;
		},
	} as any);
	return tool;
}

test("queries v2 filters and follows bounded next links", async () => {
	const tool = registeredTool();
	const requests: URL[] = [];
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		requests.push(url);
		const page = requests.length === 1
			? {
				associations: [{ rs_id: "rs123" }],
				next: "/gwas/rest/api/v2/associations?rs_id=rs123&page=1&size=1",
			}
			: { associations: [{ rs_id: "rs124" }] };
		return new Response(JSON.stringify(page), { status: 200, headers: { "content-type": "application/json" } });
	};

	try {
		const result = await tool.execute("call-1", {
			endpoint: "associations",
			filters: {
				rs_id: "rs123",
				mapped_gene: "HBB",
				show_child_traits: false,
				extended_geneset: true,
			},
			size: 1,
			max_pages: 2,
		}, new AbortController().signal);

		assert.equal(requests.length, 2);
		assert.equal(requests[0].origin, "https://www.ebi.ac.uk");
		assert.equal(requests[0].pathname, "/gwas/rest/api/v2/associations");
		assert.equal(requests[0].searchParams.get("rs_id"), "rs123");
		assert.equal(requests[0].searchParams.get("mapped_gene"), "HBB");
		assert.equal(requests[0].searchParams.get("show_child_traits"), "false");
		assert.equal(requests[0].searchParams.get("extended_geneset"), "true");
		assert.equal(requests[0].searchParams.get("page"), "0");
		assert.equal(requests[0].searchParams.get("size"), "1");
		assert.equal(requests[1].searchParams.get("page"), "1");
		assert.equal(result.details.pages_fetched, 2);
		assert.deepEqual(result.details.source_urls, requests.map(String));
		assert.match(result.content[0].text, /"rs_id": "rs123"/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("rejects v1 search endpoints and camelCase filters", async () => {
	const tool = registeredTool();
	const originalFetch = globalThis.fetch;
	let calls = 0;
	globalThis.fetch = async () => {
		calls += 1;
		return new Response("{}", { status: 200 });
	};
	try {
		await assert.rejects(
			tool.execute("call-v1", { endpoint: "associations/search/findByRsId", filters: { rsId: "rs123" } }),
			/snake_case/,
		);
		await assert.rejects(
			tool.execute("call-v1-path", { endpoint: "associations/search/findByRsId" }),
			/v2 API/,
		);
		assert.equal(calls, 0);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("does not follow an unsafe next link", async () => {
	const tool = registeredTool();
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response(
		JSON.stringify({ next: "https://example.org/gwas/rest/api/v2/associations" }),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
	try {
		await assert.rejects(
			tool.execute("call-unsafe-next", { endpoint: "associations", max_pages: 2 }),
			/unsafe next link/,
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("reports a bounded API failure", async () => {
	const tool = registeredTool();
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response("unknown filter", { status: 400, statusText: "Bad Request" });
	try {
		await assert.rejects(
			tool.execute("call-error", { endpoint: "studies", filters: { efo_id: "MONDO_0004979" } }),
			/GWAS Catalog v2 request failed \(400 Bad Request\): unknown filter/,
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
