# Changelog

## v0.6.0

- expand `genomics-sql-rewrites` with DuckDB-first planning guidance, including ART/expression-index considerations before custom serving formats
- expand `duckvep-design` with multi-source annotation planning, staged/federated execution, and structured output layering
- expand `bioinformatics-cache-and-index-design` with explicit exact-key versus interval-overlap guidance and DuckDB-native indexing considerations
- add reference notes for DuckDB index planning, multi-source annotation planning, and interval-vs-exact lookup design

## v0.5.0

- add `bioinformatics-cache-and-index-design` skill
- add guidance for choosing between mainstream interoperable formats and specialized annotation-serving caches
- add notes on provenance, regeneration, and invalidation for generated caches
- add `echtvar` as a concrete reference for innovative genome-chunked annotation indexing and compressed serving formats

## v0.4.0

- add `duckqc-design` skill
- add `duckvep-design` skill
- expand the genomics SQL umbrella with DuckQC-style one-pass QC planning and DuckVEP-style consequence-engine planning
- add explicit discussion of `bcftools csq`-aligned, haplotype-aware design paths and careful cache/index planning

## v0.3.0

- add `genomics-sql-rewrites` skill
- add genomics SQL / DuckDB design guidance covering threading models, file formats, indexes, and queryable rewrite targets
- add reference directions from `duckhts`, `plinking_duck`, `fastVEP`, and `RustQC`

## v0.2.0

- add `bioinformatics-single-pass-analytics` skill
- add explicit changelog tracking to the repo
- expand package guidance for install/update workflow

## v0.1.0

Initial release.

Included skills:
- `bioinformatics-rewrite-porting`
- `library-first-bio-rewrites`
- `bioinformatics-ffi-and-bindings`
