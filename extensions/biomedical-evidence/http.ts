import type { OperationProfile, PreparedRequest, ProviderProfile } from "./catalog.js";

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PAGE_BYTES = 2_000_000;
export const RESPONSE_BUDGET_BYTES = 8_000_000;
const MAX_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 10_000;
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

type JsonObject = Record<string, unknown>;

export interface FetchedPage {
	url: string;
	payload: unknown;
	bytes: number;
}

export interface ResponseBudget {
	used: number;
	limit: number;
}

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sleep(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
	if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("Biomedical request was aborted"));
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, milliseconds);
		if (!signal) return;
		const abort = () => {
			clearTimeout(timer);
			reject(signal.reason ?? new Error("Biomedical request was aborted"));
		};
		signal.addEventListener("abort", abort, { once: true });
	});
}

async function readBoundedText(response: Response): Promise<{ raw: string; bytes: number }> {
	const contentLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > MAX_PAGE_BYTES) {
		throw new Error(`Biomedical response exceeds the ${MAX_PAGE_BYTES}-byte per-page safety limit`);
	}
	if (!response.body) {
		const raw = await response.text();
		const bytes = new TextEncoder().encode(raw).byteLength;
		if (bytes > MAX_PAGE_BYTES) throw new Error(`Biomedical response exceeds the ${MAX_PAGE_BYTES}-byte per-page safety limit`);
		return { raw, bytes };
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
			if (bytes > MAX_PAGE_BYTES) {
				await reader.cancel();
				throw new Error(`Biomedical response exceeds the ${MAX_PAGE_BYTES}-byte per-page safety limit`);
			}
			chunks.push(decoder.decode(part.value, { stream: true }));
		}
		chunks.push(decoder.decode());
		return { raw: chunks.join(""), bytes };
	} finally {
		reader.releaseLock();
	}
}

function parseJson(raw: string, provider: ProviderProfile): unknown {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch {
		throw new Error(`${provider.label} returned a non-JSON response`);
	}
	if (isObject(parsed) && Array.isArray(parsed.errors) && parsed.errors.length) {
		const messages = parsed.errors
			.filter(isObject)
			.map((error) => typeof error.message === "string" ? error.message : "Unknown GraphQL error")
			.join("; ");
		throw new Error(`${provider.label} GraphQL request failed: ${messages || "Unknown GraphQL error"}`);
	}
	return parsed;
}

function retryDelay(response: Response, attempt: number): number {
	const retryAfter = response.headers.get("retry-after");
	if (retryAfter !== null) {
		const seconds = Number(retryAfter);
		if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_RETRY_DELAY_MS, seconds * 1_000);
		const date = Date.parse(retryAfter);
		if (Number.isFinite(date)) return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, date - Date.now()));
	}
	const exponential = 250 * 2 ** attempt;
	const jitter = Math.floor(Math.random() * Math.min(250, exponential / 2));
	return Math.min(MAX_RETRY_DELAY_MS, exponential + jitter);
}

function nextHref(payload: unknown): string | undefined {
	if (!isObject(payload)) return undefined;
	for (const value of [payload.next, isObject(payload.links) ? payload.links.next : undefined, isObject(payload._links) ? payload._links.next : undefined]) {
		if (typeof value === "string" && value.trim()) return value;
		if (isObject(value) && typeof value.href === "string" && value.href.trim()) return value.href;
	}
	return undefined;
}

function nextRequest(operation: OperationProfile, page: FetchedPage): PreparedRequest | undefined {
	if (operation.pagination === "hal-next") {
		const href = nextHref(page.payload);
		return href ? { url: new URL(href, page.url), method: "GET" } : undefined;
	}
	if (operation.pagination === "europe-pmc-cursor" && isObject(page.payload)) {
		const cursor = typeof page.payload.nextCursorMark === "string" ? page.payload.nextCursorMark : undefined;
		if (!cursor) return undefined;
		const url = new URL(page.url);
		if (url.searchParams.get("cursorMark") === cursor) return undefined;
		url.searchParams.set("cursorMark", cursor);
		return { url, method: "GET" };
	}
	return undefined;
}

export class BiomedicalHttpClient {
	private readonly queues = new Map<string, Promise<void>>();
	private readonly nextRequestAt = new Map<string, number>();

	private async fetchPage(provider: ProviderProfile, request: PreparedRequest, signal: AbortSignal | undefined): Promise<FetchedPage> {
		for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
			await this.throttle(provider, signal);
			const requestSignal = signal
				? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
				: AbortSignal.timeout(REQUEST_TIMEOUT_MS);
			const response = await fetch(request.url, {
				method: request.method,
				headers: {
					Accept: "application/json",
					"User-Agent": "pi-skills-biomedical-search/1.1",
					...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
				},
				body: request.body === undefined ? undefined : JSON.stringify(request.body),
				signal: requestSignal,
			});
			const { raw, bytes } = await readBoundedText(response);
			if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_RETRIES) {
				await sleep(retryDelay(response, attempt), signal);
				continue;
			}
			if (!response.ok) {
				const detail = raw.replace(/\s+/g, " ").trim().slice(0, 300);
				throw new Error(`${provider.label} request failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`);
			}
			return { url: response.url || request.url.toString(), payload: parseJson(raw, provider), bytes };
		}
		throw new Error(`${provider.label} retry limit reached`);
	}

	private throttle(provider: ProviderProfile, signal: AbortSignal | undefined): Promise<void> {
		const key = new URL(provider.baseUrl).origin;
		const previous = this.queues.get(key) ?? Promise.resolve();
		const current = previous.then(async () => {
			const wait = (this.nextRequestAt.get(key) ?? 0) - Date.now();
			if (wait > 0) await sleep(wait, signal);
			this.nextRequestAt.set(key, Date.now() + provider.minimumIntervalMs);
		});
		this.queues.set(key, current.then(() => undefined, () => undefined));
		return current;
	}

	async fetchPages(
		provider: ProviderProfile,
		operation: OperationProfile,
		initialRequest: PreparedRequest,
		maxPages: number,
		signal: AbortSignal | undefined,
		batchBudget: ResponseBudget,
	): Promise<FetchedPage[]> {
		const pages: FetchedPage[] = [];
		let totalBytes = 0;
		let request: PreparedRequest | undefined = initialRequest;
		while (request && pages.length < maxPages) {
			const page = await this.fetchPage(provider, request, signal);
			totalBytes += page.bytes;
			batchBudget.used += page.bytes;
			if (totalBytes > RESPONSE_BUDGET_BYTES) throw new Error(`Biomedical pages exceed the ${RESPONSE_BUDGET_BYTES}-byte per-request safety limit`);
			if (batchBudget.used > batchBudget.limit) throw new Error(`Biomedical batch exceeds the ${batchBudget.limit}-byte total safety limit`);
			operation.validate?.(page.payload);
			pages.push(page);
			request = nextRequest(operation, page);
		}
		return pages;
	}
}
