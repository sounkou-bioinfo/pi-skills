---
name: bioinformatics-rewrite-porting
description: Guides responsible AI-assisted rewriting and porting of bioinformatics tools, combining rewrites.bio principles with practical validation, attribution, compatibility, and maintenance discipline. Use when planning or implementing a rewrite, reimplementation, or high-performance port of an existing bioinformatics tool.
---

# Bioinformatics Rewrite and Porting

Use this skill when rewriting, porting, or modernizing an existing bioinformatics tool.

This skill is based on the principles of `rewrites.bio`, with a practical implementation focus for real repository work.

## Core philosophy

A rewrite is not automatically valuable because it is newer, faster, or written in a fashionable language.
A rewrite becomes valuable when it:

- preserves scientific trust
- credits the original work
- defines compatibility honestly
- validates outputs on real data
- remains maintainable after the first release

## Foundational principles

### 1) Credit the original authors

A rewrite stands on years of prior algorithm design, bug fixing, user feedback, and maintenance.

Make credit visible in:

- `README`
- papers or preprints
- docs and citation instructions
- release notes where relevant

If users cite the rewrite, they should also know when and how to cite the original tool.

### 2) Emulate exactly for the declared scope

If the rewrite claims compatibility, define exactly what that means.

For deterministic tools, aim for:

- byte-for-byte identical outputs when feasible

For floating-point or numerically sensitive tools, define:

- acceptable tolerance
- exact datasets and commands used for validation

Do not present semantic differences as harmless “improvements” while still claiming equivalence.

### 3) Be transparent about AI assistance

Document:

- what AI tools were used
- what role they played
- how outputs were verified
- where validation is still incomplete

Output comparison is the trust anchor, not prose about the implementation.

## Planning principles

### 4) Think big

Do not only ask:

- “how do we port this code?”

Also ask:

- what pipeline bottlenecks surround it?
- what I/O boundaries are artificial?
- what intermediate files could disappear?
- what could be fused without sacrificing validation?

Large gains often come from redesigning pipeline boundaries, not only from translation to a faster language.

### 5) Work small

Implementation strategy should be incremental.

Preferred loop:

1. choose a narrow slice
2. implement it
3. validate against upstream
4. add tests
5. expand scope

This is especially important for AI-assisted work, where local correctness must be established continuously.

## Building principles

### 6) Test and benchmark with real data

Synthetic fixtures help early, but real bioinformatics data reveals the actual edge cases.

Use:

- multiple organisms or references when relevant
- multiple platforms / library preps when relevant
- edge cases such as empty or tiny inputs
- realistic large datasets for performance claims

Document:

- hardware
- exact commands
- exact datasets
- exact comparison methodology

### 7) Build only what is needed first

Do not chase feature-complete parity before core correctness exists.

Prefer:

- explicit supported feature scope
- loud failure for unsupported options
- incremental scope expansion backed by tests

A smaller exact rewrite is more useful than a broad unreliable one.

### 8) Pin versions and document validation scope

Compatibility claims must be tied to:

- exact upstream version
- exact tag or commit when possible
- exact local validation date
- exact commands/scripts used for comparison

State clearly if compatibility is:

- exact for a pinned version
- partial for a subset of options
- approximate in some numerical areas

## Stewardship principles

### 9) Plan maintenance and governance

Before release, decide:

- who reviews issues
- how regressions are handled
- how upstream version changes are tracked
- how new datasets expand validation scope

A rewrite is a maintained scientific artifact, not a one-shot translation exercise.

### 10) Preserve adoption-friendly compatibility

The best rewrite often has near-zero migration cost.

Compatibility includes:

- file names
- output formats
- column ordering
- summary-stat conventions
- downstream parseability

If downstream tools break, the rewrite is not really a drop-in replacement.

### 11) Release as open source

A rewrite of an open-source scientific tool should usually strengthen, not weaken, the commons.

Check licenses before implementation and choose compatible licensing intentionally.

### 12) Contribute upstream responsibly

A rewrite may uncover real bugs in the original.

Before filing upstream issues:

- verify manually
- confirm with upstream tool behavior
- rule out your rewrite and malformed inputs
- avoid AI-generated speculation as evidence

Do not automate bug reporting to upstream maintainers.

## Practical rewrite checklist

Before implementation, record:

- upstream tool name
- exact upstream version
- exact commit/tag if available
- what must match exactly
- what is currently out of scope
- validation datasets
- validation commands/scripts
- benchmark plan
- attribution and citation plan
- maintenance owner(s)

## Recommended workflow

1. read upstream source and docs
2. define the compatibility contract
3. create the smallest validated slice
4. compare outputs against upstream
5. add regression tests
6. expand scope in phases
7. document limitations honestly
8. release with attribution and pinned validation notes

## Related skills

- For a more opinionated library/C/dependency-aware approach, also load [the library-first bio rewrites skill](../library-first-bio-rewrites/SKILL.md)

## References

- [Rewrite workflow checklist](references/rewrite-workflow.md)
- [Validation and attribution](references/validation-and-attribution.md)
