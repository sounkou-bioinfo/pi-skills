import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { PROVIDERS, prepareOperation, type ArgumentValue, type Arguments } from "./catalog.js";
import { BiomedicalHttpClient, RESPONSE_BUDGET_BYTES } from "./http.js";

const ArgumentScalar = Type.Union([Type.String(), Type.Number(), Type.Boolean()]);
const RequestParameters = Type.Object({
	provider: Type.String({ minLength: 1, description: "Provider id returned by action=list" }),
	operation: Type.String({ minLength: 1, description: "Operation id returned by action=describe" }),
	arguments: Type.Optional(Type.Record(Type.String(), Type.Union([ArgumentScalar, Type.Array(ArgumentScalar)]))),
	max_pages: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, default: 1, description: "Bounded pages to follow when the operation supports pagination" })),
});

const BiomedicalEvidenceParameters = Type.Object({
	action: Type.Union([Type.Literal("list"), Type.Literal("describe"), Type.Literal("call")], {
		description: "List providers, describe one provider, or call one or more fixed operations",
	}),
	provider: Type.Optional(Type.String({ minLength: 1, description: "Provider to describe when action=describe" })),
	max_pages: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Default max_pages for requests that do not set their own value" })),
	requests: Type.Optional(Type.Array(RequestParameters, {
		minItems: 1,
		maxItems: 12,
		description: "One or more bounded provider operations when action=call",
	})),
});

type BiomedicalEvidenceInput = Static<typeof BiomedicalEvidenceParameters>;
type RequestInput = NonNullable<BiomedicalEvidenceInput["requests"]>[number];

function listProviders() {
	return Object.entries(PROVIDERS).map(([id, provider]) => ({
		id,
		label: provider.label,
		status: provider.status ?? "live",
		operation_count: Object.keys(provider.operations).length,
		minimum_interval_ms: provider.minimumIntervalMs,
		documentation_url: provider.documentationUrl,
		limitation: provider.limitation,
	}));
}

function describeProvider(name: string | undefined) {
	if (!name) throw new Error("action=describe requires provider");
	const provider = PROVIDERS[name];
	if (!provider) throw new Error(`Unknown biomedical provider '${name}'`);
	return {
		id: name,
		label: provider.label,
		status: provider.status ?? "live",
		base_url: provider.baseUrl,
		api_path: provider.pathPrefix,
		minimum_interval_ms: provider.minimumIntervalMs,
		request_timeout_ms: provider.requestTimeoutMs ?? 30_000,
		documentation_url: provider.documentationUrl,
		limitation: provider.limitation,
		operations: Object.entries(provider.operations).map(([id, operation]) => ({
			id,
			description: operation.description,
			availability: operation.availability ?? "live",
			required_arguments: operation.required ?? [],
			default_arguments: operation.defaults,
			supported_arguments: operation.supportedArguments,
			pagination: operation.pagination,
			limitation: operation.limitation,
		})),
	};
}

function validateArguments(args: Record<string, ArgumentValue> | undefined): Arguments {
	const result: Arguments = {};
	for (const [name, value] of Object.entries(args ?? {})) {
		if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(name)) throw new Error(`Invalid biomedical argument name '${name}'`);
		const values = Array.isArray(value) ? value : [value];
		if (!values.length) throw new Error(`Biomedical argument '${name}' must not be an empty array`);
		for (const item of values) {
			if (typeof item === "number" && !Number.isFinite(item)) throw new Error(`Biomedical argument '${name}' must contain finite numbers`);
		}
		result[name] = value;
	}
	return result;
}

function prepareCall(input: RequestInput, inheritedMaxPages: number | undefined) {
	const args = validateArguments(input.arguments as Record<string, ArgumentValue> | undefined);
	const prepared = prepareOperation(input.provider.trim(), input.operation.trim(), args);
	return {
		providerId: input.provider.trim(),
		operationId: input.operation.trim(),
		maxPages: input.max_pages ?? inheritedMaxPages ?? 1,
		...prepared,
	};
}

function textResult(value: unknown): { content: Array<{ type: "text"; text: string }>; details: unknown } {
	return {
		content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
		details: value,
	};
}

export default function biomedicalEvidenceExtension(pi: ExtensionAPI): void {
	const client = new BiomedicalHttpClient();

	pi.registerTool({
		name: "biomedical_search",
		label: "Biomedical Evidence Search",
		description: "List, describe, and query biomedical evidence resources through one bounded read-only HTTP abstraction. Includes GWAS Catalog, Open Targets, gpmap, OmicsPred, Europe PMC, LitVar2, Ensembl, GTEx, FinnGen, and PheWeb.",
		parameters: BiomedicalEvidenceParameters,
		async execute(_toolCallId, params: BiomedicalEvidenceInput, signal) {
			if (params.action === "list") return textResult({ providers: listProviders() });
			if (params.action === "describe") return textResult(describeProvider(params.provider?.trim()));
			if (!params.requests?.length) throw new Error("action=call requires at least one request");

			const calls = params.requests.map((request) => prepareCall(request, params.max_pages));
			const batchBudget = { used: 0, limit: RESPONSE_BUDGET_BYTES };
			const results = await Promise.all(calls.map(async (call) => {
				const common = {
					provider: call.providerId,
					operation: call.operationId,
					documentation_url: call.provider.documentationUrl,
					limitation: call.operation.limitation ?? call.provider.limitation,
				};
				try {
					const pages = await client.fetchPages(call.provider, call.operation, call.request, call.maxPages, signal, batchBudget);
					const summary = call.operation.summarize?.(pages.map((page) => page.payload));
					return {
						...common,
						status: "ok",
						pages_fetched: pages.length,
						source_urls: pages.map((page) => page.url),
						...(summary === undefined
							? { pages: pages.map(({ url, payload }) => ({ url, payload })) }
							: { result: summary }),
					};
				} catch (error) {
					return {
						...common,
						status: "error",
						error: error instanceof Error ? error.message : String(error),
					};
				}
			}));
			return textResult({ results });
		},
	});
}
