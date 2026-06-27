# pi-skills

<!-- README.md is generated from README.Rmd. Edit README.Rmd and run `npm run render:readme`. -->

Personal, skills-first Pi package for `sounkou-bioinfo`.

It includes domain skills, the user-wide `/goals` extension, and a lean
RLM tool that uses system R directly.

## Install

``` sh
pi install git:github.com/sounkou-bioinfo/pi-skills
```

After installing or updating in an interactive Pi session:

``` text
/reload
```

## Active contents

The extension and skill lists below are generated from `package.json`
plus skill frontmatter.

### Extensions

- `goals` — Codex-style `/goals` and `/goal` session goal loop
  extension.
- `rlm` — Recursive long-context tool with `r_eval` backed by system
  `Rscript`, configurable R library paths, and DuckDB-backed parquet
  loading through Node.

### Subagents

This package no longer ships a homegrown subagent/scout/plan/recon
implementation. Use the maintained package instead:

``` sh
pi install npm:pi-subagents
```

That package already covers the runtime details we do not want to
duplicate: child boundaries, fresh/fork context, async status,
artifacts, worktrees, acceptance gates, and management commands.

### Skills

- `bioinformatics-cache-and-index-design` — Guides cache, index, and
  annotation-store design for bioinformatics rewrites, including when to
  use mainstream interoperable formats versus specialized
  high-performance encodings. Use when startup cost, repeated lookup
  performance, interval access, or annotation storage strategy are
  central design concerns.
- `bioinformatics-ffi-and-bindings` — Guides library-first
  bioinformatics rewrites that expose mature native code through
  bindings, extensions, FFI, or embedded runtimes across R, Python, SQL,
  and wasm. Use when building reusable interfaces around existing C/C++
  libraries instead of standalone-only rewrites.
- `bioinformatics-rewrite-porting` — Guides responsible AI-assisted
  rewriting and porting of bioinformatics tools, combining rewrites.bio
  principles with practical validation, attribution, compatibility, and
  maintenance discipline. Use when planning or implementing a rewrite,
  reimplementation, or high-performance port of an existing
  bioinformatics tool.
- `bioinformatics-single-pass-analytics` — Guides design of
  bioinformatics kernels and rewrites that compute multiple validated
  outputs or statistics in one pass over the data, reducing repeated I/O
  and decompression while preserving explicit semantics. Use when
  designing fused readers, counters, coverage engines, or summary
  pipelines.
- `duckdb-c-extension-api-stability` — Guides DuckDB C extension API
  selection, deprecation handling, compatibility shims, and release
  policy. Use when balancing stable versus unstable APIs, managing
  breaking changes, or documenting deprecation strategy for SQL and
  wrapper surfaces.
- `duckdb-c-extension-architecture` — Guides design of DuckDB extensions
  written primarily in C, including runtime ownership, function
  boundaries, state models, background services, concurrency, and
  separation of stable logic from volatile adapter code. Use when
  planning or restructuring a native DuckDB extension rather than a
  one-off patch.
- `duckdb-c-extension-function-catalog` — Guides machine-readable
  function catalogs for DuckDB extensions, including a `functions.yaml`
  source-of-truth pattern that can drive docs, wrappers, aliases,
  examples, and consistency checks. Use when an extension exposes many
  SQL functions or multiple wrapper surfaces.
- `duckdb-c-extension-r-bindings` — Guides packaging DuckDB C extensions
  with R bindings, including repository layout, installed artifacts, SQL
  wrappers, generated docs, and native-versus-R responsibility
  boundaries. Use when building or restructuring an R package around a
  DuckDB extension.
- `duckdb-c-extension-testing-and-interop` — Guides testing of DuckDB C
  extensions across SQL, native, wrapper, and external-client layers,
  with emphasis on real execution paths, sqllogictest coverage, and
  protocol/interop validation. Use when building trustworthy tests for
  extensions that expose SQL plus native or service behavior.
- `duckdb-c-extension-vendoring-and-shims` — Guides vendoring of native
  dependencies into DuckDB C extensions, including pinning, patch
  ledgers, static linking, hidden symbols, and compatibility-shim
  boundaries. Use when an extension needs bundled third-party C/C++
  libraries rather than relying only on system dependencies.
- `duckhts-development` — Guides development in the DuckHTS repo,
  including DuckDB extension work, Rduckhts package integration,
  vendored htslib workflows, SQL and tinytest coverage, wasm/webR
  constraints, and exact-compatible rewrites of upstream genomics tools.
  Use when working in github.com/RGenomicsETL/duckhts.
- `duckhts-rewrite-porting` — Guides exact-compatible rewrites and ports
  of existing genomics tools into DuckHTS, with pinned upstream
  validation, attribution, phased scope, and rewrites.bio-style
  discipline. Use when implementing or maintaining compatibility layers
  such as mosdepth-, bcftools-, or WisecondorX-aligned behavior in
  duckhts.
- `duckhts-wasm-debugging` — Guides wasm, webR, and duckdb-wasm
  debugging for DuckHTS, including artifact verification, symbol/export
  checks, browser-runtime constraints, and package-vs-runtime
  distinctions. Use when debugging DuckHTS in webR, browser wasm, or
  duckdb-wasm environments.
- `duckqc-design` — Guides design of a DuckDB-native, SQL-first
  sequencing QC system inspired by RustQC and related upstream tools,
  with one-pass analytics, reusable kernels, compatibility outputs, and
  careful threading and summary design. Use when planning DuckQC-style
  functionality.
- `duckvep-design` — Guides design of a DuckDB-native variant effect
  prediction system, including consequence prediction kernels,
  transcript/annotation caches, haplotype-aware consequence paths,
  bcftools csq alignment opportunities, and careful planning for indexes
  and metadata stores. Use when exploring DuckVEP-style functionality.
- `genomics-sql-rewrites` — Guides genomics tool rewrites and ports that
  target SQL-native, DuckDB-centered execution using reusable native
  kernels, streaming readers, parallel scans, alternative file formats,
  and indexed metadata access. Use when designing genomics capabilities
  as DuckDB extensions or SQL-first libraries.
- `library-first-bio-rewrites` — Guides AI-assisted bioinformatics
  rewrites with a library-first, low-dependency mindset, emphasizing
  battle-tested libraries, C and FFI reuse, innovative composition,
  portable deployment, and single-pass statistics. Use when designing
  rewrites that should avoid dependency bloat and maximize reuse.
- `r-package-development` — Guides creation, maintenance, checking,
  testing, documenting, and releasing R packages using project-native
  workflows such as Makefiles, tinytest, roxygen2, base R, and optional
  tools like usethis, pkgdown, air, or jarl. Use when working on any R
  package or CRAN-style package workflow.
- `s7-development` — Guides development of R code and packages using S7
  classes, generics, methods, validators, properties, compatibility
  layers, and package integration. Use when designing or maintaining
  S7-based APIs or migrating S3/S4 code toward S7.

## RLM and R runtime direction

`r_eval` now targets real system R, not webR. Configure it with:

- tool param `rBin`, or env `PI_RLM_R_BIN` (default: `Rscript`)
- tool param `rLibPaths`, or env `PI_RLM_R_LIBS` (`:`/`;` separated)
- tool param `rRepos`, or env `PI_RLM_R_REPOS` (default:
  `https://cloud.r-project.org`)

Inside `r_eval`, use `install_r_packages()`, `context_load()`,
`context_r_load_code()`, `save_plot()`, `rlm_call()`, `FINAL()`, and
`FINAL_VAR()`.

Parquet context is loaded through `@duckdb/node-api`, which lines up
with the DuckDB-native direction for DuckHTS, `ducknng`, and
`ducktinycc`. DuckHTS stays the first target for deeper runtime
integration.

The longer-term worker design is tracked in
`docs/rlm-r-nng-arrow-design.md`: persistent system-R workers over
NNG/nanoarrow, with DuckDB extensions as first-class runtime peers.

## Development

``` sh
npm install
npm run typecheck
npm run render:readme
```

Runtime Pi APIs are peer dependencies supplied by Pi itself.

## License

MIT. See `LICENSE`.
