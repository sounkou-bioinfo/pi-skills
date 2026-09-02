---
name: r-c-anti-slop
description: Audit R/C source with the repository Tree-sitter analyzer. Use to review redundant guards, helper and validation-layer sprawl, false path threat models, cyclomatic complexity, no-op handlers, or host-unsafe C assertions.
---

# R/C anti-slop

## Authority

Use `scripts/anti_slop.R` directly or the `anti_slop` Pi tool. Tree-sitter is the only parser authority for native rules. Missing grammars and parse errors are failures; there is no regex or alternate-parser fallback.

File and directory scans are supported. Git directory scans use tracked R/C sources; other directories recurse over recognized suffixes. Direct-call counts used by helper rules are scope-wide review evidence; dynamic callback/get calls are intentionally not inferred.

Jarl is an optional complementary R linter, not a parser fallback or bundled dependency. Set `jarl = true` on the Pi tool, use `/anti-slop --jarl path`, or pass `--jarl jarl` to the script. An explicit Jarl request fails if the executable or its JSON diagnostics are unavailable; findings are namespaced as `jarl/<rule>`. Let Jarl own broad lint rules and keep native anti-slop rules limited to structural review prompts it does not provide.

## Rules

R rules, by exact trigger:

- `r-final-return`: a `return(...)` that is the final expression of a braced function (R returns that expression automatically).
- `r-rethrow-handler`: `tryCatch(..., error = function(e) stop(e))` with a one-argument handler that merely rethrows its caught condition.
- `r-duplicate-adjacent-guard`: two adjacent `if` statements with the same Tree-sitter expression, a known side-effect-free validation condition, and an earlier `stop()`/`return()` consequence.
- `r-else-null`: `else NULL` where the `if` is a standalone expression in a braced body, so an absent alternative already yields `NULL`.
- `r-redundant-else-after-termination`: an `else` on a standalone `if` whose true branch is exactly one `stop()` or `return()`; outdent the alternative after the terminating guard.
- `r-identical-if-branches`: a known side-effect-free condition whose true and false branches have identical whitespace-normalized source; confirm that forcing the condition is not contractual before removing it.
- `r-private-helper-usage`: every top-level private `.name <- function(...)` together with its direct call-site count in the analysis scope; callbacks and `get()` remain dynamic and are not counted.
- `r-single-use-predicate-helper`: a top-level, side-effect-free predicate helper with exactly one direct call from another assigned function in the analysis scope, regardless of whether its name starts with a dot.
- `r-scalar-validator-helper`: a dedicated helper that hand-rolls scalar-string validation by composing `is.character()`, `length()`, `is.na()`, and `nzchar()` instead of placing a concise check at a real admission boundary.
- `r-path-threat-model`: a helper that rejects parent path segments with a `grepl()` string pattern; require distinct producer/consumer principals and privileges rather than importing traversal-security posture into same-principal local R configuration.
- `r-conditional-sprawl`: an `if`, `while`, or `ifelse()`/`if_else()` test with more than three atomic `&&`, `||`, `&`, or `|` clauses — it reports the count and asks for the one decision or admission invariant being expressed.
- `r-implicit-length-test`: `length(x)` or `!length(x)` used as a condition, relying on numeric-to-logical coercion (`0L` is false, positive lengths are true); use `length(x) == 0L` or `length(x) > 0L` to state the intended cardinality.
- `r-cyclomatic-complexity`: a function whose cyclomatic complexity is 15 or greater, enforcing a score below 15 with `cyclocomp`-compatible contributions for `if`, `for`, `while`, `repeat`, `&&`, and `||`; nested function bodies are scored independently, while `&`, `|`, and `ifelse()` do not add paths.

C rules, by exact trigger:

- `c-final-void-return`: a final bare `return;` in a `void` function.
- `c-duplicate-adjacent-guard`: adjacent C `if` statements with the same side-effect-free condition and an earlier direct `return` consequence.
- `c-empty-else`: `else {}`.
- `c-runtime-assert`: `assert(...)`. In an embedded extension, determine whether its predicate can depend on user input, allocation, I/O, or a recoverable host condition; replace those cases with an explicit checked branch and host-visible error or status return. A proven internal development invariant may remain, or this rule may be disabled locally.

## Interpretation

Findings are review prompts, not automatic deletions.

Preserve:

- concise scalar admission contracts at genuine package, API, serialization, or system boundaries;
- distinct ownership, allocation, API, and host-error checks;
- S7 property/validator invariants and `s7contract` admission conformance;
- cleanup that has an observable resource effect.

Review/remove only proven cases: redundant final returns and terminating `else` branches, identical pure-condition branches, no-op rethrow handlers, duplicated adjacent terminating guards, empty alternatives, ambiguous `length(x)` truthiness, unjustified one-use predicate chains, translated scalar-validator layers, path-security checks with no privilege boundary, cyclomatically tangled functions, sprawling conditions that hide repeated policy, and C assertions reachable from embedded-host input/runtime paths.

Replace host-unsafe assertions with explicit error propagation, not silent omission.

## Proof

Run the native analyzer before and after; add Jarl when it is installed and pinned for the target repository. Inspect each changed AST site, run focused behavioral/error/lifetime tests, then repository gates and `git diff --check`. A clean analyzer or Jarl result does not prove program correctness.
