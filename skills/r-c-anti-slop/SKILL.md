---
name: r-c-anti-slop
description: "Audits R and C source with the vendored Tree-sitter anti-slop analyzer, then removes only proven redundant guards, no-op handlers, and host-unsafe C assertions while preserving real invariants. Use when reviewing or simplifying defensive R/C code."
---

# R/C anti-slop

Use this skill when a request concerns overly defensive, repeated, or ceremony-heavy R
or C. It is a narrow AST audit, not a style score and not permission to delete validation.

## Authority and invocation

`extensions/anti-slop/` is the Pi bridge and `scripts/anti_slop.R` is the only rule
authority. The analyzer parses source with Tree-sitter; it has **no regex or alternate
parser fallback**. A missing grammar or a parse error is an explicit failed analysis,
not a clean result.

- For an agent: call `anti_slop` with a source-file or directory `path`, optional
  `language` (`auto`, `r`, or `c`), optional JSON `config`, and optional
  `max_findings`.
- For an interactive default review: `/anti-slop path/to/file.R`,
  `/anti-slop path/to/file.c`, or `/anti-slop .` for the current codebase.
- From this checkout: `Rscript scripts/anti_slop.R --format text path/to/file.R` or
  `Rscript scripts/anti_slop.R --format text .`.

A Git directory scans its tracked R/C files beneath the requested path, excluding ignored
build products and vendored files unless they are tracked. A non-Git directory recursively
scans recognized R (`.R`) and C (`.c`, `.h`, `.inc`) suffixes. `--language r` or
`--language c` restricts a directory scan. The finding limit applies to the complete
analysis, not separately to each file.

The runtime requires `treesitter` and the selected grammar package:
`treesitter.r` for R, `treesitter.c` for C. JSON output and configuration additionally
require `jsonlite`.

## Rule scope

Treat every finding as a review prompt. Read the enclosing function and prove that the
suggested deletion preserves behavior before editing.

### R rules

- `r-final-return` identifies only a `return(...)` that is the final expression of a
  braced function. R returns that expression automatically.
- `r-rethrow-handler` identifies only `tryCatch(..., error = function(e) stop(e))` with
  a one-argument handler that merely rethrows its caught condition.
- `r-duplicate-adjacent-guard` requires two adjacent `if` statements with the same
  Tree-sitter expression, a known side-effect-free validation condition, and an earlier
  `stop()` or `return()` consequence.
- `r-else-null` identifies `else NULL` only when the `if` is a standalone expression in
  a braced body, where an absent alternative already yields `NULL`.
- `r-private-helper-usage` reports every top-level private `.name <- function(...)`
  together with its direct call-site count **in the analysis scope**. A directory scan
  counts recognized direct calls across all selected R files. Callbacks and `get()` remain
  dynamic and are not counted automatically.
- `r-conditional-sprawl` reports an `if`, `while`, or `ifelse()`/`if_else()` test with
  more than three atomic `&&`, `||`, `&`, or `|` clauses. It reports the count and asks
  for the one decision or admission invariant being expressed.
- `r-implicit-length-test` reports `length(x)` and `!length(x)` as a condition. They
  rely on numeric-to-logical coercion (`0L` is false; positive lengths are true); use
  `length(x) == 0L` or `length(x) > 0L` to state the intended cardinality.

Do **not** remove ordinary scalar validation such as
`if (!is.logical(strict) || length(strict) != 1L || is.na(strict)) stop(...)`. That is
one clear admission invariant, not automatically redundant defensive code. Likewise,
retain a condition handler when it adds context, translates a condition class, records
cleanup, or changes control flow. For S7 objects, properties and validators own repeated
object invariants; `s7contract` owns admission conformance. Do not recreate either as a
sprawl of `.is_*()`, `.check_*()`, or `.validate_*()` helpers.

### C rules

- `c-final-void-return` identifies only a final bare `return;` in a `void` function.
- `c-duplicate-adjacent-guard` requires adjacent C `if` statements with the same
  side-effect-free condition and an earlier direct `return` consequence.
- `c-empty-else` identifies only `else {}`.
- `c-runtime-assert` identifies `assert(...)`. In an embedded extension, determine
  whether its predicate can depend on user input, allocation, I/O, or a recoverable host
  condition. Replace those cases with an explicit checked branch and host-visible error
  or status return. A proven internal development invariant may remain, or this rule may
  be disabled locally.

Do not turn checks into `assert()`, and do not delete a C check merely because it is
verbose. Keep concrete ownership, allocation-size, offset, and host-API failure checks.

## Configuration

Rules default to `warning`. A checked-in JSON file may set any named rule to `warning`,
`error`, or `off`, and may bound emitted findings:

```json
{
  "rules": {
    "r-final-return": "off",
    "r-private-helper-usage": "error",
    "c-runtime-assert": "error"
  },
  "max_findings": 50
}
```

Keep configuration close to a current team decision. Do not add a configuration file
just to suppress a finding that has not been reviewed. Unknown rule names and invalid
values fail explicitly.

## Repair and proof

1. Analyze the smallest affected source file.
2. Inspect the AST finding and surrounding control flow; for C, also identify the host
   error/ownership path that replaces a runtime assertion.
3. Make the smallest deletion or explicit error-path change. Do not introduce helper
   layers, validators, or generic wrappers merely to satisfy the analyzer.
4. Run the focused R/package, C, or SQL test that exercises the changed behavior.
5. Re-run anti-slop and `git diff --check`; report remaining findings rather than
   disabling rules silently.
