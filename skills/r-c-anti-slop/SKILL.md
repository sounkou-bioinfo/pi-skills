---
name: r-c-anti-slop
description: Audit R/C source with the repository Tree-sitter analyzer. Use to review redundant guards, private-helper sprawl, condition sprawl, no-op handlers, or host-unsafe C assertions.
---

# R/C anti-slop

## Authority

Use `scripts/anti_slop.R` directly or the `anti_slop` Pi tool. Tree-sitter is the only parser authority. Missing grammars and parse errors are failures; there is no regex or alternate-parser fallback.

File and directory scans are supported. Git directory scans use tracked R/C sources; other directories recurse over recognized suffixes. Private `.helper()` direct-call counts are scope-wide review evidence; dynamic callback/get calls are intentionally not inferred.

## Interpretation

Findings are review prompts, not automatic deletions.

Preserve:

- scalar admission contracts such as type, cardinality, and missingness checks;
- distinct ownership, allocation, API, and host-error checks;
- S7 property/validator invariants and `s7contract` admission conformance;
- cleanup that has an observable resource effect.

Review/remove only proven cases: redundant final returns, no-op rethrow handlers, duplicated adjacent terminating guards, empty alternatives, ambiguous `length(x)` truthiness, unjustified one-use private wrappers, sprawling conditions that hide repeated policy, and C assertions reachable from embedded-host input/runtime paths.

Replace host-unsafe assertions with explicit error propagation, not silent omission.

## Proof

Run the analyzer before and after. Inspect each changed AST site, run focused behavioral/error/lifetime tests, then repository gates and `git diff --check`. A clean analyzer result does not prove program correctness.
