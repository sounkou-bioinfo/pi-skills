---
name: duckdb-c-extension-r-bindings
description: Use for packaging or exposing a DuckDB C extension through an R package.
---

# DuckDB C extension R bindings

## Layer contract

- The extension owns SQL/native semantics.
- Installed extension payloads own exact binary/source provenance.
- R owns argument admission, DBI orchestration, names, defaults, and R-native return shaping.
- Generated catalogs may drive wrappers/docs, but generated files are not a second authority.

Map every R argument to SQL literal, identifier, or documented raw expression explicitly. Do not rebuild native algorithms in R.

## Packaging

Use an explicit reproducible bootstrap/configure path suitable for source packages. Install-time work may select or compile declared bundled sources, but must not perform hidden first-use downloads or mutate the source tree. Keep Unix, Windows, and wasm targets explicit. Build a tarball and test the installed tarball when project rules require it.

Record extension version, DuckDB ABI/version, platform, source receipt, and artifact location. Fail before `LOAD` when the required artifact/capability is unavailable.

## Documentation and tests

Apply these to the affected wrapper, build, or release surface; prose-only edits do not require unrelated native checks.

- Keep authored R documentation distinct from generated function-catalog fragments.
- Test wrapper validation and defaults independently from SQL conformance.
- Exercise a real DBI load/query path from the installed package.
- Test configure/bootstrap and tarball installation on supported platforms.
- Run `R CMD check` under project/CRAN constraints.

Use the focused references under `references/` for bootstrap, layout, and responsibility splits.
