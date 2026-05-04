---
name: duckhts-rewrite-porting
description: Guides exact-compatible rewrites and ports of existing genomics tools into DuckHTS, with pinned upstream validation, attribution, phased scope, and rewrites.bio-style discipline. Use when implementing or maintaining compatibility layers such as mosdepth-, bcftools-, or WisecondorX-aligned behavior in duckhts.
---

# DuckHTS Rewrite and Porting

Use this skill when DuckHTS is porting, rewriting, or emulating behavior from an existing genomics tool.

Typical cases:

- `duckhts_mosdepth(...)`
- `bcftools_liftover`
- `bcftools_score`
- `bcftools_munge_row`
- WisecondorX-style streaming dedup logic

This skill exists because compatibility rewrites are not ordinary feature work. They need pinned targets, explicit validation, and visible attribution.

## Core rule

Do not build “something inspired by X” when the repo goal is “rewrite X behavior for a declared scope”.

Follow rewrites.bio-style discipline:

- credit the original authors
- emulate exactly for the declared scope
- pin upstream version/commit
- validate continuously against upstream
- state scope and exclusions explicitly
- expand in phases

## Mandatory first reads

1. `AGENTS.md`
2. the relevant `design/*.md` file
3. `.sync/` mirror for the upstream tool, when present
4. existing SQL and tinytest coverage
5. any validation scripts already in the repo

If the task touches mosdepth behavior, read:

- `design/duckhts_mosdepth.md`

If the task touches WisecondorX-style dedup behavior, also read any referenced notes/scripts and the repo guidance pointing to `RWisecondorX/AGENTS.md`.

## Rewrite checklist

Before implementing, record:

- upstream tool name
- exact upstream version
- pinned tag or commit
- local validation date
- compatibility scope for v1
- explicitly deferred features
- exact output/semantic contract that must match
- validation commands or scripts

## Source priority

Use sources in this order:

1. `.sync/` mirror in the repo, when present
2. pinned upstream checkout/source files
3. official upstream docs and issues
4. secondary blogs/posts only after source review

Do not substitute memory for upstream source.

## Implementation strategy

Think big, work small.

1. design the full compatibility target
2. implement a narrow, testable slice
3. validate against upstream
4. add regression tests for mismatches found
5. extend scope incrementally

Compatibility work should prefer:

- explicit helper functions
- isolated compatibility-specific code paths
- validation scripts that compare to upstream
- feature gating by declared scope instead of half-working generalization

## What must not happen

Do not:

- silently change output formats while claiming compatibility
- claim compatibility with an unpinned upstream version
- replace exact validation with “seems similar” checks
- bury attribution or citation requirements
- mix compatibility-specific behavior into unrelated generic APIs unless the design explicitly requires it

## Testing requirements

Every compatibility rewrite needs:

- SQL conformance tests in `test/sql/`
- R wrapper/package tests in `r/Rduckhts/inst/tinytest/`
- upstream comparison or conformance validation where applicable

If exact byte identity is not required, document what equivalence means.

## Documentation requirements

Public docs should include:

- explicit upstream credit
- citation guidance where scientifically relevant
- exact version/commit validated against
- exact scope of compatibility
- explicit statement of deferred/unsupported features
- AI assistance disclosure if repo guidance requires it

## Related skills

- [DuckHTS development](../duckhts-development/SKILL.md)
- [R package development](../r-package-development/SKILL.md)

## References

- [DuckHTS rewrite guidance](../duckhts-development/references/rewrite-porting.md)
