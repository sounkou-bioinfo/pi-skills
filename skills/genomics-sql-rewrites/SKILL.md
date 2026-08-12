---
name: genomics-sql-rewrites
description: Decompose genomics tools into DuckDB readers, native kernels, indexes, and composable SQL. Use for generic SQL-native architecture rather than a repository-specific workflow.
---

# Genomics SQL rewrites

## Architecture

Prefer queryable primitives over a monolithic command:

1. projection-aware readers and index access;
2. reusable native kernels;
3. explicit state/reduction mechanics;
4. SQL joins, grouping, provenance, and orchestration;
5. optional compatibility outputs.

Choose the execution model early. Per-thread mutable readers/iterators are the default; batch claiming, contig traversal, ordered emission, and reduction must match the workload. Preserve streaming, projection, filter, and `LIMIT` behavior where the source permits it.

## Storage and indexes

Treat exact-key, interval, range-scan, and aggregate access as different workloads. Try interoperable files and DuckDB-native tables/partitioning before specialized caches. A derived serving index keeps source identity, assembly, schema, derivation, and rebuild receipts.

## Semantics and proof

- Keep counting/normalization/consequence models on distinct public surfaces.
- Fuse passes only when filters, locality, and state semantics agree.
- Pin any upstream compatibility target and declare the supported subset.
- Validate native kernels against scalar/upstream oracles and SQL surfaces end to end.
- Benchmark equivalent full workloads with threads, denominators, memory, and I/O stated.

Load narrower cache, FFI, rewrite-porting, or single-pass skills when those are the actual design question. Repository-specific skills own build and release gates.
