---
name: duckdb-c-extension-r-bindings
description: Guides packaging DuckDB C extensions with R bindings, including repository layout, installed artifacts, SQL wrappers, generated docs, and native-versus-R responsibility boundaries. Use when building or restructuring an R package around a DuckDB extension.
---

# DuckDB C Extension R Bindings

Use this skill when the extension should be usable naturally from R without turning the R package into the native core.

## Core position

A strong R integration usually keeps three things separate:

1. the native DuckDB extension
2. the installed extension artifacts bundled with the package, if applicable
3. the ergonomic R wrapper layer

The R package should expose and document the extension well, but core semantics should remain native and SQL-centered.

## Recommended layout pattern

A common practical layout is:

- `R/` for user-facing wrapper functions
- `man/` for generated docs
- `inst/duckdb_extension/` for bundled extension sources or installable artifacts when packaging that way
- `inst/extdata/` for fixtures and examples
- `inst/function_catalog/` for machine-readable/generated SQL catalog files
- `inst/tinytest/` or `tests/` for R-level tests
- top-level native extension files if the repo also builds the extension directly

Not every repo needs all of these, but the separation should stay clear.

## Main principles

### 1) Keep the native contract canonical

R helpers should mainly do things like:

- install or locate the extension
- open DuckDB connections
- call SQL functions cleanly
- validate R-specific arguments
- present results in idiomatic R shapes

Do not let R become the only specification of semantics.

### 2) Bundle artifacts intentionally

If the R package ships extension code or build artifacts:

- keep install paths explicit
- document how artifacts are refreshed
- keep vendored native code provenance visible
- do not duplicate large native trees in several places unless unavoidable

### 2a) Use an explicit bootstrap pattern for CRAN-ready packaging

For CRAN-oriented packages, bootstrap work should be small, explicit, and install-time oriented.

A strong pattern, seen in the general direction used around DuckTinyCC and DuckHTS-style R packaging, is:

- keep the native extension build/test workflow at the repo level
- stage installed payloads under `inst/duckdb_extension/` when packaging that way
- use `configure` / `configure.win` only for narrow target-machine adaptation
- keep compiler/linker rules in `src/Makevars` / `src/Makevars.win`
- let R wrappers load the installed extension from package paths

This is usually more CRAN-friendly than hiding large native bootstrap work inside first-call runtime behavior.

Typical acceptable bootstrap tasks include:

- probing for a local toolchain detail
- generating a tiny compatibility file on the target machine
- writing a small config fragment consumed by `src/Makevars*`
- selecting or locating the installed extension payload

Avoid bootstrap patterns where the first exported R call silently performs a large native build, downloads opaque binaries, or depends on undocumented shell state.

### 3) Map R names to SQL names clearly

If R exports helpers such as `pkg_feature()` that call SQL functions:

- keep the correspondence documented
- avoid silent divergence between R defaults and SQL defaults
- keep examples easy to translate back to SQL

### 4) Test the wrapper layer separately

Even if native tests pass, R can still fail via:

- argument coercion mistakes
- path handling bugs
- temporary-file behavior
- installation/layout issues
- platform-specific load/install problems

### 5) Keep documentation generation systematic

For projects with many SQL functions, a catalog-driven approach often helps generate:

- R wrapper docs
- extension function reference pages
- tables for README/pkgdown sites

### 6) Prefer `README.Rmd` with a custom knitr engine for executable docs

A strong pattern used in both DuckTinyCC and DuckHTS is:

- keep `README.md` generated from `README.Rmd`
- define a custom knitr `sql` engine near the top of the document
- run real DuckDB CLI examples from documentation chunks
- optionally auto-load the built extension before each SQL chunk
- include generated function-catalog markdown instead of hand-maintaining long function lists

This keeps docs closer to the real extension workflow and makes drift much easier to catch.

#### What DuckTinyCC shows

DuckTinyCC uses a simple custom `sql` engine in `README.Rmd` that sends chunk contents to `duckdb -unsigned` and returns the output through knitr.

That is a good minimal pattern when you want runnable SQL docs without a lot of wrapper logic.

#### What DuckHTS adds

DuckHTS uses the same general approach but adds convenience logic to auto-load the built extension path before each SQL chunk.

That is a strong default when most examples should run against the just-built extension and you want short, readable SQL chunks in docs.

#### Generic example

A minimal example looks like:

```r
knitr::knit_engines$set(sql = function(options) {
  code <- paste(options$code, collapse = "\n")
  extension_path <- normalizePath("build/release/myext.duckdb_extension", mustWork = FALSE)
  extension_path <- gsub("'", "''", extension_path, fixed = TRUE)
  code <- paste(sprintf("LOAD '%s';", extension_path), code, sep = "\n")

  if (isTRUE(options$eval)) {
    out <- system2("duckdb", "-unsigned", input = code, stdout = TRUE, stderr = TRUE)
    status <- attr(out, "status")
    if (!is.null(status) && status != 0) {
      stop(paste(out, collapse = "\n"))
    }
    knitr::engine_output(options, code, out)
  } else {
    knitr::engine_output(options, code, NULL)
  }
})
```

Then the README can contain direct SQL chunks such as:

````markdown
```{sql eval=TRUE, collapse=FALSE, comment=""}
SELECT * FROM my_table_function('example.dat');
```
````

If the project also generates a function catalog, prefer embedding that generated markdown in the README instead of copying the same list by hand.

## Good outcomes

- clean R ergonomics over a native core
- stable install and load paths
- low duplication of semantics
- clear docs from SQL to R

## Anti-patterns

- R wrappers that quietly redefine native semantics
- undocumented artifact copying
- no clear path from R helper to underlying SQL function
- wrapper docs drifting away from actual extension behavior

## Related skills

- [DuckDB C extension function catalog](../duckdb-c-extension-function-catalog/SKILL.md)
- [DuckDB C extension testing and interop](../duckdb-c-extension-testing-and-interop/SKILL.md)

## References

- [R package layout pattern](references/r-package-layout-pattern.md)
- [Wrapper responsibility split](references/wrapper-responsibility-split.md)
- [README.Rmd custom knitr engine pattern](references/readme-rmd-custom-engine-pattern.md)
- [CRAN bootstrap pattern](references/cran-bootstrap-pattern.md)
