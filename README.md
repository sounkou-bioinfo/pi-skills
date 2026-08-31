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

- `anti-slop` — Tree-sitter-only, configurable R/C audit for redundant
  code, private-helper call counts and justification, ambiguous length
  conditions, empty branches, and host-unsafe C runtime assertions.
- `biomedical-evidence` — One bounded read-only HTTP tool for GWAS
  Catalog, Open Targets, gpmap, OmicsPred, Europe PMC, LitVar2, Ensembl,
  GTEx, FinnGen, and PheWeb.
- `codex-web-search` — Native web search through Pi’s existing OpenAI
  Codex authentication, with grounded answers and source URLs.
- `context-budget` — Transiently caps large built-in inspection results
  in model context while preserving full stored/UI results and
  deterministic recovery guidance.
- `expert-discipline` — Cache-safe, idempotent expert decision
  discipline that tests consequential choices against leading-expert
  rejection reasons and reports evidence, uncertainty, and material
  trade-offs without exposing private deliberation.
- `goals` — Session goal loop with stable policy, transient goal
  context, compact continuations, and evidence-gated completion.
- `memory` — Append-only Semantic-SQL memory with cache-safe task
  retrieval, bounded summary frontiers, historical `as_of`, graph
  traversal, and DuckDB FTS.
- `rlm` — Detached-by-default single-controller long-context runs with
  completion wakeups, bounded opt-in recursion, system `Rscript`
  evaluation, and DuckDB-backed parquet sampling.
- `vscode-path-links` — Disables Pi OSC 8 hyperlinks in VS Code
  terminals so native Remote-SSH and WSL path detection handles file
  clicks.
- `background-tasks` — Named detachable shell tasks with bounded
  external logs, status/kill tools, a focused TUI dock, and one
  completion wakeup.

### VS Code terminal path clicks

In VS Code integrated terminals, `vscode-path-links` disables Pi’s OSC 8
hyperlinks and lets VS Code’s native path detector handle visible paths.
This avoids local `file://` interpretation for Remote-SSH and WSL file
clicks; other terminals are unchanged.

### Anti-slop AST audit

`anti_slop` and `/anti-slop path/to/source.R` audit one R/C source file
or a directory with the vendored Tree-sitter analyzer. A Git directory
scans its tracked R/C files beneath that path; a non-Git directory
recurses over recognized source suffixes. It counts direct calls to each
top-level R private helper across that analysis scope and asks for its
distinct invariant/effect, flags condition sprawl and ambiguous
`length()` truthiness, and inspects narrow redundant/host-unsafe C
patterns. The extension deliberately does not use regex or a substitute
parser: unavailable R grammar packages and parse errors are explicit
results. Runtime requirements are `treesitter`, `treesitter.r` for R,
and [treesitter.c](https://github.com/sounkou-bioinfo/treesitter.c) for
C; optional JSON configuration and machine-readable output use
`jsonlite`. See the `r-c-anti-slop` skill for its narrow rule scope and
review workflow.

### Expert decision discipline and cache behavior

`expert-discipline` appends one concise, byte-stable block through
`before_agent_start`. It preserves the chained base prompt exactly, uses
a marker to append only once even when handlers are chained or retried,
and neither reads, transforms, nor persists user messages. For each
consequential choice, the block asks what would make a leading relevant
expert reject the candidate, rejects it when that reason applies,
prefers expert-correct work over merely cheap constraint satisfaction,
and reports evidence, uncertainty, and material trade-offs while keeping
private deliberation private.

Enabling the extension changes the system prompt and therefore causes an
unavoidable cold cache miss. After that, the extension contributes the
same bounded bytes to each run instead of copying a fresh reminder into
every user message; it does not itself introduce per-turn prefix
variation or linear transcript growth. Actual cache reads still depend
on provider thresholds and expiry plus changes from models, tools,
context files, or other extensions.

### Orchestration discipline

This package does not ship a subagent/scout/plan/recon swarm and does
not create worktrees. The RLM keeps long context outside the model and
uses one controller to inspect it. Its default `auto` mode does not
recurse; `mode=decompose` is an explicit, shallow, budgeted exception
for materially independent contradictions.

Skill discovery uses progressive disclosure, but names and descriptions
are always in the system prompt. The inventory therefore keeps one
distinct trigger per skill and delegates shared mechanics to a single
authority instead of multiplying near-duplicate skills.

The `context-budget` hook prevents broad `read`, `bash`, `grep`, `find`,
or `ls` results from consuming the context window immediately after
compaction. Each result is capped at 12 KiB with deterministic head/tail
evidence; an aggregate 64 KiB budget retains newest inspection results
and replaces older bodies with rerunnable receipts. Complete tool
results remain stored and visible. Configure
`PI_CONTEXT_TOOL_RESULT_BYTES` (4096–51200) and
`PI_CONTEXT_TOOL_RESULTS_TOTAL_BYTES` (16384–524288).

RLM model policy is ordered
`openai-codex/gpt-5.6-luna < .../gpt-5.6-terra < .../gpt-5.6-sol` in
both capability and price. Both root and child defaults are Luna: choose
Luna for bounded extraction/simple work, Terra for multi-step analysis,
planning, or synthesis, and Sol only for the hardest/high-stakes work.
`thinking` and `subThinking` accept Pi’s `off` through `max` levels;
explicit values win, automatic levels use only model tier, role, context
kind, and a fixed 12,000-character bounded-context threshold, never task
keywords, and `xhigh`/`max` require explicit selection. At child depth,
planner, worker, and synthesis calls use `subModel`/`subThinking`.
Complete role instructions are byte-stable system prompts; task, runtime
metadata, observations, and iteration remain in user prompts so the RLM
does not itself invalidate the provider’s system-prefix cache. Actual
cache reuse remains provider-dependent. Workers cannot change their
assigned model and report insufficiency when it is inadequate.

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
history, summaries, graph edges, pending compression, and historical
`as_of` projections are SQL views or recursive SQL queries.

The system prompt contains only stable memory policy. Once per user
turn, the extension builds a small task-conditioned projection from a
four-row summary frontier plus at most four exact FTS matches. The
`context` hook inserts that projection immediately before the current
user message, after the prior transcript. It is not persisted, does not
accumulate, and remains frozen through that turn’s tool loop. A memory
write therefore changes retrieval on the next user turn without mutating
the early system-prompt cache prefix.

Repeated `(graph, subject, predicate)` statements create inspectable
versions rather than rewriting history. `memory sql` selects an explicit
transaction or timestamp and exposes `as_of_statement`, `as_of_note`,
`as_of_summary`, `node_to_node_statement`, `node_to_value_statement`,
`memory_block`, `pending_summary`, and `wake`. Its dedicated read-only
connection disables local and network filesystem access, locks DuckDB
configuration, and bounds query text, memory, threads, runtime, and
returned rows. `recall` maintains a process-local DuckDB FTS projection
over exact notes; SQLite remains authoritative.

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

- `bioinformatics-cache-and-index-design` — Choose cache, index, and
  annotation-store formats from measured bioinformatics access patterns.
  Use when startup, repeated exact/interval lookup, provenance, or
  serving layout is the design problem.
- `bioinformatics-ffi-and-bindings` — Design bindings around mature
  native bioinformatics libraries. Use when exposing a C/C++ core to R,
  Python, SQL, wasm, or an embedded runtime instead of rewriting it.
- `bioinformatics-rewrite-porting` — Define and validate a compatible
  port of an existing bioinformatics tool. Use when behavior or output
  claims target a named upstream implementation.
- `bioinformatics-single-pass-analytics` — Design fused bioinformatics
  scans that compute several validated outputs from one
  parse/decompression pass. Use when repeated I/O dominates and metrics
  share real data locality.
- `biomedical-evidence-search` — Search biomedical evidence resources
  through one bounded tool, including GWAS Catalog, Open Targets,
  gpmap/gpmapr, OmicsPred, Europe PMC, LitVar2, Ensembl, GTEx, FinnGen,
  and PheWeb. Use for variant, gene, trait, study, score, PheWAS, eQTL,
  or literature lookups.
- `duckdb-c-extension-architecture` — Design and harden C DuckDB
  extensions across ownership, concurrency, API stability, vendoring,
  catalogs, and tests. Use for extension architecture or cross-cutting
  native changes, not a one-line patch.
- `duckdb-c-extension-r-bindings` — Package a DuckDB C extension for R.
  Use when installed artifacts, bootstrap/configure, SQL wrappers,
  generated docs, CRAN behavior, or native-versus-R ownership is
  central.
- `duckhts-development` — Work in RGenomicsETL/duckhts across the C
  extension, Rduckhts, tests, docs, vendoring, benchmarks, and
  compatible upstream rewrites. Use for any DuckHTS implementation
  change.
- `duckhts-wasm-debugging` — Debug DuckHTS in webR, browser workers,
  Emscripten, or duckdb-wasm. Use when the failing artifact or runtime
  is wasm rather than native host DuckDB/R.
- `ducknng-development` — Work in sounkou-bioinfo/ducknng on RPC
  manifests, NNG/HTTP/WebSocket carriers, Quack/Arrow payloads,
  session/AIO lifetime, security, DuckDB APIs, catalogs, and interop
  tests.
- `duckqc-design` — Design DuckDB-native sequencing QC with queryable
  metrics and fused scans. Use for DuckQC-style planning, metric
  contracts, reduction/threading, and compatibility outputs.
- `ducktinycc-development` — Work in sounkou-bioinfo/DuckTinyCC on
  TinyCC state/artifact lifetime, generated UDF bridges, recursive
  descriptors, embedded assets, allocator domains, trusted native code,
  and extension tests.
- `duckvep-design` — Design DuckDB-native variant consequence
  prediction. Use when transcript/reference caches, haplotype-aware
  consequences, bcftools csq reuse, annotation joins, or structured
  outputs are central.
- `genomics-sql-rewrites` — Decompose genomics tools into DuckDB
  readers, native kernels, indexes, and composable SQL. Use for generic
  SQL-native architecture rather than a repository-specific workflow.
- `library-first-bio-rewrites` — Apply a library-first, low-dependency
  stance to bioinformatics rewrites — prefer battle-tested libraries and
  composition, treat dependency bloat as a real engineering cost, and
  fuse statistics in one validated pass. Use when designing a rewrite or
  new tool that should avoid dependency bloat and maximize reuse.
- `r-c-anti-slop` — Audit R/C source with the repository Tree-sitter
  analyzer. Use to review redundant guards, helper and validation-layer
  sprawl, false path threat models, cyclomatic complexity, no-op
  handlers, or host-unsafe C assertions.
- `r-package-development` — Maintain an R package through
  DESCRIPTION/NAMESPACE, documentation, tests, native configure/build
  logic, tarball checks, websites, and release. Use for generic
  CRAN-style package mechanics.
- `rducks-development` — Work in sounkou-bioinfo/Rducks on execution
  plans, R-thread/SEXP ownership, direct and Quack/NNG marshalling,
  exact DuckDB ABI artifacts, capability probes, generated catalogs,
  wasm, and package gates.
- `rfmalloc-development` — Work in the Rfmalloc monorepo on typed
  out-of-core storage, C-callable contracts, backend fallback, GGML
  vendoring, architecture programs, numerical oracles, cross-package
  checks, and GPU evidence.
- `rho-development` — Work in RGenomicsETL/Rho on evidence-driven
  refinement, S7/s7contract interfaces, async tasks and streams,
  capabilities, providers, sessions, authored Rmd tests, and monorepo
  gates.
- `s7-development` — Implement or migrate R APIs with S7 classes,
  properties, validators, generics, multiple dispatch, inheritance,
  compatibility, and package registration.
- `sounkou-engineering-style` — Apply shared
  sounkou-bioinfo/RGenomicsETL engineering rules. Use when the user asks
  for “our style” or when a project skill delegates authority,
  ownership, bounds, focused work, and proof here.

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
