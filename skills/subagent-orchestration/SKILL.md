---
name: subagent-orchestration
description: Guides use of packaged Pi subagents for decomposition, parallel reconnaissance, planning, implementation, and review. Use when a task is large enough to benefit from isolated context windows or staged delegation.
---

# Subagent Orchestration

Use this skill when the task is too broad, noisy, or multi-phase for one flat context window.

This package provides a `subagent` tool and bundled agents:

- `scout`
- `planner`
- `worker`
- `reviewer`

## When to delegate

Delegate when any of these are true:

- the repo is large and discovery would pollute the main context
- you want parallel exploration of multiple subsystems
- you want planning separated from implementation
- you want an explicit review pass before finalizing
- you need isolated retries on a narrow subproblem

## Default patterns

### 1. Recon only

Use a single `scout` for fast discovery.

### 2. Parallel recon

Use multiple `scout` tasks in parallel when the codebase splits naturally by subsystem.

### 3. Plan then execute

Use a chain:

1. `scout`
2. `planner`
3. `worker`

### 4. Plan, execute, review

Use a chain:

1. `scout`
2. `planner`
3. `worker`
4. `reviewer`

## Operating rules

- Keep each delegated task narrow and explicit.
- Tell the subagent exactly what output format you want.
- Pass the previous step's output via `{previous}` in chain mode.
- Use `scout` or `planner` before `worker` when the repository is unfamiliar.
- Use `reviewer` after non-trivial edits.
- Synthesize subagent outputs in the parent agent instead of blindly copying them.

## Example invocations

Single:

```text
Use the subagent tool with agent=scout to locate all auth middleware and summarize the key files.
```

Parallel:

```text
Use the subagent tool with parallel tasks: scout routing, scout persistence, scout tests.
```

Chain:

```text
Use the subagent tool in a chain: scout -> planner -> worker -> reviewer.
```

## Scope guidance

Packaged agents are available by default.

Optional extras:

- `agentScope: "user"` also allows `~/.pi/agent/agents`
- `agentScope: "project"` or `"both"` enables `.pi/agents` for trusted repos

Prefer packaged agents unless you explicitly need custom local agents.
