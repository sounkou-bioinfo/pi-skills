# pi-background-tasks Test Plan

This package follows:

- [`../EXTENSION_PACKAGE_STANDARD.md`](../EXTENSION_PACKAGE_STANDARD.md)
- [`../EXTENSION_QA_STANDARD.md`](../EXTENSION_QA_STANDARD.md)
- [`../EXTENSION_TESTING_PLAYBOOK.md`](../EXTENSION_TESTING_PLAYBOOK.md)

## Package

| Field | Value |
|---|---|
| Package | `pi-background-tasks` |
| Extension entrypoint | `extensions/background-tasks.ts` |
| Public commands | `/bg`, `/jobs`, `/logs`, `/kill`, `/tasks`, `/bg-tasks`, `/bg-clear`, `/bg-update` |
| Public tools | `bg_run`, `bg_status`, `bg_logs`, `bg_kill` |
| Shortcuts | `Shift+Down`; optional fallback `Ctrl+Alt+C` |
| Custom UI | footer status + focused bottom dock overlay |
| Custom provider | no |
| Runtime files/state | `.pi/tasks/<session-id>-<pid>/<task-id>.output`, `.pi/tasks/<session-id>-<pid>/<task-id>.json` |

## Required gates

| Gate | Command | Required in default `npm run test`? | Status |
|---|---|---:|---|
| Typecheck | `npm run typecheck` | yes | implemented |
| Unit | `npm run test:unit` | yes | implemented |
| SDK | `npm run test:sdk` | yes | implemented |
| RPC | `npm run test:rpc` | yes | implemented |
| Component | `npm run test:component` | yes | implemented |
| Package | `npm run test:package` | yes | implemented |
| PTY/TUI | `npm run test:pty` | full gate | implemented (answers pi's Kitty keyboard-protocol negotiation; auto-skips with a loud reason on hosts that cannot deliver raw-mode Node stdin via `/usr/bin/expect`) |
| Scripted provider | `npm run test:agent-loop` | full gate | implemented |
| Pack dry run | `npm run pack:dry-run` | release gate | implemented |
| Smoke | `npm run smoke` | no | implemented; load-only |

## Feature coverage matrix

| Feature | Public surface | Unit | SDK | RPC | Component | PTY | Package | Scripted provider | Notes |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| Start background command from UI command | `/bg` | yes |  | yes |  | yes |  |  | Unit covers `--name` and `--agent`; RPC/PTY start real processes. |
| List tasks | `/jobs` |  |  | yes |  |  |  |  | RPC asserts running and killed task rows. |
| Show bounded logs | `/logs <id> [maxBytes]` | yes |  | yes |  |  |  |  | Unit covers bounded reads; RPC verifies output/path. |
| Kill running task | `/kill <id>` |  | yes | yes |  |  |  |  | SDK tool and RPC slash command. |
| Open task manager fallback | `/tasks`, `/bg-tasks` |  |  | discovery | yes | yes |  |  | Component covers dock; PTY covers `/tasks` and `/bg-tasks`. |
| Start background command from LLM tool | `bg_run` | yes | yes |  |  |  |  | yes | SDK starts named commands, verifies required `isAgent` schema/runtime behavior, and scripted provider verifies agent-loop tool calls with `isAgent:false` for scripts. |
| Inspect task status | `bg_status` |  | yes |  |  |  |  |  | SDK polls exact IDs and validates shutdown state. |
| Read task logs | `bg_logs` | yes | yes |  |  |  |  |  | SDK verifies content. |
| Stop task from LLM tool | `bg_kill` |  | yes |  |  |  |  |  | Covers running kill and already-finished loud failure. |
| Completion notification | custom message `background-task-notification` | yes | yes |  | renderer via typecheck |  |  | yes | Unit covers duplicate/failing notification paths; SDK verifies XML/details; scripted provider verifies real follow-up turns, display-only `/bg`, `notifyOnCompletion:false`, and failed-task error fields. |
| Footer status | `ctx.ui.setStatus` |  | load path + clear command/shortcut + mixed states/focused label |  | render semantics | yes |  |  | SDK verifies `/bg-clear` hint, failed/stopped/done combinations, running combinations, and focused label; PTY verifies Shift+Down dock path after footer-visible task. |
| Explicit agent classification | required `bg_run.isAgent`, `/bg --agent`, task metadata | yes | yes |  |  |  |  | yes | `isAgent:true` is required only for LLM/agent tasks and enables Pi-agent telemetry wrapping when the command invokes plain `pi`; `isAgent:false` is required for scripts/non-agents and prevents wrapping even if the command text looks like `pi -p ...`. |
| Per-task context usage | task row/detail + `bg_status`/metadata/notification snapshots | yes | yes |  | yes |  |  |  | SDK verifies task-owned telemetry is captured, explicitly marked background `pi` invocations are wrapped to emit telemetry, and parent `ctx.getContextUsage()` is not used; component verifies list/detail rendering plus `ctx —` placeholder. |
| Per-task token usage | background Pi-agent telemetry + `bg_status`/metadata/dock row/detail | yes | yes |  | yes |  |  |  | SDK verifies cumulative input/output/cache read/cache write/total token usage from explicit telemetry, fake `isAgent:true` wrapped child events, and real child `pi --mode json` with scripted provider; component verifies row/detail rendering. |
| Per-task tool-use counts | background Pi-agent telemetry + `bg_status`/metadata/dock row/detail | yes | yes |  | yes |  |  |  | SDK verifies total/failed/by-name tool counts from fake and real child Pi `tool_execution_start/end` events, including failed tools; component verifies row/detail rendering. |
| Per-task agent model | background Pi-agent telemetry + `bg_status`/metadata/dock row/detail | yes | yes |  | yes |  |  |  | Unit verifies `formatModelSummary`/snapshot-list rendering and telemetry ingestion of `model`; SDK verifies the model is captured from explicit telemetry, fake `isAgent:true` wrapped child `message_end` events (qualified `provider/model`), and a real child `pi --mode json` run (bare child model re-qualified from `--model`), plus that non-agent tasks report no model; component verifies compact `model <id>` row, fully-qualified `Model:` detail, and the “not reported by this background task” placeholder. |
| Agent activity transcript | wrapped Pi-agent output file + dock detail tail + `bg_logs` | yes | yes |  |  |  |  |  | Unit covers `parseAgentActivity`/`formatAgentActivityLine` for assistant text, reasoning, tool start (arrow + collapsed/truncated arg summary), and tool end (silent success, `✗ tool failed[: error]`), plus blank/invalid/non-activity narrowing. Registry unit verifies wrapped-agent stdout is reconstructed across split chunks into the transcript, `background-task-telemetry`/`-context-usage`/`-activity` control lines are stripped from the output file while still updating telemetry fields, child stderr passes through verbatim, and the trailing partial line is flushed on finalize. SDK verifies fake and real child `pi --mode json` runs render `→ tool`, `✗ tool failed`, and assistant text in `bg_logs` while keeping the telemetry/activity control JSON out of the visible output. |
| Focused dock list | overlay component |  |  |  | yes | yes |  |  | Selection/actions/history tested; PTY covers arrows, page keys, ordering with multiple tasks, failed/unread badges, and `/bg-tasks` fallback. |
| Focused dock detail | overlay component |  |  |  | yes | yes |  |  | Tail read, output box, and return-to-list tested. Component also verifies output-tail scrolling: ↑/↓ + PageUp/PageDown move through the loaded window, scrolling up pauses the live tail and shows a `lines X–Y of N` position, paging back to the bottom resumes follow, and output that fits the window never enters scroll mode. PTY drives the real arrow/page scroll keys in the detail tail. |
| Dock stop selected | `k` |  |  |  | yes |  |  |  | Component. |
| Dock stop all | `a`/`K` |  |  |  | yes | yes |  |  | Component and PTY confirmation. |
| Dock rerun | `R` |  |  |  | yes | yes |  |  | Component plus PTY running/completed/failed/killed rerun paths. |
| Dock close | `x`/`Esc`/`q` |  |  |  | yes | yes |  |  | Component + PTY. |
| Shortcut opens dock | `Shift+Down` |  | registration |  |  | yes |  |  | PTY sends xterm `ESC [ 1 ; 2 B`. |
| Clear finished notices | `/bg-clear`, optional `Ctrl+Alt+C` fallback |  | yes | yes |  |  |  |  | `/bg-clear` is the canonical terminal-independent path and is advertised in the footer. SDK invokes the slash-command handler and verifies fallback shortcut registration; RPC verifies `/bg-clear` clears finished notices; finished notices remain until explicit clear. |
| Update-available footer notice | `⬆ v<latest> /bg-update` footer segment + `/bg-update` command | yes | yes | yes |  |  |  |  | Unit covers semver parse/compare/precedence, `isNewerVersion`, `formatUpdateSegment`, npm/`package.json` payload narrowing, injected-fetch success/404/throw/timeout, and `package.json` read/degrade. SDK uses a localhost registry to verify the idle and append-to-active footer segment, `/bg-update` non-installing instructions, and that opt-out (`PI_BG_DISABLE_UPDATE_CHECK=1`), offline (`PI_OFFLINE=1`), already-current, and registry-failure paths render no segment and never throw. RPC verifies `/bg-update` discovery and offline non-installing instructions. The check is one-shot per `session_start`, time-boxed, offline-safe, and never runs on the status tick. |
| Runtime output files | `.pi/tasks/...output` | yes | yes |  |  |  |  |  | SDK asserts existence. |
| Runtime metadata files | `.pi/tasks/...json` | yes | yes |  |  |  |  |  | SDK asserts shape/status/name/context usage; registry unit tests cover metadata failure/update ordering. |
| Timeout kills task | `timeoutSeconds` |  | yes |  |  |  |  |  | SDK. |
| Output cap kills task | `PI_BG_MAX_OUTPUT_BYTES` |  |  | yes |  |  |  |  | RPC runs with a low cap and asserts failed status/log notice. |
| Shutdown cleanup | `session_shutdown` | yes | yes |  |  |  |  |  | SDK asserts multiple running tasks become killed; registry tests cover shared stop/wait behavior. |
| Process lifecycle/races | registry core | yes | yes | yes |  | yes |  | yes | Unit tests cover process-group fallback, Windows fallback, SIGKILL escalation, duplicate finalization/notification races, notification/metadata failures, pruning, malformed telemetry, split telemetry chunks, large telemetry records above the old 16KiB buffer, and wrapped-agent transcript/telemetry separation with split-chunk and trailing-partial flush; SDK/RPC cover runtime spawn/timeout/output-cap/shutdown; scripted provider covers wakeup integration. |
| Package manifest | `package.json` |  |  |  |  |  | yes |  | Keywords, `pi.extensions`, files. |
| Pack contents | `npm pack --dry-run` |  |  |  |  |  | yes |  | Runtime files included. |

## Residual hardening coverage

Lane A residual hardening is now covered by automated tests. No remaining hardening-only gaps are intentionally left open in this plan. Future feature work should add new rows instead of weakening these gates.

| Hardened area | Coverage |
|---|---|
| Extracted process registry | `src/core/registry.ts` has direct unit coverage for state transitions and injected spawn/kill/platform behavior. |
| Agent/script classification | Unit tests cover `isAgent:true` wrapping, `isAgent:false` non-wrapping, `PI_BG_DISABLE_PI_TELEMETRY`, and non-interceptable path-qualified `pi`; SDK verifies required tool schema/runtime validation and real marked Pi telemetry. |
| Process lifecycle/races | Unit tests cover duplicate error/close finalization, output-cap races, duplicate-notification prevention, waiter resolution via stop paths, metadata failure logging, and notification failure reset. |
| Process-tree kill safety | Unit tests cover POSIX process-group kill, child fallback, both-fail loud errors, SIGTERM idempotency, SIGKILL escalation, and Windows child-kill/shell invocation. |
| Pruning | Unit tests cover oldest-finished pruning while preserving running tasks. |
| Completion follow-up turns | `test:agent-loop` registers a deterministic scripted provider and verifies `bg_run` wakeup default, `/bg` display-only default, `notifyOnCompletion:false`, failed notification error fields, and real follow-up provider calls. |
| PTY secondary keys | `test:pty` covers arrows, page keys, `a`/`K`, `R`, `c`, `/bg-tasks`, failed/unread badges, multiple-task ordering, and rerun paths for running/completed/failed/killed tasks. |
| Footer/status combinations | SDK tests cover failed/stopped/done/running combinations, explicit clear, and focused label. |

## Acceptance checklist

- [x] `npm run test` passes offline in isolated temp dirs.
- [x] `npm run test:full` validates baseline real TUI/PTY behavior.
- [x] `npm run pack:dry-run` passes.
- [x] README claims and all plausible edge cases are exhaustively mapped in this test plan.
- [x] Every listed edge case has automated coverage at the lowest reliable layer.
- [x] No real LLM/API/network dependency in default tests.
- [x] No dependency on user/global `~/.pi/agent` for SDK/RPC/PTY tests.
- [x] Volatile output is normalized in snapshot-style assertions where applicable.
