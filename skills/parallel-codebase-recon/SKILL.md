---
name: parallel-codebase-recon
description: Runs broad codebase reconnaissance using multiple scout subagents in parallel, then synthesizes the results. Use when the repo is large or the task spans several subsystems.
---

# Parallel Codebase Recon

Use this skill when one scout would be too slow or too shallow.

## Best use cases

- architecture discovery across multiple directories
- locating related implementations in server, client, and tests
- comparing several candidate implementations
- inventorying APIs, schemas, migrations, or adapters

## Workflow

1. Split the repo into natural slices.
2. Launch parallel `scout` tasks, one per slice.
3. Ask each scout to report exact files and line ranges.
4. Merge the results into one concise parent summary.
5. If changes are needed, hand off to `planner` or `worker`.

## Good slice examples

- backend vs frontend vs tests
- models vs providers vs API routes
- migrations vs runtime code vs docs
- parsing vs storage vs rendering

## Prompt pattern

Ask each scout for:

- files retrieved
- key findings
- risks or unknowns
- recommended next step

## Important rule

Do not parallelize arbitrary overlapping searches if one targeted scout would do.
The point is to reduce context contention, not create duplicate noise.
