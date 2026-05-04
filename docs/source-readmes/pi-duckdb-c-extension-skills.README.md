# pi-duckdb-c-extension-skills

Pi skills for AI-assisted design and implementation of DuckDB extensions written in C, especially when the work involves vendored native dependencies, compatibility shims, R bindings, generated function catalogs, and real integration testing.

## Install

```bash
pi install git:github.com/sounkou-bioinfo/pi-duckdb-c-extension-skills
```

Pin a release:

```bash
pi install git:github.com/sounkou-bioinfo/pi-duckdb-c-extension-skills@v0.2.1
```

## Included skills

- `duckdb-c-extension-architecture`
- `duckdb-c-extension-vendoring-and-shims`
- `duckdb-c-extension-api-stability`
- `duckdb-c-extension-r-bindings`
- `duckdb-c-extension-function-catalog`
- `duckdb-c-extension-testing-and-interop`

## When to use `duckdb-c-extension-architecture`

Load this skill when you are:

- planning a DuckDB extension primarily in C
- deciding extension boundaries, runtime ownership, and state layout
- separating stable business logic from version-sensitive adapter code
- designing table functions, scalar functions, services, or background runtimes

## When to use `duckdb-c-extension-vendoring-and-shims`

Load this skill when you are:

- vendoring native libraries into a DuckDB extension
- deciding what to pin, patch, or statically link
- avoiding symbol collisions with other libraries in the same host process
- isolating raw upstream calls behind compatibility shims

## When to use `duckdb-c-extension-api-stability`

Load this skill when you are:

- choosing between stable and unstable DuckDB extension APIs
- planning deprecations and compatibility windows
- isolating version-sensitive APIs behind a narrow surface
- documenting upgrade and removal policy clearly

## When to use `duckdb-c-extension-r-bindings`

Load this skill when you are:

- packaging a DuckDB C extension inside an R package
- deciding how native code, installed artifacts, and R wrappers should be laid out
- exposing SQL functions cleanly through R helpers
- balancing CRAN, local native builds, and extension bundling concerns

## When to use `duckdb-c-extension-function-catalog`

Load this skill when you are:

- managing many SQL functions in one extension
- keeping signatures, aliases, docs, and examples synchronized
- designing a `functions.yaml`-style machine-readable catalog
- generating markdown, TSV, wrappers, or validation from one source of truth
- following the DuckHTS-style Python renderer + JSON-formatted YAML pattern to avoid parser dependencies

## When to use `duckdb-c-extension-testing-and-interop`

Load this skill when you are:

- building sqllogictest coverage for a C extension
- verifying real client/server or wire-path behavior
- testing R wrappers separately from native behavior
- planning interop tests across SQL, R, CLI, or external clients

## Core themes

These skills emphasize a few recurring patterns:

- prefer the DuckDB C API where possible
- keep version-sensitive or unstable integration points in shim files
- vendor deliberately, with pinned upstream versions and explicit patch ledgers
- design deprecation policy on purpose instead of drifting into it
- treat R bindings as a packaging/interface layer, not as the place where core semantics live
- keep a machine-readable function catalog so docs and wrappers do not rot
- test real paths, not hidden shortcuts

## Install test snippets

Quick smoke test after install:

```bash
pi install git:github.com/sounkou-bioinfo/pi-duckdb-c-extension-skills@v0.2.1
pi list | grep pi-duckdb-c-extension-skills
```

Suggested prompt to verify skill loading behavior:

```text
Use the duckdb-c-extension-function-catalog skill and propose a functions.yaml layout for a small DuckDB C extension with one scalar function, one table function, and one deprecated alias.
```

Suggested prompt to verify architecture guidance:

```text
Use the duckdb-c-extension-architecture skill and outline a per-database runtime design for a DuckDB C extension that starts a background service and registers SQL functions at load time.
```

## Included worked references

The package also includes a few concrete supporting references:

- a minimal `functions.example.yaml` in JSON-formatted YAML style
- a tiny `generate_function_catalog.py` generator stub using only Python standard-library modules
- a DuckTinyCC case study on using `access->get_database(info)` and an extension-managed persistent connection at init time

## Update

If installed unpinned:

```bash
pi update
```

Or update just this package:

```bash
pi update git:github.com/sounkou-bioinfo/pi-duckdb-c-extension-skills
```

If pinned, move explicitly to the current release:

```bash
pi install git:github.com/sounkou-bioinfo/pi-duckdb-c-extension-skills@v0.2.1
```
