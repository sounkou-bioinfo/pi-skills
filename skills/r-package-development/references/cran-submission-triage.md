# CRAN Submission Triage

Use this as a quick map from a CRAN message to likely fixes.

## If CRAN says examples are wrapped too much

Check:

- are executable examples incorrectly in `\\dontrun{}`?
- are all examples hidden in `\\donttest{}` unnecessarily?
- should some examples use `if (interactive())` instead?
- can you add a smaller toy example that runs quickly?

## If CRAN says return values are undocumented

Check:

- missing `@return` in roxygen source
- stale generated `.Rd` files
- side-effect-only functions lacking explicit return docs

Then regenerate docs.

## If CRAN reports repeated manual issues

Check:

- did you edit `.Rd` directly instead of source roxygen?
- did you rerun `make rd` / `roxygen2::roxygenize()` before submission?

## If CRAN complains about DESCRIPTION text

Check:

- `Description` too thin or too short
- software/package/API names not in single quotes where appropriate
- unexplained acronyms
- `Title` not in title case
- malformed DOI/URL references
- unnecessary `+ file LICENSE`

## If CRAN complains about console output

Check:

- unconditional `print()` / `cat()` / `writeLines()`
- logging that cannot be suppressed
- whether `message()` or `verbose` would be more appropriate

## If CRAN complains about side effects

Check:

- `options()`, `par()`, or working directory changes not restored
- writing to `.GlobalEnv`
- writing to home directory or package directory during checks
- temp files not cleaned up

## If CRAN reports overall checktime or CPU usage

Check:

- examples/vignettes/tests too heavy
- unnecessary iterations
- large data where toy data would do
- more than 2 cores used in checks

## If CRAN flags package availability checks

Check:

- use of `installed.packages()` instead of `requireNamespace()`

## If CRAN flags random seeds

Check:

- hard-coded `set.seed()` inside user-facing functions
- whether seed should be a user-controlled argument instead
- examples/tests should stay reproducible, but functions should not impose a fixed seed

## If CRAN flags package size

Check:

- oversized bundled data or inst assets
- whether large files can move out of the main package
- whether justification belongs in `cran-comments.md`

## Reviewer notes

When in doubt, add concise context to `cran-comments.md` explaining:

- unusual examples
- package size
- external requirements
- platform-specific behavior
- anything a reviewer would otherwise have to infer
