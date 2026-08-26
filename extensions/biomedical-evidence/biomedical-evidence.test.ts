import assert from "node:assert/strict";
import test from "node:test";
import biomedicalEvidenceExtension from "./index.js";

function registeredTool(): any {
	let tool: any;
	biomedicalEvidenceExtension({
		registerTool(definition: unknown) {
			tool = definition;
		},
	} as any);
	return tool;
}

test("lists and describes providers without network access", async () => {
	const tool = registeredTool();
	const originalFetch = globalThis.fetch;
	let calls = 0;
	globalThis.fetch = async () => {
		calls += 1;
		return new Response("{}", { status: 200 });
	};
	try {
		const listed = await tool.execute("list", { action: "list" });
		assert.match(listed.content[0].text, /"gwas_catalog"/);
		assert.match(listed.content[0].text, /"europe_pmc"/);
		assert.match(listed.content[0].text, /"litvar2"/);
		assert.match(listed.content[0].text, /"minimum_interval_ms": 70/);
		const described = await tool.execute("describe", { action: "describe", provider: "omicspred" });
		assert.match(described.content[0].text, /"score_phewas_search"/);
		assert.match(described.content[0].text, /openapi-schema\.yml/);
		assert.equal(calls, 0);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("calls declared provider operations and preserves source receipts", async () => {
	const tool = registeredTool();
	const originalFetch = globalThis.fetch;
	const requests: Array<{ url: string; init?: RequestInit }> = [];
	globalThis.fetch = async (input, init) => {
		requests.push({ url: String(input), init });
		return new Response(JSON.stringify({ data: [{ geneSymbol: "LPA" }] }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	};
	try {
		const result = await tool.execute("gtex", {
			action: "call",
			requests: [{
				provider: "gtex_v8",
				operation: "eqtls",
				arguments: { chr: "6", pos: 160540105, ref: "T", alt: "C" },
			}],
		}, new AbortController().signal);
		assert.equal(requests.length, 1);
		const url = new URL(requests[0].url);
		assert.equal(url.origin, "https://gtexportal.org");
		assert.equal(url.pathname, "/api/v2/association/singleTissueEqtl");
		assert.equal(url.searchParams.get("variantId"), "chr6_160540105_T_C_b38");
		assert.equal(url.searchParams.get("datasetId"), "gtex_v8");
		assert.equal((requests[0].init?.headers as Record<string, string>)["User-Agent"], "pi-skills-biomedical-search/1.1");
		assert.match(result.content[0].text, /"status": "ok"/);
		assert.match(result.content[0].text, /"source_urls"/);
		assert.match(result.content[0].text, /"geneSymbol": "LPA"/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("rejects unsupported GWAS filters and summarizes association SNPs", async () => {
	const tool = registeredTool();
	const originalFetch = globalThis.fetch;
	let calls = 0;
	globalThis.fetch = async () => {
		calls += 1;
		const payload = calls === 1
			? {
				_embedded: { associations: [{ efo_traits: [{ efo_id: "MONDO_1", efo_trait: "infection" }], snp_allele: [{ rs_id: "rs2" }, { rs_id: "rs1" }] }] },
				_links: { next: { href: "https://www.ebi.ac.uk/gwas/rest/api/v2/associations?efo_id=MONDO_1&page=1&size=1" } },
				page: { totalElements: 2 },
			}
			: {
				_embedded: { associations: [{ efo_traits: [{ efo_id: "MONDO_2", efo_trait: "viral infection" }], snp_allele: [{ rs_id: "rs1" }] }] },
				page: { totalElements: 2 },
			};
		return new Response(JSON.stringify(payload), { status: 200 });
	};
	try {
		await assert.rejects(
			tool.execute("ignored-filter", { action: "call", requests: [{ provider: "gwas_catalog", operation: "associations", arguments: { reported_trait: "COVID-19" } }] }),
			/Unsupported argument.*reported_trait/,
		);
		assert.equal(calls, 0);
		const result = await tool.execute("summary", {
			action: "call",
			requests: [{ provider: "gwas_catalog", operation: "association_snps", arguments: { efo_id: "MONDO_1", show_child_trait: true, size: 1 }, max_pages: 2 }],
		});
		const parsed = JSON.parse(result.content[0].text);
		assert.equal(parsed.results[0].result.complete, true);
		assert.equal(parsed.results[0].result.unique_snp_count, 2);
		assert.deepEqual(parsed.results[0].result.snps, [
			{ rs_id: "rs1", traits: ["infection [MONDO_1]", "viral infection [MONDO_2]"] },
			{ rs_id: "rs2", traits: ["infection [MONDO_1]"] },
		]);
		assert.equal(parsed.results[0].pages, undefined);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("serializes and spaces requests to the same origin", async () => {
	const tool = registeredTool();
	const originalFetch = globalThis.fetch;
	const starts: number[] = [];
	globalThis.fetch = async () => {
		starts.push(Date.now());
		return new Response(JSON.stringify({ ok: true }), { status: 200 });
	};
	try {
		await tool.execute("spacing", {
			action: "call",
			requests: [
				{ provider: "gpmap", operation: "health" },
				{ provider: "gpmap", operation: "version" },
			],
		});
		assert.equal(starts.length, 2);
		assert.ok(starts[1] - starts[0] >= 80);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("uses GraphQL variables rather than interpolating user input", async () => {
	const tool = registeredTool();
	const originalFetch = globalThis.fetch;
	let requestBody: any;
	globalThis.fetch = async (_input, init) => {
		requestBody = JSON.parse(String(init?.body));
		return new Response(JSON.stringify({ data: { search: { total: 1, hits: [] } } }), { status: 200 });
	};
	try {
		await tool.execute("ot", {
			action: "call",
			requests: [{ provider: "open_targets", operation: "search", arguments: { query: "BRCA1", entity_names: ["target"], page_size: 10 } }],
		});
		assert.equal(requestBody.variables.queryString, "BRCA1");
		assert.deepEqual(requestBody.variables.entityNames, ["target"]);
		assert.deepEqual(requestBody.variables.page, { index: 0, size: 10 });
		assert.match(requestBody.query, /\$queryString/);
		assert.doesNotMatch(requestBody.query, /BRCA1/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("ports Open Targets variant lookups to the current v4 schema", async () => {
	const tool = registeredTool();
	const originalFetch = globalThis.fetch;
	const bodies: any[] = [];
	globalThis.fetch = async (_input, init) => {
		bodies.push(JSON.parse(String(init?.body)));
		return new Response(JSON.stringify({ data: { variant: { id: "6_160540105_T_C" } } }), { status: 200 });
	};
	try {
		await tool.execute("ot-port", {
			action: "call",
			requests: [
				{ provider: "open_targets", operation: "variant", arguments: { chr: "6", pos: 160540105, ref: "T", alt: "C" } },
				{ provider: "open_targets", operation: "credible_sets", arguments: { chr: "6", pos: 160540105, ref: "T", alt: "C", page_size: 10 } },
			],
		});
		assert.equal(bodies.length, 2);
		const variant = bodies.find((body) => body.query.includes("referenceAllele"));
		const credible = bodies.find((body) => body.query.includes("studyLocusId"));
		assert.equal(variant.variables.variantId, "6_160540105_T_C");
		assert.match(variant.query, /rsIds/);
		assert.doesNotMatch(variant.query, /nearestGene/);
		assert.deepEqual(credible.variables.page, { index: 0, size: 10 });
		assert.match(credible.query, /credibleSets\(page: \$page\)/);
		assert.match(credible.query, /locus\(variantIds: \[\$variantId\]/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("follows bounded Europe PMC cursor pagination", async () => {
	const tool = registeredTool();
	const originalFetch = globalThis.fetch;
	const urls: URL[] = [];
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		urls.push(url);
		const payload = urls.length === 1
			? { nextCursorMark: "cursor-2", resultList: { result: [{ id: "one" }] } }
			: { nextCursorMark: "cursor-2", resultList: { result: [{ id: "two" }] } };
		return new Response(JSON.stringify(payload), { status: 200 });
	};
	try {
		const result = await tool.execute("europe-pmc", {
			action: "call",
			requests: [{ provider: "europe_pmc", operation: "search", arguments: { query: "BRCA1" }, max_pages: 2 }],
		});
		assert.equal(urls.length, 2);
		assert.equal(urls[0].searchParams.get("query"), "BRCA1");
		assert.equal(urls[0].searchParams.get("format"), "json");
		assert.equal(urls[1].searchParams.get("cursorMark"), "cursor-2");
		assert.match(result.content[0].text, /"pages_fetched": 2/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("makes the LitVar snippet limitation explicit", async () => {
	const tool = registeredTool();
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response(JSON.stringify({ pmids: [37268776] }), { status: 200 });
	try {
		const result = await tool.execute("litvar", {
			action: "call",
			requests: [{ provider: "litvar2", operation: "variant_publications", arguments: { variant_id: "litvar@rs113488022##" } }],
		});
		assert.match(result.content[0].text, /snippets remain web-interface-only/);
		assert.doesNotMatch(result.content[0].text, /"snippets":/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("rejects retired and unknown catalog operations before fetch", async () => {
	const tool = registeredTool();
	const originalFetch = globalThis.fetch;
	let calls = 0;
	globalThis.fetch = async () => {
		calls += 1;
		return new Response("{}", { status: 200 });
	};
	try {
		await assert.rejects(
			tool.execute("retired", { action: "call", requests: [{ provider: "eqtl_catalogue", operation: "associations", arguments: { rsid: "rs3798220" } }] }),
			/API now returns HTTP 410/,
		);
		await assert.rejects(
			tool.execute("unknown", { action: "call", requests: [{ provider: "gwas_catalog", operation: "findByRsId", arguments: { rsId: "rs123" } }] }),
			/Unknown operation/,
		);
		await assert.rejects(
			tool.execute("v1-argument", { action: "call", requests: [{ provider: "gwas_catalog", operation: "associations", arguments: { rsId: "rs123" } }] }),
			/must use snake_case/,
		);
		assert.equal(calls, 0);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("uses bounded backoff while preserving valid batch results", async () => {
	const tool = registeredTool();
	const originalFetch = globalThis.fetch;
	let ensemblCalls = 0;
	globalThis.fetch = async (input) => {
		if (String(input).includes("rest.ensembl.org")) {
			ensemblCalls += 1;
			return new Response("unavailable", { status: 503, statusText: "Service Unavailable" });
		}
		return new Response(JSON.stringify({ version: "1.0.1" }), { status: 200 });
	};
	try {
		const startedAt = Date.now();
		const result = await tool.execute("batch", {
			action: "call",
			requests: [
				{ provider: "ensembl", operation: "variation", arguments: { rsid: "rs3798220" } },
				{ provider: "gpmap", operation: "version" },
			],
		});
		assert.equal(ensemblCalls, 3);
		assert.ok(Date.now() - startedAt >= 650);
		assert.match(result.content[0].text, /"status": "error"/);
		assert.match(result.content[0].text, /Service Unavailable/);
		assert.match(result.content[0].text, /"status": "ok"/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
