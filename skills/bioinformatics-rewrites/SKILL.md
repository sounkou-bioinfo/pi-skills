---
name: bioinformatics-rewrites
description: Use when reusing, binding, porting, or redesigning a bioinformatics implementation - reuse decisions, native FFI/bindings, compatibility with a named upstream tool, DuckDB/SQL-native genomics architecture, single-pass metric fusion, and caches or indexes for repeated queries.
---

# Bioinformatics rewrites

Load only the sections for the open question. A settled reuse decision is not
reopened when the task is binding or porting.

## Reuse decision

Prefer a mature library or composition over reimplementing established semantics.
Compare the available core, its license/dependencies, and the target deployment
constraints. If reuse is unsuitable, record the concrete mismatch.

Keep reusable semantics separate from host wrappers. C can preserve mature-library
reuse, portable ABIs, and constrained deployment; this is not a requirement to use
C everywhere. Start with the requested host. Add other bindings only for real
consumers, not because a future CLI/R/Python/SQL/wasm combination is possible.

Dependency cost includes auditing, vendoring, binary size, and CRAN/HPC/offline
installation. See `references/reuse-and-dependencies.md`.

## Bindings

Reuse a stable native core and make the language boundary explicit.

- Separate native semantics from wrapper defaults, validation, naming, and display policy.
- Define ownership for every handle, buffer, string, callback, error, and borrowed view.
- Keep callbacks small; foreign runtimes must not retain stack pointers or temporary language objects.
- Return host-visible errors instead of aborting the host process.
- Bound input-driven allocation and length conversion before crossing integer widths.
- Expose a small C-compatible surface when multiple runtimes share one core.
- Keep one semantic implementation; wrappers translate values and policy rather than reimplement algorithms.
- Treat wasm and threaded hosts as distinct ownership/runtime targets, not compiler flags on a desktop design.

For changes to native or wrapper contracts, test the affected surfaces separately:
scalar/edge/error cases against the native or upstream oracle; close, finalization,
repeated load/unload, and callback lifetimes; wrapper defaults, missing values,
vectorization, and type conversion; installed-artifact or external-client execution;
platform-specific ABI/export behavior. Document the native version, supported
subset, unsupported semantics, and the exact comparison command. See
`references/bindings.md`. DuckDB extensions also follow
[duckdb-c-extension](../duckdb-c-extension/SKILL.md).

## Compatibility with a named upstream

Before implementation, record the upstream project and authors; exact version or
commit and license; supported inputs, options, outputs, ordering, errors, and
numerical tolerances; explicitly unsupported behavior; comparison datasets and
commands. Credit upstream visibly. Disclose AI assistance where project policy
requires it; generated code receives the same review and proof obligations as
human code.

1. Read pinned source before secondary descriptions.
2. Build the smallest useful compatible slice.
3. Keep compatibility projection separate from richer native APIs.
4. Fail loudly for deferred options; do not silently approximate.
5. Compare against the upstream executable continuously on synthetic edge fixtures and representative real data.
6. Classify mismatches as intentional scope, preserved upstream quirk, or defect.
7. Benchmark equivalent workloads only; report inputs, denominators, threads, environment, and revision.
8. Preserve acquisition, derivation, and validation receipts so another machine can rerun the proof.

Matching a few happy-path rows does not establish exact compatibility. Do not copy
unlicensed source or hide provenance behind vague inspiration language. See
`references/compatibility-porting.md`.

## SQL-native architecture

Keep parsing/native semantics distinct from SQL orchestration and compatibility
output policy. Add a reader, index, or kernel only when the workload needs it; an
ordinary SQL query does not need a new native layer. Keep counting, normalization,
and consequence models on distinct public surfaces.

Choose the execution model early. Per-thread mutable readers/iterators are the
default; batch claiming, contig traversal, ordered emission, and reduction must
match the workload. Preserve streaming, projection, filter, and `LIMIT` behavior
where the source permits it. See `references/threading-and-scan-models.md`.

## Single-pass fusion

Fuse work only when outputs consume the same records under compatible filtering,
ordering, and state requirements. For every output, define included records and
filters, coordinate/counting semantics, required state and reduction order,
determinism and numerical tolerance, and any compatibility target.

Keep the scan kernel narrow: record decoding, per-record updates, merge/reduction,
SQL/wrapper exposure, and optional compatibility writers stay separate. One
output's policy must not be implicit in another output's accumulator.

1. Establish independent scalar/oracle results for each metric.
2. Compare fused output to those results on edge and real fixtures.
3. Test partition/merge order and thread counts.
4. Measure one fused pass against the equivalent repeated passes, including decompression, peak memory, and output cost.
5. Retain a non-fused path when semantics or state locality differ materially.

Avoid fusion that requires unbounded retained records, changes
compatibility-critical ordering, or emits only an opaque all-in-one report.
Queryable independent outputs remain the public contract. See `references/single-pass.md`.

## Caches and indexes

Design from the repeated query, not from format novelty.

1. State the access pattern: whole scan, region scan, exact key, interval overlap, range aggregation, or mixed.
2. Name input scale, startup budget, lookup latency target, update cadence, memory limit, portability, and interoperability needs.
3. Prefer a mainstream exchange format, then DuckDB-native tables/partitioning, until a measured workload shows them inadequate.
4. Distinguish the source/exchange artifact from a derived serving cache. A specialized cache does not replace the portable authority.
5. Record source release and locator, checksums, derivation command/version, schema version, reference assembly, and invalidation rule.
6. Benchmark cold build/startup and repeated lookup separately, including cache size and peak memory.
7. Keep fallback and rebuild behavior explicit; reject stale or incompatible caches loudly.

- **BGZF + tabix/CSI:** interoperable sparse coordinate access.
- **BCF:** typed, compact VCF-compatible records.
- **Parquet/DuckDB:** projection, aggregation, joins, partition pruning, and SQL inspection.
- **SQLite:** small portable metadata/control stores and exact-key lookup.
- **Specialized binary layout:** only for a stable hot query whose measured benefit justifies an extra implementation and migration contract.

For transcript or annotation models, separate immutable source identity from
compiled lookup structures. For reference sequence, use indexed FASTA semantics
unless a different repeated workload proves otherwise. Exact-key, interval, and
computed supplementary sources need not share one physical layout.

Review: Can another machine reacquire and rebuild the cache? Is assembly/coordinate
convention part of its identity? Are bounds and corrupt-input failures explicit?
Does the benchmark match the production query distribution? Can the portable
source still be inspected independently? See `references/storage-and-formats.md`,
`references/interval-vs-exact-lookups.md`, and `references/duckdb-index-planning.md`.

## Proof

Validate native kernels against scalar/upstream oracles and SQL surfaces end to
end. Benchmark equivalent full workloads with threads, denominators, memory, and
I/O stated. Repository-specific skills own build and release gates.
