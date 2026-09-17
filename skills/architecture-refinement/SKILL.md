---
name: architecture-refinement
description: Use for consequential architecture review, exploratory coding and theory-building when requirements or behavior are uncertain, technical issue refinement, and retrospective reconciliation when code has outrun understanding. Iterate through concrete observations and small experiments; align the evolving specification, implementation, evidence, and owner understanding.
---

# Architecture refinement

Build and maintain a working theory connecting the domain problem, implementation,
evidence, and owner understanding. The purpose is better understanding and better
decisions, including discovering what ought to be built. Documents, tests, and
code support that purpose rather than measure success. Arrive at a design worth
defending, rather than defending the first design.

Use Peter Naur's [programming-as-theory-building perspective](https://gwern.net/doc/cs/algorithm/1985-naur.pdf):
understand how the program relates to its domain, justify its choices, and reason
constructively about modifications. Mitchell Hashimoto's whiteboard-defense
standard supplies a complementary ownership question: can the responsible owner
explain the shipped system's high-level behavior, choices, and limits? An
assistant-written specification or memorized explanation does not by itself
transfer that theory.

## When to use it

| Trigger | Review goal |
|---|---|
| Before consequential implementation | Challenge assumptions and identify what needs learning before committing to a design. |
| During implementation with uncertain requirements or surprising behavior | Use small experiments to develop the specification and implementation together. |
| Refining a technical issue | Separate the problem from an assumed cause or premature solution. |
| After a burst of AI-assisted implementation | Reconcile intended behavior with what actually emerged. |
| Lost understanding or an ownership handoff | Reconstruct the relevant model and recover architectural ownership. |
| Before shipping a significant change | Examine important assumptions, failure behavior, and evidence gaps. |
| An incident or surprising behavior | Revise the model using the counterexample, not merely patch the symptom. |

Use event-driven checkpoints and short learning loops within authorized work,
not a per-commit ritual or a mandatory approval for every experiment. Reconcile
at meaningful milestones before building another layer on uncertain assumptions.
Revisit settled choices when evidence, constraints, or consequences change; a
handoff may need explanation without redesign. Routine mechanical edits within
an already-understood design do not need this workflow.

## Choose the entry point and scope

- **Prospective:** refine a proposed architecture, implementation plan, or issue.
- **Exploratory:** use observations and small executable probes to learn the
  problem, semantics, and design while implementing within the authorized scope.
- **Retrospective:** reconstruct and critique an existing system, including
  vibecoded work whose behavior or complexity has outrun shared understanding.

Establish the user problem, known contracts and constraints, provisional success
criteria, and open questions. An incomplete specification can be the reason to
explore, not a reason to invent certainty or demand a complete plan. Bound the
work to a subsystem or user journey and its material dependencies. Distinguish
current behavior, desired behavior, and hypotheses; establish whether the task
authorizes investigation, review, implementation, or release assessment.

Scale effort to consequences. Isolated, disposable experiments favor speed;
customer data, credentials, shared infrastructure, or reliance on an output
create obligations even when the work is called a demo.

Use [project orientation](../project-orientation/SKILL.md) when conflicting or
unfamiliar context needs resolving. Domain skills and repository contracts supply
technical constraints; this workflow does not replace them. A review request
authorizes analysis and local drafts, not an unsolicited repair or rewrite.
Continue implementation when it is already within the user's authorized scope.

## Treat specification as a developing model

[Jay Kruer's argument about specification and verification costs](https://dank.systems/posts/2026-09-15-ai-bear.html)
highlights that implementation discoveries can reshape specifications and that
human oversight limits generated throughput. Apply that warning without assuming
all contracts are unknowable or all automation is ineffective.

Separate accepted commitments from provisional choices. Security, data integrity,
compatibility, and user-imposed constraints remain binding; implementation guesses
and open semantics are revisable. Learn enough to make the next safe move, then
update the working specification as evidence arrives. If discovery conflicts with
an accepted commitment, surface the conflict and obtain approval for a change;
do not silently redefine success to fit the implementation.

Use formal specifications, existing validators, and domain oracles where they fit
the risk and are available. A harness can preserve experiments, exercise checks,
and expose counterexamples; it cannot by itself establish that its objective,
fixtures, or oracle express the right problem. Additional generated specifications,
tests, or reviewers may share the same mistaken assumption.

## Run a bounded session

Use these practices as moves in an inquiry, not mandatory phases or a form to fill
out. Use one subsystem, user journey, or consequential decision per pass. Broaden the
scope only when a dependency materially affects the conclusion; divide a
whole-system request into bounded passes. Start from available context and ask
for clarification where it changes the review, rather than requiring an intake
interview before inspecting evidence.

When shared understanding is the goal, make the review conversational: present a
compact first model, invite the owner to identify surprises or mismatched
expectations, and examine one consequential uncertainty at a time. Check both
the owner's and the assistant's claims about current behavior against evidence;
keep these distinct from the owner's goals and accepted constraints. Refine the
model together instead of substituting a long report for a walkthrough. Ask
questions to expose useful gaps, not to test line-level recall.

For a requested batch review or an unavailable owner, proceed within scope and
record questions needing owner input; do not imply that shared understanding has
been established. Bound code volume, concurrent experiments, and review output by
what can be inspected and understood. More generated work is not progress when
the explanatory or verification backlog grows; summarize and resolve the critical
gap before expanding. A clearer model or one discriminating test can be enough.

## Build the working theory

Explain the relevant system in plain language, with a small diagram if useful:

- Actors, entry points, external dependencies, and trust boundaries.
- Data and control flow, state ownership, persistence, and lifecycle.
- Important data structures and abstractions, and the requirements they serve.
- Invariants, enforcement points, and externally observable promises.
- Failure and abuse paths, detection, recovery, and operating limits.
- Predictions for an unfamiliar case and how a plausible new requirement would
  affect the design; use these to test whether the explanation is actionable.

Start with a partial model when necessary and refine it through observation.
Label verified behavior, proposals, assumptions, inferences, and unknowns.
Attach claims to source paths, contracts, tests, traces, or measurements as
appropriate. Identify the relevant revision or loaded artifact when they may
differ. A plausible explanation or green happy-path test is not proof of the
whole model. Explicitly bound what was inspected.

## Explore, challenge, and consolidate

**Observe → conjecture → probe → confront surprises → revise → consolidate.**
Enter wherever the evidence permits; exploration need not begin with a fully
formed hypothesis. Code can be an instrument for finding out, not only a final
answer to an already-settled question.

1. **Observe.** Inspect concrete inputs, outputs, state, traces, and distributions
   in the native runtime. Sample representative and awkward cases. If the useful
   question is unclear, begin with bounded open exploration rather than inventing
   a choice between two designs. Let observations suggest questions.
2. **Conjecture and challenge.** State a tentative explanation or candidate.
   Where it makes a prediction, state that before the next probe. For a consequential
   choice, identify its strongest applicable expert objection, vulnerable assumption,
   and a credible alternative, including keeping the current design.
3. **Probe.** Choose the smallest safe experiment that can teach something: a
   direct function call, traced failing input, scratch expression, workload sample,
   or reversible thin implementation slice. State what it can and cannot establish.
   Stay inside data, side-effect, resource, and user-authorization boundaries.
4. **Confront surprises.** Compare observations with the working theory. A surprise
   can expose a wrong model, a defect, an inadequate measurement, or an unresolved
   requirement. Investigate rather than patching the example or weakening the test
   until it passes. Reject candidates with unresolved applicable rejection reasons.
5. **Revise.** Update the explanation, design, next question, or proposed requirement.
   Preserve justified parts; synthesize around what was learned, not an obligatory
   compromise. Small implementation and specification changes can alternate within
   one task. Broaden a probe only when the observation warrants it.
6. **Consolidate.** Once the behavior and its justification are sufficiently stable
   for the intended use, retain a minimal reproducer and promote the relevant
   learning into a clear contract, focused tests, and the simplest suitable code.
   Remove experiment-only scaffolding you introduced when it is no longer useful;
   preserve useful user artifacts and evidence. Record the decision, material costs,
   risks, reversibility, scope, alternatives, and conditions for reconsideration.

Keep discovery distinct from confirmation. An exploratory observation describes
what happened, not automatically what should happen. Before treating a generated
test or snapshot as a contract, identify its oracle: a requirement, domain rule,
validated reference, or explicit owner decision. Challenge the result with a fresh
case where practical; tests derived from the same mistaken model are not independent
evidence of correctness. Fix the implementation when an accepted contract is violated.

Stop or checkpoint when the question is answered, learning stalls, the agreed
budget is exhausted, or progress needs a specific fact or user decision. Report
the remaining uncertainty and next bounded action. A useful experiment that rules
out a design can be progress without contributing production code.

## Bring our R-developer EDA ethos to coding

Our practice as R developers treats programming as an exploratory conversation
with data and behavior. Work with concrete inputs, inspect intermediate objects,
summarize or visualize variation, compare cases, and follow anomalies. Let what
you observe reshape the question as well as the implementation. Choose the next
small expression or edit from what was learned; let functions and abstractions
emerge as useful operations and their semantics become clear.

Carry this EDA ethos into the repository's native runtime and tools. The aim is
to learn from the program, not to turn every coding question into a statistical
analysis or an R rewrite. In R, inspect values, types,
classes, lengths, names, dimensions, missingness, and dispatch where relevant;
use summaries or plots when they expose behavior better than prose. Follow
[We Use R Damnit](../we-use-r-damnit/SKILL.md) for R-native vectors, functions,
lexical environments, and contract-directed validation. Prefer a direct experiment
to a speculative framework; factor stable operations when their purpose is clear.

For example, an aggregation request may leave empty and all-missing groups
unspecified. Inspect concrete groups and compare the results before choosing an
API. A plausible zero is an observation, not a decision that absence means zero.
Use domain meaning to settle the proposed semantics, then retain a reproducer
and contract tests. If the contract already specifies the answer, test and honor it.

Keep important experiments reproducible: retain relevant inputs, code, seed if
stochastic, and runtime identity. Re-run the retained case from a clean session or
explicit setup before promoting it into package code or a regression test. Hidden
workspace state and a lucky interactive result do not establish a reusable contract.

## Retrospective reconciliation

Reconstruct representative paths through the actual implementation before
prescribing changes. Include a relevant failure or abuse path, not only the
successful demonstration. Start read-only; use isolated checks for risky cases.
Compare four views:

| View | Question |
|---|---|
| Intent | What problem, promises, and constraints should govern this system? |
| Implementation | What does the inspected or running artifact actually do? |
| Evidence | Which claims do tests, traces, or measurements establish? |
| Understanding | What can the responsible owner explain, and what remains unclear? |

Treat disagreements as review targets. Agreement between code and documentation
does not establish fitness for the requirement. Describe observed mechanisms
without inventing historical reasons; label inferred rationale as inference.
AI provenance is neither a defect nor evidence of quality.

Look for concrete consequences of competing state owners, accidental coupling,
unnecessary abstractions, hidden mutable state, silent fallback, incomplete
failure handling, security exposure, and unjustified operating cost. Distinguish
an understanding gap, an evidence gap, and a demonstrated design defect.
Unfamiliar code alone does not justify replacement.

For each material finding, record the claim, evidence, affected contract, impact,
confidence, and disposition:

| Disposition | Appropriate next step |
|---|---|
| Keep | Retain a sufficiently understood and justified design. |
| Clarify | Explain sound behavior or make an implicit contract explicit. |
| Verify | Test a plausible claim whose evidence is insufficient. |
| Simplify | Remove unnecessary machinery through a bounded, verified change. |
| Repair | Correct a demonstrated violation of a requirement or invariant. |
| Contain / replace | Propose a risk boundary or replacement for an unsuitable design. |

Prioritize by consequences and exposure, not aesthetic discomfort. Preserve
required behavior and data; make migrations, compatibility, rollback, and
verification explicit where relevant. Urgent risks warrant a clear warning and
containment recommendation, not an unauthorized production action. Keep an
as-built model distinct from a proposed target. A review can legitimately
conclude that no architectural change is needed.

## Refine technical issues

Treat an issue as a problem to clarify, not an architectural command. Separate
reported symptoms, reproduction evidence, causal hypotheses, and requested
solutions. A symptom does not establish its cause; a requested solution may hide
the actual requirement. Treat the issue as the current problem framing, with
explicit commitments and revisable hypotheses, rather than a frozen instruction
to implement a guessed solution. Apply the learning loop to its open questions
and proposed approach.

Use only the sections needed to make the issue actionable:

```markdown
## Problem and impact
## Observed behavior and evidence
## Desired behavior, constraints, and non-goals
## Proposed approach and credible alternatives
## Risks and unresolved questions
## Acceptance criteria / next discriminating experiment
```

Identify whether it is an investigation, design decision, or repair. Investigation
issues may be ready with a learning question, safe experiment bounds, and the
evidence needed for the next decision, without a selected architecture. Update
hypotheses and proposed criteria as discoveries change the problem; keep changes
to accepted commitments explicit. Acceptance criteria describe observable outcomes
and relevant failure behavior, not merely completed implementation tasks. Turn
review findings into focused local issue drafts when requested; separate blockers
from follow-up work. Keep issue descriptions and designs standalone rather than
preserving a debate transcript. Preserve useful evidence and decision rationale.

## Assess readiness and return control

Check the consequential parts of the model with whiteboard questions:

- Why this approach rather than the strongest alternative?
- Why these data structures, ownership boundaries, and abstractions?
- What happens when an actor behaves maliciously or a dependency fails?
- Where do the promises stop holding, and how would we detect and recover from it?
- What evidence would make us change this decision?
- What do we predict for a new case, and how would we accommodate a plausible
  requirement change without breaking the design's governing constraints?

Use predictions and small modification discussions during an owner walkthrough,
not recitation as a comprehension test. Documentation helps preserve evidence and
rationale; shared work on examples, surprises, and changes helps build the theory.

Distinguish **ready to investigate**, **ready for the next implementation slice**,
and **ready to ship**. These are scoped judgments, not one-way project phases;
discovery continues during implementation. An unknown may justify an isolated
experiment while blocking a production promise.
Assess shipping claims against applicable verification and operational gates;
an explanation is not a substitute for them. An assistant's explanation cannot
certify human understanding, and line-level recall is not the standard.

Return a compact result: scoped model, decisions and evidence, prioritized
findings, material trade-offs, unresolved questions, readiness, and the next
bounded action. Keep proposals distinct from approvals. Use
[local review](../local-review/SKILL.md) for human plan or diff review. Publishing
issues, comments, branches, or PRs, triggering remote CI, and merging require an
explicit user request; local review approval is not publication authority.
