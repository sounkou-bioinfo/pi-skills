# gpmapr package workflow

`gpmapr` is the R wrapper for `https://gpmap.opengwas.io/api`. The package source is:

`https://github.com/MRCIEU/gpmapr`

The operation mapping was inspected at upstream revision `772eb97935e42ca503049450dcad281adc5c9ccd`; consult current package documentation for later changes.

The biomedical tool mirrors its read-only JSON operations for health/version, search options, traits, genes, regions, variants, LD, associations, pleiotropy, and uploaded GWAS metadata. It does not replace the package's typed R workflow.

## Choose the surface

Use `biomedical_search` when the task is bounded metadata discovery, a small cross-provider lookup, or evidence retrieval with source receipts.

Use `gpmapr` in R when the task needs:

- package-level data-frame conversion and downstream R analysis;
- GWAS upload and upload metadata admission;
- downloaded ZIP/TSV summary statistics;
- package tutorials for trait clustering/comparison, tissue stratification, instrument selection, or case-study reproduction.

Do not make the extension accept arbitrary upload files or follow signed download URLs. Those have different filesystem, size, credential, and ownership contracts from bounded JSON lookup.

## R package entry points

Inspect current package documentation before calling. Major user-facing functions include searches and retrieval over traits, genes, variants, regions, associations, LD proxies/matrices, pleiotropy, and GWAS data. The internal wrapper defaults to the production API and exposes a development/local selector; production evidence should record the selected endpoint.

A representative package setup is:

```r
# install.packages("gpmapr") or the current documented development source
library(gpmapr)
health()
search_gpmap("rs3798220")
```

Use the package's current help pages for exact arguments rather than reproducing internal `*_api()` helpers. For uploaded data, record reference build, ancestry, sample size, p-value threshold, column mapping, publication state, and returned identifiers.

## Coordinate and payload discipline

The gpmap variant endpoint accepts variant IDs, rsIDs, or strings and can auto-detect them. A genomic range uses `CHR:START-STOP`. Expanded variant responses and association/colocalisation flags can materially increase payload size; request them deliberately. `include_trans` changes gene behavior and should be stated in results.

The summary-statistics endpoints return archives or download locators. Treat the archive as a separate reacquirable resource with checksum, reference build, source URL, and extraction receipt; do not serialize it through a chat tool result.
