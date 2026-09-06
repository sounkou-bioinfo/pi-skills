# Extension testing playbook

Use with [the QA standard](EXTENSION_QA_STANDARD.md) and
[the current coverage matrix](TEST_PLAN.md). Commands below run from the repository
root, not from the vendored package.

## Prerequisites and commands

- Node/npm compatible with the installed Pi host; Git; system `Rscript`.
- For R/C tests: R packages `jsonlite`, `treesitter`, `treesitter.r`, and
  [treesitter.c](https://github.com/sounkou-bioinfo/treesitter.c).
- For README rendering: `rmarkdown` and Pandoc.
- `npm install` supplies TypeScript, development Pi packages, and DuckDB bindings.
  Runtime Pi APIs remain host-provided peers.
- DuckDB SQLite/FTS artifacts may be downloaded on a cold cache. Provision matching
  artifacts before claiming an offline run. HTTP fixtures do not prove the whole
  suite is network-independent. Jarl is an explicit optional audit tool.

```sh
npm install
npm run check                  # typecheck, all current tests, README consistency
npm run test:background-tasks   # registry + fake-Pi tool integration, real shell jobs
npm run test:completions        # queue and fake-Pi lifecycle
npm run test:rlm                # worker, subprocess, store, and system-R regressions
npm run test:memory             # includes goals tests
npm run test:anti-slop          # tool adapter + native R/C analyzer fixtures
npm run test:package            # doc links, declared assets, npm pack inventory
```

After editing `README.Rmd`, run `npm run render:readme` before `npm run check`.
Other focused test commands are listed in [package.json](package.json).
Run gates serially: existing TypeScript suites use fixed build directories and
are not safe to run concurrently in the same checkout.

## Choose the layer that can establish the claim

| Layer | Use it for | Does not establish |
|---|---|---|
| Unit / injected hooks | Pure transforms, parsers, bounded queues, state transitions, fake Pi registrations. | Actual host ordering or transport. |
| Native/process integration | Real worker termination, child stdin, R evaluation, SQLite/WAL/FTS, shell output. | Whole-agent behavior or every platform. |
| Pi SDK | Load extensions into an isolated real session; execute tools and lifecycle. | Wire protocol or terminal behavior. |
| RPC | Drive a real Pi process; check request IDs, events, cancellation, and shutdown. | Keyboard/focus/rendering. |
| Component | Render the real dock at controlled sizes and drive its key handler. | Real terminal input negotiation. |
| PTY/TUI | Drive Pi through a pseudo-terminal; test keys, focus, scroll, and cleanup. | Platforms not exercised; a skipped PTY is not a pass. |
| Scripted provider | Use a deterministic fake model inside the real agent loop; count actual follow-up requests. | Live provider behavior. |
| Package | Inspect packed files, then separately install/load the tarball in a clean environment. | A dry-run inventory alone is not an install smoke test. |

SDK, RPC, component, PTY, and scripted-provider suites are currently gaps, not
commands to copy from upstream. Add a harness when changing those boundaries;
see [TEST_PLAN.md](TEST_PLAN.md) for the concrete scenarios still needed.

## Fixture rules

- Allocate a unique temp root per test. Put project, agent/session state, memory
  databases, subprocess output, and any cache writes there. Shut down owned work
  before deleting it; restore overridden environment variables in `finally`.
- For host tests, use a separate Pi agent directory (`PI_CODING_AGENT_DIR`), no
  inherited package loading, and disposable authentication/provider fixtures.
  Consult the tested host's CLI/SDK documentation for its isolation options.
- Prefer completion events or controlled gates over sleeps. Every wait needs a
  deadline. A JavaScript timer inside the code being tested cannot guard an
  event-loop hang; use a parent process watchdog as well as worker deadlines.
- Normalize volatile IDs, PIDs, timestamps, and temp paths in snapshots, but never
  normalize away exit status, signals, ordering, missing output, or error text.
- Use local/injected HTTP responses for failure cases. Keep live endpoint smoke
  tests separate and report the service/version/date; do not silently fall back.
- Record Node/Pi/R/DuckDB versions and the platform. Typechecking against development
  Pi packages is not evidence for all host versions allowed by peer dependencies.

## Useful regressions to extend

- [Background tasks](scripts/test_background_tasks.ts): signal failures and
  status/log observations suppressing a pending completion notice.
- [Completions](extensions/completions/completions.test.ts): both observation
  orders, bounded batches, wrong-session events, and shutdown.
- [RLM](extensions/rlm/rlm.test.ts): post-`await` infinite loops, 200,000-character
  stdin prompts, and two stores observing live metadata.
- [Context](extensions/context-budget/context-budget.test.ts): saturated history
  must not suppress a fresh read or retry.
- [AST review](scripts/test_anti_slop.R): formatting equivalence must not equate
  different string literals; complexity 14 passes and 15 warns.

## Review / release record

Record commit plus dirty scope, commands and results, environment, and skipped or
unavailable gates. Do not commit credentials, `.pi/`, generated test builds, or
machine-local logs. Use CI artifacts or an explicitly chosen external log path.
Before distribution, verify runtime assets and licenses in the archive and run a
clean install/load on each host/platform being claimed. Updating a checkout does
not update a running Pi process; reload only after live tasks finish.
