---
name: r-package-development
description: Use for R package metadata, documentation generation, builds, checks, or release work.
---

# R package development

When writing or reviewing R code, apply
[We Use R Damnit](../we-use-r-damnit/SKILL.md).

## Find the relevant authority

Follow package/repository instructions. Consult `DESCRIPTION` for dependencies/metadata, `NAMESPACE` or its generator for exports/registration, build files for native/install work, and the affected tests for behavior changes. Use the package's Makefile/scripts as command authority; a README typo does not require a tour of all these files.

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

Use affected tests while implementing behavior changes; regenerate documentation when its authored source changes. Before handing off native, dependency, public API, packaging, or release changes, build a source tarball and run `R CMD check` under the target settings, plus repository-required gates. Test optional-feature absence and clean installation when those contracts change. Prose-only changes need the affected render/link checks, not an automatic package check.

Inspect every WARNING/NOTE rather than normalizing it away. Render pkgdown/README only from authorities and run affected reverse/dependent checks when public contracts change. Repository release requirements remain authoritative.

Use `references/workflow-reference.md`, `release-checklist.md`, or the CRAN triage notes only when that phase is active. Repo-specific skills own stricter gates and domain semantics.
