# Extension QA standard

Applies to first-party extensions, local vendor changes, skills, and packaging in
pi-skills. This is our maintenance policy, not an upstream Pi certification.
[TEST_PLAN.md](TEST_PLAN.md) records current evidence and gaps;
[the playbook](EXTENSION_TESTING_PLAYBOOK.md) describes how to run and add tests.

## Evidence required for a change

1. Identify the affected contract: tool/schema, command, hook, UI action, stored
   data, configuration, skill/prompt behavior, or installed artifact. Consult its
   source and relevant documentation; do not load unrelated architecture or
   workflow documents. For runtime changes, establish ownership, limits, and
   failure/cancellation semantics.
2. Map changed runtime behavior and plausible edge cases to executable assertions
   at the lowest reliable layer. For skill/prompt edits, review representative
   matching and non-matching tasks and retain the required domain constraints;
   claim model behavior only after exercising it. Record new coverage or gaps in
   the matrix. A test filename or typecheck alone is not behavioral evidence.
3. For a bug, preserve the reproducer as a regression. Where practical, demonstrate
   failure on the old implementation. Put the watchdog outside the event loop or
   process that the regression could freeze.
4. Exercise the real boundary when the claim depends on it. Fake Pi objects test
   hook logic, not SDK integration; a `sendMessage` spy does not prove a follow-up
   turn; checking an archive list does not prove installation or loadability.
5. Use the change-scoped gates below. Report revision/dirty scope, commands,
   failures and skips; include host/dependency versions for runtime or
   compatibility claims. Missing prerequisites are not passes. Upstream's list
   of gates is not evidence that those gates ran here.
6. Update contracts, tests, and coverage in the same change. Keep the README a
   short entry point; put operating details in [docs/operations.md](docs/operations.md).

Existing gaps do not waive testing for a change that touches that boundary.
If a necessary gate cannot run, report the limitation and do not mark that
behavior verified. Do not rerun unchanged gates after every edit; rerun those
invalidated by subsequent changes.

## Gate scope

Choose by changed behavior, not filename. Executable examples, Rmd code, skills,
and prompt instructions are not automatically prose-only.

| Change | Verification before handoff |
|---|---|
| Prose-only | Relevant link checks (`npm run test:package` here); render/check README when its source changes. No unrelated runtime suite. |
| Skills, prompts, or instruction policy | Review matching/non-matching tasks, authority routes, permissions, and preserved invariants; package/docs checks. Exercise affected prompt/host tests if runtime injection or tool behavior changes. |
| Runtime, tests, build, dependencies, or packaging | Focused tests while iterating; `npm run check` and required boundary/platform gates before handoff. |
| Release or compatibility claim | Full local gate plus clean installed-artifact and claimed host/platform evidence. |

A mixed change takes the applicable stronger gates. Repository-specific release
or safety requirements still apply; narrowing routine checks is not a waiver.

## Edge-case review

Use the rows relevant to the changed surface. Explain a disputed omission, not
an inventory of irrelevant categories for every small edit.

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

Summarize the change and checks in proportion to the task. State material risks
and unverified claims; link to assertions or retained results where needed.
"Every plausible edge case" is a review obligation, not a guarantee that no
unknown bugs remain or a requirement to narrate a checklist for a typo fix.
