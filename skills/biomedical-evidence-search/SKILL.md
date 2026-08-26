---
name: biomedical-evidence-search
description: Search biomedical evidence resources through one bounded tool, including GWAS Catalog, Open Targets, gpmap/gpmapr, OmicsPred, Europe PMC, LitVar2, Ensembl, GTEx, FinnGen, and PheWeb. Use for variant, gene, trait, study, score, PheWAS, eQTL, or literature lookups.
---

# Biomedical evidence search

## One routing authority

Use the single `biomedical_search` tool. Do not create another provider-specific skill, extension, HTTP helper, or response schema for each new source.

The tool has three actions:

1. `list` discovers admitted providers and their status;
2. `describe` returns one provider's operations, required/default arguments, documentation, pagination, and limitations;
3. `call` executes 1–12 fixed read-only operations and returns raw upstream payloads with source URLs.

```json
{"action":"list"}
```

```json
{"action":"describe","provider":"europe_pmc"}
```

```json
{
  "action": "call",
  "requests": [
    {"provider":"ensembl","operation":"variation","arguments":{"rsid":"rs3798220"}},
    {"provider":"gtex_v8","operation":"eqtls","arguments":{"chr":"6","pos":160540105,"ref":"T","alt":"C"}}
  ]
}
```

Provider profiles are the semantic authority for endpoint mapping, method, argument-to-path/query mapping, pagination, and known limitations. The shared HTTP client owns timeout, JSON admission, bounded responses, source receipts, per-origin serialization, minimum request spacing, `Retry-After`, and capped exponential backoff for 429/502/503/504 responses. Profiles are routing metadata, not a network sandbox: the host's fetch/network policy is authoritative and may allow or restrict access. This follows pi-bio-agent's resource-profile approach without duplicating its manifest/ledger substrate.

## Routing workflow

1. Identify the question axis: canonical entity, curated GWAS association, integrated target evidence, genotype–phenotype map, molecular score, PheWAS/eQTL, or literature.
2. Call `list` or `describe` instead of guessing operation names.
3. Resolve identifiers and assembly before coordinate-based fan-out. Preserve rsIDs and canonical IDs exactly.
4. Batch independent admitted calls in one `call`; partial provider failures remain explicit per-provider results.
5. Follow pages only when needed and bound `max_pages` (1–20).
6. Summarize only returned payloads. Report provider, operation, arguments, pages, limitations, and source URLs.

Raw upstream JSON is retained deliberately. Do not normalize heterogeneous association scores, p-values, beta directions, evidence classes, or identifiers into a false common schema.

## Resource choice

- **GWAS Catalog v2:** literature-curated top associations, studies, variants, traits, publications, genes, and ancestries. Use snake_case filters, explicit `show_child_traits`, and explicit `extended_geneset` when reproducing legacy gene behavior.
- **Open Targets v4:** cross-entity search, variant annotations, and credible-set context. An integrated association score is not a GWAS Catalog record or a clinical recommendation.
- **gpmap/gpmapr:** genotype–phenotype map traits, genes, regions, variants, LD, pleiotropy, and uploaded GWAS metadata. Use the R package for uploads and archive/TSV workflows.
- **OmicsPred:** molecular prediction scores, performance, PheWAS, cohorts, platforms, datasets, publications, and molecular entities. Its OpenAPI schema is the field/parameter authority.
- **Europe PMC:** general biomedical literature search with cursor pagination.
- **LitVar2:** variant metadata and publication identifiers. Public API responses do **not** expose the evidence snippets shown in the web interface.
- **Ensembl:** rsID mappings and VEP annotations.
- **GTEx/FinnGen/PheWeb:** source-specific eQTL/PheWAS lookups with explicit assembly conventions.
- **eQTL Catalogue v3:** retained only as a retired port; the live endpoint returns HTTP 410, so use current data-access downloads.

Load [references/resources.md](references/resources.md) for provider-specific contracts and [references/gpmapr.md](references/gpmapr.md) for R package workflows. Load [references/upstream-port.md](references/upstream-port.md) only when checking compatibility or provenance for imported client behavior.

## Literature and snippet boundary

Use Europe PMC for literature discovery and LitVar2 for variant-to-publication indexing. LitVar2's documented API can return variant summaries, autocomplete results, PMIDs/PMCIDs, sensor links, and variants for a gene. It cannot substantiate a quote or snippet because those snippets are available only through the LitVar2 web interface. Link the returned sensor/web page and state that a human-visible snippet requires web-interface inspection; never fabricate or attribute a snippet to the API.

## Answer contract

Return concise result rows plus:

- provider and operation;
- exact identifiers/coordinates and assembly;
- pagination extent;
- source and documentation URLs;
- provider limitations, retired/development status, and failed calls;
- an abstention where missing evidence would otherwise require guessing.

For clinical or high-stakes interpretations, API evidence supports retrieval, not diagnosis or treatment advice.
