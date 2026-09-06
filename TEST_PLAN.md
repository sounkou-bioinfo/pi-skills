# Coverage and gaps

This is the pi-skills coverage inventory, not a copy of upstream's acceptance
checklist. The evidence column names the cases exercised by repository tests;
it does **not** assert exhaustive coverage of that row.
See [the QA standard](EXTENSION_QA_STANDARD.md) and
[testing playbook](EXTENSION_TESTING_PLAYBOOK.md) before adding or changing a gate.

## Current gates

| Gate | Command / evidence | Scope and missing proof |
|---|---|---|
| Typecheck | `npm run typecheck`; vendor also compiled by `test:background-tasks` | Development dependency types, not a supported-host matrix. |
| Unit, fake-Pi hooks, native/process tests | `npm test` | Cases below. Fake `ExtensionAPI` objects are not Pi SDK sessions. |
| Docs and package inventory | `npm run test:package` | Local Markdown destinations and packed source/worker/SQL/skill/vendor assets; not a tarball install. |
| Generated README | `npm run check:readme` | Source/render consistency, not accuracy of every prose claim. |
| Real Pi SDK and RPC | **Missing full suites**; optional [memory source smoke](EXTENSION_TESTING_PLAYBOOK.md#optional-fresh-pi-memory-source-smoke) | Source-load/schema/native projection is narrower than tool invocation, agent-loop lifecycle or RPC. |
| Dock component and PTY/TUI | **Missing locally** | Need real component rendering plus keyboard/focus/scroll/cleanup scenarios. |
| Scripted-provider agent loop | **Missing** | Need to observe actual follow-up model requests, not just message submissions. |
| Clean tarball install and host/platform matrix | **Missing as automated gates** | An earlier manual source-loader smoke is not this evidence. |

`npm run check` combines the implemented gates for runtime/build/package handoff.
Use the [change-scoped gates](EXTENSION_QA_STANDARD.md#gate-scope) for prose and
instruction edits. There is no `test:full` certification gate. Tests require native prerequisites; cold DuckDB extension
provisioning may need network access. Run suites serially in one checkout.

## Surface matrix

| Surface | Executable evidence | Uncovered cases / next proof |
|---|---|---|
| Background tools, commands, dock | [test_background_tasks.ts](scripts/test_background_tasks.ts): runtime-directory recreation, injected SIGTERM/SIGKILL close events, real shell jobs, terminal status/log headers, observed/unread notices through fake Pi. | Full command/schema failures, real external signals/process trees, timeout/output-cap races, UI actions, Windows, and actual host lifecycle. |
| Completion queue | [completions.test.ts](extensions/completions/completions.test.ts): both observation orders, deduplication, batch bounds, session filtering, synchronous send failure, busy/idle hooks, shutdown. | SDK/scripted-provider tests for real idle/follow-up ordering, switch/reload, submission failure, and interaction with goals. |
| RLM | [rlm.test.ts](extensions/rlm/rlm.test.ts): model/effort policy, file helpers, worker cancellation/deadline, stdin transport, real R, serialized runs, live-owner hydration, targeted result observations. | Parent-process watchdog for the test itself; worker OOM/exit/RPC failure, dead/reused owner PIDs, process-tree cleanup, end-to-end controller and clean installed-worker loading. |
| Context budget | [context-budget.test.ts](extensions/context-budget/context-budget.test.ts): UTF-8 bounds, head/tail retention, pass-through, immutability, fresh evidence/retry after saturated history, cap ordering. | Real SDK context conversion and interactions with compaction, memory, goals, and multiple extensions. |
| Memory | [memory.test.ts](extensions/memory/memory.test.ts): real SQLite WAL/FTS, append-only/as-of views, concurrent writers, interleaved graph forests, wrong-scope/hash rejection, canonical scope admission, scoped invalidation, v1 view isolation and reopened snapshots, legacy-label collisions and cross-protocol supersession, current-slot filtering before FTS limits, separate evidence/checkout metadata, combined UTF-8 projection bounds, Git identity/forks/worktrees/overrides and oversized dirty listings, fake-hook freeze/next-turn/project switching, unambiguous cache-key framing and legacy write rejection. | Corrupt/interrupted storage, disk-full/permission failures, adversarial SQL resource limits, Git failure/host matrices, large-corpus cost, real session reload/cancellation and concurrent old/new Pi runtimes. Summary fidelity and applicability are not certified. |
| Goals | [goals.test.ts](extensions/goals/goals.test.ts), via `test:memory`: explicit creation, stable policy, transient state, next-turn completion projection. | Command branches, continuation limits/failures, session lifecycle, real agent-loop interaction. Stored token budget is **not enforced cumulative expenditure**. |
| R/C anti-slop | [adapter](extensions/anti-slop/anti-slop.test.ts) and [R fixtures](scripts/test_anti_slop.R): skill-local analyzer resolution, repository-launcher delegation, grammar/config/error cases, structural rules, complexity boundary, literal-preserving equality, Jarl protocol fixtures. | Real-host command path, grammar/Jarl version matrix; no transitive dataflow or proof of semantic equivalence. |
| Web search | [codex-web-search.test.ts](extensions/codex-web-search/codex-web-search.test.ts): injected auth/HTTP, citations, absent auth, empty query, unterminated SSE. | Response body byte cap is absent; need auth-cancellation, oversized-body, multiline SSE, and live provider checks. |
| Biomedical search | [biomedical-evidence.test.ts](extensions/biomedical-evidence/biomedical-evidence.test.ts): injected provider responses, schemas, receipts, rate spacing, selected pagination/retry paths. | Each provider's malformed/cancelled response cases, pagination-origin policy, and opt-in live contract checks. |
| Expert discipline | [expert-discipline.test.ts](extensions/expert-discipline/expert-discipline.test.ts): stable/idempotent prompt block, preservation of base prompt and messages. | Real chained-extension behavior; tests cannot establish the quality of model decisions or provider cache hits. |
| VS Code path links | [source](extensions/vscode-path-links/index.ts), typecheck only. | No behavior tests. Need terminal detection, environment restoration, and Remote-SSH/WSL interaction evidence. |
| Skills | [skill sources](skills/); package inventory plus manual Pi-loader/frontmatter checks and [orientation exercise](docs/orientation-pilot.md). | No task-level model effectiveness suite. Routing/constraint review is not measured selection quality; the native ABI pilot case is planning-only. |
| Packaging and documentation | [package.test.mjs](scripts/package.test.mjs): local links and pack contents. | Clean install with fresh dependencies, SDK discovery, native assets on supported platforms. |

## Retained manual memory evidence

The source-loader smoke passed on the dirty memory implementation over `0364b77`
with Pi **0.85.1**, Node **24.14.1**, Linux x64 and `@duckdb/node-api`
**1.5.4-r.1**. It used an isolated agent directory/database and no model request;
registered schema and scoped native projection were asserted. Development types
are Pi **0.84.1**, not the tested CLI version. This is not a clean-install or
multi-host certification.

Production memory source fingerprint:
`2228a6b9182aced1a16266c5752cb9515c077bbcd484b3a91004fad6ad093dcd`.
This hashes each filename followed by NUL and its bytes, in order: `index.ts`,
`project.ts`, `store.ts`, `operations.sql`, `schema.sql`, `session.sql`, under
`extensions/memory/`. Test/documentation changes are outside that fingerprint. The full local gate
passed; subsequent scope-canonicalization refinements were rechecked with the
14 memory/goals tests, package/render checks and fresh-Pi smoke at this fingerprint.

## Instruction-routing review cases

These are manual review cases for instruction edits, not measured model results.
Check both the needed route and the work that should **not** be triggered.

| Task | Expected route / verification | Should not trigger |
|---|---|---|
| Fix a README spelling error | Authored README source, render/consistency and link checks. | Architecture tour or native/runtime suite. |
| Change executable Rmd code or a tool prompt | Affected behavior/prompt tests and relevant generation checks. | Classification as prose-only based on filename. |
| Fix background signal/notification handling | Registry/completion regressions, full local gate, and applicable host-boundary proof. | Dropping lifecycle coverage because the patch is short. |
| Change Rducks ABI/transport behavior | Rducks contract, affected ABI/data-plane checks and required package handoff gates. | A guessed ABI, an automatic fallback, or only documentation checks. |
| Query literature; separately enumerate an ontology's GWAS SNPs | Biomedical tool contract; GWAS enumeration reference and completeness evidence only for the latter. | Loading the GWAS workflow for every literature query or calling a partial result "all". |
| Bind an already-chosen native library into R | FFI/lifetime and R packaging contracts; upstream comparisons where claimed. | Reopening the reuse decision or inventing SQL/wasm consumers. |
| Resume unfamiliar work after conflicting implementation/runtime reports | Project orientation: identify scope, applicable evidence and the decisive counterexample; preserve unresolved distinctions. | Treating memory as instructions, silently changing accepted semantics, or promoting private notes to `AGENTS.md`. |
| Continue a familiar, already-scoped edit | Use the established context and relevant gate. | Invoking orientation simply because another edit began. |

Shorter text and successful skill loading do not establish better model behavior.
A model-specific comparison still needs recorded task outcomes, unnecessary reads,
missed invariants, test results, and host/model versions; no Astra A/B claim is
made by this cleanup.

## Priority boundary work

1. **Completion delivery:** real SDK + scripted provider, covering consumed results,
   unread batches, silent mode, goals interaction, switch/reload, and no surviving
   owned work after shutdown. Current spies can miss host ordering bugs.
2. **Runtime and storage failure:** parent watchdog, process-tree death, worker
   failures, dead-owner recovery, and I/O faults. A green happy path cannot rule
   out a hang, orphan, or misleading terminal state.
3. **Package and host compatibility:** clean tarball install/load of the vendored
   extension, worker and SQL assets, then explicit host/OS versions. Presence in
   an archive does not establish loadability.
4. **UI and remote services:** component/PTY keyboard behavior; provider boundary
   failures and response limits. Keep real-service checks opt-in and identified.

For each new scenario, add the assertion, gate, platform, and remaining limitation
here. Do not turn these gaps into checked boxes without executing the relevant
boundary. Any retained manual result must identify its exact revision and scope.

## Upstream material

[Vendor provenance](vendor/pi-background-tasks/UPSTREAM.md) identifies the npm
snapshot. Its README, testing plan, and publishing notes describe upstream;
the snapshot omitted upstream test sources. Their historical "implemented" rows
are not local proof, and their parent-workspace QA links are not our policy.
