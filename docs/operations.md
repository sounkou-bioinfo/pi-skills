# Operating notes

[Back to README](../README.md) · [Coverage and known gaps](../TEST_PLAN.md)

## Installation and dependencies

Pi installs npm dependencies when installing this package. Runtime Pi APIs are
host-provided peers; `@duckdb/node-api` is a package dependency. If it is missing
from an existing checkout, install that checkout's dependencies: `/reload` is
not an installer. Finish live work before updating/reloading extensions.

| Feature | Additional requirements |
|---|---|
| RLM JavaScript | Node worker support; model access through the Pi CLI. Workers bound execution time, not a security boundary for hostile native code. |
| RLM `r_eval` | System `Rscript`; packages required by the analysis. This is not webR. |
| R/C audit | System R, `treesitter`, `treesitter.r` / [treesitter.c](https://github.com/sounkou-bioinfo/treesitter.c), `jsonlite`. Missing grammars and parse errors are explicit failures; no parser fallback. |
| Optional Jarl audit | Separately installed [Jarl](https://github.com/etiennebacher/jarl); request it explicitly. |
| Memory | DuckDB SQLite and FTS extensions; matching artifacts may need downloading on a cold cache. |

## Background tasks and completions

Use `bg_run` for long shell work, then `bg_status` and `bg_logs` to inspect the
result. Set `isAgent=true` only for LLM/agent processes; use `false` for scripts,
builds, tests, and servers. `/tasks` or `/bg-tasks` opens the task dock;
`/bg-clear` clears finished notices. Logs and metadata live under `.pi/tasks/`.

Keep the `completions` extension enabled with background tasks and RLM. Notices
are session-scoped. Terminal background status/log reads and targeted RLM
`status`/`wait` responses suppress pending notices; an RLM summary list alone does
not consume final results. Unread results are batched only at idle. Shutdown
removes pending notices/listeners; host submission is not a durable delivery
receipt and cannot retract a message already submitted to the host.

For silent shell polling set **both** `notifyOnCompletion=false` and
`triggerOnCompletion=false`. For silent detached RLM use `notifyOnCompletion=false`.
The [background manager is vendored](../vendor/pi-background-tasks/UPSTREAM.md);
do not install a second standalone copy.

## RLM

`rlm` starts detached by default; use `async=false` for a short blocking call.
Within one runtime, controllers and model subprocesses are serialized, with at
most four active/queued runs. `auto` does not recurse; `decompose` explicitly
allows bounded, serial child work. JavaScript runs in a terminable worker with
deadlines outside that worker. Large prompts travel through stdin.

The default root/child model is Luna. Choose Terra for multi-step synthesis and
Sol for the hardest/high-stakes work. Explicit `thinking`/`subThinking` override
static tier/role/context policy; `xhigh` and `max` are never automatic. Provider
availability, cost, and cache reuse remain provider-dependent.

| Input | Current bound |
|---|---|
| Inline context | 5 million characters |
| Eager text file | 20 MB |
| Eager CSV/JSON | 10 MB |
| Directory | Manifest up to 20,000 files; eager prioritized text up to 5 MB; bounded lazy reads |
| Parquet | DuckDB-backed sampling, not eager loading of the whole table |

Run history defaults to `/tmp/pi-rlm-runs` (under the system temp directory).
Hydration does not rewrite foreign metadata. Live foreign executors are not
resumed; a known dead owner may be displayed as interrupted. This is not a
distributed job-recovery service.

System R configuration:

| Tool option | Environment / default |
|---|---|
| `rBin` | `PI_RLM_R_BIN`; default `Rscript` |
| `rLibPaths` | `PI_RLM_R_LIBS`; colon/semicolon-separated |
| `rRepos` | `PI_RLM_R_REPOS`; default `https://cloud.r-project.org` |

In `r_eval`, helpers include `install_r_packages()`, `context_load()`,
`context_r_load_code()`, `save_plot()`, `FINAL()`, and `FINAL_VAR()`.
`rlm_call()` requires explicit recursive mode. Persistent R/NNG workers are a
[design proposal](rlm-r-nng-arrow-design.md), not the current implementation.

## Memory and goals

Memory's append-only SQLite authority defaults to `~/.pi/agent/memory.sqlite`;
`PI_MEMORY_DB` overrides it. SQLite WAL supports concurrent writers. DuckDB supplies
semantic/as-of views and an FTS projection; SQLite remains authoritative.
The tool resolves a project graph; `PI_MEMORY_PROJECT` overrides Git-derived
identity. `global` is explicit cross-project knowledge and `legacy` is read-only
v1 history. Scope applies to retrieval and compression, not just note labels.
No old history is rewritten. See [project memory](memory.md) for identity rules,
current versus historical queries, applicability, SQL boundaries and rollout.

Automatic global/project context shares eight-record and 12 KiB budgets. It stays
frozen through the same project's tool loop, refreshing on a new turn or project
switch; it is not persisted as another user message. `/goals` creates an explicit
objective and continuation policy. The stored token budget is
not an enforced cumulative spending cap; do not use it as a billing limit.

The semantic views follow [INCATools Semantic-SQL](https://github.com/INCATools/semantic-sql).
The summary hierarchy is independently implemented and inspired by
[OptMem](https://github.com/VictorTaelin/OptMem); no OptMem source is included.

## Shared terminal workbench

`/workbench` adds an opt-in review envelope to the existing goal. The agent can
`propose_contract`; the user reviews it with `/workbench contract` and grants a
tool-admission allowance with `/workbench resume N`. Neither command starts a
model turn. `record_checkpoint` links an agent report to retained tool-result
entry IDs and pauses for review. `/workbench evidence` opens recorded output;
it does not certify its interpretation.

Pause blocks future tool admissions and this package's automatic continuations.
It does not cancel admitted jobs, cover child-agent spending, or roll back files.
State is session/branch-local and requires renewal after reopening or reloading.
The [workbench guide](workbench.md) covers commands, limits, and phone access to
the same VM session through SSH/tmux. No browser service is started.

## Auditing, context, and terminal behavior

- `anti_slop` / `/anti-slop` scans tracked R/C files in a Git directory, or
  recognized files recursively outside Git. Complexity **≥15 warns**. Optional
  Jarl output is namespaced; output reports engine state, disabled rules, totals,
  and truncation. This is structural review, not semantic equivalence or a proof
  that a copied tree represents the repository. See the
  [rule policy](../skills/r-c-anti-slop/SKILL.md).
- Inspection text defaults to 12 KiB per result and 64 KiB retained across results.
  Full stored/UI results remain intact; fresh evidence displaces old context.
  Eviction can invalidate cached prefixes. Configure `PI_CONTEXT_TOOL_RESULT_BYTES`
  (4096–51200) and `PI_CONTEXT_TOOL_RESULTS_TOTAL_BYTES` (16384–524288).
- `mandatory-skills` loads `no-ghosts` and `native-tool-discipline` into every
  system prompt. They govern final-artifact wording and native tool selection.
- `expert-discipline` appends stable decision-review instructions. It cannot
  establish the correctness of the model's decisions or guarantee cache hits.
- `vscode-path-links` disables Pi OSC 8 links in VS Code terminals so native path
  detection handles Remote-SSH/WSL clicks. Other terminals are unchanged.
