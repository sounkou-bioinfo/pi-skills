# Bootstrapping Pattern for R / CRAN-Ready DuckDB Extensions

This note captures a practical pattern for R packages that need to ship or prepare a DuckDB extension in a CRAN-friendly way.

It is inspired by the kind of packaging concerns seen around DuckTinyCC, DuckHTS, and related R package workflows:

- keep native extension semantics outside the R wrapper layer
- keep the R package install story explicit
- make platform-specific bootstrap work happen in install/build hooks, not hidden at runtime
- keep generated docs and installed payload layout predictable

## Core idea

For a CRAN-ready R package around a DuckDB extension, separate these concerns:

1. **native extension source/build tree**
2. **R package wrapper layer**
3. **install-time/bootstrap logic**
4. **installed extension payload under `inst/`**

The package should make it obvious:

- what gets built before install
- what gets copied into the installed package
- what tiny target-machine bootstrap steps still happen during `R CMD INSTALL`
- what the runtime load path is after install

## Recommended generic layout

A useful pattern is:

- top-level extension repo for native build/test
- `R/` for user-facing helpers
- `src/Makevars` / `src/Makevars.win` for package-native compilation rules
- `configure` / `configure.win` for install-time probing or tiny bootstrap tasks when needed
- `cleanup` for removing configure/install byproducts when appropriate
- `inst/duckdb_extension/` for installed extension sources or artifacts
- `inst/function_catalog/` for generated reference material
- `README.Rmd` for executable docs

## What "bootstrap" should mean here

Bootstrap steps should be small and explicit.

Good examples:

- discovering the correct toolchain path
- generating a tiny compatibility file on the target machine
- copying or selecting the right extension artifact
- recording install-time paths or platform facts
- verifying the built extension exists where the R wrapper expects it

Bad examples:

- performing a huge hidden build during first function call
- downloading large opaque payloads at runtime
- making runtime success depend on undocumented shell state

## Pattern: top-level build, package install, runtime load

A strong generic sequence is:

1. build/test the extension in the native repo workflow
2. stage the installable payload under `inst/duckdb_extension/`
3. use `configure` / `configure.win` only for small target-machine adaptations
4. let R helpers load the installed extension from package paths

This keeps CRAN-facing install logic narrow.

## Example responsibilities

### `configure` / `configure.win`

Use these scripts for things like:

- locating a required system tool
- generating a tiny compatibility file from the local machine
- choosing a platform-specific installed path
- writing small config fragments for `src/Makevars*`

### `cleanup`

Use `cleanup` to remove generated configure/install byproducts that should not linger in the source tree after checks.

### `src/Makevars` / `src/Makevars.win`

Keep compiler and linker rules here, not buried across wrapper scripts.

### `R/` wrappers

R helpers should:

- locate the installed extension payload
- open DuckDB connections
- `LOAD` or install/load the extension predictably
- expose friendly R entry points over SQL

## Example bootstrap sketch

A very small `configure.win` pattern might look like:

```sh
#!/bin/sh
# Pseudocode only

echo "Preparing Windows-specific extension bootstrap"

# Example: generate a small compatibility file on the target machine
# because the exact local runtime/toolchain surface is machine-specific.

# write a config fragment consumed by src/Makevars.win or R helpers
cat > src/Makevars.user <<EOF
EXT_PAYLOAD_DIR=inst/duckdb_extension
EOF
```

A minimal R-side loader helper might look like:

```r
extension_path <- system.file("duckdb_extension", package = "mypkg")
stopifnot(nzchar(extension_path))
DBI::dbExecute(con, sprintf("LOAD '%s'", normalizePath(file.path(extension_path, "myext.duckdb_extension"), winslash = "/")))
```

## Why this is CRAN-friendlier

Because it avoids a fuzzy install story.

Reviewers and maintainers can see:

- what native work happens where
- what target-machine adaptation exists
- what gets installed under `inst/`
- how runtime loading finds the extension

## Practical rule

If a bootstrap step is needed for CRAN portability, put it in one of:

- `configure`
- `configure.win`
- `src/Makevars*`
- a documented staging script in `tools/` or `scripts/`

Do not hide it inside an arbitrary first-call runtime side effect.
