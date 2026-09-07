# Analyzer rule triggers

R rules, by exact trigger:

- `r-final-return`: a `return(...)` that is the final expression of a braced function (R returns that expression automatically).
- `r-rethrow-handler`: `tryCatch(..., error = function(e) stop(e))` with a one-argument handler that merely rethrows its caught condition.
- `r-duplicate-adjacent-guard`: two adjacent `if` statements with the same Tree-sitter expression, a known side-effect-free validation condition, and an earlier `stop()`/`return()` consequence.
- `r-else-null`: `else NULL` where the `if` is a standalone expression in a braced body, so an absent alternative already yields `NULL`.
- `r-redundant-else-after-termination`: an `else` on a standalone `if` whose true branch is exactly one `stop()` or `return()`; outdent the alternative after the terminating guard.
- `r-identical-if-branches`: a known side-effect-free condition whose true and false branches have identical parsed structure and token contents (including whitespace inside literals); confirm that forcing the condition is not contractual before removing it.
- `r-private-helper-usage`: every top-level private `.name <- function(...)` together with its direct call-site count in the analysis scope; callbacks and `get()` remain dynamic and are not counted.
- `r-single-use-predicate-helper`: a top-level, side-effect-free predicate helper with exactly one direct call from another assigned function in the analysis scope, regardless of whether its name starts with a dot.
- `r-scalar-validator-helper`: a dedicated helper that hand-rolls scalar-string validation by composing `is.character()`, `length()`, `is.na()`, and `nzchar()` instead of placing a concise check at a real admission boundary.
- `r-path-threat-model`: a helper that rejects parent path segments with a `grepl()` string pattern; require distinct producer/consumer principals and privileges rather than importing traversal-security posture into same-principal local R configuration.
- `r-conditional-sprawl`: any maximal boolean expression with more than three atomic `&&`, `||`, `&`, or `|` clauses, including equivalent direct clauses supplied through `all(...)`, `any(...)`, `all(c(...))`, or `any(c(...))`, whether used as a condition, assigned to a local alias, passed as an argument, or returned. Renaming or mechanically re-encoding the unchanged expression does not reduce its decision structure and must not evade the rule.
- `r-implicit-length-test`: `length(x)` or `!length(x)` used as a condition, relying on numeric-to-logical coercion (`0L` is false, positive lengths are true); use `length(x) == 0L` or `length(x) > 0L` to state the intended cardinality.
- `r-suppressed-integer-coercion`: `suppressWarnings(as.integer(x))`, including `base::` qualification, named first arguments, and extra parentheses around the coercion. This is an error: validate type, finiteness, integrality, and integer range before conversion instead of hiding coercion failures.
- `r-cyclomatic-complexity`: a function whose cyclomatic complexity is 15 or greater, enforcing a score below 15 with `cyclocomp`-compatible contributions for `if`, `for`, `while`, `repeat`, `&&`, and `||`; nested function bodies are scored independently, while `&`, `|`, and `ifelse()` do not add paths.

C rules, by exact trigger:

- `c-final-void-return`: a final bare `return;` in a `void` function.
- `c-duplicate-adjacent-guard`: adjacent C `if` statements with the same side-effect-free condition and an earlier direct `return` consequence.
- `c-empty-else`: `else {}`.
- `c-runtime-assert`: `assert(...)`. In an embedded extension, determine whether its predicate can depend on user input, allocation, I/O, or a recoverable host condition; replace those cases with an explicit checked branch and host-visible error or status return. A proven internal development invariant may remain, or this rule may be disabled locally.
