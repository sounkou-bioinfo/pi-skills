---
name: sounkou-engineering-style
description: Apply shared sounkou-bioinfo/RGenomicsETL engineering rules. Use when the user asks for “our style” or when a project skill delegates authority, ownership, bounds, focused work, and proof here.
---

# Sounkou engineering style

## Control the concept

Read repository authorities before editing. Keep one conceptual controller; do not multiply agents, branches, worktrees, plans, validators, helpers, or interfaces to simulate progress.

For each change, identify:

- the single semantic authority;
- the invariant and its owner;
- the public boundary affected;
- the smallest executable proof;
- obsolete code/docs the new authority replaces.

Use evidence dialectically: state a model, seek a counterexample, revise the model, and encode the resolution in code/tests rather than permanent planning prose.

## Code

**C:** explicit ownership and cleanup; checked width/allocation arithmetic; host-visible errors instead of abort/exit; no fake object systems or future-only interfaces.

**R:** idiomatic vectors/functions/S7; explicit scalar cardinality; shared helpers only for a repeated named invariant; let R/DBI errors stand when they already express the contract.

**SQL/DuckDB:** composable relations and native kernels; readers separate from analytics; stable public semantics; no hidden mutable cross-thread state.

Name the concrete axis instead of saying only “boundary”: allocation limit, R/C ownership interface, exon–intron junction, transcript endpoint, VCF anchor case, vector edge, and so on.

## Completion

Inspect the final diff and actual artifacts. Run focused tests, then repository gates. Map every requested deliverable to evidence. Do not claim performance, compatibility, portability, or completion beyond the measured/tested workload. Remove superseded plans, duplicate authorities, and generated debris.
