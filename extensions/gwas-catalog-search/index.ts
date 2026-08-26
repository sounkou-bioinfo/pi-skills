import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";

const API_ORIGIN = "https://www.ebi.ac.uk";
const API_PREFIX = "/gwas/rest/api/v2/";
const REQUEST_TIMEOUT_MS = 30_000;
const MIN_REQUEST_INTERVAL_MS = 70;
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_TOTAL_RESPONSE_BYTES = 8_000_000;
const MAX_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 10_000;

const FilterScalar = Type.Union([Type.String(), Type.Number(), Type.Boolean()]);
const GwasCatalogSearchParameters = Type.Object({
	endpoint: Type.String({
		minLength: 1,
		description: "A GWAS Catalog v2 resource path, for example associations, studies, publications, genes, or traits",
	}),
	filters: Type.Optional(Type.Record(Type.String(), Type.Union([FilterScalar, Type.Array(FilterScalar)]))),
	page: Type.Optional(Type.Integer({ minimum: 0, default: 0, description: "Zero-based page number" })),
	size: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 20, description: "Records per page" })),
	max_pages: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, default: 1, description: "Maximum number of pages to retrieve" })),
	follow_next: Type.Optional(Type.Boolean({ default: true, description: "Follow documented next links until max_pages is reached" })),
});

type GwasCatalogSearchInput = Static<typeof GwasCatalogSearchParameters>;
type JsonObject = Record<string, unknown>;
type FilterValue = string | number | boolean | Array<string | number | boolean>;

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeEndpoint(value: string): string {
	let endpoint = value.trim();
	if (endpoint.startsWith(API_ORIGIN)) {
		try {
			const url = new URL(endpoint);
			if (url.origin !== API_ORIGIN || url.search || url.hash) throw new Error("URL must not include a query or fragment");
			endpoint = url.pathname;
		} catch (error) {
			throw new Error(`Invalid GWAS Catalog v2 endpoint: ${error instanceof Error ? error.message : "invalid URL"}`);
		}
	}
	endpoint = endpoint.replace(/^\/+/, "");
	if (endpoint.startsWith("gwas/rest/api/v2/")) endpoint = endpoint.slice("gwas/rest/api/v2/".length);
	if (endpoint.startsWith("gwas/rest/api/") || endpoint.split("/").some((part) => part === "search" || part.startsWith("findBy") || part === "singleNucleotidePolymorphisms" || part === "efoTraits") || !endpoint || endpoint.includes("..") || !/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(endpoint)) {
		throw new Error("GWAS Catalog endpoint must be a v2 API resource path, not a v1 search endpoint");
	}
	return `${API_ORIGIN}${API_PREFIX}${endpoint}`;
}

function validateFilters(filters: Record<string, FilterValue> | undefined): void {
	for (const [name, value] of Object.entries(filters ?? {})) {
		if (!/^[a-z][a-z0-9_]*$/.test(name)) {
			throw new Error(`GWAS Catalog v2 filter '${name}' must use snake_case; v1 search parameters are not supported`);
		}
		if (["page", "size"].includes(name)) {
			throw new Error(`Pass '${name}' as a top-level GWAS Catalog search argument, not in filters`);
		}
		const values = Array.isArray(value) ? value : [value];
		if (!values.length) throw new Error(`GWAS Catalog filter '${name}' must not be an empty array`);
		for (const item of values) {
			if (typeof item === "number" && !Number.isFinite(item)) throw new Error(`GWAS Catalog filter '${name}' must contain finite numbers`);
		}
	}
}

function addQueryValues(url: URL, name: string, value: FilterValue): void {
	const values = Array.isArray(value) ? value : [value];
	for (const item of values) url.searchParams.append(name, String(item));
}

function buildInitialUrl(input: GwasCatalogSearchInput): URL {
	validateFilters(input.filters as Record<string, FilterValue> | undefined);
	const url = new URL(normalizeEndpoint(input.endpoint));
	for (const [name, value] of Object.entries(input.filters ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
		addQueryValues(url, name, value as FilterValue);
	}
	url.searchParams.set("page", String(input.page ?? 0));
	url.searchParams.set("size", String(input.size ?? 20));
	return url;
}

function sleep(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
	if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("GWAS Catalog request was aborted"));
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, milliseconds);
		if (!signal) return;
		const abort = () => {
			clearTimeout(timer);
			reject(signal.reason ?? new Error("GWAS Catalog request was aborted"));
		};
		signal.addEventListener("abort", abort, { once: true });
	});
}

async function readBoundedText(response: Response): Promise<string> {
	const contentLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
		throw new Error(`GWAS Catalog response exceeds the ${MAX_RESPONSE_BYTES}-byte safety limit`);
	}
	if (!response.body) {
		const raw = await response.text();
		if (new TextEncoder().encode(raw).byteLength > MAX_RESPONSE_BYTES) {
			throw new Error(`GWAS Catalog response exceeds the ${MAX_RESPONSE_BYTES}-byte safety limit`);
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
				throw new Error(`GWAS Catalog response exceeds the ${MAX_RESPONSE_BYTES}-byte safety limit`);
			}
			chunks.push(decoder.decode(part.value, { stream: true }));
		}
		chunks.push(decoder.decode());
		return chunks.join("");
	} finally {
		reader.releaseLock();
	}
}

function retryDelay(response: Response, attempt: number): number {
	const retryAfter = response.headers.get("retry-after");
	const seconds = retryAfter === null ? NaN : Number(retryAfter);
	if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_RETRY_DELAY_MS, seconds * 1_000);
	return Math.min(MAX_RETRY_DELAY_MS, 250 * 2 ** attempt);
}

function parseJson(raw: string): unknown {
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		throw new Error("GWAS Catalog returned a non-JSON response");
	}
}

function nextHref(value: unknown): string | undefined {
	if (typeof value === "string" && value.trim()) return value;
	if (!isObject(value)) return undefined;
	for (const key of ["href", "url"]) {
		if (typeof value[key] === "string" && value[key].trim()) return value[key] as string;
	}
	return undefined;
}

function findNextLink(payload: unknown): string | undefined {
	if (!isObject(payload)) return undefined;
	for (const candidate of [payload.next, isObject(payload.links) ? payload.links.next : undefined, isObject(payload._links) ? payload._links.next : undefined]) {
		const href = nextHref(candidate);
		if (href) return href;
	}
	return undefined;
}

function validateNextUrl(value: string): URL {
	const url = new URL(value, API_ORIGIN);
	if (url.origin !== API_ORIGIN || !url.pathname.startsWith(API_PREFIX) || url.hash) {
		throw new Error("GWAS Catalog returned an unsafe next link outside the v2 API");
	}
	return url;
}

async function fetchPage(
	url: URL,
	signal: AbortSignal | undefined,
	beforeRequest: (signal: AbortSignal | undefined) => Promise<void>,
): Promise<{ url: string; payload: unknown; bytes: number }> {
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
		await beforeRequest(signal);
		const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
		const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
		const response = await fetch(url, {
			headers: { Accept: "application/json" },
			signal: requestSignal,
		});
		const raw = await readBoundedText(response);
		if (response.status === 429 && attempt < MAX_RETRIES) {
			await sleep(retryDelay(response, attempt), signal);
			continue;
		}
		if (!response.ok) {
			const detail = raw.replace(/\s+/g, " ").trim().slice(0, 300);
			throw new Error(`GWAS Catalog v2 request failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`);
		}
		return { url: url.toString(), payload: parseJson(raw), bytes: new TextEncoder().encode(raw).byteLength };
	}
	throw new Error("GWAS Catalog request retry limit reached");
}

function formatResult(pages: Array<{ url: string; payload: unknown; bytes: number }>): string {
	return JSON.stringify({
		api_version: 2,
		pages: pages.map(({ url, payload }) => ({ url, payload })),
	}, null, 2);
}

export default function gwasCatalogSearchExtension(pi: ExtensionAPI): void {
	let lastRequestAt = 0;
	let requestQueue = Promise.resolve();

	const rateLimitedFetch = (url: URL, signal: AbortSignal | undefined): Promise<{ url: string; payload: unknown; bytes: number }> => {
		const run = requestQueue.then(async () => fetchPage(url, signal, async (requestSignal) => {
			const wait = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
			if (wait > 0) await sleep(wait, requestSignal);
			lastRequestAt = Date.now();
		}));
		requestQueue = run.then(() => undefined, () => undefined);
		return run;
	};

	pi.registerTool({
		name: "gwas_catalog_search",
		label: "GWAS Catalog v2",
		description: "Query the live GWAS Catalog REST API v2 with resource filters and bounded pagination. Uses the v2 API only; returns response data and source URLs.",
		parameters: GwasCatalogSearchParameters,
		async execute(_toolCallId, params: GwasCatalogSearchInput, signal) {
			const pages: Array<{ url: string; payload: unknown; bytes: number }> = [];
			let totalBytes = 0;
			let url = buildInitialUrl(params);
			const maxPages = params.max_pages ?? 1;
			const followNext = params.follow_next ?? true;
			for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
				const page = await rateLimitedFetch(url, signal);
				totalBytes += page.bytes;
				if (totalBytes > MAX_TOTAL_RESPONSE_BYTES) {
					throw new Error(`GWAS Catalog pages exceed the ${MAX_TOTAL_RESPONSE_BYTES}-byte safety limit`);
				}
				pages.push(page);
				if (!followNext) break;
				const next = findNextLink(page.payload);
				if (!next) break;
				url = validateNextUrl(next);
			}

			return {
				content: [{ type: "text", text: formatResult(pages) }],
				details: {
					api_version: 2,
					endpoint: params.endpoint.trim(),
					pages_fetched: pages.length,
					next_links_followed: Math.max(0, pages.length - 1),
					source_urls: pages.map((page) => page.url),
					rate_limit_queries_per_second: 15,
				},
			};
		},
	});
}
