---
name: library-first-bio-rewrites
description: Apply a library-first, low-dependency stance to bioinformatics rewrites — prefer battle-tested libraries and composition, treat dependency bloat as a real engineering cost, and fuse statistics in one validated pass. Use when designing a rewrite or new tool that should avoid dependency bloat and maximize reuse.
---

# Library-first bio rewrites

## Core position

A productive rewrite is not always a new standalone binary. Often the better outcome is bringing a mature library into a new environment and exposing it across languages and runtimes: embedding a proven C library in a database extension, exposing one implementation through R, Python, CLI, SQL, and wasm, or replacing a multipass shell pipeline with one validated native pass.

## Principles

- **Prefer battle-tested libraries over fashionable rewrites.** Before rewriting a tool wholesale, ask whether a high-quality library already solves the hard part, whether it can be reused or composed directly in a new host runtime, and whether the capability can be exposed as a reusable primitive instead of another application binary. Do not assume a rewrite must replace the entire stack.
- **Design library-first.** Put the core value in a library, small extension, reusable kernel, or host-agnostic primitive — that is what binds into multiple languages, tests in isolation, embeds in larger systems, and ports to constrained targets like wasm.
- **Treat dependency bloat as a real engineering cost**, not a neutral choice: it affects vendoring burden, CRAN/HPC/enterprise packaging difficulty, auditability, build reproducibility, binary size, and long-term maintenance risk. See `references/dependency-discipline.md` for the pre-add checklist.
- **C remains strategically valuable**, independent of language fashion, when it gives direct reuse of mature libraries, broad compiler/platform reach, straightforward FFI into many languages, and deployability in constrained or unusual runtimes. Choose the substrate that best preserves reuse, portability, and trust — the goal is not "C everywhere."
- **Mix technologies in interesting ways.** A good rewrite may come from inventive composition rather than one-language purity — e.g. a C library plus a DuckDB extension plus an R package plus a wasm harness — with the innovation in exposing proven code in more useful places, not in rewriting every line.
- **Prefer reusable primitives over application-only design.** Ask whether a feature should become a table function, UDF, callable library API, or composable kernel instead of only a one-off executable; reusable primitives multiply impact across languages and workflows.
- **Fuse statistics in one pass when scientifically safe.** Combining multiple outputs from a single validated scan (e.g. counts + strand splits + QC summaries) can cut repeated I/O, decompression, and parsing — but only if correctness stays explicit and testable: each derived statistic stays well defined, compatibility contracts are preserved, and pre-/post-filter behavior is documented. See `references/one-pass-statistics.md`.
- **Design for multiple runtimes early**: CLI, R package, Python binding, DuckDB extension, wasm/browser worker, server-side service.

## Workflow

1. Identify battle-tested upstream libraries and map the minimum dependency graph.
2. Define the reusable kernel or primitive, and its compatibility/validation targets.
3. Implement the narrowest useful slice; validate outputs on real data.
4. Expose through one host first, then expand bindings/runtimes after the core is stable.

Avoid: rewriting everything because the language is fashionable; heavy dependency trees for small gains; another standalone binary when a reusable primitive is possible; one-pass statistics added without per-statistic validation; ignoring CRAN/HPC/wasm packaging constraints.

Use `references/design-questions.md` for the pre-design question list, `references/dependency-discipline.md` for the dependency pre-add checklist, and `references/one-pass-statistics.md` for one-pass fusion requirements.
