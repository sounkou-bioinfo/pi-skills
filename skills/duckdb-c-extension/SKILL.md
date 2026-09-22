---
name: duckdb-c-extension
description: Use for C DuckDB extension architecture, ownership, concurrency, API compatibility, vendoring, function catalogs, or packaging and exposing the extension through an R package.
---

# DuckDB C extension

This is the generic authority for C-extension architecture, API policy, vendoring, function catalogs, native/SQL interoperability tests, and R-package bindings.

## Layers and ownership

Separate public SQL registration/bind/execute policy, reusable kernels, and necessary DuckDB/upstream compatibility shims. Introduce a layer only when it owns a distinct responsibility, not to fill an architectural template.

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

Select checks for the changed contract; release and compatibility claims still require their full supported-surface evidence.

- SQL conformance for public semantics and failure paths.
- Native/property/sanitizer tests for kernels, ownership, and bounds.
- Wrapper tests at each language boundary.
- External-client tests for coexistence/protocol claims.
- Repeated load/unload, cancellation, shutdown, and partial-init cleanup.
- Deterministic fixtures and generated-output checks.

Useful references: `runtime-layering-checklist.md`, `state-ownership-patterns.md`, plus compatibility, vendoring, catalog, and test checklists under `references/`.

## R package bindings

- The extension owns SQL/native semantics.
- Installed extension payloads own exact binary/source provenance.
- R owns argument admission, DBI orchestration, names, defaults, and R-native return shaping; apply [We Use R Damnit](../we-use-r-damnit/SKILL.md).
- Generated catalogs may drive wrappers/docs, but generated files are not a second authority.

Map every R argument to SQL literal, identifier, or documented raw expression explicitly. Do not rebuild native algorithms in R.

Use an explicit reproducible bootstrap/configure path suitable for source packages. Install-time work may select or compile declared bundled sources, but must not perform hidden first-use downloads or mutate the source tree. Keep Unix, Windows, and wasm targets explicit. Record extension version, DuckDB ABI/version, platform, source receipt, and artifact location. Fail before `LOAD` when the required artifact/capability is unavailable.

Apply these checks to the affected wrapper, build, or release surface:

- Keep authored R documentation distinct from generated function-catalog fragments.
- Test wrapper validation and defaults independently from SQL conformance.
- Exercise a real DBI load/query path from the installed package.
- Test configure/bootstrap and tarball installation on supported platforms.
- Run `R CMD check` under project/CRAN constraints; see [r-package-development](../r-package-development/SKILL.md).

References: `cran-bootstrap-pattern.md`, `r-package-layout-pattern.md`, `wrapper-responsibility-split.md`, `readme-rmd-custom-engine-pattern.md`.
