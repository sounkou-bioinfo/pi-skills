---
name: duckdb-c-extension-function-catalog
description: Guides machine-readable function catalogs for DuckDB extensions, including a `functions.yaml` source-of-truth pattern that can drive docs, wrappers, aliases, examples, and consistency checks. Use when an extension exposes many SQL functions or multiple wrapper surfaces.
---

# DuckDB C Extension Function Catalog

Use this skill when the extension has enough functions that hand-maintained docs and wrappers start drifting.

## Core position

Once an extension exposes more than a handful of SQL entry points, keep a machine-readable catalog.
A `functions.yaml`-style file can become the source of truth for:

- SQL names
- kind: scalar/table/macro/aggregate
- signatures
- return types
- categories
- wrapper aliases
- docs text
- examples
- lifecycle metadata such as `since` or `deprecated`

## Why this pattern helps

Without a catalog, teams often end up with inconsistent copies of the same information in:

- registration code
- README tables
- package docs
- wrapper helpers
- test fixtures

A catalog reduces drift.

## Recommended metadata fields

A useful generic schema often includes:

- `name`
- `kind`
- `category`
- `signature`
- `returns`
- `sql_aliases` or wrapper aliases
- `description`
- `examples`
- `since`
- `deprecated`
- `notes`

Not every project needs every field, but think in that direction.

## Main principles

### 1) Keep one canonical source of function metadata

If the extension needs generated docs or wrappers, choose one canonical catalog file and generate derivatives from it.
Treat generated `functions.md` and `functions.tsv` as build artifacts, not hand-edited sources.

### 2) Generate human-readable outputs

Common derivatives:

- `functions.md`
- `functions.tsv`
- README tables
- R helper registration tables
- validation scripts

A good default is a small Python renderer wired into `make` so docs can be refreshed reproducibly.
Prefer the DuckHTS-style pattern where `functions.yaml` is stored as JSON-formatted YAML and rendered with Python standard-library code (`json`, `csv`, `pathlib`) instead of depending on PyYAML.

### 3) Record lifecycle metadata

The catalog is also a good place for:

- `since`
- `experimental`
- `deprecated`
- replacement function names

### 4) Keep catalog entries user-oriented

Descriptions should explain behavior, not just repeat signatures.
Examples should be copyable.

### 5) Validate generated outputs in CI

If you generate files from the catalog, CI should detect drift.
A practical workflow is:

- edit `functions.yaml`
- run the Python renderer
- commit regenerated `functions.md` and `functions.tsv`
- have CI fail if rerendering changes tracked outputs

## Good outcomes

- one source of truth
- synchronized docs and wrappers
- easier deprecation management
- cleaner README/reference tables

## Anti-patterns

- hand-editing generated docs without updating the source catalog
- requiring PyYAML or another parser dependency when a JSON-formatted YAML manifest and stdlib Python would do
- function names duplicated inconsistently across SQL and wrappers
- no lifecycle metadata
- examples that are not actually tested anywhere

## Related skills

- [DuckDB C extension API stability](../duckdb-c-extension-api-stability/SKILL.md)
- [DuckDB C extension R bindings](../duckdb-c-extension-r-bindings/SKILL.md)

## References

- [Functions YAML pattern](references/functions-yaml-pattern.md)
- [Catalog generation checklist](references/catalog-generation-checklist.md)
- [Example catalog source](references/functions.example.yaml)
- [Python generator stub](references/generate_function_catalog.py)
