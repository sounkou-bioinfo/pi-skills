export type ArgumentScalar = string | number | boolean;
export type ArgumentValue = ArgumentScalar | ArgumentScalar[];
export type Arguments = Record<string, ArgumentValue>;

export interface PreparedRequest {
	url: URL;
	method: "GET" | "POST";
	body?: unknown;
}

export interface OperationProfile {
	description: string;
	required?: string[];
	defaults?: Arguments;
	supportedArguments?: Record<string, string>;
	pagination?: "hal-next" | "europe-pmc-cursor";
	availability?: "live" | "retired";
	limitation?: string;
	validate?: (payload: unknown) => void;
	summarize?: (payloads: unknown[]) => unknown;
	prepare: (provider: ProviderProfile, args: Arguments) => PreparedRequest;
}

export interface ProviderProfile {
	label: string;
	baseUrl: string;
	documentationUrl: string;
	pathPrefix: string;
	minimumIntervalMs: number;
	requestTimeoutMs?: number;
	status?: "live" | "retired" | "development" | "undocumented";
	limitation?: string;
	validateArguments?: (args: Arguments) => void;
	operations: Record<string, OperationProfile>;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalar(value: ArgumentValue | undefined, name: string): ArgumentScalar {
	if (value === undefined || Array.isArray(value)) throw new Error(`Argument '${name}' must be a scalar`);
	return value;
}

function text(value: ArgumentValue | undefined, name: string): string {
	const result = String(scalar(value, name)).trim();
	if (!result) throw new Error(`Argument '${name}' must not be empty`);
	return result;
}

function integer(value: ArgumentValue | undefined, name: string): number {
	const result = Number(scalar(value, name));
	if (!Number.isSafeInteger(result) || result < 0) throw new Error(`Argument '${name}' must be a non-negative integer`);
	return result;
}

function boundedInteger(value: ArgumentValue | undefined, name: string, minimum: number, maximum: number): number {
	const result = integer(value, name);
	if (result < minimum || result > maximum) throw new Error(`Argument '${name}' must be between ${minimum} and ${maximum}`);
	return result;
}

function mergedArgs(operation: OperationProfile, args: Arguments): Arguments {
	const merged = { ...(operation.defaults ?? {}), ...args };
	for (const name of operation.required ?? []) {
		if (merged[name] === undefined) throw new Error(`Missing required argument '${name}'`);
	}
	return merged;
}

function addQuery(url: URL, name: string, value: ArgumentValue): void {
	for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(name, String(item));
}

function get(
	pathTemplate: string,
	description: string,
	options: Omit<OperationProfile, "description" | "prepare"> = {},
): OperationProfile {
	const operation: OperationProfile = {
		...options,
		description,
		prepare(provider, input) {
			const args = mergedArgs(operation, input);
			const consumed = new Set<string>();
			const path = pathTemplate.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, name: string) => {
				consumed.add(name);
				return encodeURIComponent(text(args[name], name));
			});
			const url = new URL(path, provider.baseUrl);
			for (const [name, value] of Object.entries(args).sort(([a], [b]) => a.localeCompare(b))) {
				if (!consumed.has(name)) addQuery(url, name, value);
			}
			return { url, method: "GET" };
		},
	};
	return operation;
}

function customGet(
	description: string,
	required: string[],
	build: (provider: ProviderProfile, args: Arguments) => URL,
	options: Omit<OperationProfile, "description" | "required" | "prepare"> = {},
): OperationProfile {
	const operation: OperationProfile = {
		...options,
		description,
		required,
		prepare(provider, input) {
			const args = mergedArgs(operation, input);
			return { url: build(provider, args), method: "GET" };
		},
	};
	return operation;
}

function graphql(
	description: string,
	required: string[],
	query: string,
	variables: (args: Arguments) => Record<string, unknown>,
	options: Omit<OperationProfile, "description" | "required" | "prepare"> = {},
): OperationProfile {
	const operation: OperationProfile = {
		...options,
		description,
		required,
		prepare(provider, input) {
			const args = mergedArgs(operation, input);
			return {
				url: new URL("graphql", provider.baseUrl),
				method: "POST",
				body: { query, variables: variables(args) },
			};
		},
	};
	return operation;
}

const PAGE_ARGUMENTS = {
	page: "Zero-based page index",
	size: "Records per page; GWAS Catalog v2 allows at most 500",
	sort: "Endpoint-specific sort field",
	direction: "Sort direction: asc or desc",
};

const ASSOCIATION_ARGUMENTS = {
	pubmed_id: "PubMed publication identifier",
	rs_id: "dbSNP rsID",
	full_pvalue_set: "Whether full summary statistics are available",
	accession_id: "GWAS Catalog study accession such as GCST000854",
	efo_trait: "Exact ontology trait label",
	efo_id: "Ontology term short form such as EFO_0001060 or MONDO_0005550",
	show_child_trait: "Include descendants of the requested ontology term",
	mapped_gene: "Mapped gene symbol",
	extended_geneset: "Include the broader legacy gene set",
	...PAGE_ARGUMENTS,
};

function associationSnpSummary(payloads: unknown[]): unknown {
	const snps = new Map<string, Set<string>>();
	let associationTotal: number | undefined;
	let associationsRetrieved = 0;
	let associationsWithoutRsid = 0;
	for (const payload of payloads) {
		if (!isObject(payload)) continue;
		if (associationTotal === undefined && isObject(payload.page) && typeof payload.page.totalElements === "number") {
			associationTotal = payload.page.totalElements;
		}
		const embedded = isObject(payload._embedded) ? payload._embedded : undefined;
		const associations = embedded && Array.isArray(embedded.associations) ? embedded.associations : [];
		for (const value of associations) {
			if (!isObject(value)) continue;
			associationsRetrieved += 1;
			const traits = new Set<string>();
			for (const trait of Array.isArray(value.efo_traits) ? value.efo_traits : []) {
				if (!isObject(trait)) continue;
				const label = typeof trait.efo_trait === "string" ? trait.efo_trait : undefined;
				const id = typeof trait.efo_id === "string" ? trait.efo_id : undefined;
				if (label || id) traits.add(label && id ? `${label} [${id}]` : (label ?? id)!);
			}
			const rsids = new Set<string>();
			for (const allele of Array.isArray(value.snp_allele) ? value.snp_allele : []) {
				if (isObject(allele) && typeof allele.rs_id === "string" && allele.rs_id.trim()) rsids.add(allele.rs_id.trim());
			}
			if (!rsids.size) associationsWithoutRsid += 1;
			for (const rsid of rsids) {
				const knownTraits = snps.get(rsid) ?? new Set<string>();
				for (const trait of traits) knownTraits.add(trait);
				snps.set(rsid, knownTraits);
			}
		}
	}
	return {
		association_total: associationTotal,
		associations_retrieved: associationsRetrieved,
		complete: associationTotal === undefined ? undefined : associationsRetrieved >= associationTotal,
		associations_without_rsid: associationsWithoutRsid,
		unique_snp_count: snps.size,
		snps: [...snps.entries()]
			.sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
			.map(([rs_id, traits]) => ({ rs_id, traits: [...traits].sort() })),
	};
}

const OPEN_TARGETS_SEARCH = `query Search($queryString: String!, $entityNames: [String!], $page: Pagination) {
  search(queryString: $queryString, entityNames: $entityNames, page: $page) {
    total
    hits { id name entity category description highlights score }
    aggregations { total entities { name total categories { name total } } }
  }
}`;

const OPEN_TARGETS_VARIANT = `query Variant($variantId: String!) {
  variant(variantId: $variantId) {
    id rsIds chromosome position referenceAllele alternateAllele variantDescription
    alleleFrequencies { populationName alleleFrequency }
    mostSevereConsequence { id label }
  }
}`;

const OPEN_TARGETS_CREDIBLE_SETS = `query CredibleSets($variantId: String!, $page: Pagination) {
  variant(variantId: $variantId) {
    id
    credibleSets(page: $page) {
      count
      rows {
        studyId studyLocusId beta pValueMantissa pValueExponent studyType finemappingMethod
        study { id traitFromSource }
        locus(variantIds: [$variantId], page: { index: 0, size: 1 }) {
          rows { posteriorProbability beta pValueMantissa pValueExponent is95CredibleSet is99CredibleSet }
        }
      }
    }
  }
}`;

function variantColon(args: Arguments, positionName = "pos"): string {
	return `${text(args.chr, "chr")}:${integer(args[positionName], positionName)}-${text(args.ref, "ref")}-${text(args.alt, "alt")}`;
}

function variantUnderscore(args: Arguments): string {
	return `${text(args.chr, "chr")}_${integer(args.pos, "pos")}_${text(args.ref, "ref")}_${text(args.alt, "alt")}`;
}

function coordinateGet(
	basePath: string,
	description: string,
	positionName = "pos",
	options: Omit<OperationProfile, "description" | "required" | "prepare"> = {},
): OperationProfile {
	return customGet(description, ["chr", positionName, "ref", "alt"], (provider, args) => {
		return new URL(`${basePath}${encodeURIComponent(variantColon(args, positionName))}`, provider.baseUrl);
	}, options);
}

function omicsPredOperations(): Record<string, OperationProfile> {
	const paths: Record<string, string> = {
		cohorts: "api/cohort/all",
		cohort: "api/cohort/{cohort}",
		samples: "api/sample/all",
		pathways: "api/pathway/all",
		pathway: "api/pathway/{pathway_id}",
		metabolite: "api/metabolite/{metabolite_id}",
		metabolite_search: "api/metabolite/search",
		protein: "api/protein/{protein_id}",
		protein_search: "api/protein/search",
		gene: "api/gene/{gene_id}",
		gene_search: "api/gene/search",
		metabolomics: "api/metabolomics/{platform}",
		proteomics: "api/proteomics/{platform}",
		transcriptomics: "api/transcriptomics/{platform}",
		performance_search: "api/performance/search",
		performance_by_trait: "api/performance/search/{type}/{molecular_trait}",
		publications: "api/publication/all",
		publication: "api/publication/{opp_id}",
		publication_search: "api/publication/search",
		score: "api/score/{opgs_id}",
		score_search: "api/score/search",
		score_by_trait: "api/score/search/{type}/{molecular_trait}",
		score_performance: "api/score/performance/{opgs_id}",
		platforms: "api/platform/all",
		platform: "api/platform/{platform}",
		datasets: "api/dataset/all",
		dataset: "api/dataset/{opd_id}",
		dataset_search: "api/dataset/search",
		tissues: "api/tissue/all",
		tissue: "api/tissue/{tissue_id}",
		phenotypes: "api/phenotype/all",
		phenotype: "api/phenotype/{phenotype_id}",
		score_phewas: "api/score/phewas/{opgs_id}",
		score_phewas_search: "api/score/phewas/search",
		info: "api/info",
		external_sources: "api/external_source/all",
	};
	return Object.fromEntries(Object.entries(paths).map(([name, path]) => [
		name,
		get(path, `OmicsPred ${name.replaceAll("_", " ")} endpoint`, {
			required: [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]),
		}),
	]));
}

const retiredEqtl: OperationProfile = {
	description: "Legacy eQTL Catalogue v3 rsID association lookup",
	required: ["rsid"],
	availability: "retired",
	limitation: "The EBI eQTL Catalogue v3 API now returns HTTP 410. Use the current eQTL Catalogue data-access downloads instead.",
	prepare() {
		throw new Error("eQTL Catalogue v3 API is retired; see https://www.ebi.ac.uk/eqtl/Data_access/");
	},
};

export const PROVIDERS: Record<string, ProviderProfile> = {
	gwas_catalog: {
		label: "GWAS Catalog REST API v2",
		baseUrl: "https://www.ebi.ac.uk/gwas/rest/api/v2/",
		documentationUrl: "https://www.ebi.ac.uk/gwas/rest/docs/api",
		pathPrefix: "/gwas/rest/api/v2/",
		minimumIntervalMs: 70,
		requestTimeoutMs: 120_000,
		validateArguments(args) {
			for (const name of Object.keys(args)) {
				if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`GWAS Catalog v2 argument '${name}' must use snake_case`);
			}
			if (args.page !== undefined && (Array.isArray(args.page) || !Number.isInteger(Number(args.page)) || Number(args.page) < 0)) {
				throw new Error("GWAS Catalog v2 page must be a non-negative integer");
			}
			if (args.size !== undefined && (Array.isArray(args.size) || !Number.isInteger(Number(args.size)) || Number(args.size) < 1 || Number(args.size) > 500)) {
				throw new Error("GWAS Catalog v2 size must be an integer between 1 and 500");
			}
		},
		operations: {
			associations: get("associations", "Search curated GWAS associations with validated v2 filters", {
				pagination: "hal-next",
				supportedArguments: ASSOCIATION_ARGUMENTS,
			}),
			association_snps: get("associations", "Search GWAS associations and return a compact deduplicated rsID/trait result", {
				pagination: "hal-next",
				supportedArguments: ASSOCIATION_ARGUMENTS,
				summarize: associationSnpSummary,
			}),
			studies: get("studies", "Search curated GWAS studies with validated v2 filters", {
				pagination: "hal-next",
				supportedArguments: {
					pubmed_id: "PubMed publication identifier",
					disease_trait: "Free-text reported disease trait",
					full_pvalue_set: "Whether full summary statistics are available",
					efo_id: "Ontology term short form",
					efo_trait: "Exact ontology trait label",
					accession_id: "GWAS Catalog study accession",
					cohort: "Discovery-stage cohort",
					gxe: "Whether the study investigates gene-environment interaction",
					ancestral_group: "Ancestry category group",
					no_of_individuals: "Number of individuals",
					show_child_trait: "Include descendants of the ontology term",
					mapped_gene: "Mapped gene symbol",
					extended_geneset: "Include the broader legacy gene set",
					...PAGE_ARGUMENTS,
				},
			}),
			variants: get("single-nucleotide-polymorphisms", "Search GWAS variants", {
				pagination: "hal-next",
				supportedArguments: {
					rs_id: "dbSNP rsID",
					bp_location: "Base-pair location",
					bp_start: "Range start used with bp_end and chromosome",
					bp_end: "Range end used with bp_start and chromosome",
					pubmed_id: "PubMed publication identifier",
					chromosome: "Chromosome",
					mapped_gene: "Mapped gene symbol",
					extended_geneset: "Include the broader legacy gene set",
					...PAGE_ARGUMENTS,
				},
			}),
			publications: get("publications", "Search GWAS publications", {
				pagination: "hal-next",
				supportedArguments: {
					pubmed_id: "PubMed publication identifier",
					title: "Publication title",
					first_author: "First author surname and initials",
					...PAGE_ARGUMENTS,
				},
			}),
			genes: get("genes", "List GWAS genes", {
				pagination: "hal-next",
				supportedArguments: { page: PAGE_ARGUMENTS.page, size: PAGE_ARGUMENTS.size, sort: "Sort as property,(asc|desc)" },
			}),
			ancestries: get("ancestries", "List GWAS ancestry resources", { pagination: "hal-next", supportedArguments: {} }),
			efo_traits: get("efo-traits", "Search ontology-mapped GWAS traits", {
				pagination: "hal-next",
				supportedArguments: {
					efo_trait: "Exact ontology trait label",
					uri: "Full ontology term URI",
					efo_id: "Ontology term short form",
					pubmed_id: "PubMed publication identifier",
					mapped_gene: "Mapped gene symbol",
					extended_geneset: "Include the broader legacy gene set",
					...PAGE_ARGUMENTS,
				},
			}),
			study_ancestries: get("studies/{accession_id}/ancestries", "Retrieve ancestries for one GWAS study", { required: ["accession_id"], pagination: "hal-next" }),
		},
	},
	open_targets: {
		label: "Open Targets Platform GraphQL v4",
		baseUrl: "https://api.platform.opentargets.org/api/v4/",
		documentationUrl: "https://api.platform.opentargets.org/api/v4/graphql/schema",
		pathPrefix: "/api/v4/",
		minimumIntervalMs: 100,
		operations: {
			search: graphql("Full-text search across targets, diseases, drugs, variants, and studies", ["query"], OPEN_TARGETS_SEARCH, (args) => ({
				queryString: text(args.query, "query"),
				entityNames: args.entity_names === undefined ? undefined : (Array.isArray(args.entity_names) ? args.entity_names : [args.entity_names]).map(String),
				page: { index: integer(args.page_index ?? 0, "page_index"), size: boundedInteger(args.page_size ?? 25, "page_size", 1, 3_000) },
			})),
			variant: graphql("Retrieve one variant with current v4 alleles, rsIDs, consequence, and population-frequency annotations", ["chr", "pos", "ref", "alt"], OPEN_TARGETS_VARIANT, (args) => ({ variantId: variantUnderscore(args) })),
			credible_sets: graphql("Retrieve credible-set memberships for one variant", ["chr", "pos", "ref", "alt"], OPEN_TARGETS_CREDIBLE_SETS, (args) => ({
				variantId: variantUnderscore(args),
				page: { index: integer(args.page_index ?? 0, "page_index"), size: boundedInteger(args.page_size ?? 25, "page_size", 1, 3_000) },
			})),
		},
	},
	gpmap: {
		label: "Genotype-Phenotype Map API used by gpmapr",
		baseUrl: "https://gpmap.opengwas.io/api/",
		documentationUrl: "https://github.com/MRCIEU/gpmapr",
		pathPrefix: "/api/",
		minimumIntervalMs: 100,
		limitation: "This tool covers read-only JSON metadata. Use gpmapr for uploads and downloaded ZIP/TSV summary-statistics workflows.",
		operations: {
			health: get("health", "Check gpmap service health"),
			version: get("v1/info/version", "Retrieve gpmap API version"),
			search_options: get("v1/search/options", "Retrieve gpmap search options"),
			search_variant: get("v1/search/variant/{query}", "Resolve a variant query", { required: ["query"], defaults: { rsquared_threshold: 0.8 } }),
			traits: get("v1/traits", "List or filter traits"),
			trait: get("v1/traits/{trait_id}", "Retrieve one trait", { required: ["trait_id"], defaults: { include_associations: false } }),
			trait_coloc_pairs: get("v1/traits/{trait_id}/coloc-pairs", "Retrieve trait colocalisation pairs", { required: ["trait_id"], defaults: { h4_threshold: 0.8 } }),
			trait_associations_full: get("v1/traits/{trait_id}/associations-full", "Retrieve full trait associations", { required: ["trait_id"] }),
			genes: get("v1/genes", "List or filter genes"),
			gene: get("v1/genes/{gene_id}", "Retrieve one gene", { required: ["gene_id"], defaults: { include_associations: false, include_coloc_pairs: false, include_trans: true, h4_threshold: 0.8 } }),
			region: get("v1/regions/{region_id}", "Retrieve one region", { required: ["region_id"], defaults: { include_associations: false, include_coloc_pairs: false, h4_threshold: 0.8 } }),
			variants: get("v1/variants", "Retrieve variants by IDs, rsIDs, or strings", { required: ["variants"], defaults: { expand: false, include_associations: false, include_coloc_pairs: false, h4_threshold: 0.8 } }),
			variants_region: customGet("Retrieve variants in a genomic range", ["chr", "start", "stop"], (provider, args) => {
				const url = new URL("v1/variants", provider.baseUrl);
				url.searchParams.set("grange", `${text(args.chr, "chr")}:${integer(args.start, "start")}-${integer(args.stop, "stop")}`);
				for (const [name, value] of Object.entries({ include_associations: args.include_associations ?? false, include_coloc_pairs: args.include_coloc_pairs ?? false, h4_threshold: args.h4_threshold ?? 0.8 })) addQuery(url, name, value);
				return url;
			}),
			variant: get("v1/variants/{variant_id}", "Retrieve one gpmap variant", { required: ["variant_id"], defaults: { include_coloc_pairs: false, h4_threshold: 0.8 } }),
			ld_proxies: get("v1/ld/proxies", "Retrieve LD proxies by variants or variant_ids"),
			ld_matrix: get("v1/ld/matrix", "Retrieve an LD matrix by variants or variant_ids"),
			associations: get("v1/associations", "Retrieve associations by variant_ids and study_ids", { required: ["variant_ids", "study_ids"] }),
			gene_pleiotropies: get("v1/pleiotropy/genes", "Retrieve gene pleiotropy results"),
			variant_pleiotropies: get("v1/pleiotropy/snps", "Retrieve variant pleiotropy results"),
			gwas: get("v1/gwas/{gwas_id}", "Retrieve uploaded GWAS metadata", { required: ["gwas_id"] }),
			gwas_summary_stats_url: get("v1/gwas/{gwas_id}/summary-stats", "Retrieve the signed summary-statistics download URL", { required: ["gwas_id"], limitation: "Returns a download locator only; the bounded JSON tool does not fetch the archive." }),
		},
	},
	omicspred: {
		label: "OmicsPred REST API",
		baseUrl: "https://rest.omicspred.org/",
		documentationUrl: "https://rest.omicspred.org/static/rest_api/openapi/openapi-schema.yml",
		pathPrefix: "/api/",
		minimumIntervalMs: 150,
		operations: omicsPredOperations(),
	},
	europe_pmc: {
		label: "Europe PMC REST literature search",
		baseUrl: "https://www.ebi.ac.uk/europepmc/webservices/rest/",
		documentationUrl: "https://europepmc.org/RestfulWebService",
		pathPrefix: "/europepmc/webservices/rest/",
		minimumIntervalMs: 150,
		operations: {
			search: get("search", "Search biomedical literature in Europe PMC", {
				required: ["query"],
				defaults: { format: "json", resultType: "core", pageSize: 25 },
				pagination: "europe-pmc-cursor",
				limitation: "Search snippets and highlighting depend on Europe PMC response fields; do not substitute LitVar2 web-only snippets.",
				validate(payload) {
					if (typeof payload !== "object" || payload === null || !("resultList" in payload)) {
						throw new Error("Europe PMC returned no resultList search contract");
					}
				},
			}),
		},
	},
	litvar2: {
		label: "NCBI LitVar2 API",
		baseUrl: "https://www.ncbi.nlm.nih.gov/research/litvar2-api/",
		documentationUrl: "https://www.ncbi.nlm.nih.gov/research/litvar2/api",
		pathPrefix: "/research/litvar2-api/",
		minimumIntervalMs: 350,
		limitation: "The public API returns variant metadata and publication identifiers, not LitVar snippets. Snippets are shown only in the LitVar2 web interface; do not claim API snippet evidence.",
		operations: {
			variant_summary: get("variant/get/{variant_id}", "Retrieve LitVar2 variant metadata", { required: ["variant_id"] }),
			autocomplete: get("variant/autocomplete/", "Find variants matching text", { required: ["query"], limitation: "The documented limit is at most 100." }),
			variant_publications: get("variant/get/{variant_id}/publications", "Retrieve PMIDs and PMCIDs mentioning a variant", { required: ["variant_id"], limitation: "Publication identifiers are returned; snippets remain web-interface-only." }),
			sensor: get("sensor/{rsid}", "Return the LitVar2 web link and publication count for an rsID", { required: ["rsid"] }),
			gene_variants: get("variant/search/gene/{gene}", "Retrieve LitVar2 variants for one gene", { required: ["gene"] }),
		},
	},
	ensembl: {
		label: "Ensembl REST API",
		baseUrl: "https://rest.ensembl.org/",
		documentationUrl: "https://rest.ensembl.org/documentation",
		pathPrefix: "/",
		minimumIntervalMs: 100,
		operations: {
			variation: get("variation/human/{rsid}", "Retrieve Ensembl variation mappings and frequencies", { required: ["rsid"] }),
			vep: get("vep/human/id/{rsid}", "Run Ensembl VEP lookup by rsID", { required: ["rsid"] }),
		},
	},
	eqtl_catalogue: {
		label: "eQTL Catalogue legacy REST API v3",
		baseUrl: "https://www.ebi.ac.uk/eqtl/api/v3/",
		documentationUrl: "https://www.ebi.ac.uk/eqtl/Data_access/",
		pathPrefix: "/eqtl/api/v3/",
		minimumIntervalMs: 350,
		status: "retired",
		limitation: retiredEqtl.limitation,
		operations: { associations: retiredEqtl },
	},
	finngen_r12: {
		label: "FinnGen release 12 PheWAS",
		baseUrl: "https://r12.finngen.fi/",
		documentationUrl: "https://r12.finngen.fi/",
		pathPrefix: "/api/",
		minimumIntervalMs: 500,
		status: "undocumented",
		limitation: "The port constructs FinnGen r12 variant requests from explicit GRCh38 coordinates.",
		operations: { phewas: coordinateGet("api/variant/", "Retrieve FinnGen r12 PheWAS results for a GRCh38 variant") },
	},
	gtex_v8: {
		label: "GTEx Portal v8 eQTL API",
		baseUrl: "https://gtexportal.org/api/v2/",
		documentationUrl: "https://gtexportal.org/api/v2/redoc",
		pathPrefix: "/api/v2/",
		minimumIntervalMs: 500,
		operations: {
			eqtls: customGet("Retrieve GTEx v8 single-tissue eQTL associations for a GRCh38 variant", ["chr", "pos", "ref", "alt"], (provider, args) => {
				const url = new URL("association/singleTissueEqtl", provider.baseUrl);
				url.searchParams.set("variantId", `chr${variantUnderscore(args)}_b38`);
				url.searchParams.set("datasetId", text(args.dataset_id ?? "gtex_v8", "dataset_id"));
				return url;
			}),
		},
	},
	pheweb_ukb: {
		label: "UKB-TOPMed PheWeb",
		baseUrl: "https://pheweb.org/UKB-TOPMed/",
		documentationUrl: "https://pheweb.org/UKB-TOPMed/",
		pathPrefix: "/UKB-TOPMed/api/",
		minimumIntervalMs: 500,
		status: "undocumented",
		limitation: "Supply the GRCh38 coordinate resolved for the variant and verify the assembly against the PheWeb deployment before interpretation.",
		operations: { phewas: coordinateGet("api/variant/", "Retrieve UKB-TOPMed PheWAS results for a variant") },
	},
	pheweb_bbj: {
		label: "Biobank Japan PheWeb",
		baseUrl: "https://pheweb.jp/",
		documentationUrl: "https://pheweb.jp/",
		pathPrefix: "/api/",
		minimumIntervalMs: 500,
		status: "undocumented",
		limitation: "Biobank Japan PheWeb variant positions must be GRCh37 coordinates.",
		operations: { phewas: coordinateGet("api/variant/", "Retrieve Biobank Japan PheWAS results for a GRCh37 variant", "pos_grch37") },
	},
	portaldev: {
		label: "Michigan portal development omnisearch",
		baseUrl: "https://portaldev.sph.umich.edu/api/v1/",
		documentationUrl: "https://portaldev.sph.umich.edu/api/v1/",
		pathPrefix: "/api/v1/",
		minimumIntervalMs: 500,
		status: "development",
		limitation: "This is a development host ported for rsID resolution; availability and response shape are not stable contracts.",
		operations: {
			resolve_rsid: customGet("Resolve an rsID to a coordinate", ["rsid"], (provider, args) => {
				const url = new URL("annotation/omnisearch/", provider.baseUrl);
				url.searchParams.set("q", text(args.rsid, "rsid"));
				url.searchParams.set("build", text(args.build ?? "GRCh38", "build"));
				return url;
			}),
		},
	},
};

export function prepareOperation(providerName: string, operationName: string, args: Arguments): { provider: ProviderProfile; operation: OperationProfile; request: PreparedRequest } {
	const provider = PROVIDERS[providerName];
	if (!provider) throw new Error(`Unknown biomedical provider '${providerName}'`);
	const operation = provider.operations[operationName];
	if (!operation) throw new Error(`Unknown operation '${operationName}' for provider '${providerName}'`);
	provider.validateArguments?.(args);
	if (operation.supportedArguments) {
		const allowed = new Set([...Object.keys(operation.supportedArguments), ...(operation.required ?? [])]);
		const unknown = Object.keys(args).filter((name) => !allowed.has(name));
		if (unknown.length) {
			throw new Error(`Unsupported argument(s) for ${providerName}/${operationName}: ${unknown.join(", ")}. Supported arguments: ${[...allowed].sort().join(", ") || "none"}`);
		}
	}
	if (provider.status === "retired" || operation.availability === "retired") {
		throw new Error(operation.limitation ?? provider.limitation ?? `${provider.label} is retired`);
	}
	const request = operation.prepare(provider, args);
	return { provider, operation, request };
}
