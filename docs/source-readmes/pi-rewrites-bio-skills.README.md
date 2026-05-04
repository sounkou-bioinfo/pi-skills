# pi-rewrites-bio-skills

Pi skills for AI-assisted bioinformatics rewrites, ports, and modernization work.

## Install

```bash
pi install git:github.com/sounkou-bioinfo/pi-rewrites-bio-skills
```

Pin the initial release:

```bash
pi install git:github.com/sounkou-bioinfo/pi-rewrites-bio-skills@v0.1.0
```

## Included skills

- `bioinformatics-rewrite-porting`
- `library-first-bio-rewrites`
- `bioinformatics-ffi-and-bindings`
- `bioinformatics-single-pass-analytics`
- `genomics-sql-rewrites`
- `duckqc-design`
- `duckvep-design`
- `bioinformatics-cache-and-index-design`

## When to use `bioinformatics-rewrite-porting`

Load this skill when you are:

- porting or rewriting an existing bioinformatics tool
- targeting compatibility with an upstream tool
- defining validation scope, attribution, and maintenance expectations
- planning staged modernization work with AI assistance

## When to use `library-first-bio-rewrites`

Load this skill when you are:

- reusing battle-tested libraries instead of rewriting everything from scratch
- favoring C/library-first composition over dependency-heavy application rewrites
- designing low-dependency ports for embedded, CRAN, HPC, or wasm contexts
- fusing multiple pipeline passes into one pass with richer statistics

## When to use `bioinformatics-ffi-and-bindings`

Load this skill when you are:

- exposing native bioinformatics libraries through R, Python, SQL, or wasm
- designing FFI-friendly APIs and wrappers
- embedding one native engine across multiple frontends
- validating wrapper behavior separately from core native behavior

## When to use `bioinformatics-single-pass-analytics`

Load this skill when you are:

- replacing repeated parsing/decompression passes with one fused native pass
- designing counters, coverage engines, or summary kernels
- emitting multiple validated outputs from one traversal
- adding richer per-bin or per-interval statistics without losing semantic clarity

## When to use `genomics-sql-rewrites`

Load this skill when you are:

- designing genomics capabilities as DuckDB extensions or SQL-native kernels
- thinking through threading models for readers and analytics
- evaluating alternative metadata formats, caches, or indexes
- turning classic genomics tools into queryable primitives
- exploring directions inspired by `duckhts`, `plinking_duck`, `fastVEP`, or `RustQC`
- deciding how far DuckDB-native storage, planning, and ART/expression indexes can take you before custom serving formats are needed

## When to use `duckqc-design`

Load this skill when you are:

- planning a DuckDB-native QC system inspired by RustQC-style one-pass QC
- deciding which QC outputs should be tables versus compatibility reports
- designing shared accumulators and reductions across multiple QC metrics

## When to use `duckvep-design`

Load this skill when you are:

- planning a DuckDB-native variant effect prediction system
- evaluating a `bcftools csq`-aligned path for haplotype-aware consequences
- thinking through transcript/reference caches and annotation indexes carefully
- deciding what should be SQL-native consequence kernels versus compatibility projections
- planning how many annotation sources should be federated and staged rather than forced into one physical layout

## When to use `bioinformatics-cache-and-index-design`

Load this skill when you are:

- deciding between mainstream interoperable formats and specialized caches
- designing transcript, annotation, reference, or interval indexes
- planning cache provenance, invalidation, and regeneration
- evaluating innovative high-performance structures such as `echtvar` versus more standard storage choices
- separating exact-key lookup problems from interval-overlap problems

## Worked example direction

A good example of the library-first approach is the kind of work done in `duckhts` and the adjacent direction suggested by `plinking_duck`:

- reuse a battle-tested native library rather than replacing it wholesale
- expose it through a new host runtime
- make the capability available across multiple languages through that host
- enrich one-pass analytics with additional validated statistics instead of stacking more pipeline passes
- think seriously about threading models, metadata companions, file formats, and indexes as part of the architecture

## Update

If installed unpinned:

```bash
pi update
```

Or update just this package:

```bash
pi update git:github.com/sounkou-bioinfo/pi-rewrites-bio-skills
```

If pinned, move explicitly to the current release:

```bash
pi install git:github.com/sounkou-bioinfo/pi-rewrites-bio-skills@v0.6.0
```
