---
name: bioinformatics-single-pass-analytics
description: Guides design of bioinformatics kernels and rewrites that compute multiple validated outputs or statistics in one pass over the data, reducing repeated I/O and decompression while preserving explicit semantics. Use when designing fused readers, counters, coverage engines, or summary pipelines.
---

# Bioinformatics Single-Pass Analytics

Use this skill when designing native or low-level analytics that should produce multiple outputs or statistics from one scan of the data.

Typical cases:

- coverage/counting kernels
- readers that emit both primary records and summaries
- fixed-bin counting with extra QC/statistics
- tools that currently require repeated decompression or repeated parsing passes

## Core idea

A strong modernization opportunity is often not just “make it faster”, but:

- parse once
- decompress once
- scan once
- emit multiple trustworthy outputs

Examples of one-pass enrichments:

- counts + strand splits
- counts + GC summaries
- counts + MAPQ summaries
- primary outputs + summary side products
- compatibility outputs + diagnostics from the same engine run

## Why this is valuable

One-pass designs can reduce:

- repeated I/O
- repeated decompression
- repeated parsing
- intermediate files
- duplicated pipeline stages

This matters especially for large BAM/CRAM/VCF/BCF-like workloads.

## Core rules

### 1) Semantics must stay explicit

A fused pass is only good if every emitted statistic still has a clear meaning.

Document:

- exactly what each metric means
- whether it is pre-filter or post-filter
- whether it is computed on primary records, fragments, bins, intervals, or events
- whether it preserves an upstream compatibility contract

### 2) Do not hide incompatibility behind enrichment

If one output claims compatibility with an upstream tool, keep that contract explicit.

Additional one-pass statistics are fine, but they must not silently alter the compatibility-critical output.

### 3) Validate each output, not only the main one

A fused engine should not be judged only by its main table/file.

Validate separately:

- primary output
- summary output
- per-bin metrics
- per-interval metrics
- QC or diagnostic side products

### 4) Prefer one pass only when data locality is real

Do not force everything into one pass if it makes semantics or maintenance worse.

A one-pass design is most compelling when:

- the same parse/decompression cost dominates multiple outputs
- the same traversal naturally yields several metrics
- intermediate materialization would be expensive

### 5) Keep the core kernel narrow

The one-pass engine should usually be a focused kernel with:

- a clear input model
- a clear filtering model
- a clear accumulation model
- a clear output contract

Wrapper layers can expose convenient surfaces, but the core should stay understandable.

## Design questions

Before implementing, ask:

- what repeated passes currently exist?
- what expensive work is duplicated across them?
- which statistics naturally share the same traversal?
- which outputs are compatibility-critical?
- which outputs are additional enrichments?
- can pre-filter and post-filter summaries both be useful?
- what is the smallest fused slice worth implementing first?

## Recommended workflow

1. identify duplicated passes in the current workflow
2. isolate the shared scan/decompression/parsing work
3. define the minimal fused output set
4. specify each emitted statistic clearly
5. implement the smallest viable kernel
6. validate each emitted output independently
7. benchmark against the multi-pass baseline
8. expand only when semantics remain crisp

## Good patterns

- one scan over alignments populates total, strand, and QC bins
- one contig traversal emits primary coverage plus summaries
- one parser builds both row-level output and lightweight metadata side products
- one native pass replaces multiple SQL or shell stages while preserving equivalent outputs

## Anti-patterns

- adding side metrics with unclear definitions
- mixing pre-filter and post-filter values without labeling them
- claiming compatibility while changing the main output semantics
- fusing unrelated computations only for elegance
- benchmarking only the main output while ignoring expensive side products

## Related skills

- [Library-first bio rewrites](../library-first-bio-rewrites/SKILL.md)
- [Bioinformatics rewrite and porting](../bioinformatics-rewrite-porting/SKILL.md)

## References

- [One-pass design checklist](references/one-pass-design-checklist.md)
- [Validation notes](references/validation-notes.md)
