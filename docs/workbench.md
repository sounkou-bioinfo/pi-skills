# Terminal workbench

[Operating notes](operations.md) · [Coverage and limits](../TEST_PLAN.md)

The workbench adds an opt-in collaboration envelope to an existing Pi goal.
It makes the approved contract, recorded evidence, and continuation boundary
inspectable in a terminal. It runs on the same machine as Pi, including a VM
accessed through VS Code Remote-SSH. It does not start a web server.

## Start a task

1. Set the existing goal without automatic continuation:

   ```text
   /goals Preserve genotype missingness and phase through the reader --no-auto
   ```

2. Ask the agent to draft a contract with `propose_contract`. A proposal does
   not change the approved contract, enable the gate, or grant new authority.
   Existing project instructions still apply during drafting.
3. Run `/workbench contract`. Review the proposal in Pi's multiline editor,
   edit it, and save to approve. Escape cancels. The workbench is **paused**
   after approval.
4. Run `/workbench resume 20` to grant 20 tool admissions. Choose an allowance
   appropriate to the task; 20 is an example, not a recommended universal limit.
5. Send a prompt to begin the agreed work. Renewal itself does not invoke a
   model or change the underlying goal's active/paused status.

The agent drafts; the user approves and renews. A materially different contract
requires another explicit review. Both `/goals` and `/workbench` remain available
while the workbench is paused.

The four contract fields are:

| Field | Question |
|---|---|
| `acceptance` | What independent observation establishes success? |
| `invariants` | What scientific, API, data, or architectural properties must survive? |
| `autonomy` | Which decisions and actions may the agent take without asking? |
| `escalation` | Which changes or uncertainties require human judgment? |

The outcome comes from the goal rather than a separate workbench task list.
Each field must contain 1–2000 characters. Non-interactive integrations can
supply the same object with `/workbench contract {"acceptance":..., ...}`.
Only these four fields are accepted. A host integration submitting commands
must authenticate the human decision; a JSON object is not proof of approval.

## Inspect and steer

| Command/tool | Effect |
|---|---|
| `/workbench` or `/workbench show` | Inspect the contract, allowance, pending amendment, and latest checkpoint. |
| `/workbench evidence` | Select a recent tool result in the TUI; list recent IDs in other modes. |
| `/workbench evidence <entry-id>` | Open a particular tool-result entry on the current branch. |
| `/workbench pause` | Stop future tool admissions, even during an active turn. |
| `/workbench resume N` | While idle, grant a fresh allowance of 1–10000 admissions for the same unfinished goal. |
| `/workbench off` | While idle, disable this envelope; normal host and goal behavior applies. |
| `propose_contract` | Record an agent proposal without approving it. |
| `get_goal` | Include the active workbench and up to 12 recent evidence IDs in the tool response. |
| `record_checkpoint` | Record a statement, existing evidence IDs, uncertainty, and next decision; pause for user review. |

The read-only views support Up/Down, Page Up/Page Down, and Escape or `q`.
The compact panel truncates to terminal width; opening the view reveals wrapped
text. UI rendering removes terminal control sequences from source text.
Outside the TUI, inspection commands require an idle session so that reading a
view does not enqueue steering. Display-only views are excluded from model
context; the original tool results remain the evidence source.

An evidence view shows the tool, arguments when the preceding call is unambiguous, timestamp, tool error
flag, and up to 24000 output characters. It points to the source session file.
Recent lists show at most 20 tool results; explicit IDs can open older retained
results. Images are identified as attachments rather than rendered in this
text view.

**A tool returning without error is not scientific certification.** Errors stay
inspectable. An agent checkpoint remains an agent report, even when it cites
real output. Results are historical and may be stale; the view does not track
filesystem changes, reproduce a test, or identify a loaded binary automatically.
Record those identities in the actual execution output when they matter.

Use ordinary Pi steering for changes within the approved scope. Pause and review
the contract when the acceptance criterion, meaning of the data, authorized
scope, or resource allowance needs to change. Checkpoints do not mark goals
complete or require approval of every routine edit.

## What the boundary enforces

The gate reserves a slot at this extension's `tool_call` hook. Reaching the
allowance pauses further admissions. Calls already admitted may finish,
including sibling calls in the same batch. A call can consume a slot even if a
later handler blocks it or execution fails. All tools are gated, including
status tools and `record_checkpoint`; report a checkpoint before exhausting the
allowance if one is needed.

While paused, this package does not enqueue goal continuations. The completion
batcher displays unread notices without waking the model; those displayed
notices do not become delayed wakes after renewal. A wholly blocked tool batch
terminates without an automatic follow-up model call. A mixed batch can still
have a follow-up, and users can explicitly ask text-only questions while paused.

The allowance is **not a token, wall-time, or spending cap**. It does not count
nested calls inside a tool or work performed by detached processes. It does not
cancel an active model request, stop existing jobs, retract already-queued
messages, or control another Pi/Codex session. Other extensions may have their
own continuation paths. Use the relevant task's cancellation controls when
cancellation is intended.

Contract statements are behavioral instructions, not filesystem or network
access controls. This extension is not a sandbox or a security boundary against
code that can alter the host, extension files, or session storage. Approval and renewal are command operations, not model-tool operations.
Effective isolation and authentication remain host responsibilities.

## Persistence and recovery

Contracts, admissions, proposals, and checkpoints are custom entries in Pi's
session JSONL, reconstructed from the current branch. Evidence references point
to existing tool-result entries; outputs are not copied into another evidence
store. The active contract is injected as transient context rather than saved
as repeated instruction messages.

Opening, reloading, or navigating to a branch with a running envelope pauses it
for user renewal. A checkpoint and its evidence IDs remain inspectable after
reopening the saved session. Changing/completing the goal invalidates its tool
admissions; the user must review a contract for the current unfinished goal.

This is conversation-state recovery, not filesystem rollback. Navigating a
session branch does not revert code, restore an R process, or undo external
side effects. Resume only after checking that the workspace and running jobs
match the decision being renewed.

## Phone access over SSH

For a persistent terminal, start Pi inside a named `tmux` session on the VM.
Use an existing authenticated SSH connection; this feature needs no extra
public port or service.

```sh
# In the VM terminal, before starting a new Pi process:
tmux new-session -s pi-workbench
# Change to the project and start Pi in that session.
```

From a phone's SSH client, a read-only attachment can observe the same screen:

```sh
ssh -t user@vm 'tmux attach-session -r -t pi-workbench'
```

For an interactive attachment, omit `-r` and coordinate one input owner at a
time. Two attachments share the same Pi process; do not start a second writer
against the same session file. `Ctrl-b d` detaches a tmux client without ending
Pi. Attaching to the same process does not reopen/reload the Pi session or reset
its allowance. Existing work is not automatically migrated into tmux.

The panel and views are width-tested. `npm run test:workbench:pty` exercises
actual Pi commands, review scrolling, editor cancellation, input focus, and
80/40-column resize in an isolated tmux server. A physical phone, its keyboard,
and its SSH client's escape-key behavior require a separate hands-on check.
