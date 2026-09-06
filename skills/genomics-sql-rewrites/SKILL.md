---
name: genomics-sql-rewrites
description: Use when designing a genomics tool around DuckDB readers, native kernels, and composable SQL.
---

# Genomics SQL rewrites

## Architecture

Keep parsing/native semantics distinct from SQL orchestration and compatibility output policy. Add a reader, index, or kernel only when the workload needs it; an ordinary SQL query does not need a new native layer.

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
