# pi-skills

<!-- README.md is generated from README.Rmd. Edit README.Rmd and run `npm run render:readme`. -->

Personal, skills-first Pi package for `sounkou-bioinfo`.

It includes domain skills, permanent semantic memory, detachable
background tasks, the user-wide `/goals` extension, and a lean RLM tool
that uses system R directly.

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

- `anti-slop` — Tree-sitter-only, configurable R/C audit for proven
  redundant guards, no-op R error handlers, empty branches, and
  host-unsafe C runtime assertions.
- `goals` — Codex-style `/goals` and `/goal` session goal loop
  extension.
- `memory` — Append-only Semantic-SQL memory in SQLite/WAL with bounded
  summary-frontier wakeups, historical `as_of`, graph traversal, and
  DuckDB FTS.
- `rlm` — Detached-by-default single-controller long-context runs with
  completion wakeups, bounded opt-in recursion, system `Rscript`
  evaluation, and DuckDB-backed parquet sampling.
- `background-tasks` — Named detachable shell tasks with bounded
  external logs, status/kill tools, a focused TUI dock, and one
  completion wakeup.

### Anti-slop AST audit

`anti_slop` and `/anti-slop path/to/source.R` audit one R or C source
file with the vendored Tree-sitter analyzer. The extension deliberately
does not use regex or a substitute parser: unavailable R grammar
packages and parse errors are explicit results. Runtime requirements are
`treesitter`, `treesitter.r` for R, and
[treesitter.c](https://github.com/sounkou-bioinfo/treesitter.c) for C;
optional JSON configuration and machine-readable output use `jsonlite`.
See the `r-c-anti-slop` skill for its narrow rule scope and review
workflow.

### Orchestration discipline

This package does not ship a subagent/scout/plan/recon swarm and does
not create worktrees. The RLM keeps long context outside the model and
uses one controller to inspect it. Its default `auto` mode does not
recurse; `mode=decompose` is an explicit, shallow, budgeted exception
for materially independent contradictions.

Only one RLM run and one child model process are active at a time; at
most four active/queued runs are retained. Additional background runs
and recursive children queue. RLM starts detached by default, keeps the
Pi session interactive, and emits one bounded completion wakeup; set
`async=false` only for a short blocking call. This serialization is a
hard safety boundary, not a tuning default.

Long-running shell commands use `bg_run`: output stays in bounded
external task files while Pi remains interactive, and completion emits
one status/path wakeup. This avoids holding a foreground tool call open
or repeatedly injecting CI progress into model context.

### Permanent memory

The `memory` extension keeps one append-only SQLite authority at
`~/.pi/agent/memory.sqlite` (override with `PI_MEMORY_DB`). SQLite runs
in WAL mode; each Pi process owns an in-memory DuckDB connection
attached through DuckDB’s SQLite storage extension. Transactions and
RDF-shaped statements are the small physical core. Notes, current facts,
history, summaries, graph edges, pending compression, bounded wake
frontiers, and historical `as_of` projections are SQL views or recursive
SQL queries.

Repeated `(graph, subject, predicate)` statements create inspectable
versions rather than rewriting history. `memory sql` selects an explicit
transaction or timestamp and exposes `as_of_statement`, `as_of_note`,
`as_of_summary`, `node_to_node_statement`, `node_to_value_statement`,
`memory_block`, `pending_summary`, and `wake`. Its dedicated read-only
connection disables local and network filesystem access, locks DuckDB
configuration, and bounds query text, memory, threads, runtime, and
returned rows. `recall` maintains a process-local DuckDB FTS projection
over exact notes; the SQLite statements remain authoritative. Optional
embeddings can therefore remain a replaceable derived projection if a
measured need appears.

Summary nodes and their `memory:left` / `memory:right` statements form a
graph that the agent can walk with recursive SQL or `zoom`. The `graph`
column leaves named-graph/fork projections schema-compatible, but this
package does not invent branch-head or merge policy before a current
consumer needs it.

The few-base-tables/many-semantic-views design follows [INCATools
Semantic-SQL](https://github.com/INCATools/semantic-sql). The
append-only log, bounded fading-detail context, and navigable summary
hierarchy are independently implemented concepts inspired by
[VictorTaelin/OptMem](https://github.com/VictorTaelin/OptMem); no OptMem
source is included.

Inline context is capped at 5M characters. Eager text files are capped
at 20MB and eager CSV/JSON files at 10MB. Directory contexts keep a
Git-aware manifest of up to 20,000 files, eagerly load at most 5MB of
prioritized text, and expose bounded lazy reads for omitted text files.

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
- `ducknng-development` — Guides development in the ducknng pure-C
  DuckDB extension: registry-derived RPC manifests, NNG/HTTP/WebSocket
  carrier boundaries, Arrow IPC and Quack payloads, explicit
  service/session/AIO lifetime, bounded security contracts, stable and
  unstable DuckDB API audits, SQL/property/browser/interop tests, and
  generated function catalogs. Use when working in
  sounkou-bioinfo/ducknng.
- `duckqc-design` — Guides design of a DuckDB-native, SQL-first
  sequencing QC system inspired by RustQC and related upstream tools,
  with one-pass analytics, reusable kernels, compatibility outputs, and
  careful threading and summary design. Use when planning DuckQC-style
  functionality.
- `ducktinycc-development` — Guides development in DuckTinyCC: in-memory
  TinyCC state and relocated artifact lifetime, generated scalar-UDF
  wrappers, recursive DuckDB/C descriptors, embedded runtime assets,
  trusted native-code boundaries, allocator domains, SQL stability,
  source-split conventions, upstream precedents, and extension/community
  tests. Use when working in sounkou-bioinfo/DuckTinyCC.
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
- `r-c-anti-slop` — Audits R and C source with the vendored Tree-sitter
  anti-slop analyzer, then removes only proven redundant guards, no-op
  handlers, and host-unsafe C assertions while preserving real
  invariants. Use when reviewing or simplifying defensive R/C code.
- `r-package-development` — Guides creation, maintenance, checking,
  testing, documenting, and releasing R packages using project-native
  workflows such as Makefiles, tinytest, roxygen2, base R, and optional
  tools like usethis, pkgdown, air, or jarl. Use when working on any R
  package or CRAN-style package workflow.
- `rducks-development` — Guides development in the Rducks R package and
  bundled DuckDB C extension, including strict execution plans, R-thread
  and SEXP ownership, direct versus Quack/NNG worker marshalling, exact
  DuckDB unstable-ABI artifacts, runtime capability probes, generated
  catalogs, wasm, and tarball-based tinytest/check workflows. Use when
  working in sounkou-bioinfo/Rducks.
- `rfmalloc-development` — Guides development in the Rfmalloc monorepo
  and its Rfmalloc, Rggml, Rgguf, Rllm, Rpgen, and RfmallocStatgen
  packages: typed out-of-core storage, C-callable contracts, backend
  fallback, generated GGML vendoring, architecture programs, numerical
  oracles, cross-package checks, and GPU-rig evidence. Use when working
  in sounkou-bioinfo/Rfmalloc.
- `rho-development` — Guides development in the RGenomicsETL/Rho
  monorepo: evidence-driven dialectical refinement, modern R and
  functional S7 OOP, s7contract interfaces, asynchronous tasks and
  streams, explicit capabilities, provider and session protocols,
  authored Rmd tests, and monorepo gates. Use when working in Rho or its
  rho.\* packages.
- `s7-development` — Guides development of R code and packages using S7
  classes, generics, methods, validators, properties, compatibility
  layers, and package integration. Use when designing or maintaining
  S7-based APIs or migrating S3/S4 code toward S7.
- `sounkou-engineering-style` — Applies the working and coding style
  used across sounkou-bioinfo and RGenomicsETL projects: one-controller
  conceptual control without agent/worktree sprawl, evidence-driven
  dialectical design, one semantic authority, explicit C ownership and
  bounds, idiomatic R and S7, composable SQL, focused changes, and
  executable proof. Use when working in DuckHTS, Rducks, Rfmalloc,
  ducknng, DuckTinyCC, Rho, or when the user asks for "our style".

## RLM and R runtime direction

`r_eval` now targets real system R, not webR. Configure it with:

- tool param `rBin`, or env `PI_RLM_R_BIN` (default: `Rscript`)
- tool param `rLibPaths`, or env `PI_RLM_R_LIBS` (`:`/`;` separated)
- tool param `rRepos`, or env `PI_RLM_R_REPOS` (default:
  `https://cloud.r-project.org`)

Inside `r_eval`, use `install_r_packages()`, `context_load()`,
`context_r_load_code()`, `save_plot()`, `FINAL()`, and `FINAL_VAR()`.
`rlm_call()` is available only when recursion was explicitly enabled
with `mode=decompose`.

Parquet context is sampled through `@duckdb/node-api`; full analysis
remains available through `context_load()` in system R. This lines up
with the DuckDB-native direction for DuckHTS, `ducknng`, and
`ducktinycc` without eagerly retaining an entire Parquet table in Node.

The longer-term worker design is tracked in
`docs/rlm-r-nng-arrow-design.md`: persistent system-R workers over
NNG/nanoarrow, with DuckDB extensions as first-class runtime peers.

## Development

``` sh
npm install
npm run typecheck
npm run test
npm run test:memory
npm run test:rlm
npm run render:readme
npm pack --dry-run
```

Runtime Pi APIs are peer dependencies supplied by Pi itself.

## License

MIT. See `LICENSE`.
