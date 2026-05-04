---
name: genomics-sql-rewrites
description: Guides genomics tool rewrites and ports that target SQL-native, DuckDB-centered execution using reusable native kernels, streaming readers, parallel scans, alternative file formats, and indexed metadata access. Use when designing genomics capabilities as DuckDB extensions or SQL-first libraries.
---

# Genomics SQL Rewrites

Use this skill when a genomics rewrite should become a SQL-native capability, especially in or around DuckDB.

This skill sits inside the rewrites.bio umbrella but is more opinionated about:

- SQL-native execution
- DuckDB extension architecture
- reusable table functions and UDFs
- parallel scan design
- alternative metadata/file formats
- indexed access patterns
- replacing repeated tool invocations with queryable primitives

## Reference projects to study

Good reference directions:

- `duckhts` — sequencing/HTS readers and analytics in DuckDB
- `plinking_duck` — PLINK genotype readers and GWAS/QC analytics in DuckDB
- `fastVEP` — high-performance variant annotation architecture and alternative binary annotation formats
- `RustQC` — single-pass RNA-seq QC fusion across multiple upstream tools

## Core position

For genomics, a powerful rewrite target is often not “another CLI tool”, but:

- a DuckDB extension
- a set of table functions
- a set of SQL-native analytics kernels
- reusable primitives available through many client languages

This can make one implementation immediately available through:

- SQL
- R
- Python
- command-line DuckDB sessions
- browser/wasm runtimes, where feasible

## Main principles

### 1) Prefer queryable primitives over monolithic commands

Ask whether the tool should become:

- a table reader
- a scalar/table UDF
- a macro
- a counting/coverage kernel
- an annotation primitive

instead of only a single command-line binary.

### 2) Separate readers from analytics kernels

A robust SQL genomics design often has layers:

- file reader layer
- metadata/index reader layer
- low-level analytic kernels
- compatibility wrappers or macros
- host-language wrappers

Do not entangle file parsing, analytics, and wrapper ergonomics unnecessarily.

### 3) Threading model is architecture, not afterthought

For DuckDB-style execution, decide early:

- what work belongs to Bind
- what work belongs to InitGlobal / InitLocal / Scan
- what state is global vs per-thread
- whether scans use atomic batch claiming
- whether exact compatibility requires sequential contig/order traversal
- whether some functions must stay single-threaded due to semantics or lifecycle constraints

### 4) Streaming matters

Prefer designs where:

- Scan emits incremental chunks
- large genotype/alignment payloads are not fully materialized before output
- projection pushdown avoids expensive decoding when possible
- LIMIT can short-circuit work naturally

### 5) Alternative file formats are strategic

Do not assume the original text companion format is the only reasonable metadata format.

A SQL-native rewrite should consider:

- text compatibility for interoperability
- parquet companions for metadata
- binary caches for startup speed
- tabix/CSI/FAI-like indexing where appropriate
- compact annotation stores for direct lookup

### 6) Indexes are first-class design objects

Good genomics SQL systems often depend on careful indexing of:

- genomic intervals
- transcript models
- FASTA references
- metadata rows
- chunked annotation blocks
- variant keys

Index design can matter more than language choice.

But in DuckDB, ask first what the engine already gives you:

- columnar storage
- row-group pruning
- predicate/projection pushdown
- vectorized execution
- persistent ART indexes
- expression indexes

Do not jump straight to a custom genomics serving format. First test whether a planner-friendly schema plus DuckDB-native indexing already solves enough of the workload.

### 7) One-pass enriched analytics are often the big win

If one traversal can produce:

- primary result
- summaries
- QC diagnostics
- side products

then fuse them when semantics stay explicit and validation remains granular.

### 8) Preserve compatibility where it counts

If a table function or SQL kernel claims alignment with an upstream tool, define:

- exact compatibility target
- pinned upstream version
- what outputs must match exactly
- what is intentionally richer or different

## Threading model guidance

Common useful threading models in genomics SQL work:

### Atomic batch claiming

Useful when:

- work is naturally partitioned by variant/record ranges
- each thread can maintain isolated reader state
- output order is not semantically required

Seen in systems like `plinking_duck` for parallel variant processing.

### Per-thread file handles / readers

Useful when:

- underlying file handles are not thread-safe
- each worker can read independent regions or batches

### Sequential header/contig order traversal

Prefer this when:

- compatibility with an upstream output order matters
- summaries or file-writing contracts depend on deterministic traversal
- multi-output fused kernels would become semantically fragile under free parallel scheduling

### Single-thread accumulation with deferred merge

Sometimes required when:

- output semantics depend on whole-dataset aggregation
- the host execution API lacks a clean parallel accumulate/finalize lifecycle for your abstraction

### Background-worker plus emitter split

Worth considering only when:

- the host table-function lifecycle cannot naturally express accumulate-then-emit
- the complexity is justified by the workload

## File format and index guidance

### Companion metadata

Consider whether metadata should be readable from:

- native domain formats
- parquet
- CSV
- existing DuckDB tables/views

This can reduce format conversion friction dramatically.

### Binary caches

Use binary caches when startup dominates and the same annotation model is reused often.

### Chunked annotation stores

For lookup-heavy annotation systems, chunked binary formats with:

- compact keys
- block/chunk compression
- cache-aware access
- optional negative-lookup filters

can matter more than raw parser speed.

But treat them as a later optimization stage after trying:

- DuckDB-native tables
- chunk metadata columns
- planner-friendly predicates
- ART or expression indexes on hot exact-key paths

## Worked directions from reference repos

### `plinking_duck`

Useful lessons:

- SQL readers plus analysis functions as first-class extension APIs
- projection pushdown
- atomic batch claiming for parallel scan
- alternative companion metadata sources (native text, parquet, tables/views)
- offset-indexed metadata access to reduce memory use at scale

### `duckhts`

Useful lessons:

- file-format readers as table functions
- compatibility rewrites inside DuckDB
- careful wasm/runtime separation
- one-pass enriched statistics (e.g. count + QC-style summaries)
- explicit handling of indexes, side outputs, and compatibility contracts

### `fastVEP`

What it appears to be doing technically:

- complete VEP-style consequence engine in Rust
- modular crate architecture
- transcript/gene/cache separation
- memory-mapped FASTA and binary transcript caches
- tabix-indexed lookups
- custom binary annotation formats (`.osa`, `.osa2`, `.osi`, `.oga`)
- chunked and encoded supplementary annotation stores
- heavy focus on startup amortization and high-throughput annotation

This suggests interesting DuckDB/C rewrite questions:

- should transcript models live in a DuckDB-friendly binary cache?
- should supplementary annotations become indexed DuckDB-readable stores?
- can consequence prediction be exposed as row kernels + macros + lookup tables?
- can VEP-style annotation become SQL-native without reintroducing massive multipass overhead?

### `RustQC`

What it appears to be doing technically:

- single-pass RNA-seq QC over BAM
- fusing many classic QC tools into one pass
- producing multiple upstream-compatible outputs
- emphasizing static binaries and deployment simplicity

This suggests a possible DuckDB-inspired direction such as a future “DuckQC” concept:

- one native pass
- SQL-visible metrics
- compatibility file outputs where needed
- composable QC summaries rather than many separate invocations

## Recommended design workflow

1. identify the reusable primitive
2. define whether it is a reader, kernel, or compatibility wrapper
3. define the threading model early
4. define file format and index strategy early
5. start with planner-friendly DuckDB-native tables and query shapes
6. test ART or expression indexes on true hot exact-key paths
7. add chunked payloads or specialized kernels only if profiling still shows need
8. validate on real data
9. benchmark against both upstream tools and naïve multi-pass baselines
10. add richer outputs only when semantics stay explicit

## Related skills

- [Bioinformatics rewrite and porting](../bioinformatics-rewrite-porting/SKILL.md)
- [Library-first bio rewrites](../library-first-bio-rewrites/SKILL.md)
- [Bioinformatics single-pass analytics](../bioinformatics-single-pass-analytics/SKILL.md)
- [Bioinformatics FFI and bindings](../bioinformatics-ffi-and-bindings/SKILL.md)

## References

- [Threading and scan models](references/threading-and-scan-models.md)
- [Formats and index strategy](references/formats-and-index-strategy.md)
- [DuckDB index planning](references/duckdb-index-planning.md)
- [fastVEP notes](references/fastvep-notes.md)
