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
| Claude Code subscription | Official `claude` CLI on `PATH`, authenticated separately with `claude auth login`; a Claude subscription. |

## Claude Code subscription

The [vendored pi-claude-code provider](../vendor/pi-claude-code/UPSTREAM.md)
routes Claude requests through the official Claude Code CLI. Pi owns tools and
conversation state; Claude Code owns authentication. Select **Claude Code
Subscription (Experimental)** in Pi and use `/claude-code-status` to check the
CLI and login. Models remain hidden when Claude Code is unavailable or logged out.

Load one copy. If the standalone upstream package is configured, remove it before
reloading pi-skills:

```sh
pi remove https://github.com/earendil-works/pi-claude-code
```

The package resource is `vendor/pi-claude-code/src/index.ts`; Pi package filters
can disable it. `PI_CLAUDE_CODE_COMMAND` selects the CLI executable and
`PI_CLAUDE_CODE_CONFIG_DIR` selects its configuration directory. These settings
do not copy credentials into Pi.

The integration is experimental and subscription billing may change; read the
[upstream warning](../vendor/pi-claude-code/README.md). Usage-credit/overage events
fail by default. `PI_CLAUDE_CODE_ALLOW_USAGE_CREDITS` explicitly opts into those
charges. Inherited API-key, proxy, and cloud-provider overrides are rejected to
avoid silently changing authentication or billing. Local fixtures verify
packaging and protocol behavior, not live subscription eligibility or cost.

The replay rewrite allocates at most four explicit cache markers: one tool
boundary, one leading-system boundary, and up to two message boundaries.
Nested tool arguments are not cache metadata. Pi's asynchronous payload hook
runs after this rewrite and before forwarding to Claude; it can mutate or replace
the JSON. Hook code must preserve provider-valid requests. Rejection of the
provider's `onPayload` promise or cancellation prevents forwarding. Pi reports
exceptions from individual `before_provider_request` listeners without
necessarily rejecting that promise; a listener that must stop a request must
also abort the agent. Local CLI/HTTP tests do not establish provider cache hits
or subscription quota savings.

Native environment/date reminders occupy their replay positions before the
initial request is sent. Startup context attached to the first queried user
message stays at that historical position, even with imported history. Replay
carriers record the user ordinal and canonical-content hash along with the
prefix; an edited or absent anchor does not receive stale context. This
preserves native instructions rather than discarding them to improve cache
statistics. Restoration requires recorded metadata and cannot reconstruct
unrecorded native context. [Bounded Haiku verification](claude-cache-verification.md)
records the live checks and their limits.

A session can switch to Claude Code from another provider. Historical tool-call
identifiers are normalized for Claude, and other providers' reasoning is dropped
rather than replayed; thinking signed by this provider or Pi's
`anthropic-messages` API is replayed unchanged. Provider caches are per model,
so the first Claude request after a switch writes a new cache entry.

The snapshot is pinned and generated from a [manifest, patches, and overlay](../scripts/vendor/pi-claude-code/manifest.json).
Updates are explicit maintenance operations; installation and reload do not
fetch upstream source or apply patches.

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
switch. A byte-identical refreshed snapshot keeps its existing user-message anchor.
If that anchor is absent or edited, the snapshot moves before the current user.
Changed snapshots also move there and replace the previous snapshot. Only one
snapshot is sent; stale facts do not accumulate for cache reuse. The snapshot
is not persisted as another user message.

The semantic views follow [INCATools Semantic-SQL](https://github.com/INCATools/semantic-sql).
The summary hierarchy is independently implemented and inspired by
[OptMem](https://github.com/VictorTaelin/OptMem); no OptMem source is included.

## Architecture refinement

The [architecture-refinement skill](../skills/architecture-refinement/SKILL.md)
builds a working theory linking the domain problem, evolving specification,
implementation, evidence, and owner understanding. Use it for proposed designs,
exploratory coding, technical issues, or systems whose behavior has outrun shared
understanding. Pi can select it from its description, or you can invoke it explicitly:

```text
/skill:architecture-refinement Review the proposed job queue design and its failure modes.
/skill:architecture-refinement The missing-input semantics of this R API are undecided. Explore concrete cases with small probes before proposing a contract; preserve accepted invariants.
/skill:architecture-refinement I've lost the architectural picture of uploads. Reconstruct the flow, challenge the decisions, and walk me through the trade-offs. Review only.
/skill:architecture-refinement Refine this issue into an actionable investigation with acceptance criteria.
```

The skill owns the workflow: bounded observe–explain–probe–revise loops,
event-driven checkpoints rather than per-commit ceremony, and local-only review
and issue drafts unless publication is requested.

The [expert-discipline hook](../extensions/expert-discipline/index.ts) supplies
three fixed, named system-prompt sections: decision review, skill activation,
and a clarification gate. The activation nudge uses the available skill list
and its file location. Pi reads the skill proactively at relevant decision
points in any project; keep both the hook and skill enabled. The full skill
loads on demand. Decision guidance prefers short observe–act–inspect–revise cycles
and distinct evidence-producing delegations over unsolicited best-of-N answer sampling.

The clarification gate applies even when the skill is unavailable. It instructs
the agent to pause affected work before consequential analysis, execution, or edits
when intent has materially different readings, constraints conflict, or a correction
exposes an unresolved assumption. The agent asks one focused question, offers
alternatives and a recommendation, and waits for resolution or explicit delegation
within accepted constraints. A generic “continue” does not resolve the choice.
Bounded inspection and safe probes can continue without committing to an interpretation.
Settled decisions and routine work do not require an interview. Revisit settled
decisions only when evidence, changed constraints, or corrections invalidate their
premises. The skill supplies the detailed [decision cases](../skills/architecture-refinement/SKILL.md#clarify-intent-when-drift-is-likely).

The hook makes no extra model or cache-warming requests. Stable text permits
cache reuse but does not guarantee it. The hook is a behavioral instruction,
not a scheduler, tool gate, or proof of model adherence or human understanding.
The [invariant-section projection](../extensions/shared/prompt-sections.ts) places
current owned policies in the first outgoing system message. It removes only
those owned keys from later system updates in that projection. Stored history,
unowned fields, and tool declarations remain unchanged. Expert discipline,
mandatory skills, permanent-memory policy, and local-review policy use this path.
It covers background continuations that bypass `before_agent_start` without
moving a transient repair across tool results. Updating a policy intentionally
changes its initial prompt section.

Offline tests cover user-started and repeated background tool continuations,
including skill-disabled loading. Native Codex tests cover both mid-conversation
system-message modes and the following user turn. These tests establish delivery
and transport continuity, not provider cache hits or whether a model will ask or wait.
After updating the package, finish live tasks and run `/reload` or start a new session.

## Local review

Plan and diff review use upstream [Plannotator](https://github.com/backnotprop/plannotator),
`@plannotator/pi-extension` 0.27.14 (MIT OR Apache-2.0). Its Pi extension supplies
the workflow, browser UI, annotations, and approval handling. Load one copy of
Plannotator. No separate CLI installer is needed for these Pi commands.
Plan submission requires interactive Pi and installed browser assets; headless
submission is blocked rather than treated as approval. Background agents can
prepare a Markdown plan for review in an interactive session.

**Work and review locally first.** Local plan approval authorizes implementation,
not publication; the [local-review skill](../skills/local-review/SKILL.md) owns
that policy. It is a workflow instruction, not a network sandbox.

| Pi command | Use |
|---|---|
| `/plannotator-plan-mode` | Explore and draft a plan for human review. `pi --plan` starts in this mode. |
| `plannotator_submit_plan` tool | Have the agent submit its Markdown plan for browser approval or revision. |
| `/plannotator-review --git` | View the local Git working-tree diff; annotate if desired. No plan or PR is needed. |
| `/plannotator-review <PR-URL>` | Inspect an existing published PR. Posting a review or comments is a separate, explicit action. |
| `/plannotator-annotate path/to/plan.md` | Review a Markdown artifact. |
| `/plannotator-last` | Annotate an explanation from the conversation. |

For viewer-only use, run `/plannotator-review --git` in Pi, inspect tracked and
untracked changes, then choose **Close review without feedback**. Closing stops
the review listener without sending a message to the model. No plan, approval,
implementation request, or published PR is required. Sending annotations is a
separate handoff for discussion; it is not necessary just to read a diff.

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

## Context and subscription cache reuse

Inspection text defaults to 12 KiB per result and 64 KiB retained across results.
Text-only `read`, `bash`, `grep`, `find`, and `ls` results share this allowance;
image/mixed results, other tool names, and conversation messages pass through.
Full stored/UI results and metadata remain intact. Configure
`PI_CONTEXT_TOOL_RESULT_BYTES` (4096–51200) and
`PI_CONTEXT_TOOL_RESULTS_TOTAL_BYTES` (16384–524288).

Crossing the retained-text ceiling re-trims a whole older block to retain at
most half-budget, or the newest single bounded result if larger. Omission
decisions are persisted by toolCallId in session custom entries and restored
from the active branch on reload/tree navigation. Between these deliberate
re-trims, previously sent inspection results remain byte-stable. Older small
results do not fill suffix gaps. Omission-notice overhead is separate from the
retained-text allowance; ordinary conversation compaction still bounds the rest
of the history. Re-running a tool obtains fresh evidence under a new toolCallId.

Eviction still changes the prompt near the recent-evidence boundary. Compaction,
branch changes, model/tool/prompt changes, and provider cache expiry can also
break reuse. These bounds therefore cannot guarantee cache hits or subscription
savings. Use existing Pi session assistant-usage records to distinguish active
work from idle gaps, accounting for model and context changes.

[Codex pricing](https://developers.openai.com/codex/pricing) describes caching as
one factor in usage. API-dollar estimates, credit-metered rates, and cache-hit
percentages are not measurements of an included subscription allowance saved.
This package makes no idle keepalive requests. A quota-consuming warming
experiment needs separate authorization and must account for all probes,
failures, resumed work, sessions that never resume, concurrent usage, and
allowance resets. A client timeout or a request for one output token does not
establish a hard quota cap.

### Cache telemetry

The package auto-discovers `extensions/cache-telemetry/index.ts`. Reload Pi after
installing the package update, then use `/cache` or `/cache 10` (1–100) for the
active branch's turns, miss rate, costs and latest misses. The command is local
and does not send a model request.

In the interactive UI the footer shows the latest turn's reuse and cost, the
session cost and the cost of misses so far, for example
`cache ✓ 99% · est. turn $0.15 · session $812.40 · 221 misses $716.29`. A miss
turns the line red and raises a warning with cached, uncached and cache-write
input tokens and the events observed before it. Dollar values are usage-cost
estimates, not subscription charges or quota measurements. When the provider
reports both read and write prices, the warning estimates their rate difference
for written tokens; it does not infer a missing read price or promise savings.

Assistant messages already store usage; telemetry reuses that data and appends
`cache-telemetry-v1` custom entries for request diagnostics. These entries do
not enter model context. They contain usage/cost, classifications, event names,
tool-result counts, and SHA-256 digests of the observed system prompt and active
tool-name order, not prompt text. For providers whose logical request has an
`input` or `messages` array, telemetry compares ephemeral item and top-level
field hashes with the preceding request. It persists only item counts, the
common-prefix length, the first mismatch position, and changed top-level field
names. Payload content is not retained; comparison hashes remain in memory and
reset at session, tree, or model boundaries.

Diagnostics include the elapsed gap from the preceding assistant record to the
next request and the count of newly persisted context-budget omissions observed
before sending. Existing branch receipts are history on reload; tool
continuations do not count them again. A long gap is labeled `cache expiry
unverified`, not a known cold cache. Neither elapsed time nor compaction proves
that all cached prefixes are gone. The retained-text hard ceiling and
half-budget retrim policy remain in force; time alone does not trigger trimming.

A hit has at least 50% cached input (`input + cacheRead + cacheWrite`, excluding
output). Low reuse after a comparable provider/model turn is a miss; a first or
model-switch low-reuse turn is cold. Turns with no input-context tokens are
unknown. A sharp-drop flag requires more than a 50% drop from at least 4,096
cached tokens while input context grows on the same provider/model. Miss rate
excludes cold/unknown turns; costs include separate cold/unknown buckets. These
are reuse heuristics, not provider cache verdicts. Compaction, model changes,
observed prompt/tool-order changes and tool-result counts are diagnostics, not
proven causes. Prompt/tool hashes are extension-context observations, not final
wire-payload fingerprints; they cannot detect a later provider-payload mutation
or a tool-schema change with unchanged names.

The `before_provider_request` comparison observes the provider-converted logical
request at this extension's hook position, before transport optimization; a
later request hook can still modify it. A stable logical prefix does not prove
that Codex selected `previous_response_id`, that a connection was reused, or
that the provider accepted a cache entry. The offline
[`codex-cache-continuity.test.mjs`](../scripts/codex-cache-continuity.test.mjs)
uses the installed Codex adapter and a fake WebSocket to inspect actual outbound
frames. It verifies delta selection across a tool continuation and the following
user turn, and verifies full-context fallback after prompt/history changes or a
connection reset. Set `PI_CACHE_HOST_DIR` to an installed
`@earendil-works/pi-coding-agent` directory when testing that host's exact
adapter. The test does not contact OpenAI or establish provider-side token reuse.
For Claude Code, the same hook runs on the replay-rewritten JSON at the relay
boundary. Loopback tests compare callback output with the body actually received
upstream, including process reuse, tool results, hook rejection, and cancellation.
A later hook can still change the body; provider-side cache acceptance remains
unmeasured. Older turns retain usage but may lack these diagnostics.

For offline session replay on Node 24+, run:

```sh
node scripts/analyze_cache_misses.mjs \
  /path/to/session.jsonl \
  /path/to/@earendil-works/pi-coding-agent/dist/core/session-manager.js
```

Use the core module matching the log's Pi version. Replay takes a byte-bounded
snapshot, reports its SHA-256, follows parent IDs/compaction context entries,
and compares the configured legacy/new omission decisions. It neither contacts a
provider nor writes the session. Its cohort is Claude Code / claude-opus-5-5;
investigation misses use the supplied `<50% of totalTokens` definition, which
includes output and differs from the live telemetry input-only denominator.
An optional final positive integer limits the cohort to that many qualifying
large-context turns; use `577` to reproduce the investigation's original cohort
when the source session continues growing.

## Auditing and terminal behavior

- `anti_slop` / `/anti-slop` scans tracked R/C files in a Git directory, or
  recognized files recursively outside Git. Complexity **≥15 warns**. Optional
  Jarl output is namespaced; output reports engine state, disabled rules, totals,
  and truncation. This is structural review, not semantic equivalence or a proof
  that a copied tree represents the repository. See the
  [rule policy](../skills/r-c-anti-slop/SKILL.md).
- `ste_check` / `/ste-check [--mode procedural|descriptive|mixed] path` checks a
  Markdown or text file (the tool also accepts draft text) against the
  structural rules of the
  [Simplified Technical English skill](../skills/simplified-technical-english/SKILL.md):
  sentence and paragraph length, verb forms, contractions, semicolons, helping
  verbs, and words outside the approved list and the skill's
  [bioinformatics technical names and verbs](../skills/simplified-technical-english/references/bioinformatics-terms.md),
  which is the place to add project terms. It runs in-process with no
  external runtime. The skill and word list come from
  [0xpili/simplified-technical-english](https://github.com/0xpili/simplified-technical-english)
  (MIT; the ASD-STE100 dictionary belongs to ASD; the bioinformatics rules,
  terms, and examples are this package's additions, see the
  [notice](../skills/simplified-technical-english/NOTICE.md)). A clean report is
  not ASD-STE100 compliance.
- `mandatory-skills` loads `no-ghosts` and `native-tool-discipline` into every
  system prompt. They govern final-artifact wording and native tool selection.
- Prompt policy from this package (memory, mandatory skills, expert discipline,
  local review) is set as named sections on `before_agent_start`
  (`permanent_memory`, `mandatory_skills`, `expert_decision_discipline`,
  `architecture_refinement`, `local_review_policy`). Pi 1.0 keeps such a prompt
  structured in the transcript and sends a later change as a section update. A
  hook that returns a whole `systemPrompt` makes the prompt one opaque block for
  that run, so an extension loaded beside this package should set sections too.
  The package requires Pi 1.0 or later.
- `vscode-path-links` disables Pi OSC 8 links in VS Code terminals so native path
  detection handles Remote-SSH/WSL clicks. Other terminals are unchanged.
