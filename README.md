# pi-skills

Consolidated, skills-first Pi package for `sounkou-bioinfo`.

This repo replaces the previously separate Pi skill/package repositories:

- `pi-r-skills`
- `pi-rewrites-bio-skills`
- `pi-duckdb-c-extension-skills`

It also includes the user-wide `/goals` extension and a lean RLM tool that uses system R directly.

## Install

```sh
pi install git:github.com/sounkou-bioinfo/pi-skills
```

After installing or updating in an interactive Pi session:

```text
/reload
```

## Active contents

### Extensions

- `goals` — Codex-style `/goals` and `/goal` session goal loop extension.
- `rlm` — recursive long-context tool with `r_eval` backed by system `Rscript`, configurable R library paths, and DuckDB-backed parquet loading through Node.

### Subagents

This package no longer ships a homegrown subagent/scout/plan/recon implementation. Use the maintained package instead:

```sh
pi install npm:pi-subagents
```

That package already covers the runtime details we do not want to duplicate: child boundaries, fresh/fork context, async status, artifacts, worktrees, acceptance gates, and management commands.

### Skills

- `bioinformatics-cache-and-index-design`
- `bioinformatics-ffi-and-bindings`
- `bioinformatics-rewrite-porting`
- `bioinformatics-single-pass-analytics`
- `duckdb-c-extension-api-stability`
- `duckdb-c-extension-architecture`
- `duckdb-c-extension-function-catalog`
- `duckdb-c-extension-r-bindings`
- `duckdb-c-extension-testing-and-interop`
- `duckdb-c-extension-vendoring-and-shims`
- `duckhts-development`
- `duckhts-rewrite-porting`
- `duckhts-wasm-debugging`
- `duckqc-design`
- `duckvep-design`
- `genomics-sql-rewrites`
- `library-first-bio-rewrites`
- `r-package-development`
- `s7-development`

## RLM and R runtime direction

`r_eval` now targets real system R, not webR. Configure it with:

- tool param `rBin`, or env `PI_RLM_R_BIN` (default: `Rscript`)
- tool param `rLibPaths`, or env `PI_RLM_R_LIBS` (`:`/`;` separated)
- tool param `rRepos`, or env `PI_RLM_R_REPOS` (default: `https://cloud.r-project.org`)

Inside `r_eval`, use `install_r_packages()`, `context_load()`, `context_r_load_code()`, `save_plot()`, `rlm_call()`, `FINAL()`, and `FINAL_VAR()`.

Parquet context is loaded through `@duckdb/node-api`, which lines up with the DuckDB-native direction for DuckHTS, `ducknng`, and `ducktinycc`. DuckHTS stays the first target for deeper runtime integration.

The longer-term worker design is tracked in `docs/rlm-r-nng-arrow-design.md`: persistent system-R workers over NNG/nanoarrow, with DuckDB extensions as first-class runtime peers.

## Development

```sh
npm install
npm run typecheck
```

Runtime Pi APIs are peer dependencies supplied by Pi itself.

## License

MIT. See `LICENSE`.
