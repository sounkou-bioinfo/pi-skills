# Extension QA standard

Applies to first-party extensions, local vendor changes, skills, and packaging in
pi-skills. This is our maintenance policy, not an upstream Pi certification.
[TEST_PLAN.md](TEST_PLAN.md) records current evidence and gaps;
[the playbook](EXTENSION_TESTING_PLAYBOOK.md) describes how to run and add tests.

## Evidence required for a change

1. Identify the affected public contract: tool/schema, command, hook, UI action,
   stored data, configuration, or installed artifact. State observable behavior,
   ownership, limits, and failure/cancellation semantics before changing it.
2. Map every changed behavior and plausible edge case to an executable assertion
   at the lowest reliable layer. List uncovered cases in the coverage matrix,
   with the risk and the next test needed. A test filename or passing typecheck
   alone is not evidence for a behavior.
3. For a bug, preserve the reproducer as a regression. Where practical, demonstrate
   failure on the old implementation. Put the watchdog outside the event loop or
   process that the regression could freeze.
4. Exercise the real boundary when the claim depends on it. Fake Pi objects test
   hook logic, not SDK integration; a `sendMessage` spy does not prove a follow-up
   turn; checking an archive list does not prove installation or loadability.
5. Run `npm run check` serially, plus affected boundary/platform gates. Report
   revision, dirty-tree scope, host/dependency versions, commands, failures and
   skips. Missing prerequisites are not passes. Do not describe an unrun gate as
   implemented coverage merely because upstream documentation lists it.
6. Update contracts, tests, and coverage in the same change. Keep the README a
   short entry point; put operating details in [docs/operations.md](docs/operations.md).

Existing gaps do not waive testing for a change that touches that boundary.
If a necessary gate cannot run, report the limitation and do not mark that
behavior verified. A documentation-only change need not invent a runtime harness.

## Edge-case review

Apply these to the changed surface; record why a category is not applicable.

| Boundary | Cases to consider |
|---|---|
| Input and limits | Empty/malformed input, unknown IDs, zero, exact limit, limit + 1, Unicode/byte length, truncated output. |
| Async ownership | Queued/running/terminal states, observation before/after publication, abort before/during work, duplicate terminal events, session switch, reload, shutdown. |
| Processes | Spawn failure, nonzero exit, null exit with signal, timeout, descendant cleanup, escalation, no surviving owned work. |
| Storage | Concurrent owners, interrupted writes/recovery, missing artifacts, persistence and historical reads, no mutation by observers. |
| Context and messaging | Fresh evidence remains visible, stored messages are unchanged, no duplicate projections, no replay of observed completions, bounded unread results. |
| Remote services | Authentication failure, cancellation, malformed/partial response, body/page/rate limits, retries, redirected pagination. |
| UI and packages | Empty/error states, keyboard/focus/scroll behavior, non-TUI fallback, packed assets, clean install, supported host versions. |

## Test integrity

- Isolate temporary projects, agent/session stores, processes, and endpoints.
  Never use a person's real credentials, memory database, or package settings.
- Assert outcomes and cleanup, not just successful startup or elapsed time.
  Use deterministic providers for agent-loop tests; live services are opt-in.
- Declare genuine runtime prerequisites. Do not silently replace system R,
  Tree-sitter grammars, DuckDB, or the relevant host with a mock and retain the
  original claim. Label dependency-injected tests as such.
- Do not lower coverage by hiding source, excluding inconvenient cases, weakening
  assertions, or suppressing diagnostics to obtain green output. R/C analysis
  follows [the anti-slop policy](skills/r-c-anti-slop/SKILL.md); lint is review
  evidence, not a correctness or simplicity score.
- Preserve vendor attribution and distinguish upstream history from local tests.
  Do not clear a host's entire message queue or delete unrelated artifacts to
  make a lifecycle test pass.

## Completion report

State **changed**, **verified**, **not verified**, and **remaining risks**. Link to
assertions or retained results when claiming coverage. "Every plausible edge case"
is a review obligation, not a measurable guarantee that no unknown bugs remain.
