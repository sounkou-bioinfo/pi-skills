---
name: duckdb-c-extension-api-stability
description: Guides DuckDB C extension API selection, deprecation handling, compatibility shims, and release policy. Use when balancing stable versus unstable APIs, managing breaking changes, or documenting deprecation strategy for SQL and wrapper surfaces.
---

# DuckDB C Extension API Stability

Use this skill when compatibility and upgrade cost matter.

## Core position

There are usually two different stability problems in a DuckDB extension:

1. **Upstream integration stability**: DuckDB APIs, transport libraries, Arrow helpers, and other dependencies.
2. **Your extension's public stability**: SQL names, argument semantics, wire contracts, wrapper behavior, and package APIs.

Treat both explicitly.

## Main principles

### 1) Prefer stable APIs by default

When both stable and unstable surfaces exist:

- start from the stable C API first
- verify which calls are actually required
- isolate unstable usage if you must use it

### 2) Put volatile calls behind one narrow compatibility layer

The most version-sensitive code should live in one place.
That is often better than spreading tiny unstable calls across many files.

### 3) Do not build new features on deprecated APIs

If an API is already marked deprecated:

- avoid it for new implementation work
- migrate old usage when practical
- if temporary use is unavoidable, isolate it and note the exit plan

### 4) Separate pre-1.0 cleanup from post-1.0 promises

A useful generic policy:

- **pre-1.0**: simplify aggressively, but record breaking changes clearly
- **post-1.0**: prefer deprecation windows, aliases, and migration notes

### 5) Deprecate with a written policy

For SQL functions, wrapper helpers, or generated aliases, document:

- what is deprecated
- since which version
- expected removal window
- replacement name or pattern
- whether behavior changed or only naming changed

### 6) Keep compatibility promises narrow and testable

Avoid vague claims like “compatible with all DuckDB versions”.
Instead state:

- supported DuckDB range or target line
- supported wrapper/package versions
- exact interop contracts that are validated

### 7) Maintain a changelog and machine-readable metadata where possible

Deprecation is easier to manage when reflected in:

- `NEWS.md` or `CHANGELOG.md`
- generated function catalogs
- wrapper docs
- tests that cover both current and deprecated paths, if still supported

## Good outcomes

- fewer accidental breakages
- small blast radius for dependency churn
- explicit migration paths
- public API clarity

## Anti-patterns

- mixing stable and unstable APIs throughout the tree
- using deprecated APIs for new code because they are convenient
- silent SQL renames or semantic changes
- no documented compatibility window

## Related skills

- [DuckDB C extension vendoring and shims](../duckdb-c-extension-vendoring-and-shims/SKILL.md)
- [DuckDB C extension function catalog](../duckdb-c-extension-function-catalog/SKILL.md)

## References

- [Deprecation policy template](references/deprecation-policy-template.md)
- [Compatibility boundary checklist](references/compatibility-boundary-checklist.md)
