# R Package Workflow Reference

## Inspect package metadata

```bash
Rscript -e 'read.dcf("DESCRIPTION")'
Rscript -e 'packageVersion("pkgname")'
```

## Useful usethis helpers

```bash
Rscript -e 'usethis::use_package_doc()'
Rscript -e 'usethis::use_lifecycle_badge("experimental")'
Rscript -e 'usethis::use_news_md()'
Rscript -e 'usethis::use_github_action_check_standard()'
Rscript -e 'usethis::use_coverage()'
Rscript -e 'usethis::use_cran_comments()'
Rscript -e 'usethis::use_git_ignore(c(".Rproj.user", ".Rhistory", ".Rdata"))'
Rscript -e 'usethis::use_build_ignore(c("^.*\\.tar\\.gz$", "^.*\\.Rcheck$"))'
```

## Common make/base-R commands

```bash
make rd
make dev-install
make test
make build
make check

R -e 'roxygen2::roxygenize(load_code = "source")'
R CMD INSTALL --preclean .
R -e "tinytest::test_package('pkgname', testdir = 'inst/tinytest')"
R CMD build .
R CMD check *.tar.gz
```

## Optional formatting and linting tools

```bash
air format R/ tests/ inst/tinytest/
jarl check R/ tests/ inst/tinytest/
jarl check R/ tests/ inst/tinytest/ --fix
```

Use these only when they fit the repository workflow. They complement, but do not replace, docs/tests/check steps.

## roxygen2 tags often used

- `@export`
- `@param`
- `@returns` or `@return`
- `@examples`
- `@seealso`
- `@inheritParams`
- `@importFrom pkg fun`
- `@family`

Guideline: update roxygen in `R/*.R`, then regenerate. Never hand-edit generated `NAMESPACE` or `.Rd` files.

## Native-code naming convention

- Prefix C functions that touch the R C API or are exported to `.Call` with `RC_`
- Keep the convention consistent across C source, headers, registration, and R wrappers

## Typical package layout

```text
DESCRIPTION
NAMESPACE
Makefile
R/
  aaa.R
man/
inst/tinytest/
tests/tinytest.R
vignettes/
README.Rmd
_pkgdown.yml
```

## Package-level roxygen in `aaa.R`

A common pattern is to keep package-level namespace roxygen in `R/aaa.R`, for example:

```r
#' @useDynLib pkgname, .registration = TRUE
#' @importFrom somepkg some_fun
NULL
```

Use this file for dynload-related roxygen tags and package-level imports, then regenerate `NAMESPACE`. 

## External reference pattern

When developing against existing codebases or upstream packages, a useful pattern is:

- keep source references in a local `.sync/` directory when the project uses mirrored checkouts
- for R packages, generate a single review artifact containing source, docs, and vignettes

Example with `rdocdump`:

```bash
Rscript -e 'install.packages("rdocdump")'
Rscript -e 'rdocdump::rdd_to_txt(pkg = "S7", file = "S7.llm.txt", force_fetch = TRUE, keep_files = "none")'
```

This is useful when you want an `llm.txt`-style snapshot of an R package for review, search, or prompting.

## NEWS.md guidance

- Keep newest changes first
- Add new bullets at the top
- Prefer user-facing wording over internal implementation detail

## CRAN-facing checklist themes

Before submission, quickly sanity-check:

- `Description` is informative and not too thin
- `Title` is in title case
- software/package names are quoted appropriately in DESCRIPTION text
- examples use the right wrappers (`\\donttest{}`, `if (interactive())`, `try()`, etc.)
- return values are documented via `@return` / `\\value{}`
- examples, tests, and vignettes do not leave temp-file detritus
- code does not write outside `tempdir()` during checks
- code restores `options()`, `par()`, and working directory changes
- tests/examples do not use more than 2 cores
- reviewer context is captured in `cran-comments.md` when needed

## CI-friendly sequence

```bash
air format R/ tests/ inst/tinytest/
jarl check R/ tests/ inst/tinytest/
make rd
make dev-install
make test
make check
```

If the repository does not use `air` or `jarl`, omit those steps rather than imposing them.
