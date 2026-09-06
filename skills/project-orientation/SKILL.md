---
name: project-orientation
description: Re-establish working context after a handoff, when resuming unfamiliar repository work, or when requirements, source, tests and remembered decisions conflict. Not a repository tour before every edit.
---

# Project orientation

Recover enough understanding for the task, then work. Do not reconstruct an
already-established context or turn this into a mandatory checklist.

## Establish the working model

- Identify the target checkout and relevant user/repository instructions. Read
  only the contracts and code boundaries the task depends on; use a domain skill
  when its ownership, ABI, provenance or compatibility rules apply.
- If memory is available, check its project identity before relying on recall.
  Retrieve relevant current decisions and their evidence, not an unscoped history
  dump. Cross-project and legacy retrieval should be explicit. Without memory,
  use the ordinary repository/handoff evidence; do not create a replacement system.
- Distinguish the requirement, implementation, test evidence and loaded artifact.
  A remembered decision, passing test, or repository document can be wrong or
  stale. A checkout revision does not identify the running extension or native ABI.

## Make useful friction explicit

For a consequential conflict, state the competing claims, the observation or
counterexample that separates them, and what remains unresolved. Resolve it with
focused evidence where possible. Surface disagreements that change accepted
semantics, scope, or material trade-offs; do not ask permission for every routine
local step. Report concise reasons and evidence, not private deliberation.

Automate repeated mechanics, not the distinction the failure taught. Prefer a
simpler abstraction **after** it explains the counterexample and preserves the
contract—not because it produces fewer findings or a shorter prompt.

## Retain the learning, not the transcript

When a durable understanding changes, record the decision **and why**, a useful
counterexample or evidence locator, applicability, and any unresolved question.
Use a stable subject/predicate for the evolving fact so old versions remain
history rather than current advice. Keep verified revision/runtime separate from
where the note happened to be recorded. Compress without erasing contradictions.

Project scope does not decide sharing. Do not automatically promote private
memory into repository instructions or declare a project-specific lesson global.
Propose a shared contract when its audience and stability justify it. Do not
create or rewrite `AGENTS.md` merely because orientation ran.

An adequate handoff identifies what governs this task, what was verified, what
changed in the working model, and what still needs evidence. Match verification
to the changed behavior and the repository's required handoff gates.
