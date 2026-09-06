---
name: sounkou-engineering-style
description: Use when the user requests our engineering style or a project skill delegates shared R/C/DuckDB rules here.
---

# Sounkou engineering style

## Control the concept

Follow applicable repository instructions; consult other authorities for the contract being changed, not as a mandatory reading stack. Keep one conceptual controller; do not multiply agents, branches, worktrees, plans, validators, helpers, or interfaces to simulate progress.

For design/runtime changes, identify the invariant, its owner, its public boundary, and an executable counterexample or proof. Encode the resolution in code/tests rather than permanent planning prose. A typo fix does not need a formal design narrative.

## Code

**C:** explicit ownership and cleanup; checked width/allocation arithmetic; host-visible errors instead of abort/exit; no fake object systems or future-only interfaces. Scalar code is the correctness oracle for SIMD: dispatch is centralized and capability-driven, never private ISA checks scattered through callers.

**R:** idiomatic vectors/functions/S7; explicit scalar cardinality; shared helpers only for a repeated named invariant; let R/DBI errors stand when they already express the contract. Use an S7 class when a semantic value changes behavior, a property for a reusable field constraint, a generic for an open operation, and a method for the class-specific answer.

**SQL/DuckDB:** composable relations and native kernels; readers separate from analytics; stable public semantics; no hidden mutable cross-thread state. A runtime capability is established by an API or layout probe, not guessed from a version or model-name string.

Name the concrete axis instead of saying only “boundary”: allocation limit, R/C ownership interface, exon–intron junction, transcript endpoint, VCF anchor case, vector edge, and so on.

## Completion

Inspect the changed diff/artifacts. Use affected tests during development and complete the gates required by the changed contract before handoff; prose-only edits need relevant render/link checks. Do not rerun unaffected suites after every edit. Report completion, performance, compatibility, and portability only to the extent verified. Remove superseded authorities and task-owned generated debris, not unrelated work.

## Review questions

Use the relevant questions for design, ownership, or safety reviews; they are not a required response template.

- What is the one authority for this decision?
- Which contradiction forced this abstraction?
- Is every allocation bounded and owned?
- Can malformed input crash the host or escape a lifetime?
- Is fallback explicit and semantically valid?
- Is mutable state scoped to the right database, session, worker, or process?
- Does the public claim have a real producer, consumer, and executable proof?
- Can any new layer, shim, flag, or plan be deleted because no current consumer needs it?
