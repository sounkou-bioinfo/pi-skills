# pi-subagent-skills

A Pi package that bundles:

- a `subagent` extension for delegating work to isolated Pi subprocesses
- packaged default agents (`scout`, `planner`, `worker`, `reviewer`)
- prompt templates for common multi-agent flows
- skills that teach the main agent when and how to use subagents

## Upstream credit

This package is not presented as wholly original.

Primary upstream reference:

- [`badlogic/pi-mono` subagent example](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions/subagent) — direct structural and behavioral inspiration for the bundled `subagent` extension pattern

## Install

From GitHub:

```bash
pi install git:github.com/sounkou-bioinfo/pi-subagent-skills
```

Pin a ref if desired:

```bash
pi install git:github.com/sounkou-bioinfo/pi-subagent-skills@main
```

From a local checkout:

```bash
git clone https://github.com/sounkou-bioinfo/pi-subagent-skills.git
cd pi-subagent-skills
pi install .
```

## Included resources

### Extensions

- `subagent` — delegate a task to one or more specialized agents with isolated context windows
- `rlm` — recursive long-context orchestration with a Node-based REPL environment plus webR for text/tabular work, supporting text/files/csv/json/parquet contexts

### Packaged agents

- `scout` — fast repo recon (`openai-codex/gpt-5.3-codex-spark` by default)
- `planner` — implementation planning only (`openai-codex/gpt-5.4` by default)
- `worker` — executes changes (`openai-codex/gpt-5.4` by default)
- `reviewer` — reviews and sanity-checks results (`openai-codex/gpt-5.4` by default)

### Skills

- `subagent-orchestration`
- `parallel-codebase-recon`
- `plan-implement-review`

### Prompt templates

- `/implement`
- `/scout-and-plan`
- `/parallel-recon`
- `/rlm-r-eval-demo`
- `/rlm-codebase-demo`
- `/rlm-csv-demo`
- `/rlm-json-demo`
- `/rlm-parquet-demo`

## Usage examples

Single delegation:

```text
Use the subagent tool with the scout agent to locate authentication code.
```

Parallel delegation:

```text
Use the subagent tool to run two scouts in parallel: one for routing, one for database access.
```

Chain:

```text
Use the subagent tool in a chain: scout -> planner -> worker -> reviewer.
```

RLM over inline context:

```text
Use the rlm tool with task="How many lines mention apple?" and context="apple\nbanana\napple pie".
```

Deterministic R/webR evaluation:

```text
Use the rlm tool with task="Run set.seed(1995); sum(rnorm(100)) in R and return just the numeric result. Use r_eval." and context="R numeric task".
```

RLM can inspect text or file-tree context via structured actions such as:

- `peek`
- `grep`
- `sample_chunks`
- `map_chunks`
- `decompose`
- `repl_eval` (generic Node/JS REPL over the context object)
- `r_eval` (via webR for text/csv/parquet context)
- `solve`
- `final`

For counting, aggregation, line-oriented summarization, and deterministic R computations, the planner may prefer `r_eval`.
For codebases or file-tree context (`contextKind="files"` with a directory `contextPath`), the planner may prefer `repl_eval` with helpers like `listFiles()`, `readFile()`, `peekFile()`, and `grepFiles()`.
For parsed tables and objects, you can use `contextKind="csv"`, `contextKind="json"`, or `contextKind="parquet"` so the REPL gets first-class rows/columns or parsed JSON/parquet values.
Inside `repl_eval`, recursive calls are available through `await callRlm(task, subcontext)`.
Inside `repl_eval`, `rLoadCode()` returns context-aware R loading code for text/csv/json/parquet workflows.
If a `repl_eval` result includes that snippet under a field like `rLoadCode`, the top-level RLM summary also surfaces it as an `r_load_code:` block.
RLM also extracts `r_load_code:` from `r_eval` outputs when the loader snippet is returned directly or under a `Loader snippet:` section.
Inside `r_eval`, `context_load()` loads the current text/csv/parquet context in R and `context_r_load_code()` returns the loader snippet.
Inside `r_eval`, `install_webr_packages(c("pkg"))` installs wasm-ready packages from the webR binary repository at `https://repo.r-wasm.org/` using the supported webR package path.
Installed webR packages are cached across sessions in a shared host cache (`/tmp/pi-webr-package-cache`) and restored into each node-local webR library on startup, so repeated installs avoid the worst cold-start overhead.
Inside `r_eval`, `save_plot("plot.png", expr)` saves plot files into the run artifact directory and returns the artifact filename.
Inside `r_eval`, `rlm_call(task, subcontext = NULL, context_kind = NULL)` launches a recursive child RLM call from R and returns a list with `result`, `error`, `contextKind`, and `strategy`.
Inside `r_eval`, `FINAL(x)` returns a final answer directly from R and `FINAL_VAR("name")` returns the value of a named R variable.
Within a single RLM node, `r_eval` now reuses a persistent webR session so variables created in one `r_eval` step can be reused by later `r_eval` steps for that same node.
For parquet in webR, `context_load()` prefers real parquet readers (`arrow` or `duckdb+DBI`) when available and otherwise falls back to an embedded in-memory data frame built from the parsed parquet rows.
When `backend="tmux"`, RLM starts a tmux visualizer session over events/tree/output artifacts.
Completed runs now also surface top-level `strategy:` and `duration_ms:` lines so CLI/json output makes both the execution path and wall-clock runtime easier to verify.
A focused spark-based end-to-end validator is included as `npm run validate:rlm:spark`; it exercises `FINAL_VAR(...)`, recursive `rlm_call(...)`, webR package installation/cache reuse, and plot artifact export.

## Notes

- Packaged agents are available out of the box.
- User agents from `~/.pi/agent/agents` can also be used.
- Project agents from `.pi/agents` require explicit opt-in and confirmation.
