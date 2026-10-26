# OpenAI cache investigation: 2026-10-21

## Screenshot request

The screenshot matches assistant entry `6c2478b4` in the DuckHTS session started
at 07:26 UTC, using `openai-codex/gpt-5.6-sol`. Its provider-reported usage is
34,292 uncached input tokens and 15,104 cached input tokens: **30.6% reuse**.

The client-side invalidation is identified:

- At 07:29:55.925 UTC, the context-budget reducer recorded receipt `cc3b0806`,
  naming 17 omitted inspection results. It is the assistant entry's direct parent.
- Retained tool text reached 84,967 bytes after per-result bounding. The cumulative
  cap was 65,536 bytes; retrimming toward half that cap left 31,582 bytes.
- Offline replay of the reducer reproduces all 17 omitted IDs exactly.
- Conversion through the installed Codex adapter reproduces the recorded input
  counts, 206 to 217 items, and first mismatch at **`input[135]`**. Every changed
  earlier item is one of those 17 `function_call_output` entries.
- The first changed output is a read of `skills/r-c-anti-slop/SKILL.md`, replaced
  by an omission notice. This is an item index, not a token offset.
- The preceding turn's telemetry record was written only seven milliseconds
  before the request started. This is not an hour-long idle case.

| Turn | Cached tokens | Uncached input | Reuse |
|---|---:|---:|---:|
| Preceding | 55,552 | 1,559 | 97.3% |
| Screenshot | 15,104 | 34,292 | 30.6% |
| Following | 49,280 | 446 | 99.1% |

The warning belongs to the model request that generated the first process-listing
command, not to that command's output. The screenshot's later 99% footer is
consistent with the following turn recovering reuse.

## Transport and diagnostic evidence

A network-disabled replay through the installed Pi 1.1.0 Codex adapter, using
scripted WebSocket responses, sends:

1. The preceding request's full 206-item input, to establish the fixture state.
2. The rewritten 217-item input without `previous_response_id`.
3. A one-item delta with `previous_response_id` for the following turn.

This demonstrates the adapter's fallback for the reconstructed history mutation.
It is not a capture of the historical connection. The exact provider-side reason
for retaining 15,104 tokens rather than another unchanged prefix is unobserved.

The saved session has 261 telemetry records, all without the `completedAt` and
`trimmedResults` fields. Its warning uses the older `rewrote` wording. The loaded
telemetry behavior therefore differs from the current implementation; a checkout
revision alone does not identify the code already loaded in a running Pi process.
Replaying the current hooks against this receipt attributes
`context-budget trimmed 17 results`, including when the receipt appears after
the telemetry context hook. Repeated observation does not double-count it.

## Other misses in the same session

Of 261 recorded turns, telemetry classifies 244 as hits, 16 as misses, and one as
cold. Fourteen misses have an immediate omission receipt. Two need separate
explanations:

- **07:53 UTC, `f12255d4`:** the `instructions` field changes after a background
  task-completion message and a `bg_status` tool call. System entry `bd12081e`
  removes `expert_decision_discipline`, `architecture_refinement`,
  `mandatory_skills`, `permanent_memory`, and `local_review_policy`.
  A minimal scripted-provider test reproduces this on installed Pi 1.1.0:
  the initial user run sets the sections; an idle custom-message trigger starts
  another run without `before_agent_start`; its tool continuation refreshes from
  base prompt options and removes the sections. The retention assertion fails
  on the bare host; this is a host lifecycle defect, not merely a cache
  statistic. Pi 1.2.0 fixes the host path
  ([earendil-works/pi#10267](https://github.com/earendil-works/pi/issues/10267)).
  On Pi 1.1.0, pi-skills re-projects its owned sections through
  `context_with_system` ([prompt sections](../extensions/shared/prompt-sections.ts));
  `scripts/expert-discipline.test.mjs` passes this background-triggered
  tool-continuation scenario against the installed 1.1.0 host.
- **07:27 UTC, `3ec23fd3`:** 24,571 input tokens, zero cached tokens, no trim
  receipt, and a stable recorded logical prefix. Transport continuation,
  fallback, affinity, and provider cache state were not captured. Its cause
  remains unknown.

## Retention-policy trade-off

The 64-KiB cumulative cap is independent of actual model context pressure. It can
rewrite cached history while the model still has substantial context headroom.
A fixed-transcript simulation reproduces all 16 actual trim receipts and compares
other byte caps:

| Cap | Requests rewriting an earlier prefix | Mean retained tool text/request |
|---|---:|---:|
| 64 KiB | 16 | 42 KiB |
| 128 KiB | 9 | 87 KiB |
| 256 KiB | 4 | 192 KiB |
| 512 KiB | 1 | 383 KiB |

These are policy simulations over the recorded messages, not predictions of
agent behavior, cache hits, billing, or subscription-quota savings. A larger cap
reduces rewrites but resubmits more retained input on every request. Hit percentage
alone is not a sufficient optimization target. Budget changes need an explicit
choice of context headroom, information retention, and token-cost trade-offs;
an arbitrary idle-time reset is not supported by this evidence.

## Receipts and limits

Private evidence is in `.pi/openai-cache-investigation/`: the immutable session
snapshot, `replay.mjs`, `report.json`, `background-policy.mjs`, and
`background-policy-report.json`. The snapshot SHA-256 is
`471dcee93eecf8f46dc39cca4fc74de4a1875b8a7014f02f15d3f63e34589025`.
The memory extension's transient projection is absent from the saved transcript;
replay substitutes an indexing-only placeholder at its known insertion point.
Full historical payload hashes are not claimed.

No live inference requests, retention-policy changes, installation changes, or
host patches were made for this investigation. The background-policy reproducer
exercises the bare host and fails its contract assertion on Pi 1.1.0; it is not
a passing gate. The separate [Claude verification](claude-cache-verification.md)
does not explain the unattributed early OpenAI miss. Dollar amounts displayed by telemetry
are estimates, not subscription charges; local RAM/page-cache figures do not
measure the provider's prompt cache.
