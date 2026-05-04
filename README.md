# pi-skills

Consolidated user-wide Pi package for `sounkou-bioinfo`.

This repo replaces the previously separate Pi skill/package repositories:

- `pi-r-skills`
- `pi-rewrites-bio-skills`
- `pi-subagent-skills`
- `pi-duckdb-c-extension-skills`

It also includes the user-wide `/goals` extension so stateful slash-command behavior lives in one Pi package.

## Install

```sh
pi install git:github.com/sounkou-bioinfo/pi-skills
```

After installing or updating in an interactive Pi session:

```text
/reload
```

## Contents

### Extensions

- `subagents` — packaged subagent orchestration tool.
- `rlm` — recursive long-context/RLM tool.
- `goals` — Codex-style `/goals` and `/goal` session goal loop extension.

### Prompts

- `implement.md`
- `parallel-recon.md`
- `rlm-codebase-demo.md`
- `rlm-csv-demo.md`
- `rlm-json-demo.md`
- `rlm-parquet-demo.md`
- `rlm-r-eval-demo.md`
- `scout-and-plan.md`

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
- `parallel-codebase-recon`
- `plan-implement-review`
- `r-package-development`
- `s7-development`
- `subagent-orchestration`

## Development

```sh
npm install
npm run typecheck
```

The source docs copied from the old repos are in `docs/source-readmes/` for migration traceability.

## License

MIT. See `LICENSE`.
