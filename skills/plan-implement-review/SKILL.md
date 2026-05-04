---
name: plan-implement-review
description: Guides a staged subagent workflow of planning, implementation, and review. Use when making non-trivial code changes that should be scoped, executed, and checked in separate passes.
---

# Plan, Implement, Review

Use this skill for medium or large code changes.

## Recommended chain

1. `scout` to gather context
2. `planner` to turn context into file-level steps
3. `worker` to implement the change
4. `reviewer` to inspect the result

## Why this helps

- discovery stays separate from implementation
- the worker gets a cleaner brief
- review happens with fresh context
- the parent agent can decide whether to accept or iterate

## Parent-agent responsibilities

- define success criteria clearly
- verify that the plan is still appropriate
- inspect the review findings
- run any final integration or packaging steps not delegated

## Iteration pattern

If reviewer finds issues:

1. summarize the issues
2. send a new `worker` task focused only on those fixes
3. optionally run `reviewer` again

## Validation guidance

Have the worker report:

- files changed
- tests or commands run
- any limits in validation

Have the reviewer focus on:

- correctness
- regressions
- missing tests
- mismatches between requirements and implementation
