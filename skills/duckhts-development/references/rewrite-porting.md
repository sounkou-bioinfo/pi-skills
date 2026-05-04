# Rewrite and Porting Guidance for DuckHTS

DuckHTS sometimes ports or rewrites behavior from existing genomics tools.

## Use `rewrites.bio`-style discipline

When porting an existing tool, follow these principles:

- credit original authors visibly
- emulate exact behavior for the declared scope
- pin the upstream version or commit
- validate continuously against upstream
- state clearly what is in scope and what is deferred
- avoid silent semantic drift while claiming compatibility

## Practical checklist

Record:

- upstream tool name
- pinned version
- pinned commit/tag
- local validation date
- validation commands/scripts
- exact outputs or semantics that must match
- unsupported/deferred features

## Upstream sources

Prefer in this order:

1. `.sync/` mirror in the repo, when present
2. pinned upstream source checkout
3. official upstream docs/issues
4. secondary explanations only after source review

## DuckHTS cases where this matters

- `duckhts_mosdepth(...)` native mosdepth-compatible rewrite
- `bcftools_liftover`
- `bcftools_score`
- `bcftools_munge_row`
- WisecondorX-style streaming dedup behavior

## Documentation obligations

For a public compatibility rewrite, docs should include:

- explicit credit to upstream tool/authors
- citation guidance where scientifically relevant
- exact validation scope/version
- explicit statement if behavior is compatible only for a subset or pinned version
- AI assistance disclosure if the repo/design guidance requires it

## Incremental strategy

Think big, work small:

- design the full compatibility target
- implement one narrow slice
- validate it
- expand in phases
