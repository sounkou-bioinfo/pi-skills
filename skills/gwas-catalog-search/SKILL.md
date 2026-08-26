---
name: gwas-catalog-search
description: Query and migrate workflows to the GWAS Catalog REST API v2 with ontology-aware trait filters, gene-set semantics, bounded pagination, and source URLs. Use when searching curated GWAS Catalog studies, associations, variants, publications, genes, or ancestries.
---

# GWAS Catalog search

## Authority and scope

Use the `gwas_catalog_search` extension as the factual authority for live Catalog records. It queries the fixed EBI host at `/gwas/rest/api/v2/`, returns the API payload without inventing a second schema, and includes every fetched request URL. Do not answer a Catalog lookup from model memory when the tool is available.

The API covers the literature-curated Catalog and its associated metadata. It is not an API for the complete genome-wide summary-statistics collection.

## v2 request model

Start with the resource, then put criteria in `filters`:

```json
{
  "endpoint": "associations",
  "filters": {"rs_id": "rs123"},
  "size": 20,
  "max_pages": 1
}
```

Useful v2 resource paths include `studies`, `associations`, `publications`, `genes`, `ancestries`, `efo-traits`, and the documented single-nucleotide-polymorphism and genomic-context resources. Study ancestry details can be queried with a documented path such as `studies/GCST.../ancestries`. Use the API's OpenAPI reference for resource-specific filters; unknown filters are passed through, but must be snake_case.

Common study filters include `pubmed_id`, `disease_trait`, `efo_trait`, `efo_id`, `accession_id`, `cohort`, `ancestral_group`, and `mapped_gene`. Association and variant filters can include `rs_id`, genomic location, `pubmed_id`, chromosome, and `mapped_gene` where supported by the selected endpoint.

Use an ontology identifier such as `MONDO_0004979` when precision matters. Decide explicitly whether descendants should be included with `show_child_traits=false` or `show_child_traits=true`.

For gene searches, v2 defaults to the web-interface gene set. If reproducing v1 gene-query behaviour is required, pass `extended_geneset=true` on endpoints that support it. Record that choice in the answer because it can change the result set.

## v1 migration

Replace:

- `/gwas/rest/api/...` with the corresponding `/gwas/rest/api/v2/...` resource;
- `/search/findBy...` calls with filters on the resource endpoint;
- camelCase parameters such as `pubmedId` and `rsId` with v2 names such as `pubmed_id` and `rs_id`;
- code expecting HAL `_embedded`, `_links`, or v1 projections with code for the v2 response schema;
- implicit v1 gene semantics with an explicit `extended_geneset` choice;
- text-only trait matching with an explicit `efo_id`/`efo_trait` and `show_child_traits` choice.

V2 makes publications, genes, and ancestries first-class resources and exposes richer study metadata, including cohorts, background traits, fuller sample descriptions, licensing/terms, and integrated annotations. Do not assume those resources or fields have the v1 representation shape.

## Pagination and limits

The extension defaults to 20 records and follows API-provided next links only up to `max_pages` (1–20). Raise `max_pages` deliberately for a bounded larger retrieval; do not assume page zero is complete. The extension validates next links so requests stay on the EBI v2 API.

The documented usage limit is 15 queries per second. Requests are serialized and rate-limited, and transient 429 responses are retried with a bound. Treat API errors, missing fields, and unsupported endpoint filters as evidence gaps rather than guesses.

## Answer contract

State the endpoint and filters used, summarize only returned records, report pages fetched and source URLs, and distinguish an empty result from an unsupported query. Keep the raw API evidence available in the tool result. For migration advice, separate documented v2 behavior from assumptions about a local v1 client.
