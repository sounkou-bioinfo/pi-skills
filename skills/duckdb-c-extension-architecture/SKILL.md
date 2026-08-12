---
name: duckdb-c-extension-architecture
description: Design and harden C DuckDB extensions across ownership, concurrency, API stability, vendoring, catalogs, and tests. Use for extension architecture or cross-cutting native changes, not a one-line patch.
---

# DuckDB C extension architecture

This is the generic authority for C-extension architecture, API policy, vendoring, function catalogs, and native/SQL interoperability tests.

## Layers and ownership

Keep three layers:

1. public SQL registration/bind/execute adapters;
2. reusable runtime and kernels;
3. narrow DuckDB/upstream compatibility adapters.

Name the owner and destruction point for database, connection, function, bind, global, local, thread, iterator, callback, and external-service state. Registration creates immutable metadata; execution state is scoped to the invocation or worker. Design shutdown and partial-initialization cleanup before adding background work.

Do not share mutable reader handles or iterators across DuckDB workers. Keep callbacks bounded and non-blocking. Return DuckDB-visible errors; never `exit`, abort, or use runtime assertions for input/host failures.

## API and public stability

- Prefer stable DuckDB APIs.
- Isolate required unstable/deprecated calls in one adapter and test every supported DuckDB version.
- Separate upstream API stability from the extension's SQL/wrapper promises.
- Record supported versions and deprecation windows; do not add new code on deprecated APIs.
- Keep pre-1.0 freedom distinct from post-1.0 compatibility guarantees.

## Vendoring

Pin upstream versions/commits and checksums. Vendor through deterministic scripts; keep patches minimal, ordered, and ledgered. Hide vendored symbols when coexistence matters. Business logic calls a shim, not volatile upstream internals. Re-run license, symbol, ABI, and behavioral comparisons on every bump.

## Function authority

When multiple surfaces can drift, keep one machine-readable catalog for names, kinds, signatures, returns, aliases, descriptions, examples, and lifecycle metadata. Generate docs/wrappers/descriptors and fail CI on drift. Examples must be short and executable.

## Validation

- SQL conformance for public semantics and failure paths.
- Native/property/sanitizer tests for kernels, ownership, and bounds.
- Wrapper tests at each language boundary.
- External-client tests for coexistence/protocol claims.
- Repeated load/unload, cancellation, shutdown, and partial-init cleanup.
- Deterministic fixtures and generated-output checks.

Useful references: `runtime-layering-checklist.md`, `state-ownership-patterns.md`, plus merged compatibility, vendoring, catalog, and test checklists under `references/`.
