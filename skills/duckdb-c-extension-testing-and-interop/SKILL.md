---
name: duckdb-c-extension-testing-and-interop
description: Guides testing of DuckDB C extensions across SQL, native, wrapper, and external-client layers, with emphasis on real execution paths, sqllogictest coverage, and protocol/interop validation. Use when building trustworthy tests for extensions that expose SQL plus native or service behavior.
---

# DuckDB C Extension Testing and Interop

Use this skill when the extension has behavior that cannot be trusted from unit tests alone.

## Core position

For DuckDB C extensions, tests should usually exist in layers:

1. **SQL-level regression tests** for the public extension surface
2. **small native/unit tests** for helpers such as framing, parsing, or ownership-sensitive code
3. **wrapper tests** for R or other host-language integrations
4. **interop tests** for real external clients or real transport paths when applicable

The key rule is simple: test the real path you claim to support.

## Main principles

### 1) SQL tests should cover public semantics first

Use sqllogictest-style coverage for:

- load behavior
- function registration
- deterministic outputs
- error propagation
- persistence/restart expectations
- duplicate-name or invalid-argument handling

### 2) Do not hide the real path behind internal shortcuts

If the extension claims to support remote execution, service IPC, or Arrow wire formats, the tests should exercise the real client/server path.

### 3) Keep tests deterministic

Prefer:

- explicit `ORDER BY`
- fixed aggregates or hashes for large outputs
- deterministic helper URLs or temp paths
- explicit cleanup hooks instead of sleeps

### 4) Test wrapper layers separately

An R wrapper or client helper deserves its own tests even if native and SQL layers are green.

### 5) Add interop tests for coexistence claims

If you claim interoperability with another runtime or package, add tests that use that real client.

### 6) Validate failure paths

Important negative tests often include:

- malformed requests
- missing sessions/handles
- oversized payloads
- duplicate server names
- invalid URLs/paths
- server-side SQL errors surfaced to callers

### 7) Test shutdown and cleanup

Extensions with long-lived state should test:

- start/stop
- restart behavior
- forced cleanup or GC hooks in test builds
- cancellation or interruption where supported

## Good outcomes

- confidence in public behavior
- regression coverage for wire/protocol logic
- wrapper bugs caught separately from native bugs
- less reliance on ad hoc manual testing

## Anti-patterns

- testing only helper internals while public SQL paths remain mostly untested
- tests that bypass the real protocol or runtime path
- timing-based sleeps as the main synchronization tool
- exact assertions on thread-dependent IDs or timestamps

## Related skills

- [DuckDB C extension architecture](../duckdb-c-extension-architecture/SKILL.md)
- [DuckDB C extension R bindings](../duckdb-c-extension-r-bindings/SKILL.md)

## References

- [SQL and interop test pyramid](references/sql-and-interop-test-pyramid.md)
- [Deterministic testing rules](references/deterministic-testing-rules.md)
