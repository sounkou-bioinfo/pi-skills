# Changelog

## Unreleased

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
