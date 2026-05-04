# README.Rmd Custom knitr Engine Pattern

A useful documentation pattern seen in both DuckTinyCC and DuckHTS is:

- keep `README.md` generated from `README.Rmd`
- define a custom knitr SQL engine near the top of `README.Rmd`
- run real DuckDB CLI examples during render
- optionally auto-load the built extension before each SQL chunk
- include generated function-catalog output rather than duplicating long function lists by hand

## Why this pattern is good

It keeps docs close to the real extension workflow:

- examples execute against DuckDB, not a hand-waved pseudocode layer
- `README.md` stays reproducible
- extension examples break during render if they drift
- generated catalogs can be embedded directly into docs

## DuckTinyCC-style minimal engine

DuckTinyCC uses a simple custom `sql` engine pattern in `README.Rmd`:

```r
knitr::knit_engines$set(sql = function(options) {
  code <- paste(options$code, collapse = "\n")
  if (isTRUE(options$eval)) {
    out <- system2("duckdb", "-unsigned", input = code,
                   stdout = TRUE, stderr = TRUE)
    knitr::engine_output(options, code, out)
  } else {
    knitr::engine_output(options, code, NULL)
  }
})
```

Then a runnable chunk can be as direct as:

```markdown
```{sql eval=TRUE, collapse=FALSE, comment=""}
LOAD 'build/release/myext.duckdb_extension';
SELECT my_function();
```
```

## DuckHTS-style convenience engine

DuckHTS uses the same basic idea but adds convenience logic to auto-load the built extension unless disabled:

```r
knitr::knit_engines$set(sql = function(options) {
  code <- paste(options$code, collapse = "\n")
  load_extension <- is.null(options$load_extension) || isTRUE(options$load_extension)
  if (load_extension) {
    extension_path <- normalizePath("build/release/myext.duckdb_extension", mustWork = FALSE)
    extension_path <- gsub("'", "''", extension_path, fixed = TRUE)
    code <- paste(sprintf("LOAD '%s';", extension_path), code, sep = "\n")
  }
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

This is often the better default for extension repos because it keeps chunks short while still running the real extension path.

## Function catalog include pattern

If the project generates `functions.md` from a catalog file, the README can include it directly:

```r
cat(paste(readLines("inst/function_catalog/functions.md"), collapse = "\n"))
```

That avoids maintaining long function lists by hand in multiple places.

## Suggested rule to encode in the skill

For DuckDB extension repos with R docs:

- prefer `README.Rmd` as the editable source
- render `README.md` from it
- use a custom knitr SQL engine for executable SQL examples
- consider auto-loading the built extension for docs chunks
- include generated function-catalog output instead of duplicating function lists manually
