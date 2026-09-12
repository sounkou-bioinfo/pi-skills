# Operating notes

[Back to README](../README.md) · [Coverage and known gaps](../TEST_PLAN.md)

## Installation and dependencies

Pi installs npm dependencies when installing this package. Runtime Pi APIs are
host-provided peers. `@duckdb/node-api` is a package dependency; the pinned
`@plannotator/pi-extension` and its review assets are bundled for Pi's loader. If it is missing
from an existing checkout, install that checkout's dependencies: `/reload` is
not an installer. Finish live work before updating/reloading extensions.

| Feature | Additional requirements |
|---|---|
| RLM JavaScript | Node worker support; model access through the Pi CLI. Workers bound execution time, not a security boundary for hostile native code. |
| RLM `r_eval` | System `Rscript`; packages required by the analysis. This is not webR. |
| R/C audit | System R, `treesitter`, `treesitter.r` / [treesitter.c](https://github.com/sounkou-bioinfo/treesitter.c), `jsonlite`. Missing grammars and parse errors are explicit failures; no parser fallback. |
| Optional Jarl audit | Separately installed [Jarl](https://github.com/etiennebacher/jarl); request it explicitly. |
| Memory | DuckDB SQLite and FTS extensions; matching artifacts may need downloading on a cold cache. |
| Local review | A browser locally or through VS Code Remote-SSH forwarding; Git for diff review. Plannotator requires Pi >=0.79.1. |

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

## Memory

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
switch; it is not persisted as another user message.

The semantic views follow [INCATools Semantic-SQL](https://github.com/INCATools/semantic-sql).
The summary hierarchy is independently implemented and inspired by
[OptMem](https://github.com/VictorTaelin/OptMem); no OptMem source is included.

## Local review

Plan and diff review use upstream [Plannotator](https://github.com/backnotprop/plannotator),
`@plannotator/pi-extension` 0.27.14 (MIT OR Apache-2.0). Its Pi extension supplies
the workflow, browser UI, annotations, and approval handling. Load one copy of
Plannotator. No separate CLI installer is needed for these Pi commands.
Plan submission requires interactive Pi and installed browser assets; headless
submission is blocked rather than treated as approval. Background agents can
prepare a Markdown plan for review in an interactive session.

**Work and review locally first.** Local plan approval authorizes implementation,
not publication. Push branches, submit PRs or stacks, post remote reviews or
comments, trigger remote CI, and merge only when the user explicitly requests those actions. This is a workflow
instruction, not a network sandbox or a guarantee about an agent's behavior.

| Pi command | Use |
|---|---|
| `/plannotator-plan-mode` | Explore and draft a plan for human review. `pi --plan` starts in this mode. |
| `plannotator_submit_plan` tool | Have the agent submit its Markdown plan for browser approval or revision. |
| `/plannotator-review` | Review the local working-tree diff and return annotated feedback. No PR is needed. |
| `/plannotator-review <PR-URL>` | Inspect an existing published PR. Posting a review or comments is a separate, explicit action. |
| `/plannotator-annotate path/to/plan.md` | Review a Markdown artifact. |
| `/plannotator-last` | Annotate an explanation from the conversation. |

On narrow screens, close the annotation panel and sidebar to read the plan;
the green approval button is labeled **OK**. Browser viewport checks are not a
substitute for trying the actual phone/client.

Code-review annotations return to Pi as findings to verify and discuss. Have the
agent ground its verdicts in the code, then choose which revisions to apply;
sending annotations is not automatic agreement that every finding is a bug.

Use ordinary file inspection and local tests throughout implementation. Review
untracked files as well as tracked changes. If work is already committed locally,
select an appropriate commit/base comparison in the review UI. GitHub remains
authoritative for published code reviews, CI results, and merges; local annotations
are not GitHub approvals. Native [stacked PRs](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs)
can package coherent, dependent changes after local review. `gh stack submit`
publishes branches and PRs: it belongs to that explicit publication step.

### Local machines and VS Code Remote-SSH

The review service listens on loopback, including inside SSH sessions. The
package sets `PLANNOTATOR_REMOTE=0` and rejects public bind/URL configurations.
Sharing links are disabled by default with `PLANNOTATOR_SHARE=disabled`.
Plannotator's own remote mode binds all interfaces without authentication; it
is not the configuration used here.

On a local machine, Plannotator opens the browser normally. In a VS Code
Remote-SSH terminal, keep the `BROWSER` helper supplied by VS Code: it opens
links on the client. Use the **Ports** view to forward the review port privately
if it has not been forwarded automatically. Do not make the forwarded port
public. This uses the existing SSH connection and does not require installing a
remote-access service or changing SSH configuration.

Ports are ephemeral by default so parallel sessions do not compete for one port.
For a stable forwarded URL, choose an **unused port dedicated to that Pi session**:

```bash
PLANNOTATOR_PORT=19432 pi
```

Forward remote port `19432` in VS Code's Ports view and open
`http://127.0.0.1:19432` on the client while a review is open. For plain SSH, open a
private tunnel from the client instead:

```bash
ssh -N -L 127.0.0.1:19432:127.0.0.1:19432 user@development-server
```

Use a different port for each concurrent session. Upstream can reclaim a fixed
port from an existing review, so do not reuse a port another session owns.
Loopback plus SSH forwarding protects network access, not access by untrusted
local users on a shared server. Review services do not provide per-user HTTP
authentication; use a trusted host or additional isolation for sensitive work.
Browser closing, tree navigation, and cancelling a review do not undo file changes
or cancel independently running jobs.

### Build understanding with Pi's tree

Keep the implementation objective on a stable conversation branch. Before a
side discussion, label its **assistant response** in `/tree`, for example
`implementation-root`. Selecting a user-message node instead can restore that
prompt to the editor; it is not the same resume point.

1. Use `/explore-topic <question>` for a short, read-only discussion. Compare
   alternatives and inspect evidence; do not begin implementation implicitly.
2. When you want to inspect a brief before leaving, use `/return-brief` to collect the objective, decisions actually made by the
   user, evidence, unresolved questions, and a proposed next step.
3. Finish or close outstanding review tabs. Open `/tree`, return to the labeled
   assistant anchor, and choose a branch summary. Custom summary instructions can
   request the same brief and separate user decisions from agent suggestions.
4. Inspect that summary and choose the next action. Submit an implementation plan
   through Plannotator when useful; approval and implementation happen on this
   branch, without replaying the entire exploratory discussion.

The side branch remains inspectable in the same session. Native branch
summarization may make a model request; navigating without a summary does not
provide the side discussion to the destination branch. `/fork` creates a separate
session and is useful for an independent investigation, whereas `/tree` is the
usual return path for a short side discussion.

Tree navigation changes conversation context, **not the working directory, Git
branch, files, or running processes**. Keep exploratory work read-only, or isolate
experiments explicitly. Summaries preserve hypotheses and evidence; they do not
turn an agent suggestion or an external document into user policy.

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
