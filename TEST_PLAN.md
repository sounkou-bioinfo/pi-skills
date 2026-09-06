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
| Real Pi SDK and RPC | **Missing** | Need loader/tool/lifecycle and wire-protocol fixtures. |
| Dock component and PTY/TUI | **Missing locally** | Need real component rendering plus keyboard/focus/scroll/cleanup scenarios. |
| Scripted-provider agent loop | **Missing** | Need to observe actual follow-up model requests, not just message submissions. |
| Clean tarball install and host/platform matrix | **Missing as automated gates** | An earlier manual source-loader smoke is not this evidence. |

`npm run check` combines the implemented gates. There is no `test:full`
certification gate. Tests require native prerequisites; cold DuckDB extension
provisioning may need network access. Run suites serially in one checkout.

## Surface matrix

| Surface | Executable evidence | Uncovered cases / next proof |
|---|---|---|
| Background tools, commands, dock | [test_background_tasks.ts](scripts/test_background_tasks.ts): runtime-directory recreation, injected SIGTERM/SIGKILL close events, real shell jobs, terminal status/log headers, observed/unread notices through fake Pi. | Full command/schema failures, real external signals/process trees, timeout/output-cap races, UI actions, Windows, and actual host lifecycle. |
| Completion queue | [completions.test.ts](extensions/completions/completions.test.ts): both observation orders, deduplication, batch bounds, session filtering, synchronous send failure, busy/idle hooks, shutdown. | SDK/scripted-provider tests for real idle/follow-up ordering, switch/reload, submission failure, and interaction with goals. |
| RLM | [rlm.test.ts](extensions/rlm/rlm.test.ts): model/effort policy, file helpers, worker cancellation/deadline, stdin transport, real R, serialized runs, live-owner hydration, targeted result observations. | Parent-process watchdog for the test itself; worker OOM/exit/RPC failure, dead/reused owner PIDs, process-tree cleanup, end-to-end controller and clean installed-worker loading. |
| Context budget | [context-budget.test.ts](extensions/context-budget/context-budget.test.ts): UTF-8 bounds, head/tail retention, pass-through, immutability, fresh evidence/retry after saturated history, cap ordering. | Real SDK context conversion and interactions with compaction, memory, goals, and multiple extensions. |
| Memory | [memory.test.ts](extensions/memory/memory.test.ts): real SQLite WAL/FTS, append-only/as-of views, summary traversal/invalidation, multiple writers, bounded projection, fake-Pi lifecycle. | Corrupt/interrupted storage, disk-full/permission failures, adversarial read-only SQL limits, and real session reload/cancellation. |
| Goals | [goals.test.ts](extensions/goals/goals.test.ts), via `test:memory`: explicit creation, stable policy, transient state, next-turn completion projection. | Command branches, continuation limits/failures, session lifecycle, real agent-loop interaction. Stored token budget is **not enforced cumulative expenditure**. |
| R/C anti-slop | [adapter](extensions/anti-slop/anti-slop.test.ts) and [R fixtures](scripts/test_anti_slop.R): grammar/config/error cases, structural rules, complexity boundary, literal-preserving equality, Jarl protocol fixtures. | Real-host command path, grammar/Jarl version matrix; no transitive dataflow or proof of semantic equivalence. |
| Web search | [codex-web-search.test.ts](extensions/codex-web-search/codex-web-search.test.ts): injected auth/HTTP, citations, absent auth, empty query, unterminated SSE. | Response body byte cap is absent; need auth-cancellation, oversized-body, multiline SSE, and live provider checks. |
| Biomedical search | [biomedical-evidence.test.ts](extensions/biomedical-evidence/biomedical-evidence.test.ts): injected provider responses, schemas, receipts, rate spacing, selected pagination/retry paths. | Each provider's malformed/cancelled response cases, pagination-origin policy, and opt-in live contract checks. |
| Expert discipline | [expert-discipline.test.ts](extensions/expert-discipline/expert-discipline.test.ts): stable/idempotent prompt block, preservation of base prompt and messages. | Real chained-extension behavior; tests cannot establish the quality of model decisions or provider cache hits. |
| VS Code path links | [source](extensions/vscode-path-links/index.ts), typecheck only. | No behavior tests. Need terminal detection, environment restoration, and Remote-SSH/WSL interaction evidence. |
| Skills | [skill sources](skills/); package test checks shipped files. | No task-level effectiveness suite. Review triggers, referenced authorities, and prerequisite assumptions per changed skill. |
| Packaging and documentation | [package.test.mjs](scripts/package.test.mjs): local links and pack contents. | Clean install with fresh dependencies, SDK discovery, native assets on supported platforms. |

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
