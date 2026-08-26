# Biomedical provider contracts

Always call `biomedical_search` with `action=describe` for the current executable operation list. This reference records semantic boundaries that should remain visible in answers.

| Provider | Main role | Identifier/assembly contract | Important limitation |
|---|---|---|---|
| `gwas_catalog` | Curated GWAS studies and top associations | rsID, GCST accession, ontology IDs; endpoint-specific v2 filters | v2 response model; not the full summary-statistics collection |
| `open_targets` | Integrated target/disease/drug/variant/study evidence | Ensembl, EFO, ChEMBL, `CHROM_POS_REF_ALT`, study IDs | Integrated scores are source-specific evidence aggregation |
| `gpmap` | Genotype–phenotype map | gpmap trait/gene/region/variant/GWAS IDs | Tool is read-only JSON; use gpmapr for upload and archive workflows |
| `omicspred` | Omics-based predictors and scores | OPGS/OPP/OPD and API entity IDs | OpenAPI 1.2.1 schema controls parameters and pagination |
| `europe_pmc` | Biomedical literature search | Europe PMC/PubMed query syntax and publication IDs | Cursor pagination; search result text is not LitVar snippet evidence |
| `litvar2` | Variant literature index | LitVar IDs such as `litvar@rs...##`, rsIDs, genes | API publication endpoint returns IDs, not web-interface snippets |
| `ensembl` | Variation mapping and VEP | rsID; report returned assembly | Mapping and consequence records may have multiple alleles/transcripts |
| `gtex_v8` | Single-tissue eQTL | GRCh38 `chr_POS_REF_ALT_b38` | Dataset fixed to GTEx v8 unless explicitly overridden |
| `finngen_r12` | FinnGen PheWAS | GRCh38 `CHR:POS-REF-ALT` | Release-specific, large and undocumented response surface |
| `pheweb_ukb` | UKB-TOPMed PheWAS | provider variant coordinate | Undocumented PheWeb API; null is a valid no-record payload |
| `pheweb_bbj` | Biobank Japan PheWAS | **GRCh37** `CHR:POS-REF-ALT` | Never send an unconverted GRCh38 position |
| `portaldev` | rsID coordinate resolution | rsID plus build | Development host; not a stable production contract |
| `eqtl_catalogue` | Legacy eQTL v3 port | rsID | Retired: HTTP 410; current access is via downloads |

## GWAS Catalog v2

Use filters directly on resources rather than v1 `search/findBy...` paths. Parameters use snake_case and are enumerated by `action=describe`; unsupported filters are rejected because GWAS v2 can silently ignore unknown query names. For ontology traits, select the live OpenAPI parameter `show_child_trait=true` or `false` deliberately and prefer an ontology ID for precise retrieval. For gene searches, v2's default set differs from legacy v1; use `extended_geneset=true` only when that broader behavior is intended.

The shared client follows API-provided HAL next links only up to `max_pages`; the host remains responsible for network admission. The documented 15-query-per-second limit is reflected by per-origin serialization and 70 ms minimum spacing.

## OmicsPred

Schema authority:

`https://rest.omicspred.org/static/rest_api/openapi/openapi-schema.yml`

The profile mirrors all GET paths in schema version 1.2.1: cohorts, samples, pathways, metabolites, proteins, genes, omics platforms, score/performance/PheWAS searches, publications, platforms, datasets, tissues, phenotypes, info, and external sources. Pass path parameters named by `describe`; remaining scalar/array arguments become query parameters and remain subject to OpenAPI validation upstream.

## Literature

Europe PMC search defaults to JSON, `resultType=core`, and 25 rows. Raise `max_pages` deliberately; cursor marks are taken only from the API response. A 200 response containing only an API version and no `resultList` is rejected as an incomplete search contract rather than reported as an empty literature result.

LitVar2's public API surface is documented by its web API page and currently includes variant summary, autocomplete (documented maximum 100), variant publication IDs, sensor links, and variants by gene. Publication snippets rendered by the Angular web application are not present in the documented API response. The source boundary is intentional.

## Port status

The legacy eQTL Catalogue v3 client no longer has a live service; retaining a callable facade that silently returns empty data would be false compatibility. The profile is discoverable but fails closed with the current EBI data-access URL.

FinnGen, GTEx, PheWeb, Ensembl, and the Michigan resolver preserve the upstream request contracts, but this tool returns bounded raw JSON rather than a hand-normalized cross-provider schema. This avoids implying stable common fields across independently versioned services.
