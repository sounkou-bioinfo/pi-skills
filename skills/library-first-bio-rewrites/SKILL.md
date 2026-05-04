---
name: library-first-bio-rewrites
description: Guides AI-assisted bioinformatics rewrites with a library-first, low-dependency mindset, emphasizing battle-tested libraries, C and FFI reuse, innovative composition, portable deployment, and single-pass statistics. Use when designing rewrites that should avoid dependency bloat and maximize reuse.
---

# Library-First Bio Rewrites

Use this skill when designing bioinformatics rewrites with an opinionated engineering stance:

- prefer battle-tested libraries over full-stack rewrites
- prefer composition over dependency explosion
- consider C and FFI-first designs when they improve portability and reuse
- fuse multiple statistics or outputs into one validated pass when it preserves trust

This skill incorporates the spirit of `rewrites.bio`, but adds a stronger focus on library design, dependency discipline, and reusable systems.

## Core position

A productive rewrite is not always a new standalone binary.
Sometimes the better outcome is to bring a mature library into a new environment and unlock it across many languages and runtimes.

Examples of this mindset:

- embedding a proven C library in a database extension
- exposing one implementation through R, Python, CLI, SQL, and wasm
- replacing multipass shell pipelines with one carefully validated native pass

## Main principles

### 1) Prefer battle-tested libraries over fashionable rewrites

Before rewriting a tool wholesale, ask:

- is there already a high-quality library underneath?
- can we reuse that library directly?
- can we compose existing libraries in a new host runtime?
- can we expose a capability as a reusable primitive instead of another application binary?

Do not assume a rewrite must replace the entire stack.

### 2) Favor library-first design

Prefer designs where the core value lives in:

- a library
- a small extension
- a reusable kernel
- a host-agnostic primitive

This makes the result easier to:

- bind into multiple languages
- test in isolation
- embed in larger systems
- port to constrained targets like wasm

### 3) Treat dependency bloat as a real engineering cost

Dependency count is not neutral.
It affects:

- vendoring burden
- CRAN/HPC/enterprise packaging difficulty
- auditability
- build reproducibility
- binary size
- long-term maintenance risk

Before adding a new dependency, ask:

- what exact capability does it provide?
- can existing battle-tested libraries already do this?
- is the dependency stable, minimal, and easy to vendor?
- is it compatible with target environments such as CRAN, HPC clusters, air-gapped installs, or wasm?

### 4) C is still strategically valuable

Do not dismiss C just because newer systems languages are popular.

C remains valuable when you want:

- direct reuse of mature libraries
- broad compiler and platform reach
- straightforward FFI into many languages
- compatibility with existing scientific ecosystems
- deployability in constrained or unusual runtimes

The point is not “C everywhere”. The point is to choose the substrate that best preserves reuse, portability, and trust.

### 5) Mix technologies in interesting ways

A good rewrite may come from inventive composition, not one-language purity.

For example:

- C library + DuckDB extension + R package + wasm harness
- one native engine exposed through SQL, R, Python, and browser runtimes
- an old library reused in a new execution environment with modern orchestration

Think about where the innovation actually is:

- not necessarily in rewriting every line
- often in exposing proven code in more useful places

### 6) Prefer reusable primitives over application-only design

Ask whether a feature should become:

- a table function
- a UDF
- a callable library API
- a composable kernel
- a binding-friendly module

instead of only:

- a one-off executable

Reusable primitives multiply impact across languages and workflows.

### 7) Fuse statistics in one pass when scientifically safe

One of the best rewrite opportunities is to combine multiple outputs or statistics in a single validated scan.

Good examples include:

- count totals + strand counts + QC summaries in one pass
- per-bin counts + GC summaries + MAPQ summaries in one pass
- primary output + summary files + compatibility reports from one engine run

This can reduce:

- repeated I/O
- repeated parsing
- repeated decompression
- duplicated pipeline stages

But this only helps if correctness remains explicit and testable.

### 8) One-pass enrichment must not hide semantics

If you combine outputs in one pass:

- keep each derived statistic well defined
- preserve compatibility contracts for outputs that claim equivalence
- document exactly what is computed pre-filter and post-filter
- make validation granular enough that each statistic can be trusted

A one-pass design is an engineering optimization, not permission to blur semantics.

### 9) Design for multiple runtimes early

When the core is reusable, ask where it can live:

- CLI
- R package
- Python binding
- DuckDB extension
- wasm/browser worker
- server-side service

Choose interfaces that preserve that flexibility.

### 10) Rewrite less, integrate better

Sometimes the best “rewrite” is mostly:

- integration work
- adaptation layers
- better host interfaces
- improved validation harnesses
- tighter pipeline fusion

This is still real systems innovation.

## Practical design questions

Before starting, ask:

- what library already solves the hard part?
- what host runtime gives the broadest leverage?
- what dependencies can be avoided?
- can multiple downstream statistics be emitted in one pass?
- can the result become a reusable primitive, not only an app?
- what packaging environments must this survive? CRAN? HPC? wasm? offline installs?

## Recommended workflow

1. identify battle-tested upstream libraries
2. map the minimum dependency graph
3. define the reusable kernel or primitive
4. define compatibility and validation targets
5. implement the narrowest useful slice
6. validate outputs on real data
7. expose through one host first
8. expand bindings/runtimes after the core is stable

## Anti-patterns

Avoid:

- rewriting everything because the language is fashionable
- introducing heavy dependency trees for small gains
- producing another standalone binary when a reusable primitive is possible
- adding one-pass statistics without per-stat validation
- ignoring packaging constraints in CRAN/HPC/browser contexts

## References

- [Design questions](references/design-questions.md)
- [One-pass statistics notes](references/one-pass-statistics.md)
- [Dependency discipline](references/dependency-discipline.md)
