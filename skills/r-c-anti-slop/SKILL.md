---
name: r-c-anti-slop
description: Use to audit R/C helper sprawl, redundant checks, complexity, or host-unsafe assertions with Tree-sitter.
---

# R/C anti-slop

## Run the audit

Use the `anti_slop` Pi tool when available. For direct execution, use
[`scripts/anti_slop.R`](scripts/anti_slop.R), resolving that path relative to the
skill directory containing this `SKILL.md`. Do not infer a Pi installation,
package checkout, or home-directory path. Tree-sitter is the only parser authority
for native rules. Missing grammars and parse errors are failures; there is no regex
or alternate-parser fallback.

Git directory scans use tracked R/C sources; non-Git directories recurse over
recognized suffixes. Direct-call counts are scope-wide review evidence, not
inference about callbacks or `get()`. Complexity **≥15 warns**.

Jarl is optional, complementary, and neither bundled nor a parser fallback.
Request it with tool `jarl=true`, `/anti-slop --jarl path`, or script `--jarl jarl`.
An explicit request fails if the executable or valid JSON diagnostics are missing.
Results report Jarl state, disabled rules, totals, and truncation; Jarl findings
are namespaced as `jarl/<rule>`.

## Interpret only the relevant findings

Look up reported rules in [exact rule triggers](references/rules.md). Findings
are review prompts, not automatic deletions. Preserve real admission contracts,
R/C ownership and allocation checks, S7/s7contract invariants, and cleanup with
observable effects. Check literal contents and condition-forcing semantics before
removing apparently equivalent branches. Replace host-unsafe assertions with
explicit error propagation, not silent omission.

## Verify the change

For source changes, compare before/after native results; add Jarl when installed
and pinned for the target repository. Inspect changed AST sites and run affected
behavior/error/lifetime tests, followed by the repository-required handoff gates.
A policy-document edit does not itself require running every R/C runtime suite.

Scan the requested source or actual tracked tree. Copied/reformatted trees,
selected subsets, suppressed profiles, truncated output, or claimed Jarl runs
without provenance cannot establish repository cleanliness. Renaming or
mechanically re-encoding a condition does not simplify its decision structure.
A clean lint result is not proof of correctness or simplicity.
