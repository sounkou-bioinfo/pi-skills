# CRAN Cookbook Notes

These notes summarize practical CRAN-facing guidance from the `r-devel/cran-cookbook` project in a way that fits this skill's existing project-native workflow.

## DESCRIPTION

- Keep `Description` as a short, informative paragraph of at least two sentences.
- Put software, package, and API names in single quotes in `Title`/`Description` where appropriate.
- Explain non-obvious acronyms.
- Keep `Title` in title case.
- Prefer `Authors@R` over manually maintained `Author`/`Maintainer` fields.
- Use auto-linkable references in `Description`, e.g. `Author (year) <doi:...>` or `<https:...>` with no stray spaces.
- Only use `+ file LICENSE` when the license actually needs an extra file.

## Examples and manuals

- Prefer runnable toy examples; do not wrap everything in `\donttest{}` or `\dontrun{}` by default.
- Use wrappers precisely:
  - `\donttest{}` for long-running or network examples
  - `\dontrun{}` only when the example really cannot run
  - `if (interactive())` for genuinely interactive examples
  - `try()` for examples expected to error
  - `if (requireNamespace("pkg", quietly = TRUE))` for suggested packages
- Document return values clearly. With roxygen2, add `@return` in source and regenerate.
- If manuals are generated with roxygen2, never fix CRAN manual complaints by editing `.Rd` directly.

## Runtime behavior and side effects

- Never use `T`/`F` instead of `TRUE`/`FALSE`.
- Do not hard-code `set.seed(123)` inside user-facing functions; allow users to control seeds.
- Prefer suppressible output (`message()`, `warning()`, `stop()`, or `verbose`) over unsuppressible `print()`/`cat()`.
- If code changes `options()`, `par()`, or working directory, restore them immediately; in functions use `on.exit()` right after the change.
- Do not write to `.GlobalEnv`.
- Do not write by default to the user's home directory or package directory; use `tempdir()` in examples/tests where needed.
- Clean up temporary files created during checks.

## Dependencies and installation behavior

- Do not install packages or external software inside ordinary functions, examples, tests, or vignettes.
- Do not call `installed.packages()` just to test availability; prefer `requireNamespace()`.

## Check-time and compute limits

- Keep total check time modest; reduce examples/vignettes/tests if overall check time becomes a problem.
- In examples, tests, vignettes, and installation steps, avoid using more than 2 CPU cores.
- Keep source tarballs small where possible; if size is justified, explain it in `cran-comments.md`.

## Submission communication

- Use `cran-comments.md` to explain size notes, special examples, external requirements, and other reviewer-facing context.
- For CRAN-facing work, align with:
  - Writing R Extensions
  - CRAN Repository Policy
  - CRAN submission checklist
  - CRAN Cookbook
