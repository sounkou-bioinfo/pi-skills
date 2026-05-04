---
description: Scout, plan, then implement a task with subagents
argument-hint: "<task>"
---
Use the `subagent` tool in a chain:

1. `scout` to locate the relevant code and summarize the architecture for this task.
2. `planner` to produce a concrete implementation plan using the scout output.
3. `worker` to implement the plan.

Task: $@
