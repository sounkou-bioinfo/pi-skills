# pi-background-tasks

Claude-Code-like explicit background shell task manager for [Pi](https://pi.dev/).

This package adds named, tracked background shell jobs with durable output files, bounded log reads, kill/timeout safety, task-owned context-window/token/tool-use/model telemetry, explicit Pi-agent telemetry wrapping for tasks marked as agents, a focused footer-dock task manager, `/tasks` fallback UI, and completion notifications that can wake the agent when LLM-launched work finishes.

## Install

From npm after publish:

```bash
pi install npm:pi-background-tasks@0.6.0
```

From git after pushing this package to its standalone repository and tagging:

```bash
pi install git:github.com/ismailsaleekh/pi-background-tasks@v0.6.0
```

For project-local install:

```bash
pi install -l npm:pi-background-tasks@0.6.0
```

## Commands

- `/bg [--agent] [--name "Task name"] <command>` — start a named tracked background shell command. Use `--agent` only when the command launches an LLM/agent.
- `/jobs` — list running and recent completed/failed/killed tasks.
- `/logs <id> [maxBytes]` — show bounded tail output and full output path.
- `/kill <id>` — stop a running task.
- `/tasks` or `/bg-tasks` — fallback command to open the task manager UI.
- `/bg-clear` — clear finished background-task footer notices.
- `/bg-update` — print update instructions when a newer published version exists (instruct-only; never self-installs).

## Footer dock UX

When tasks are active or unseen completions/failures exist, Pi shows a compact footer status:

```text
bg 2 running · Shift↓
bg 1 running · 1 failed · Shift↓ · /bg-clear
bg 2 done · Shift↓ · /bg-clear
```

Press `Shift+Down` to open the focused bottom dock. Arrow keys are captured only while the dock is focused. Each task row shows the latest context-window usage reported by that specific background task, for example `ctx 21.0%/200k`; tasks that do not report their own context show `ctx —` rather than the parent Pi session's usage. Background Pi-agent tasks also surface the LLM model they ran (`model gpt-5.5` in the compact row, fully-qualified such as `openai-codex/gpt-5.5` in the detail view), cumulative token usage (`tok 1.6k`), and tool-use counts (`tools 2/1 failed`) in the dock and detail view; missing model/token/tool telemetry is omitted in rows and shown as “not reported by this background task” in details. When a background command is explicitly marked as an agent and invokes a print/json child agent such as `pi -p ...` through the normal shell command name, the extension wraps that child Pi process with `--mode json`, parses real assistant usage/tool execution events, and emits task-owned telemetry automatically — including the model reported by the child assistant turns.

### Agent activity transcript

For those wrapped background Pi agents, the task output file and the dock's detail **Output tail** show a live, human-readable transcript of what the agent is actually doing — assistant messages, `→ tool args` calls, `… reasoning`, and `✗ tool failed` errors — as the agent loop runs. The machine telemetry (context/token/tool/model) is parsed out of the child stream and surfaced only as the metrics above and in `bg_status`/metadata, so the focused window reflects the agent's real activity rather than its raw instrumentation JSON. Child stderr is passed through to the transcript verbatim. Non-agent tasks and agent commands that cannot be wrapped (for example a path-qualified `pi`) keep streaming their raw stdout/stderr unchanged.

Finished-task badges intentionally remain visible until acknowledged. The reliable clear path is `/bg-clear`, which works in every terminal and clears finished background-task footer notices without opening the dock. `Ctrl+Alt+C` is still registered as an optional terminal-dependent fallback shortcut, but the footer advertises `/bg-clear` because some macOS terminals do not transmit `Ctrl+Alt+C` distinctly.

Dock controls:

| Key | Action |
|---|---|
| `Shift+Down` | Open focused background-task dock |
| `/bg-clear` | Clear finished-task footer notices from the main UI |
| `Ctrl+Alt+C` | Optional terminal-dependent shortcut for `/bg-clear` |
| `↑` / `↓` | Select task (list) · scroll the output tail (detail) |
| `PageUp` / `PageDown` | Page the task list (list) · page the output tail (detail) |
| `Enter` / `→` | Inspect logs/details |
| `←` | Return from details to list |
| `h` | Toggle recent history |
| `k` | Stop selected running task |
| `a` / `K` | Stop all running tasks, with confirmation |
| `r` | Refresh detail tail |
| `R` | Rerun selected command |
| `c` | Show copyable output path |
| `x` / `Esc` / `q` | Close dock |
| `/bg-update` | Print update instructions when a newer version is published |

In the detail view the **Output tail** is scrollable: `↑`/`↓` and `PageUp`/`PageDown` move through the loaded output (a generous bounded window, not just the last lines). Scrolling up pauses the live tail and freezes the view so it stays stable as new output arrives; the status line shows your position (e.g. `lines 46–57 of 60`). Scrolling back to the bottom (or pressing `r`) resumes live tailing.

### Update-available notice

When a newer version of `pi-background-tasks` has been published to npm, the footer appends a compact, instruct-only segment after the entry hint:

```text
bg 1 running · 1 failed · Shift↓ · /bg-clear · ⬆ v0.7.0 /bg-update
```

When no tasks are active, the notice still appears on its own (`bg ⬆ v0.7.0 /bg-update`) so the update hint is visible. The segment is rendered only when a strictly newer published version exists; `/bg-update` prints the npm and git update commands and never installs or self-updates.

The lookup runs at most once per session on `session_start`, is time-boxed, and is fully offline-safe: it never blocks or errors the footer/session, and on an offline or failed lookup it simply renders no segment (it never pins a misleading version). The check is skipped entirely when `PI_OFFLINE=1`, and can be disabled explicitly with `PI_BG_DISABLE_UPDATE_CHECK=1`. Set `PI_BG_REGISTRY_URL` to point the check at a registry mirror instead of `https://registry.npmjs.org`.

## LLM tools

- `bg_run` — start named long-running commands without blocking the conversation.
- `bg_status` — inspect one task or all recent tasks.
- `bg_logs` — read bounded task output.
- `bg_kill` — stop a running task.

`bg_run` requires a concise `name` for the footer dock, the shell `command`, and required `isAgent: boolean`. Set `isAgent: true` only when the background task launches an LLM/agent process (for example `pi -p ...` or `pi --mode json ...`); set `isAgent: false` for scripts, tests, dev servers, sleeps, and ordinary shell commands. It defaults to `triggerOnCompletion: true`, so completion notifications trigger a follow-up agent turn. Tasks marked with `isAgent: true` that launch print/json child Pi agents through the normal shell command name are telemetry-wrapped; set `PI_BG_DISABLE_PI_TELEMETRY=1` only when raw Pi stdout is required. The task snapshot and metadata expose `isAgent`, `contextUsage` (latest reported child assistant turn), cumulative `tokenUsage` (`input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`), cumulative `toolUsage` (`total`, `failed`, `byName`), and `model` (the LLM identifier reported by the child assistant turns, preferring the fully-qualified `provider/model` form) when reported by the child task. User-launched `/bg` jobs are display-only by default unless `--agent` is provided; UI reruns preserve the original task's `isAgent` value.

## Runtime files

Task output and metadata are written under the current project:

```text
.pi/tasks/<session-id>-<pid>/<task-id>.output
.pi/tasks/<session-id>-<pid>/<task-id>.json
```

These are runtime artifacts and should remain gitignored.

## Safety model

- Commands are spawned and tracked with `child_process.spawn`; the package does not rely on shell `&`.
- stdout/stderr are captured to task output files.
- Model-visible logs are bounded and point to full output files.
- POSIX process groups are used for process-tree kill where possible, with child-process fallback.
- Running tasks are cleaned up on Pi session shutdown/reload.
- Cross-Pi-restart process reattachment and Ctrl+B backgrounding of already-running foreground tools are intentionally out of scope.

## Development and QA

Default QA gate:

```bash
npm run test
```

Smoke and release checks:

```bash
npm run smoke
npm run pack:dry-run
```

Full interactive QA gate:

```bash
npm run test:full
```

The suite includes typecheck, unit, SDK, RPC, component, package, PTY/TUI, and scripted-provider coverage for the focused dock, lifecycle safety, and completion follow-up behavior.

Note: the repo QA standard requires exhaustive coverage of every public behavior and plausible edge case. `TEST_PLAN.md` tracks the current coverage matrix and any future edge-case additions.

This package follows the repo-wide Pi extension QA standard documented in:

- [`../EXTENSION_QA_STANDARD.md`](../EXTENSION_QA_STANDARD.md)
- [`../EXTENSION_TESTING_PLAYBOOK.md`](../EXTENSION_TESTING_PLAYBOOK.md)
- [`TEST_PLAN.md`](TEST_PLAN.md)
- [`TESTING.md`](TESTING.md)
