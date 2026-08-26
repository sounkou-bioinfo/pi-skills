import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";

const GRAPHQL_URL = "https://api.platform.opentargets.org/api/v4/graphql";
const SCHEMA_URL = "https://api.platform.opentargets.org/api/v4/graphql/schema";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 3_000;

const OpenTargetsSearchParameters = Type.Object({
	query: Type.String({
		minLength: 1,
		description: "Free-text term to search across Open Targets entities",
	}),
	entity_names: Type.Optional(Type.Array(Type.String({ minLength: 1 }), {
		minItems: 1,
		description: "Optional entity types such as target, disease, drug, variant, or study",
	})),
	page_index: Type.Optional(Type.Integer({ minimum: 0, default: 0, description: "Zero-based result page index" })),
	page_size: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE, description: "Number of results to request" })),
});

type OpenTargetsSearchInput = Static<typeof OpenTargetsSearchParameters>;
type JsonObject = Record<string, unknown>;

const SEARCH_QUERY = `query Search($queryString: String!, $entityNames: [String!], $page: Pagination) {
  search(queryString: $queryString, entityNames: $entityNames, page: $page) {
    total
    hits {
      id
      name
      entity
      category
      description
      highlights
      score
    }
    aggregations {
      total
      entities {
        name
        total
        categories {
          name
          total
        }
      }
    }
  }
}`;

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateInput(input: OpenTargetsSearchInput): { query: string; pageIndex: number; pageSize: number } {
	const query = input.query.trim();
	if (!query) throw new Error("Open Targets search query must not be empty");
	const pageIndex = input.page_index ?? 0;
	const pageSize = input.page_size ?? DEFAULT_PAGE_SIZE;
	if (!Number.isInteger(pageIndex) || pageIndex < 0) throw new Error("Open Targets page_index must be a non-negative integer");
	if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
		throw new Error(`Open Targets page_size must be between 1 and ${MAX_PAGE_SIZE}`);
	}
	if (input.entity_names?.some((name) => !name.trim())) throw new Error("Open Targets entity_names must not contain empty names");
	return { query, pageIndex, pageSize };
}

async function readBoundedText(response: Response): Promise<string> {
	const contentLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
		throw new Error(`Open Targets response exceeds the ${MAX_RESPONSE_BYTES}-byte safety limit`);
	}
	if (!response.body) {
		const raw = await response.text();
		if (new TextEncoder().encode(raw).byteLength > MAX_RESPONSE_BYTES) {
			throw new Error(`Open Targets response exceeds the ${MAX_RESPONSE_BYTES}-byte safety limit`);
		}
		return raw;
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const chunks: string[] = [];
	let bytes = 0;
	try {
		while (true) {
			const part = await reader.read();
			if (part.done) break;
			bytes += part.value.byteLength;
			if (bytes > MAX_RESPONSE_BYTES) {
				await reader.cancel();
				throw new Error(`Open Targets response exceeds the ${MAX_RESPONSE_BYTES}-byte safety limit`);
			}
			chunks.push(decoder.decode(part.value, { stream: true }));
		}
		chunks.push(decoder.decode());
		return chunks.join("");
	} finally {
		reader.releaseLock();
	}
}

function parseResponse(raw: string): JsonObject {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch {
		throw new Error("Open Targets returned a non-JSON response");
	}
	if (!isObject(parsed)) throw new Error("Open Targets returned an invalid GraphQL response");
	if (Array.isArray(parsed.errors) && parsed.errors.length) {
		const messages = parsed.errors
			.filter(isObject)
			.map((error) => typeof error.message === "string" ? error.message : "Unknown GraphQL error")
			.join("; ");
		throw new Error(`Open Targets GraphQL query failed: ${messages || "Unknown GraphQL error"}`);
	}
	if (!isObject(parsed.data) || !isObject(parsed.data.search)) {
		throw new Error("Open Targets returned no search data");
	}
	return parsed.data.search;
}

export default function openTargetsSearchExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "open_targets_search",
		label: "Open Targets Search",
		description: "Search the live Open Targets Platform v4 GraphQL API across targets, diseases, drugs, variants, or studies. Returns ranked hits, aggregations, and source URLs.",
		parameters: OpenTargetsSearchParameters,
		async execute(_toolCallId, params: OpenTargetsSearchInput, signal) {
			const { query, pageIndex, pageSize } = validateInput(params);
			const variables = {
				queryString: query,
				...(params.entity_names ? { entityNames: params.entity_names.map((name) => name.trim()) } : {}),
				page: { index: pageIndex, size: pageSize },
			};
			const requestSignal = signal
				? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
				: AbortSignal.timeout(REQUEST_TIMEOUT_MS);
			const response = await fetch(GRAPHQL_URL, {
				method: "POST",
				headers: {
					Accept: "application/json",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ operationName: "Search", query: SEARCH_QUERY, variables }),
				signal: requestSignal,
			});
			const raw = await readBoundedText(response);
			if (!response.ok) {
				const detail = raw.replace(/\s+/g, " ").trim().slice(0, 300);
				throw new Error(`Open Targets request failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`);
			}
			const result = parseResponse(raw);
			const total = typeof result.total === "number" ? result.total : undefined;
			const hasMore = total === undefined ? undefined : (pageIndex + 1) * pageSize < total;
			const evidence = {
				api_version: 4,
				query,
				entity_names: params.entity_names?.map((name) => name.trim()),
				page_index: pageIndex,
				page_size: pageSize,
				total,
				has_more: hasMore,
				result,
				source_url: GRAPHQL_URL,
				schema_url: SCHEMA_URL,
			};
			return {
				content: [{ type: "text", text: JSON.stringify(evidence, null, 2) }],
				details: {
					api_version: 4,
					query,
					entity_names: evidence.entity_names,
					page_index: pageIndex,
					page_size: pageSize,
					total,
					has_more: hasMore,
					source_url: GRAPHQL_URL,
					schema_url: SCHEMA_URL,
				},
			};
		},
	});
}
