---
name: duckqc-design
description: Design DuckDB-native sequencing QC with queryable metrics and fused scans. Use for DuckQC-style planning, metric contracts, reduction/threading, and compatibility outputs.
---

# DuckQC design

## Model

Design in layers:

1. projection-aware record scans and native kernels;
2. bounded per-thread accumulators and deterministic reduction;
3. named QC metric derivations;
4. SQL table/scalar surfaces;
5. optional compatibility writers.

Prefer queryable rows/structs over one opaque report. Every metric defines included records, filters, denominator, missing-value behavior, read/pair scope, ordering, and merge semantics.

## Decisions required early

- Which metrics truly share one parse/decompression pass?
- What state is per-read, per-cycle, per-contig, histogram, sketch, or pair-level?
- Can state merge associatively and deterministically across DuckDB workers?
- Which outputs require exact upstream compatibility, metric-level agreement, or only documented semantic equivalence?
- Which inputs require indexed sparse access versus sequential streaming?

Reuse htslib and existing DuckHTS kernels before creating transport or parser code. Keep compatibility formatting outside metric kernels. Validate every fused metric against an independent oracle and benchmark the full equivalent workload, not an isolated inner loop.

Use `references/qc-design-checklist.md` for a new metric family.
