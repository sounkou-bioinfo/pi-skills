---
name: duckqc-design
description: Guides design of a DuckDB-native, SQL-first sequencing QC system inspired by RustQC and related upstream tools, with one-pass analytics, reusable kernels, compatibility outputs, and careful threading and summary design. Use when planning DuckQC-style functionality.
---

# DuckQC Design

Use this skill when planning a DuckDB-native QC system for sequencing data, especially RNA-seq and alignment-centric QC workloads.

This skill is intentionally design-oriented. It assumes a future system in the spirit of “DuckQC”: SQL-native, extension-first, one-pass where possible, and able to emit both queryable outputs and compatibility-style summaries.

## Main inspiration

A useful design reference is `RustQC`, which appears to:

- fuse many RNA-seq QC analyses into one pass
- reimplement multiple established tools
- preserve upstream-compatible outputs where needed
- emphasize deployment simplicity

A DuckQC direction should ask:

- what parts should remain file outputs for compatibility?
- what parts should become tables, UDFs, or macros?
- what statistics naturally share the same pass over BAM/CRAM?
- where is SQL composition better than shell orchestration?

## Core design goals

A DuckQC-style system should aim to:

- expose QC as queryable primitives
- reduce repeated BAM parsing and decompression
- preserve compatibility where users depend on established outputs
- keep summary semantics explicit
- remain composable inside DuckDB and host-language clients

## Architectural layers

Prefer a layered system:

1. low-level alignment scan kernels
2. accumulator layer for shared statistics
3. specialized QC derivation modules
4. SQL-facing table functions / macros
5. optional compatibility writers for selected upstream output formats

This avoids rewriting the same scan logic separately for every QC metric.

## One-pass opportunities

DuckQC should aggressively look for shared-pass opportunities.

Possible one-pass outputs from aligned reads:

- flag summaries
- per-reference counts
- duplication summaries
- strandedness evidence
- exon/intron/intergenic distribution
- splice junction evidence
- insert/inner distance summaries
- transcript/gene counting support stats
- per-base or binned coverage summaries

But each metric still needs an explicit contract.

## Threading model questions

Decide early:

- is work best partitioned by contig, batch of records, or region set?
- do accumulators merge associatively across threads?
- which outputs require deterministic order?
- which outputs can be reduced at the end?
- which QC artifacts are naturally whole-dataset summaries and may resist simple scan-phase emission?

Good candidate model:

- per-thread readers / iterators
- shared immutable annotation/index state
- per-thread accumulators
- explicit reduction phase for whole-dataset summaries

Be careful where the host execution model makes this awkward.

## Annotation and index needs

DuckQC-like functionality may need:

- BAM/CRAM indexes
- GTF/GFF-derived transcript/exon/gene indexes
- interval lookup structures for genomic feature classification
- optional compact binary caches for reused annotation models

Think carefully about startup costs vs repeated-query reuse.

## SQL design questions

Should a QC feature be exposed as:

- a table function returning rows?
- a macro over existing readers?
- a scalar/aggregate UDF?
- a side-effecting function that writes compatibility reports?

Prefer queryable outputs first, compatibility writers second.

## Compatibility strategy

For each upstream-inspired QC artifact, decide whether the goal is:

- exact output compatibility
- metric-level compatibility
- close semantic equivalence but not identical formatting

Do not blur these categories.

## Suggested phased plan

### Phase 1

- SQL-visible BAM/CRAM summary primitives
- flagstat/idxstats-like outputs
- basic distribution summaries
- explicit table outputs

### Phase 2

- feature-aware distribution with gene model indexes
- one-pass duplication + count + distribution enrichments
- QC summary tables plus selected compatibility text outputs

### Phase 3

- more complex transcript/gene-body/TIN-style metrics
- report-generation layer if genuinely needed
- browser or notebook-friendly views on top of SQL outputs

## Anti-patterns

Avoid:

- one giant command with opaque internals
- duplicated scans per QC metric when one pass would suffice
- compatibility claims without metric-level validation
- adding report-generation complexity too early
- overfitting the design to a single workflow when the primitives could be reused broadly

## Related skills

- [Bioinformatics single-pass analytics](../bioinformatics-single-pass-analytics/SKILL.md)
- [Genomics SQL rewrites](../genomics-sql-rewrites/SKILL.md)

## References

- [QC design checklist](references/qc-design-checklist.md)
- [Threading notes](references/threading-notes.md)
