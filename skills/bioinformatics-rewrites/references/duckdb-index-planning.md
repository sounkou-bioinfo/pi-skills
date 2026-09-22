# DuckDB Index Planning

DuckDB already provides a lot before custom genomics index work:

- columnar storage
- row-group min/max pruning
- predicate and projection pushdown
- vectorized execution
- persistent ART indexes
- expression indexes

Practical guidance:

- start with planner-friendly schemas and predicates
- cluster or sort by contig/chunk/position where useful
- test ART indexes for exact-key lookups and highly selective filters
- use expression indexes for packed variant keys or routing expressions only when benchmarks justify them
- do not assume ART replaces interval-specific kernels

A good progression is:

1. DuckDB-native tables and pruning
2. ART or expression indexes on hot exact-key paths
3. chunk manifests and chunk-local payloads
4. specialized interval or serving kernels only if profiling still shows need
