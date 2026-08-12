---
name: r-package-development
description: Maintain an R package through DESCRIPTION/NAMESPACE, documentation, tests, native configure/build logic, tarball checks, websites, and release. Use for generic CRAN-style package mechanics.
---

# R package development

## Authority first

Read package/repository instructions, `DESCRIPTION`, `NAMESPACE`, build files, test framework, and `NEWS.md` before editing. Use the package's Makefile/scripts as command authority; do not replace established workflows with tool preference.

Keep authored and generated files distinct. Edit `.Rmd` rather than rendered Markdown, roxygen sources rather than generated `.Rd`/`NAMESPACE` where applicable, and declared vendor/bootstrap inputs rather than staged output.

## Package contract

- `DESCRIPTION`: accurate dependencies, system requirements, license, URLs, and version.
- `NAMESPACE`: minimal exports/imports and registered native routines; avoid broad imports.
- `R/`: idiomatic R admission/orchestration; no hidden network, global-option, working-directory, or user-file side effects.
- `src/`: registered symbols, explicit ownership/bounds, portable configure/Makevars behavior, host-visible errors.
- tests: deterministic public behavior, errors, installed artifacts, and optional-dependency paths.
- `NEWS.md`: user-visible changes, newest first.

Use `tempfile()`/`tempdir()` for examples/tests and restore options/environment/state with `on.exit()`. Skip only for a declared unavailable capability, not to hide defects. Keep examples deterministic, short, and offline unless explicitly `\dontrun{}` for a real external requirement.

## Native and vendored code

Pin/checksum vendors, preserve licenses, patch through a ledger, and make acquisition separate from offline build. Keep Unix and Windows configure paths aligned. Test source tarballs, not only the checkout; installed-file layout is part of the API.

## Validation

Run the package's focused tests and documentation generation, then build a source tarball and run `R CMD check` under the target CRAN settings. Inspect every WARNING/NOTE rather than normalizing it away. Test optional-feature absence and clean-install behavior. Render pkgdown/README only from authorities and run reverse/dependent checks when public contracts change.

Use `references/workflow-reference.md`, `release-checklist.md`, or the CRAN triage notes only when that phase is active. Repo-specific skills own stricter gates and domain semantics.
