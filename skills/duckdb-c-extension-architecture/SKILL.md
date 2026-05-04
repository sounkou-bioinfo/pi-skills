---
name: duckdb-c-extension-architecture
description: Guides design of DuckDB extensions written primarily in C, including runtime ownership, function boundaries, state models, background services, concurrency, and separation of stable logic from volatile adapter code. Use when planning or restructuring a native DuckDB extension rather than a one-off patch.
---

# DuckDB C Extension Architecture

Use this skill when you are designing the shape of a DuckDB extension in C and want a maintainable structure rather than a monolithic source file.

## Core position

A good DuckDB C extension usually has three layers:

1. **SQL surface**: scalar functions, table functions, macros, and registration.
2. **Core runtime/business logic**: state machines, data movement, parsing, execution, and memory ownership.
3. **Compatibility adapters**: the thin layer that touches volatile or vendor-specific APIs.

Keep these layers distinct.

## Main principles

### 1) Prefer C-first extension boundaries

If the extension is meant to be portable and ABI-conscious:

- prefer the DuckDB C API first
- use the C extension template path when it fits
- avoid pulling core semantics into C++ unless there is a strong, explicit reason

### 2) Make runtime ownership explicit

Define clearly:

- what state is process-global
- what state is per-database
- what state is per-service
- what state is per-query/session
- what state is per-thread or per-scan worker

A common good default is: key long-lived runtime state by database instance, not by an unkeyed singleton.

### 3) Separate registration from execution

Keep SQL registration code small. It should mainly:

- define signatures
- validate user-facing arguments
- locate or create runtime objects
- hand off to core functions

Do not bury all business logic in registration callbacks.

### 4) Treat concurrency as architecture

For extensions that scan, serve, stream, or embed background workers, decide early:

- which objects may cross threads
- whether one connection per worker or session is required
- which mutexes protect structure versus execution state
- what lifecycle guarantees exist during shutdown

If independent work can happen concurrently, prefer isolated per-session or per-worker resources over shared mutable connections.

### 5) Separate callbacks from heavy work

If integrating async transports or background events:

- keep callbacks tiny
- move expensive parsing, query execution, and encoding into worker code
- use explicit state machines instead of implicit callback spaghetti

### 6) Design shutdown before feature growth

Before adding more functions, make sure the extension can:

- stop services cleanly
- cancel or interrupt long-running work
- free native, DuckDB, and third-party resources on failure paths
- avoid leaking threads, sockets, handles, or result objects

### 7) Keep wire or protocol details out of SQL glue

If the extension speaks a protocol or embeds a service:

- define a protocol module
- define request/response validation separately
- keep SQL wrappers and transport code thin

### 8) Prefer staged delivery

For ambitious extensions, build in phases:

- load + register
- minimal real execution path
- one-shot operations
- streaming/session lifecycle
- concurrency
- extras

This keeps validation grounded in working behavior.

## A practical module split

A useful generic split is:

- `*_extension.c` or `*_sql_api.c`: registration only
- `*_runtime.c`: runtime and registry ownership
- `*_service.c`: long-lived service lifecycle
- `*_session.c`: per-query/per-client lifecycle
- `*_wire.c`: frame/protocol encoding and decoding
- `*_util.c`: small helpers only
- `*_compat.c`: volatile upstream adapters

## Good outcomes

- clear ownership boundaries
- small SQL registration layer
- isolated unstable API usage
- predictable shutdown and cleanup
- easier version upgrades

## Anti-patterns

- one giant file mixing SQL glue, business logic, transport code, and vendored API details
- hidden global singleton state
- cross-thread connection reuse without a strong guarantee
- complex work inside callbacks
- shutdown that only works on the happy path

## Related skills

- [DuckDB C extension vendoring and shims](../duckdb-c-extension-vendoring-and-shims/SKILL.md)
- [DuckDB C extension API stability](../duckdb-c-extension-api-stability/SKILL.md)
- [DuckDB C extension testing and interop](../duckdb-c-extension-testing-and-interop/SKILL.md)

## References

- [Runtime layering checklist](references/runtime-layering-checklist.md)
- [State ownership patterns](references/state-ownership-patterns.md)
- [DuckTinyCC init case study](references/ducktinycc-init-case-study.md)
