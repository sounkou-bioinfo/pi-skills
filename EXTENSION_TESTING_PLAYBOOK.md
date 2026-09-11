# Extension testing playbook

Consult this file for test commands, prerequisites, or harness design. Use
[the QA standard](EXTENSION_QA_STANDARD.md) for changed contracts and
[the coverage matrix](TEST_PLAN.md) for existing evidence and gaps. Commands run
from the repository root, not from the vendored package.

## Select checks for the change

- **Prose:** link/package checks; render and check README only when its source changes.
- **Skills/prompts:** review routing on matching and non-matching tasks, preserve
  domain constraints, and check shipped references. Textual review is not proof
  of a model's decisions; run affected prompt/host tests for injection changes.
- **Runtime/build/package:** use affected tests while iterating, then
  `npm run check` and required boundary gates before handoff.
- **Release/compatibility:** also validate clean installed artifacts and claimed
  host/platform combinations. Do not skip these because focused tests passed.

Choose by behavior, not file suffix: changing executable documentation or a
prompt is not a prose-only edit. Follow the applicable stronger gates for mixed
changes; do not run every command below after every patch.

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
npm run check                  # full local gate, not the default for each edit
npm run test:background-tasks   # registry + fake-Pi tool integration, real shell jobs
npm run test:completions        # queue and fake-Pi lifecycle
npm run test:rlm                # worker, subprocess, store, and system-R regressions
npm run test:workbench          # goals, contract/view tests, offline real-SDK agent loops
npm run test:workbench:pty      # tmux and Pi fd/rg helpers; isolated CLI, scripted provider only
npm run test:memory             # native memory and projection tests
npm run test:anti-slop          # tool adapter + native R/C analyzer fixtures
npm run test:package            # doc links, declared assets, npm pack inventory
```

After editing `README.Rmd`, run `npm run render:readme` and `npm run check:readme`.
Other focused test commands are listed in [package.json](package.json).
Run gates serially: existing TypeScript suites use fixed build directories and
are not safe to run concurrently in the same checkout.

## Optional fresh-Pi memory source smoke

[The command fixture](extensions/memory/source-smoke.test.ts) checks actual tool
registration/schema and source-loaded SQLite projection in a fresh Pi process.
It does not invoke the tool through a model, test RPC, or install a tarball.
Run the following Linux/Bash command in a background task after dependencies are
provisioned. Keep the output until inspected; no real memory or agent settings
are used and the slash command makes no model request.

```bash
set -euo pipefail
root=$PWD
probe=$(mktemp -d)
(
  cd "$probe"
  env -i PATH="$PATH" HOME="$HOME" \
    PI_CODING_AGENT_DIR="$probe/agent" PI_MEMORY_DB="$probe/memory.sqlite" \
    PI_MEMORY_PROJECT=source-smoke GIT_CONFIG_NOSYSTEM=1 \
    GIT_CONFIG_GLOBAL="$probe/absent-git-config" timeout 120s pi \
    --no-extensions --no-skills --no-prompt-templates --no-context-files \
    --no-session --offline \
    -e "$root/extensions/memory/index.ts" \
    -e "$root/extensions/memory/source-smoke.test.ts" -p /memory-source-smoke
) 2>&1 | tee "$probe/result.log"
grep -q SOURCE_MEMORY_SMOKE_OK "$probe/result.log"
```

After inspecting the result, remove only that task's `$probe` directory. Do not
add `--no-tools`: on Pi 0.85.1 it also removes the extension tool from discovery,
which makes this registration assertion fail. `--offline` does not provision
missing DuckDB artifacts; their warm-cache requirement still applies. The sandbox
clears inherited provider keys and retains `HOME` only for the existing native
artifact cache; Pi's agent/auth directory is separate.

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
- [Workbench](extensions/goals/workbench-sdk.test.ts): isolated real Pi SDK,
  source-loaded extensions, a scripted provider with no network calls, real shell
  probes, checkpoint evidence, disk reopen, and completion/goal pause behavior.
  The ambiguous-goal regression checks one input request, no automatic restart,
  blocked false completion, and explicit human resumption without a contract.
  [Contract/view tests](extensions/goals/workbench.test.ts) cover branch-local
  authority, invalid input, cancelled/stale reviews, local edits, approval/start,
  and narrow Unicode terminal views. The [PTY test](scripts/test_workbench_pty.mjs)
  drives actual field editing, cancellation, full-screen rendering at 80/40
  columns, approval/start, and the needs-input reply through a scripted provider.
  It reuses Pi's installed `~/.pi/agent/bin/fd` and `rg` without downloading tools;
  set `PI_WORKBENCH_BIN_DIR` to another installed helper directory if needed.
  `PI_WORKBENCH_CLI` selects a host CLI, `PI_WORKBENCH_SOURCE` selects a source
  checkout, and `PI_WORKBENCH_PREVIEW_DIR` retains plain-text terminal captures.
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
