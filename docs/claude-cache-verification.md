# Claude replay cache verification

## Contract and implementation

The [vendor manifest](../scripts/vendor/pi-claude-code/manifest.json) applies two
replay-stability patches:

- [Initial reminder layout](../scripts/vendor/pi-claude-code/patches/0004-stable-initial-reminders.patch):
  native environment/date reminders occupy their replay positions before the
  first request is sent. Cleanup preserves the bootstrap block and supports
  combined legacy snapshots.
- [Anchored startup context](../scripts/vendor/pi-claude-code/patches/0005-anchor-native-query-context.patch):
  native startup context stays on the user message that first triggered
  inference. Its carrier stores a user ordinal, canonical-content hash, and
  prefix blocks. An edited or missing anchor does not receive stale context.

These preserve native instructions and leave Pi's saved user/tool messages
unchanged. Cache markers can move without changing message content. Native
metadata can also change when a worker is replaced; neither observation alone
proves a cache miss.

## Live Haiku evidence: 2026-10-21

Two isolated Pi 1.1.0 SDK sessions used
`claude-code/claude-haiku-4-5-20251001` through Claude Code subscription login.
The seed was the user/assistant/tool history from an earlier live Astra check;
all new model requests in these sessions used Haiku. The only tool returned
synthetic fixtures. No active installation or global settings were changed.

The first session used Pi's `off` thinking setting and seven model requests.
Tool-result limits were 16,384 bytes per result and 49,152 bytes cumulative.
Retries, compaction, and cache warming were disabled.

| Request | Cache read | Cache write | Read / total input |
|---|---:|---:|---:|
| Handoff/tool request | 0 | 27,111 | 0% |
| Tool continuation | 27,111 | 7,359 | 78.6% |
| Next user | 34,470 | 64 | 99.8% |
| Second user | 34,534 | 45 | 99.9% |
| Next tool request | 34,579 | 36 | 99.9% |
| Continuation after three-result trim | 12,448 | 8,566 | 59.2% |
| Next user after trim | 21,014 | 71 | 99.6% |

The first continuation reused all 27,111 previously cache-written tokens.
Its lower overall percentage reflects new input, principally the new tool
result; it is not evidence that 21.4% of the preceding cache was lost.

The second session used Pi's `low` thinking setting and three requests. Its
continuation reused all 27,110 previously cache-written tokens, and its next
user request reached 99.8% reuse. This checks the requested setting, not a
guarantee that the model emits thinking blocks on every request.

Both sessions passed these assertions:

- Every model request was observed; tool counts and scripted answers matched.
- All untrimmed message prefixes and non-metadata request fields were identical
  after removing protocol cache markers for comparison. The transmitted
  requests retained their cache markers.
- Every request had four markers and valid, paired historical tool IDs.
- The deliberate trim had one receipt naming exactly three omitted results.

Private receipts, driver snapshots, usage, source-content hashes, and SDK
sessions are under `.pi/claude-cache-fix/2026-10-21T08-09-46.938Z-live/` and
`.pi/claude-cache-fix/2026-10-21T08-10-00.189Z-live/`. They are not packaged or
published. These are bounded live checks, not default automated tests.

## Automated coverage and limits

`npm run test:claude-code` runs 22 offline fixtures, a locked upstream typecheck,
patch replay/drift rejection, clean tarball installation, and host loading.
The composed CLI/loopback fixture checks both active-user startup prefixes and
moving tool-result suffixes through worker replacement and warm continuation.
It compares the actual upstream body with payload-hook output. Other fixtures
cover legacy snapshots, edited/missing anchors, carrier serialization, signed
blocks, marker budgeting, and cancellation.

Live provider-reported usage establishes cache reads for these Haiku requests.
It does not establish subscription-quota savings, billing eligibility for other
accounts, long-idle retention, or behavior on other Claude models. The separate
[OpenAI screenshot investigation](openai-cache-trim-investigation.md) identifies
the change at `input[135]` as a 17-result context-budget trim and records separate
host-lifecycle and unattributed misses. Those cases are not resolved by the
Claude fixes. See [operations](operations.md) for request-hook and activation
rules.
