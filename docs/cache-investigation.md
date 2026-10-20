# Prompt-cache investigation

Implementation commit:
`c1363941a099d5891bebc0980b8054a7bda5052f`.

## Evidence and attribution

Source:
`/home/biouser/.pi/agent/sessions/--home-biouser-DevOps-ulcwgs--/2026-09-08T08-57-25-078Z_01a0803c-8556-75b3-a1ca-f7d11e0dc808.jsonl`.
The session is still growing. Analysis snapshots 180,122,714 bytes, SHA-256
`17964636c3451c4adea719e74fa925aacf8af5936c10d3172166048d4b2b0f5a`, and limits
the cohort to the original first 577 Claude Code / claude-opus-5-5 turns above
100,000 total tokens. This reproduces **221 misses ($716.29), 356 hits ($43.75)**
using the supplied cacheRead/totalTokens <50% definition.

Parent-linked replay with installed Pi core context reconstruction yields:

| Preceding observation | Misses | Hits |
|---|---:|---:|
| Already-sent context-budget boundary changes | 155 | 0 |
| Latest-user change: possible memory-projection relocation | 40 | 21 |
| Appended system delta | 22 | 1 |
| Idle gap over one hour | 3 | 0 |
| Compaction, provider/model switch, leading prompt change, tool-set change, context edit | 0 each | 0 each |

Counts overlap: four memory candidates and three system deltas coincide with
budget moves. There are 148 budget-only coincidences and 22 misses without an
observed candidate. Cache reads of 15,698 and 14,129 account for 196/221 misses.
The deterministic rewrite mechanism and association strongly support the budget
hypothesis; historical final wire payloads and transient projections are absent,
so individual misses are not causally proven. Provider eviction/expiry remains
possible. Current sources also cannot certify historically loaded versions; the
configured `/home/biouser/DevOps/pi-skills` checkout is missing.

Every available mutating hook, full file:line references, timestamps/reminders,
phase/tool changes, and audit limitations are documented in
`/home/biouser/.pi/agent/git/github.com/sounkou-bioinfo/pi-skills/docs/cache-hook-audit.md`.
Memory relocation is reported, not rewritten.

## Fix and expected effect

Omissions persist per toolCallId on the active session branch. Crossing the hard
retained-text ceiling evicts a block to half-budget (or one newest bounded
result). Previously sent bytes remain identical between these deliberate
re-trims, including reload/tree restoration. Deterministic head/tail bounding
and both environment names remain intact. The trade-off is less retained older
inspection evidence; omission-notice overhead remains outside the text ceiling.

Replay reduces prefix-changing trims **156 → 16 (89.7%)**, including large-context
miss coincidences **155 → 16**. This supports substantially fewer budget-induced
misses, not a guaranteed 90% reduction in total misses or dollar/subscription cost.
Other invalidators remain.

## Telemetry and use

Core already stores assistant usage and aggregates costs, but no available
core/vendored extension supplies the requested classifier or `/cache` command.
The observer reuses stored usage and persists local, non-model diagnostic entries.
It separates hit/miss/cold/unknown turns and flags sharp cache-read drops while
input context grows; these are heuristics, not provider verdicts.

The installed package auto-discovers the extension. Reload Pi (`/reload`), then
run `/cache` or `/cache 10`. No model request is made. Operating details and the
replay command (append `577` for this cohort) are in
`/home/biouser/.pi/agent/git/github.com/sounkou-bioinfo/pi-skills/docs/operations.md`.

## Files and verification

Changed files, all under `/home/biouser/.pi/agent/git/github.com/sounkou-bioinfo/pi-skills/`:

- `/home/biouser/.pi/agent/git/github.com/sounkou-bioinfo/pi-skills/extensions/context-budget/index.ts`
- `/home/biouser/.pi/agent/git/github.com/sounkou-bioinfo/pi-skills/extensions/context-budget/context-budget.test.ts`
- `/home/biouser/.pi/agent/git/github.com/sounkou-bioinfo/pi-skills/extensions/cache-telemetry/index.ts`
- `/home/biouser/.pi/agent/git/github.com/sounkou-bioinfo/pi-skills/extensions/cache-telemetry/cache-telemetry.test.ts`
- `/home/biouser/.pi/agent/git/github.com/sounkou-bioinfo/pi-skills/scripts/analyze_cache_misses.mjs`
- `/home/biouser/.pi/agent/git/github.com/sounkou-bioinfo/pi-skills/scripts/cache-context.test.mjs`
- `/home/biouser/.pi/agent/git/github.com/sounkou-bioinfo/pi-skills/package.json`
- `/home/biouser/.pi/agent/git/github.com/sounkou-bioinfo/pi-skills/tsconfig.json`
- `/home/biouser/.pi/agent/git/github.com/sounkou-bioinfo/pi-skills/TEST_PLAN.md`
- `/home/biouser/.pi/agent/git/github.com/sounkou-bioinfo/pi-skills/docs/operations.md`
- `/home/biouser/.pi/agent/git/github.com/sounkou-bioinfo/pi-skills/docs/cache-hook-audit.md`
- `/home/biouser/.pi/agent/git/github.com/sounkou-bioinfo/pi-skills/docs/cache-investigation.md`

Typecheck, full `npm test`, package/link checks, and focused tests pass:
13 budget tests; six telemetry/SDK tests including provider-visible prefixes,
on-disk reopen, native tree restoration and command dispatch. `npm run check`
passes typecheck/tests but fails its final README consistency check: unchanged
`README.md` renders differently from unchanged `README.Rmd`. No README rewrite
was included. No live/paid cache experiment was performed. The four pre-existing
vendor edits retain their original SHA-256 hashes and are excluded from commits.
