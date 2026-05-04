---
name: r-package-development
description: Guides creation, maintenance, checking, testing, documenting, and releasing R packages using project-native workflows such as Makefiles, tinytest, roxygen2, base R, and optional tools like usethis, pkgdown, air, or jarl. Use when working on any R package or CRAN-style package workflow.
---

# R Package Development

Use this skill when creating or maintaining an R package, especially when the project has its own workflow via `Makefile`, `tinytest`, `roxygen2`, `R CMD build`, and `R CMD check`. Optional helpers like `usethis`, `pkgdown`, `air`, and `jarl` can still be used when they match the project.

## What this skill covers

- Create a new R package structure
- Add package metadata and dependencies
- Document functions with roxygen2
- Manage `NAMESPACE` via roxygen tags
- Write and run tests with the package's chosen framework, especially `tinytest`
- Run local package checks
- Use project Makefile targets when present
- Manage `NEWS.md` in reverse chronological order
- Use a consistent vendored C/C++ code strategy
- Build sites with `pkgdown` when configured
- Format code with `air` when the project uses or wants it
- Lint code with `jarl` when the project uses or wants it
- Prepare for release or CRAN submission

## Working style

When using this skill:

1. Inspect the package root for `DESCRIPTION`, `NAMESPACE`, `R/`, `man/`, `tests/`, `inst/tinytest/`, `vignettes/`, `.Rbuildignore`, and any `Makefile`.
2. Prefer the repository's existing workflow over introducing a new one.
3. Prefer modifying source files and regenerating derived artifacts rather than editing generated files by hand.
4. Treat `NAMESPACE` and `man/*.Rd` as generated when the package uses roxygen2.
5. Never manually edit roxygen2-generated artifacts or roxygen tags as a substitute for fixing the underlying R source documentation block.
6. Use package-oriented commands from the package root.
7. Make the smallest safe change and run the most relevant checks afterward.
8. For CRAN-facing work, anticipate common review issues in examples, DESCRIPTION text, side effects, temp files, and overall check behavior rather than waiting for CRAN to report them.

## First checks

Identify whether the current directory is an R package:

```bash
ls
```

Look for at least:

- `DESCRIPTION`
- `R/`
- optionally `NAMESPACE`, `man/`, `tests/`, `inst/tinytest/`, `tests/testthat/`, `Makefile`

If needed, inspect metadata:

```bash
Rscript -e 'desc <- read.dcf("DESCRIPTION"); print(desc[, c("Package", "Version", "Title")])'
```

## Common workflows

### 1) Create a new package

If the user wants a new package scaffold, prefer `usethis`:

```bash
Rscript -e 'usethis::create_package(".", open = FALSE)'
```

Then commonly add:

```bash
Rscript -e 'usethis::use_mit_license()'
Rscript -e 'usethis::use_readme_rmd()'
Rscript -e 'usethis::use_roxygen_md()'
Rscript -e 'usethis::use_pkgdown()'
Rscript -e 'usethis::use_git_ignore(c(".Rproj.user", ".Rhistory", ".Rdata", ".httr-oauth"))'
Rscript -e 'usethis::use_build_ignore(c("^.*\\.tar\\.gz$", "^.*\\.Rcheck$"))'
Rscript -e 'usethis::use_news_md()'
```

Prefer `usethis` for package skeleton setup, `.gitignore`, and `.Rbuildignore` management.

### 2) Add or update dependencies

Prefer package helpers over editing by hand when available:

```bash
Rscript -e 'usethis::use_package("dplyr")'
Rscript -e 'usethis::use_package("testthat", type = "Suggests")'
Rscript -e 'usethis::use_package("roxygen2", type = "Suggests")'
```

Dependency guidance:

- `Imports`: packages needed at runtime
- `Suggests`: tests, examples, vignettes, optional integrations
- `Depends`: use sparingly
- `LinkingTo`: compiled-code interfaces

### 3) Document package code

If roxygen2 is used, update the roxygen blocks in `R/*.R` and regenerate docs:

```bash
make rd
# or
R -e 'roxygen2::roxygenize(load_code = "source")'
```

Prefer roxygen blocks like:

```r
#' Title
#'
#' Description.
#'
#' @param x Description of x.
#' @param y Description of y.
#' @return Description of return value.
#' @export
my_function <- function(x, y) {
  x + y
}
```

Never patch generated `.Rd` or `NAMESPACE` files by hand when roxygen2 is in use.
Never make ad hoc manual tag edits without updating the surrounding source documentation block coherently and then regenerating docs.

### 4) Add tests

Follow the repository's existing framework.

If the package uses `tinytest`, prefer `inst/tinytest/` and package-level runners such as:

```bash
R -e "tinytest::test_package('pkgname', testdir = 'inst/tinytest')"
make test
make test1
make test2
```

A common minimal runner in `tests/tinytest.R` looks like:

```r
library(pkgname)
if (requireNamespace("tinytest", quietly = TRUE)) {
  tinytest::test_package("pkgname")
}
```

If the package uses `testthat`, use its native conventions instead:

```bash
Rscript -e 'usethis::use_test("my-function")'
Rscript -e 'testthat::test_file("tests/testthat/test-my-function.R")'
```

### 5) Run package checks

Use the lightest check that matches the task, then escalate. If a `Makefile` exists, prefer its targets first.

For CRAN-facing packages, also think ahead about common review triggers:

- examples wrapped too aggressively or incorrectly
- missing return-value documentation
- long overall check time
- temp-file detritus
- writing outside `tempdir()` during examples/tests
- unsuppressible console output
- use of more than 2 cores during checks

Typical Makefile-oriented flow:

```bash
make rd
make dev-install
make test
make build
make check
```

Direct command equivalents:

```bash
R -e 'roxygen2::roxygenize(load_code = "source")'
R CMD INSTALL --preclean .
R -e "tinytest::test_package('pkgname', testdir = 'inst/tinytest')"
R CMD build .
R CMD check *.tar.gz
```

Optional formatting/linting steps when the project uses them:

```bash
air format R/ tests/ inst/tinytest/
jarl check R/ tests/ inst/tinytest/
# or
jarl check R/ tests/ inst/tinytest/ --fix
```

When check output reports `NOTE`, `WARNING`, or `ERROR`, fix the underlying cause and rerun the relevant step.

### 6) Build package website

If `pkgdown` is configured:

```bash
Rscript -e 'pkgdown::build_site()'
```

### 7) Prepare a release

Useful release helpers:

```bash
Rscript -e 'devtools::check_win_devel()'
Rscript -e 'devtools::check_rhub()'
Rscript -e 'devtools::release()'
```

Also prepare reviewer-facing notes when relevant:

- why package size is acceptable
- why particular examples use `\\donttest{}` or `if (interactive())`
- any external software, network, or platform caveats
- anything unusual a CRAN reviewer would otherwise have to infer

## File-specific guidance

### DESCRIPTION

Maintain:

- `Package`
- `Title`
- `Version`
- `Authors@R`
- `Description`
- `License`
- `Encoding: UTF-8`
- `Roxygen` / `RoxygenNote` when roxygen2 is used
- dependency fields (`Imports`, `Suggests`, etc.)

CRAN-facing DESCRIPTION guidance:

- Keep `Description` to a short informative paragraph, typically at least two sentences
- Put software/package/API names in single quotes where appropriate
- Explain non-obvious acronyms
- Keep `Title` in title case
- Prefer `Authors@R` as the source of truth rather than hand-maintained `Author`/`Maintainer`
- Use auto-linkable references like `Author (year) <doi:...>` or `<https:...>` with no stray spaces
- Only use `+ file LICENSE` when the selected license genuinely needs an extra file

Citation practice in `Authors@R`:

- Use `c("aut", "cre")` for the main package author/maintainer
- Use `"ctb"` for contributors
- Use `"cph"` for copyright holders of bundled or adapted third-party code
- When vendoring external C/C++ code, record upstream copyright holders in `Authors@R` with `cph` where appropriate
- Keep `Authors@R`, `License`, and `inst/LICENSE.note` consistent with each other

### NAMESPACE

- Prefer generating with roxygen2
- Avoid hand editing when roxygen tags are the source of truth
- Never manually patch generated exports/imports in `NAMESPACE`
- Use `@export`, `@importFrom`, and related tags deliberately in source comments only

### R/

- Keep one or a few related functions per file
- Prefer clear function names and explicit imports
- Add roxygen comments directly above exported functions
- Use `R/aaa.R` for package-level roxygen when needed
- `aaa.R` should include the roxygen2 tags required for dynamic library loading and namespace imports, e.g. `@useDynLib pkgname, .registration = TRUE` and package-level `@importFrom` tags when appropriate
- Regenerate `NAMESPACE` after changing package-level roxygen tags

### inst/tinytest/ or tests/

- Follow the project's existing convention
- For `tinytest`, keep tests in `inst/tinytest/`
- Use behavior-focused tests
- Prefer small, isolated expectations
- Add regression tests for bug fixes
- For CRAN-facing checks, keep tests deterministic, avoid unnecessary temp-file leftovers, and avoid using more than 2 cores

### tests/testthat/

- Use only when the package already uses `testthat` or the user asks for it

### tools/ and vendored code

- Keep vendored third-party C/C++ sources, patch files, download helpers, and update scripts in `tools/` or another clearly documented staging area
- Record upstream source, version, checksum, local patches, and update procedure
- Treat patch files as first-class project artifacts, not incidental local hacks
- Prefer storing local changes as named patch files instead of silently editing vendored sources
- Avoid hand-edited mystery copies of external code in `src/`
- Generated or unpacked vendor artifacts should be reproducible from scripts where practical
- Document how vendored code is copied or unpacked into the build tree
- For bundled external code, credit upstream copyright holders in `Authors@R` using `cph` when appropriate

### configure / configure.win / Makevars

- Read `configure`, `configure.win`, `src/Makevars`, and `src/Makevars.win` before changing native build behavior
- Prefer the compiler, archiver, and make tool reported by `R CMD config` rather than hardcoding toolchains
- Keep platform-specific flags and linker behavior aligned with R's own build environment
- Document how compiler flags, debug flags, and link mode are selected
- For runtime library lookup, prefer explicit platform-aware strategies such as rpath on Unix-alikes and colocated DLLs on Windows
- When Windows and Unix use different include or linker strategies, preserve the reason in comments
- When native code needs platform-specific behavior, prefer a dedicated platform layer that implements platform adaptations of the public or internal API behind a stable interface
- Keep `#ifdef`, platform macros, and OS-specific branching confined to a small number of platform files instead of scattering them across the whole codebase
- Let higher-level package code call platform wrappers or adapter functions rather than embedding platform conditionals everywhere

### NEWS.md

- Keep newest changes first
- Add entries at the top under the unreleased or current development version
- Use concise, user-facing bullets
- Group related fixes or features together

### src/ platform layer

- When necessary, create a platform layer for native code, e.g. files such as `platform.h`, `platform.c`, `platform_unix.c`, `platform_windows.c`, or similarly named adapters
- Define platform-level adaptations of public or internal API functions there
- Keep headers shared and stable, with platform differences implemented behind the interface
- Prefer moving OS-specific includes, constants, shims, and macro-heavy logic into those files
- This helps restrict `#ifdef` and macro usage to specific files and keeps the rest of the code easier to read, test, and review

### src/ native API naming

- For package C code, prefix functions that touch the R C API or are intended to be exposed through `.Call` with `RC_`
- Use the `RC_` prefix to make R-facing/native-interface functions easy to identify during review, registration, and debugging
- Keep lower-level helper functions on a separate naming scheme when they are not part of the R-facing boundary
- Apply the convention consistently in declarations, definitions, registration tables, and R wrappers

### vignettes/

- Use for workflows and package narratives
- Keep code examples reproducible and dependency-aware
- Keep runtime modest for CRAN-facing packages
- Avoid writing outside `tempdir()` and clean up temporary artifacts when applicable

## Related skills

- If the package uses S7 classes, generics, methods, or package integration patterns, also load [the S7 development skill](../s7-development/SKILL.md).

## Best practices

- Prefer the repository's existing automation, especially `make` targets when present
- For CRAN-facing packages, proactively check common cookbook-style issues in DESCRIPTION text, examples, output behavior, temp files, side effects, and CPU usage before submission
- Prefer `Rscript -e` or `R -e` commands for non-interactive automation
- Keep generated artifacts synchronized after source changes
- Use `usethis` for skeleton setup, `.gitignore`, and `.Rbuildignore` maintenance when appropriate
- If a package uses `renv`, respect the lockfile and project library workflow
- If the project uses CI, align local checks with CI steps
- Avoid introducing heavyweight dependencies unless justified
- Do not switch a package from `tinytest` to `testthat` unless explicitly requested
- Use `air` and `jarl` as optional complements to the package workflow, not substitutes for testing or `R CMD check`
- If the repository already uses `styler`, `lintr`, or another formatter/linter, prefer the existing convention unless asked to migrate
- Keep `NEWS.md` reverse chronological, with newest entries first
- For vendored code, preserve provenance and a reproducible update path
- When studying external code or package behavior, prefer a checked-out reference under `.sync/` when the project uses that convention
- For R package references, consider generating a single `llm.txt`-style source/doc dump with `rdocdump` so code, docs, and vignettes can be reviewed together
- For CRAN-facing packages, be conservative about examples, timings, and external services
- Prefer `requireNamespace()` over `installed.packages()` for availability checks
- Avoid hard-coded seeds inside user-facing functions; expose seed control instead when needed
- Prefer suppressible output or explicit `verbose` controls over unconditional `print()`/`cat()`

## Troubleshooting

### Missing package tools

If commands fail because packages are missing, install what is needed:

```bash
Rscript -e 'install.packages(c("roxygen2", "tinytest", "pkgdown", "usethis"))'
```

### Native code packages

If the package contains `src/`, also inspect:

- `src/Makevars`
- `src/Makevars.win`
- compiled-code registration
- system requirements in `DESCRIPTION`

### Generated files out of date

If docs or namespace are stale, run the project's doc step, for example:

```bash
make rd
# or
R -e 'roxygen2::roxygenize(load_code = "source")'
```

If CRAN reports repeated manual issues and the package uses roxygen2, fix the source `R/*.R` documentation blocks and regenerate; do not patch `.Rd` files directly.

## References

- [Workflow reference](references/workflow-reference.md)
- [Formatting and linting](references/formatting-and-linting.md)
- [CRAN cookbook notes](references/cran-cookbook-notes.md)
- [CRAN submission triage](references/cran-submission-triage.md)
- [Release checklist](references/release-checklist.md)
- [Vendoring strategy](references/vendoring-strategy.md)
- [Related S7 skill](../s7-development/SKILL.md)
