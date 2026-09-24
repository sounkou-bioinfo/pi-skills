---
name: r-c-anti-slop
description: Use to audit R/C helper sprawl, redundant checks, complexity, or host-unsafe assertions with Tree-sitter.
---

# R/C anti-slop

For R source, apply [We Use R Damnit](../we-use-r-damnit/SKILL.md). Review the
computation and contract owners before interpreting structural counts. Preserve
necessary admission checks; challenge repeated validation of established facts.

## Run the audit

For changed R source, run the audit as a mandatory consistency second pass
after a coherent implementation and focused behavior checks, before handoff.
Read the code and its contract first; do not use clause counts or complexity
scores to design the first pass. Findings require inspection and a decision,
not a zero-warning score. For a package-wide helper question, scan the package
rather than only one changed file.

Use the `anti_slop` Pi tool when available. For direct execution, use
[`scripts/anti_slop.R`](scripts/anti_slop.R), resolving that path relative to the
skill directory containing this `SKILL.md`. Do not infer a Pi installation,
package checkout, or home-directory path. Tree-sitter is the only parser authority
for native rules. Missing grammars and parse errors are failures; there is no regex
or alternate-parser fallback. When editing the analyzer itself, the Pi tool may
still have its earlier runtime loaded; verify the current working-tree script by
direct execution and distinguish that result from the loaded tool's output.

Git directory scans use tracked R/C sources; scan new untracked files explicitly.
Non-Git directories recurse over recognized suffixes. Direct-call counts are
scope-wide review evidence, not inference about callbacks or `get()`. Complexity
**≥15 warns** for review; it does not require rewriting a justified function
below the threshold. Directly suppressing `as.integer()` coercion warnings is
banned and reports an error; validate before conversion.

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

For source changes, record the scanned scope and disposition of relevant
findings: clarify genuinely tangled code, or retain a necessary structure with
its contract rationale and affected behavior tests. Compare before/after native
results; add Jarl when installed and pinned for the target repository. Inspect
changed AST sites and run affected behavior/error/lifetime tests, followed by
the repository-required handoff gates.
A policy-document edit does not itself require running every R/C runtime suite.

Scan the requested source or actual tracked tree. Copied/reformatted trees,
selected subsets, suppressed profiles, truncated output, or claimed Jarl runs
without provenance cannot establish repository cleanliness. Renaming or
mechanically re-encoding a condition does not simplify its decision structure.
A clean lint result is not proof of correctness or simplicity.
