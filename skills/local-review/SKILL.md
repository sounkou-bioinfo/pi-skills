---
name: local-review
description: Use for Plannotator plan or local diff review, or for a short Pi tree exploration followed by returning to implementation. Keep publishing explicit.
---

# Explore, review locally, then publish deliberately

Use upstream Plannotator in Pi and the native session tree. Operating details and
Remote-SSH forwarding are in [the operating guide](../../docs/operations.md#local-review).

## Build shared understanding

- Agree the objective and evidence needed for success on the implementation branch.
- For a short side discussion, have the user label an assistant anchor in `/tree`.
  Explore read-only for a few exchanges: alternatives, evidence, and uncertainties.
- Before returning, give a concise brief: objective; decisions actually made by
  the user; observations and their source paths; unresolved questions; proposed
  next step. Keep suggestions distinct from approved decisions.
- The user returns through `/tree` and chooses whether to carry a branch summary.
  The old branch remains inspectable. The user then chooses the implementation step.
- Tree navigation does not restore files or Git state or cancel jobs. Isolate
  experiments explicitly. Close or reconcile outstanding review tabs before moving.

## Review locally

- Use `/plannotator-plan-mode` and `plannotator_submit_plan` when a plan needs review.
- Use `/plannotator-review` for the local diff, `/plannotator-annotate <path>` for
  Markdown, and `/plannotator-last` for an explanation. Use Pi's integration;
  a separate Plannotator CLI is not required.
- Keep small tasks lightweight; a short clarification does not require a formal plan.
- Run local checks and inspect meaningful evidence before treating work as ready.
  Include untracked files and the intended comparison base in local diff review.
- Treat code-review annotations as findings to verify and discuss before editing.
  Ground verdicts in the code, then apply the revisions the user chooses.
  Browser feedback is human input, not proof that a claim is correct. Ask about
  unresolved consequential questions instead of guessing.

## Publish only when requested

Local plan approval is not permission to push, create PRs, submit stacks, post
remote reviews or comments, trigger remote CI, or merge. Obtain an explicit user
request for publication. A request to inspect an existing PR does not by itself
authorize posting feedback. Until then, keep review and verification local,
without coworker notifications or CI spending.

When publication is requested, use GitHub's native stacked PRs for coherent,
dependent changes. Each layer should explain its decision, checks, and remaining
uncertainty. GitHub owns published review and merge status; Plannotator annotations
are not GitHub approvals. Bound review debt rather than merely dividing it among PRs.

## Remote development

Support local machines and VS Code Remote-SSH. Keep review listeners on loopback
and forward the port privately. Preserve VS Code's `BROWSER` helper. Choose an
unused, session-specific port if a stable URL is needed. Do not expose an
unauthenticated review server publicly or alter the user's SSH configuration.
