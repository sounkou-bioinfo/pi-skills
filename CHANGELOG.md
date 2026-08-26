# Changelog

## Unreleased

- Replace provider-specific GWAS/Open Targets surfaces with one `biomedical-evidence-search` metaskill and bounded `biomedical_search` tool. Declarative provider profiles cover GWAS Catalog v2, current Open Targets v4, gpmap/gpmapr, OmicsPred OpenAPI 1.2.1, Europe PMC, LitVar2's web-only snippet boundary, Ensembl, GTEx, FinnGen, PheWeb, and upstream variant-lookup ports; shared transport serializes each origin, spaces requests, and uses capped exponential backoff while leaving network sandboxing to the host. GWAS operations expose and enforce live OpenAPI filters, and a compact association projection deduplicates rsIDs while reporting completeness.
- Add a `vscode-path-links` extension that disables Pi OSC 8 hyperlinks in VS Code terminals so native Remote-SSH and WSL path detection handles file clicks.
- Add a schema-free `context-budget` hook with 12 KiB per-result and 64 KiB aggregate budgets for built-in inspection results. It retains newest evidence, replaces older bodies with rerunnable receipts, preserves complete stored/UI results, and freezes each result's full-vs-receipt fate the first time it is evaluated so previously transmitted content is never rewritten and provider prompt caching stays intact.
- Keep dynamic memory and goal state out of the early system-prompt cache prefix. Stable policies remain in the system prompt; bounded task/goal projections are transient context immediately before the current user message, replace rather than accumulate, and stay frozen through each tool loop.
- Reduce memory retrieval from the generic 80-row wake to a four-row summary frontier plus at most four task-matched exact notes. Compact automatic goal continuations to one sentence instead of persisting the objective and completion checklist every turn.
- Consolidate 26 overlapping skills into 20 distinct authorities and rewrite surviving `SKILL.md` contracts from 170K to about 36K characters. Fold generic DuckDB API/catalog/testing/vendoring guidance into one C-extension architecture skill, compatibility rewriting into DuckHTS development, and the library-first umbrella into narrower FFI/rewrite/single-pass authorities.
- Add a repository-vendored, Tree-sitter-only R/C anti-slop analyzer with a Pi `anti_slop` tool and `/anti-slop` command. It scans source files or whole directories (Git-tracked sources when available), flags structured redundant final returns, no-op R rethrow handlers, duplicate terminating guards, private R-helper direct-call counts requiring justification, condition sprawl, ambiguous `length()` truthiness, empty alternatives, and C runtime assertions that can abort an embedded host; JSON configuration controls rule severity without parser fallback.
- Add the `r-c-anti-slop` skill and executable R/C analyzer fixtures, including parse-error and no-fallback proof.
- Add append-only permanent memory backed by SQLite/WAL through DuckDB's
  SQLite storage extension: a Semantic-SQL-style statement authority,
  explicit transaction/timestamp `as_of`, recursive summary-graph wake and
  zoom views, process-local DuckDB FTS, externally isolated and resource-bounded
  read-only SQL, source-hash-checked compression, invalidation history, and
  cross-process write retry.
- Credit INCATools Semantic-SQL for the few-base-tables/many-views pattern and
  Victor Taelin's OptMem for the independently implemented append-only,
  bounded fading-detail, navigable-summary concepts.
- Bundle `pi-background-tasks` 0.6.0 for named detachable shell commands,
  external bounded logs, an interactive task dock, and completion wakeups. Apply
  a pinned installation patch that recreates its cached per-session task
  directory before every launch, so project cleanup cannot strand subsequent
  agent wrappers and metadata writes with `ENOENT`.
- Start RLM runs detached by default and emit one bounded completion wakeup so
  the main Pi session remains interactive; `async=false` retains explicit
  blocking behavior for short calls.
- Update the Pi development API dependencies to `@earendil-works/pi-ai` and
  `@earendil-works/pi-coding-agent` 0.82.1.
- Make the RLM a single-controller system: recursion now requires `mode=decompose`, defaults are shallow, and both runs and child model processes are serialized as a hard safety boundary.
- Isolate child Pi calls from tools, extensions, skills, context files, and nested orchestration; parse JSON events as a bounded stream instead of retaining cumulative stdout.
- Replace filesystem-order directory truncation with a Git-aware, authority-first manifest, bounded text loading, binary/large-file metadata, and lazy read/grep helpers.
- Enforce run timeouts, bound R subprocess output, sample Parquet in Node, queue background runs, persist run metadata, and recover active records as interrupted after host restart.
- Add focused RLM tests for context discovery, subprocess isolation/streaming and aborts, real system-R evaluation, and serialized durable run records.
- Add the shared engineering rule to control software concepts and executable QA rather than multiplying subagents, branches, or worktrees.

## 1.1.1

- Generate `README.md` from `README.Rmd`, deriving extension and skill lists from `package.json` plus skill frontmatter.
- Replace the DuckDB function-catalog Python reference generator with an Rscript/jsonlite generator.
- Use package-level `./extensions` and `./skills` entries instead of hand-maintained per-resource lists in `package.json`.
- Remove copied source README/changelog snapshots; this is the only repo we maintain now.

## 1.1.0

- Make the package skills-first while keeping only focused runtime extensions: `goals` and `rlm`.
- Remove the homegrown `subagent`/scout/plan/recon extension, prompt templates, bundled agents, and orchestration skills from active source; point users to `npm:pi-subagents` instead.
- Replace RLM `r_eval`'s webR runtime with configurable system R (`rBin`, `rLibPaths`, `rRepos`; env fallbacks `PI_RLM_R_BIN`, `PI_RLM_R_LIBS`, `PI_RLM_R_REPOS`).
- Replace Node-side parquet parsing via `hyparquet` with DuckDB-backed parquet loading through `@duckdb/node-api`.
- Remove `webr`, `hyparquet`, demo prompts, the webR validator script, and `package-lock.json`.
- Update extension imports to `@earendil-works/*`.
- Add/update RLM runtime design notes for a real system-R worker path over NNG + `nanoarrow`, with DuckHTS as the first integration target.

## 1.0.0

- Consolidate earlier personal Pi skill repos into one package.
- Initial consolidated package release.
