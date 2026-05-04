---
name: duckdb-c-extension-vendoring-and-shims
description: Guides vendoring of native dependencies into DuckDB C extensions, including pinning, patch ledgers, static linking, hidden symbols, and compatibility-shim boundaries. Use when an extension needs bundled third-party C/C++ libraries rather than relying only on system dependencies.
---

# DuckDB C Extension Vendoring and Shims

Use this skill when the extension depends on third-party native libraries and you need a disciplined bundling strategy.

## Core position

Vendoring is not just copying code into `third_party/`.
It is a maintenance contract.

A good vendoring pattern should answer:

- what upstream revision is pinned
- why it is vendored instead of system-linked
- what local patches exist
- what direct upstream calls are allowed outside shims
- how symbol collisions are prevented
- how vendor bumps are validated

## Main principles

### 1) Pin upstreams explicitly

Record for each vendored dependency:

- upstream project name
- exact tag/commit/release line
- local patch files or patch directory
- reason for the chosen pin

Do not leave vendored code unversioned in spirit.

### 2) Keep vendoring layout obvious

A common clean pattern is:

- `third_party/<lib>/` for vendored source
- `patches/` or `inst/patches/` for local modifications
- `docs/` or `references/` for update notes if needed

### 3) Hide vendored implementation details behind shims

If a dependency is likely to change, create a shim such as:

- `*_nng_compat.c`
- `*_duckdb_streaming_compat.c`
- `*_vendor_compat.c`

Then make a rule that the rest of the tree does not call raw upstream APIs directly.

### 4) Prefer static vendoring plus hidden visibility when coexistence matters

If the extension may load alongside other packages that also ship similar libraries:

- prefer static linking where practical
- set hidden visibility
- avoid exporting vendored symbols
- test coexistence in one process

This reduces symbol collision risk dramatically.

### 5) Patch minimally and ledger every patch

Good local patches are:

- small
- documented
- isolated
- easy to rebase on vendor updates

Bad local patches silently fork the dependency.

### 6) Re-validate on every vendor bump

For each update, re-check:

- header layout assumptions
- exported symbol expectations
- struct or callback contracts
- ownership rules
- platform build behavior
- interop tests that motivated the vendor in the first place

### 7) Avoid leaking upstream volatility into business logic

Your extension should speak to your own internal API surface, not directly to ten different dependency surfaces.

## Good outcomes

- reproducible builds
- predictable upgrade workflow
- contained vendor-specific churn
- fewer host-process symbol conflicts
- easier compatibility audits

## Anti-patterns

- scattered direct `vendor_*` calls all over the tree
- undocumented patching of vendored files
- ambiguous version provenance
- relying on runtime system libraries when coexistence and portability matter
- no post-bump validation checklist

## Related skills

- [DuckDB C extension architecture](../duckdb-c-extension-architecture/SKILL.md)
- [DuckDB C extension API stability](../duckdb-c-extension-api-stability/SKILL.md)

## References

- [Vendoring checklist](references/vendoring-checklist.md)
- [Shim boundary pattern](references/shim-boundary-pattern.md)
