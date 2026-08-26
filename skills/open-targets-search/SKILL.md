---
name: open-targets-search
description: Search the Open Targets Platform v4 GraphQL API for targets, diseases, drugs, variants, and studies with schema-grounded identifiers and pagination. Use when biomedical entity discovery or Open Targets evidence is needed.
---

# Open Targets search

## Authority and scope

Use the `open_targets_search` extension as the factual authority for live Open Targets Platform search results. It sends a fixed GraphQL search operation to:

- API: `https://api.platform.opentargets.org/api/v4/graphql`
- Schema: `https://api.platform.opentargets.org/api/v4/graphql/schema`

The extension uses GraphQL variables for user input, returns ranked hits and aggregations, and includes both URLs as evidence. The schema endpoint is the authority for field names and types; do not invent fields or silently substitute a different API version.

Open Targets is an evidence-integration platform, not the GWAS Catalog. A search hit or association score is not by itself a clinical recommendation or a GWAS Catalog record.

## Search contract

Search free text across all supported entities:

```json
{
  "query": "BRCA1",
  "entity_names": ["target"],
  "page_index": 0,
  "page_size": 25
}
```

Supported entity names include `target`, `disease`, `drug`, `variant`, and `study` where supported by the current deployment. Omit `entity_names` for a cross-entity search. Results contain an entity ID, display name, entity/category, description, highlights, and relevance score. Use `page_index` as zero-based and keep `page_size` within the documented schema bound (the current schema allows up to 3000).

Prefer canonical IDs for follow-up API queries:

- targets: Ensembl IDs such as `ENSG00000139618`;
- diseases: EFO or other Platform disease IDs such as `EFO_0000400`;
- drugs: ChEMBL IDs such as `CHEMBL112`;
- variants: `CHROM_POS_REF_ALT` identifiers such as `19_44908684_T_C`;
- studies: Platform study IDs such as `GCST004131`.

The v4 schema also exposes direct lookup and domain queries such as `target`, `targets`, `disease`, `diseases`, `drug`, `drugs`, `variant`, `study`, `studies`, `credibleSets`, `mapIds`, `facets`, and `associationDatasources`. This extension intentionally exposes the bounded full-text `search` surface; use the schema as the contract before adding another operation.

## Interpretation and evidence

Report the exact query, entity filter, page, total, whether more pages exist, and source URLs. Distinguish no hits from a failed GraphQL request. Preserve IDs exactly; do not convert a fuzzy label match into a canonical identity without a returned ID or a separate schema-supported lookup.

For ontology-aware study searches, use the Platform's disease identifiers and the `enableIndirect` behavior on the schema-supported `studies` query. This search tool does not claim ontology expansion merely because a text query matched.

## Related APIs and boundaries

For GWAS Catalog literature-curated associations, use the separate `gwas_catalog_search` tool and its v2 skill. Open Targets `studies` and GWAS Catalog studies have different schemas, identifiers, release processes, and evidence semantics. Neither endpoint replaces access to the full summary-statistics collection.

Treat API errors, schema drift, partial upstream availability, and missing fields as evidence gaps. The extension bounds response size and request duration; retry or re-run deliberately rather than guessing from stale results.
