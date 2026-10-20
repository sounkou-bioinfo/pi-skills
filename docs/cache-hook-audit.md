# Cache mutation audit

Scope: configured packages in `/home/biouser/.pi/agent/settings.json`, package
extension entry points, and `/home/biouser/.pi/agent/extensions`. Sources were
inspected locally; they are not proof of the exact code loaded by a historical
process. Counts refer to the first 577 Claude Code / claude-opus-5-5 turns above
100,000 total tokens (221 misses, 356 hits); overlaps are not additive.
The configured `/home/biouser/DevOps/pi-skills` checkout is missing, so
its historical hooks cannot be audited. The global extension directory contains
only a fast-mode configuration file, not another extension entry point. The
project settings at `/home/biouser/DevOps/ulcwgs/.pi/settings.json` select no
additional package. No live provider requests, subagents, or remote reviews were used
for this audit.

## History and prompt mutations

- `/home/biouser/.pi/agent/git/github.com/sounkou-bioinfo/pi-skills/extensions/context-budget/index.ts:32`
  (`context`): deterministic per-result head/tail bounding plus aggregate
  omissions. Legacy replay moves an already-sent boundary before 155 misses and
  zero hits in the large-context cohort. Persisted omissions with half-budget
  hysteresis replay 16 such re-trims; these are invalidation opportunities, not
  measured future cache verdicts. Tests exercise actual source-loaded provider
  contexts and session reopen.
- `/home/biouser/.pi/agent/git/github.com/sounkou-bioinfo/pi-skills/extensions/memory/index.ts:171`
  (`context`): removes projected memory messages and inserts a frozen projection
  before the latest user message. A new user relocates the injection, changing an
  earlier prefix even when the projection text stays identical. Latest-user
  changes precede 40 misses and 21 hits; four misses also have legacy budget
  boundary moves. These are *possible* relocations: the transient projection
  itself is not recorded in the JSONL. Its source includes transaction IDs,
  checkout/dirty state and selected notes at
  `/home/biouser/.pi/agent/git/github.com/sounkou-bioinfo/pi-skills/extensions/memory/index.ts:251`;
  a timestamp is frozen with each projection, not refreshed on every tool loop.
  A memory redesign is outside this fix.
- `/home/biouser/.pi/agent/git/github.com/sounkou-bioinfo/pi-skills/extensions/memory/index.ts:169`,
  `/home/biouser/.pi/agent/git/github.com/sounkou-bioinfo/pi-skills/extensions/mandatory-skills/index.ts:23`,
  `/home/biouser/.pi/agent/git/github.com/sounkou-bioinfo/pi-skills/extensions/expert-discipline/index.ts:24`,
  `/home/biouser/.pi/agent/git/github.com/sounkou-bioinfo/pi-skills/extensions/plannotator/index.ts:14`
  (`before_agent_start`): append policy/skill text. Policy text is stable;
  mandatory-skill file contents can change on disk. No per-call timestamp is
  injected. Historical logs do not attribute the 22 miss / one hit system-delta
  coincidences to individual extensions. No leading-system-prefix change is
  reconstructed in this cohort.
- `/home/biouser/.pi/agent/git/github.com/sounkou-bioinfo/pi-skills/node_modules/@plannotator/pi-extension/index.ts:1481`
  (`before_agent_start`): appends phase-specific framing as a custom message,
  with execution todo snapshots on later user turns. Framing persists in history;
  these are suffix appends, not per-tool-loop historical rewrites.
  `/home/biouser/.pi/agent/git/github.com/sounkou-bioinfo/pi-skills/node_modules/@plannotator/pi-extension/index.ts:1640`
  (`agent_end`) schedules an approved-plan continuation and appends completion
  messages at line 1683. Active-tool filtering/restoration occurs at lines
  528, 561 and 1806. Zero tool-set deltas precede cohort misses/hits; individual
  phase framing is not reliably attributable from stored provider payloads.

## Payload mutation and asynchronous appends

- `/home/biouser/.pi/agent/npm/node_modules/pi-openai-fast-mode/src/index.ts:140`
  (`before_provider_request`): only supported OpenAI-family payloads receive
  `service_tier: "priority"`; other payload fields are preserved. The inspected
  payload implementation is
  `/home/biouser/.pi/agent/npm/node_modules/pi-openai-fast-mode/src/payload.ts:55`.
  Not applicable to this Claude Code cohort; zero directly attributable misses.
- `/home/biouser/.pi/agent/git/github.com/hjanuschka/pi-multi-pass/extensions/multi-sub.ts:7386`
  (`before_agent_start`) tracks the prompt/model without rewriting them.
  Its `agent_end` error rotation at line 7392 can switch providers and enqueue a
  retry via line 3586. Zero provider/model switches precede cohort misses/hits.
- `/home/biouser/.pi/agent/git/github.com/sounkou-bioinfo/pi-ducknng/extensions/pi-ducknng/coordination.ts:844`
  (`session_start`/`input`) restores coordination state and removes deprecated
  tool names at line 855. The coordination poller appends fresh steering
  envelopes at line 420; timestamps inside envelopes are event content, not a
  per-request history rewrite. No matching tool-set changes are observed in the
  cohort; individual steering effects are not identifiable as cache misses.
- `/home/biouser/.pi/agent/git/github.com/sounkou-bioinfo/pi-skills/extensions/completions/index.ts:81`
  (`session_start`) installs completion-event subscriptions; timer delivery at
  line 72 appends a batched notification once. Background tasks emit those
  notices at
  `/home/biouser/.pi/agent/git/github.com/sounkou-bioinfo/pi-skills/vendor/pi-background-tasks/src/extension.ts:95`.
  Appending fresh evidence does not itself rewrite a sent prefix; its inspection
  outputs can trigger the budget boundary. No separate attribution is justified.

Searches of all available configured extension entry points found no additional
`context`/`before_provider_request` history mutator. Biomedical search, web search,
RLM, anti-slop and path-link extensions register tools/commands or UI behavior;
RLM planner/worker prompts belong to separate requests. No cache-miss classifier
or `/cache` command was found in core or available loaded/vendored extensions.
Core `getSessionStats()` already aggregates stored usage and total cost at
`/home/biouser/.nvm/versions/node/v24.14.1/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:3383`;
telemetry reuses assistant usage instead of introducing provider accounting.

The new observer at
`/home/biouser/.pi/agent/git/github.com/sounkou-bioinfo/pi-skills/extensions/cache-telemetry/index.ts:86`
returns no replacement context. Diagnostic custom entries are excluded from
model messages. Prompt hashes observe the extension API, not final wire payloads.
Full payload capture would be needed to attribute transient projection changes,
provider-side cache expiry/eviction, and historical hook versions conclusively.
