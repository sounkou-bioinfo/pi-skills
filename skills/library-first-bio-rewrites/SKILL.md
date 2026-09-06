---
name: library-first-bio-rewrites
description: Use when deciding whether to reuse, embed, bind, or rewrite a bioinformatics implementation.
---

# Library-first bio rewrites

## Reuse decision

Prefer a mature library or composition over reimplementing established semantics.
Compare the available core, its license/dependencies, and the target deployment
constraints. If reuse is unsuitable, record the concrete mismatch.

Keep reusable semantics separate from host wrappers. C can preserve mature-library
reuse, portable ABIs, and constrained deployment; this is not a requirement to
use C everywhere. Start with the requested host. Add other bindings only for real
consumers, not because a future CLI/R/Python/SQL/wasm combination is possible.

Dependency cost includes auditing, vendoring, binary size, and CRAN/HPC/offline
installation. Use [dependency discipline](references/dependency-discipline.md)
when adding a dependency, or [design questions](references/design-questions.md)
when the reuse boundary is undecided.

## Once the decision is made

Load only the guidance for the remaining problem:

- exposing the core: [FFI/bindings](../bioinformatics-ffi-and-bindings/SKILL.md);
- organizing SQL-native operations: [genomics SQL](../genomics-sql-rewrites/SKILL.md);
- matching a named upstream: [compatibility porting](../bioinformatics-rewrite-porting/SKILL.md);
- merging scans: [single-pass analytics](../bioinformatics-single-pass-analytics/SKILL.md).

Fusion is justified only when filtering, state, and ordering agree and each
statistic retains an independent oracle. The [one-pass notes](references/one-pass-statistics.md)
cover that decision; this skill does not require every rewrite to fuse scans.
