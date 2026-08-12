---
name: bioinformatics-single-pass-analytics
description: Design fused bioinformatics scans that compute several validated outputs from one parse/decompression pass. Use when repeated I/O dominates and metrics share real data locality.
---

# Bioinformatics single-pass analytics

## Fusion rule

Fuse work only when outputs consume the same records under compatible filtering, ordering, and state requirements.

For every output, define:

- included records and filters;
- coordinate/counting semantics;
- required state and reduction order;
- determinism and numerical tolerance;
- compatibility target, if any.

Keep the scan kernel narrow. Separate record decoding, per-record updates, merge/reduction, SQL/wrapper exposure, and optional compatibility writers. Do not make one output's policy implicit in another output's accumulator.

## Proof

1. Establish independent scalar/oracle results for each metric.
2. Compare fused output to those independent results on edge and real fixtures.
3. Test partition/merge order and thread counts.
4. Measure one fused pass against the equivalent repeated passes, including decompression, peak memory, and output cost.
5. Retain a non-fused path when semantics or state locality differ materially.

Avoid fusion that requires unbounded retained records, changes compatibility-critical ordering, or emits only an opaque all-in-one report. Queryable independent outputs remain the public contract.

Use `references/one-pass-design-checklist.md` when deciding whether state can be merged safely.
