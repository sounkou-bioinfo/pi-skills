import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";

const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const SEARCH_TIMEOUT_MS = 60_000;
const EXCLUDED_MODEL_SEGMENTS = new Set(["pro", "ultra"]);

const WebSearchParameters = Type.Object({
	query: Type.String({
		minLength: 1,
		description: "The question or topic to search for on the web",
	}),
});

type WebSearchInput = Static<typeof WebSearchParameters>;
type JsonObject = Record<string, unknown>;
type ProviderHeaders = Record<string, string | null>;

interface SearchSource {
	title: string;
	url: string;
}

interface CodexAuth {
	apiKey: string;
	headers: ProviderHeaders;
	model: string;
}

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objects(value: unknown): JsonObject[] {
	return Array.isArray(value) ? value.filter(isObject) : [];
}

function strings(value: unknown): string[] {
	return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

function isSearchCapableModel(id: string): boolean {
	return !id.split("-").some((segment) => EXCLUDED_MODEL_SEGMENTS.has(segment));
}

function modelPreference(id: string): number {
	if (id.includes("terra")) return 2;
	if (/^gpt-\d+(\.\d+)?$/.test(id)) return 1;
	return 0;
}

function pickSearchModels(ctx: ExtensionContext) {
	const available = ctx.modelRegistry
		.getAvailable()
		.filter((model) => model.provider === "openai-codex" && isSearchCapableModel(model.id));

	return available.sort((a, b) => {
		const activeDifference = Number(b === ctx.model) - Number(a === ctx.model);
		if (activeDifference) return activeDifference;
		const preferenceDifference = modelPreference(b.id) - modelPreference(a.id);
		return preferenceDifference || b.id.localeCompare(a.id, undefined, { numeric: true });
	});
}

async function resolveCodexAuth(ctx: ExtensionContext): Promise<CodexAuth> {
	const failures: string[] = [];
	for (const model of pickSearchModels(ctx)) {
		const resolved = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (resolved.ok && resolved.apiKey) {
			return {
				apiKey: resolved.apiKey,
				headers: resolved.headers ?? {},
				model: model.id,
			};
		}
		if (!resolved.ok) failures.push(resolved.error);
	}

	const detail = failures.length ? ` (${failures[0]})` : "";
	throw new Error(`OpenAI Codex web search is unavailable. Sign in with /login and select OpenAI Codex${detail}.`);
}

function requestHeaders(auth: CodexAuth): Record<string, string> {
	const headers: Record<string, string> = {};
	for (const [name, value] of Object.entries(auth.headers)) {
		if (value !== null) headers[name] = value;
	}
	headers.Authorization = `Bearer ${auth.apiKey}`;
	headers["Content-Type"] = "application/json";
	headers["OpenAI-Beta"] = "responses=experimental";
	headers.originator = "pi";

	const accountId = extractAccountId(auth.apiKey);
	if (accountId) headers["chatgpt-account-id"] = accountId;
	return headers;
}

function extractAccountId(token: string): string | undefined {
	try {
		const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as unknown;
		if (!isObject(payload)) return undefined;
		const auth = payload["https://api.openai.com/auth"];
		if (!isObject(auth)) return undefined;
		return typeof auth.chatgpt_account_id === "string" ? auth.chatgpt_account_id : undefined;
	} catch {
		return undefined;
	}
}

function responseFailure(response: JsonObject): string | undefined {
	if (response.status === "failed" || response.error) return "OpenAI Codex web search response failed";
	if (response.status === "incomplete") return "OpenAI Codex web search response was incomplete";
	return undefined;
}

function parseResponse(raw: string): JsonObject {
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (isObject(parsed)) {
			const failure = responseFailure(parsed);
			if (failure) throw new Error(failure);
			return parsed;
		}
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("OpenAI Codex")) throw error;
		// Codex normally returns an SSE stream rather than one JSON document.
	}

	const output: JsonObject[] = [];
	let completed: JsonObject | undefined;
	let failed = false;
	for (const line of raw.split(/\r?\n/)) {
		if (!line.startsWith("data:")) continue;
		const data = line.slice(5).trim();
		if (!data || data === "[DONE]") continue;
		try {
			const event = JSON.parse(data) as unknown;
			if (!isObject(event)) continue;
			if (event.type === "response.output_item.done" && isObject(event.item)) output.push(event.item);
			if (event.type === "response.failed" || event.type === "response.incomplete") failed = true;
			if ((event.type === "response.completed" || event.type === "response.done") && isObject(event.response)) {
				completed = event.response;
			}
		} catch {
			// Ignore keep-alive or malformed event lines and continue parsing the stream.
		}
	}

	if (failed) throw new Error("OpenAI Codex web search response failed");
	if (!completed) throw new Error("OpenAI Codex web search stream ended before completion");
	const failure = responseFailure(completed);
	if (failure) throw new Error(failure);
	if (!Array.isArray(completed.output) || completed.output.length === 0) completed.output = output;
	return completed;
}

function cleanUrl(value: unknown): string | undefined {
	if (typeof value !== "string" || !value) return undefined;
	try {
		const url = new URL(value);
		if (url.searchParams.get("utm_source") === "openai") url.searchParams.delete("utm_source");
		return url.toString();
	} catch {
		return undefined;
	}
}

function addSource(sources: SearchSource[], seen: Set<string>, value: JsonObject): void {
	const url = cleanUrl(value.url ?? value.source_website_url);
	if (!url || seen.has(url)) return;
	seen.add(url);
	const title = typeof value.title === "string"
		? value.title
		: typeof value.caption === "string"
			? value.caption
			: new URL(url).hostname;
	sources.push({ title, url });
}

function extractOutput(response: JsonObject): { answer: string; sources: SearchSource[] } {
	const answer: string[] = [];
	const sources: SearchSource[] = [];
	const seen = new Set<string>();

	for (const item of objects(response.output)) {
		if (item.type === "message") {
			for (const content of objects(item.content)) {
				answer.push(...strings(content.text));
				for (const annotation of objects(content.annotations)) {
					if (annotation.type === "url_citation") addSource(sources, seen, annotation);
				}
			}
		}
		if (item.type === "web_search_call") {
			const action = isObject(item.action) ? item.action : {};
			for (const source of [...objects(action.sources), ...objects(item.sources), ...objects(item.results)]) {
				addSource(sources, seen, source);
			}
		}
	}

	return { answer: answer.join("\n").trim(), sources };
}

function redact(text: string, secret: string): string {
	return secret ? text.split(secret).join("[REDACTED]") : text;
}

async function search(query: string, signal: AbortSignal | undefined, ctx: ExtensionContext) {
	const auth = await resolveCodexAuth(ctx);
	const body = {
		model: auth.model,
		instructions: "Search the web for the user's query. Give an accurate, concise answer grounded in the search results and cite the sources you used.",
		input: [{ role: "user", content: [{ type: "input_text", text: query }] }],
		tools: [{ type: "web_search" }],
		include: ["web_search_call.action.sources"],
		store: false,
		stream: true,
		tool_choice: "required",
	};

	try {
		const response = await fetch(CODEX_RESPONSES_URL, {
			method: "POST",
			headers: requestHeaders(auth),
			body: JSON.stringify(body),
			signal: signal
				? AbortSignal.any([signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)])
				: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
		});
		const raw = await response.text();
		if (!response.ok) {
			throw new Error(`OpenAI Codex web search failed (${response.status} ${response.statusText})`);
		}
		const parsed = parseResponse(raw);
		const result = extractOutput(parsed);
		if (!result.answer && !result.sources.length) {
			throw new Error("OpenAI Codex web search returned no answer or sources");
		}
		return { ...result, model: auth.model };
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		const message = redact(error.message, auth.apiKey);
		if (message === error.message) throw error;
		const safeError = new Error(message);
		safeError.name = error.name;
		throw safeError;
	}
}

function formatResult(answer: string, sources: SearchSource[]): string {
	if (!sources.length) return answer;
	const renderedSources = sources.map((source, index) => `${index + 1}. ${source.title}\n   ${source.url}`).join("\n");
	return `${answer}${answer ? "\n\n" : ""}Sources:\n${renderedSources}`;
}

export default function codexWebSearchExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description: "Search the live web using OpenAI Codex's native web_search capability. Returns a grounded answer and source URLs.",
		parameters: WebSearchParameters,
		async execute(_toolCallId, params: WebSearchInput, signal, _onUpdate, ctx) {
			const query = params.query.trim();
			if (!query) throw new Error("Web search query must not be empty");
			const result = await search(query, signal, ctx);
			return {
				content: [{ type: "text", text: formatResult(result.answer, result.sources) }],
				details: {
					query: params.query.trim(),
					model: result.model,
					sources: result.sources,
				},
			};
		},
	});
}
