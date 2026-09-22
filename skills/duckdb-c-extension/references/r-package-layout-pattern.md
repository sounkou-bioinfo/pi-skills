# R Package Layout Pattern

A practical pattern for R + DuckDB extension repos:

- native extension sources at top level or in a dedicated native subdir
- `R/` for wrapper helpers
- `man/` for generated package docs
- `inst/duckdb_extension/` for installed extension payloads if bundled
- `inst/function_catalog/` for function metadata and generated reference docs
- `inst/extdata/` for small examples/fixtures
- `inst/tinytest/` or `tests/` for wrapper-level tests

## Key question

Can a new contributor tell, in one glance, which code defines semantics and which code just packages or exposes them?
