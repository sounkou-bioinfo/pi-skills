---
name: bioinformatics-cache-and-index-design
description: Choose cache, index, and annotation-store formats from measured bioinformatics access patterns. Use when startup, repeated exact/interval lookup, provenance, or serving layout is the design problem.
---

# Bioinformatics cache and index design

## Contract

Design from the repeated query, not from format novelty.

1. State the access pattern: whole scan, region scan, exact key, interval overlap, range aggregation, or mixed.
2. Name input scale, startup budget, lookup latency target, update cadence, memory limit, portability, and interoperability needs.
3. Prefer a mainstream exchange format until a measured workload shows it is inadequate.
4. Distinguish the source/exchange artifact from a derived serving cache. A specialized cache does not replace the portable authority.
5. Record source release and locator, checksums, derivation command/version, schema version, reference assembly, and invalidation rule.
6. Benchmark cold build/startup and repeated lookup separately. Include cache size and peak memory.
7. Keep fallback and rebuild behavior explicit; reject stale or incompatible caches loudly.

## Format choice

- **BGZF + tabix/CSI:** interoperable sparse coordinate access.
- **BCF:** typed, compact VCF-compatible records.
- **Parquet/DuckDB:** projection, aggregation, joins, partition pruning, and SQL inspection.
- **SQLite:** small portable metadata/control stores and exact-key lookup.
- **Specialized binary layout:** only for a stable hot query whose measured benefit justifies an extra implementation and migration contract.

For transcript or annotation models, separate immutable source identity from compiled lookup structures. For reference sequence, use established indexed FASTA semantics unless a different repeated workload proves otherwise. For supplementary annotations, do not force exact-key, interval, and computed sources into one physical layout.

## Review gates

- Can another machine reacquire and rebuild the cache?
- Is assembly/coordinate convention part of identity?
- Are bounds and corrupt-input failures explicit?
- Does the benchmark match the production query distribution?
- Can the portable source still be inspected independently?

Use `references/cache-provenance-checklist.md` for provenance and the interval/exact lookup note when that distinction drives the design.
