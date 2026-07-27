---
name: ducknng-development
description: "Guides development in the ducknng pure-C DuckDB extension: registry-derived RPC manifests, NNG/HTTP/WebSocket carrier boundaries, Arrow IPC and Quack payloads, explicit service/session/AIO lifetime, bounded security contracts, stable and unstable DuckDB API audits, SQL/property/browser/interop tests, and generated function catalogs. Use when working in sounkou-bioinfo/ducknng."
---

# ducknng Development

Use this skill for the ducknng repository. Also load `sounkou-engineering-style`.

## First establish the current branch contract

Read:

1. `AGENTS.md`
2. relevant binding specs under `docs/`: `protocol.md`, `manifest.md`, `registry.md`, `types.md`, `security.md`, `transports.md`, `http.md`, and `lifetime.md`
3. relevant C source and SQL/property/browser tests
4. `Makefile`, `docs/unstable_api.md`, and compatibility modules before changing DuckDB API use
5. `function_catalog/functions.yaml` and its generator for public SQL changes

This repository may contain active design-review notes and local work. Separate implemented code and passing tests from unresolved checklist items. If `AGENTS.md`, review docs, Makefile, and code disagree, trace the current build and call sites, report the drift, and update the authorities instead of repeating an obsolete blanket claim.

## Mental model and layers

ducknng is a multi-client DuckDB SQL/RPC server, not a bag of helper opcodes.

- carrier/transport: NNG, HTTP/HTTPS, and runtime-specific WebSocket adapters
- method layer: versioned ducknng envelope, method descriptors, registry, session state
- tabular payload: Arrow IPC through nanoarrow or declared Quack-derived batches
- control metadata: JSON
- database: DuckDB execution, chunks, prepared statements, and result lifecycle

A transport adapter changes how bytes move, not method names, payload meaning, auth policy, or session semantics. URL scheme selects the carrier; do not multiply the RPC namespace by transport.

Keep NNG calls behind NNG compatibility code, HTTP details behind HTTP compatibility code, transport-family parsing above both, and wire/IPC details out of SQL registration.

## Registry and authorities

- Every public RPC method has a descriptor and is reached through the registry.
- Descriptor data is runtime policy: flags, payload schemas, auth, mutation, session behavior, idempotence, deprecation, and request/reply limits.
- The exported manifest is derived from current registry state. A dispatchable method missing from the manifest, or an advertised method missing from the registry, is a protocol and security defect.
- Local SQL transport helpers are not automatically server manifest methods.
- `function_catalog/functions.yaml` is the hand-maintained public SQL function catalog. Generate `functions.md`, `functions.tsv`, and community metadata; do not hand-edit generated artifacts or the separate lean root `functions.yaml`.
- Runtime telemetry belongs in introspection surfaces, not capability manifests.

## Errors, bounds, and C style

Production errors survive the embedded DuckDB process:

- expected transport/protocol/remote failures use in-band rows, frames, or terminal AIO state according to `docs/protocol.md`
- configuration misuse or a bind-time schema impossibility may throw a DuckDB error
- malformed input, exhaustion, or ordinary operating failures do not abort the host

Use shared checked-size/capacity helpers. Bound wire lengths, payloads, method names, body sizes, nesting, queues, sessions, pipes, in-flight requests, connection pools, and result batches before allocation or copying. Keep recursion over external schemas explicitly depth-bounded.

Make allocator domains, borrowed handles, lock ownership, and cleanup paths visible. Keep AIO callbacks small and move parsing or harvesting into phase-specific helpers when that exposes state transitions.

## Lifetime and concurrency

SQL-visible handles do not have automatic GC. Preserve the honest explicit lifecycle:

- start/stop server
- open/close socket
- launch/drop AIO; cancellation is not destruction
- claim/close HTTP response stream separately from its open AIO
- create/drop TLS config
- open/close query session; cancel remains best effort unless a result says otherwise

Session id is a lookup key, not authority. The session token is a bearer capability; verified mTLS identity is an additional owner constraint when present. Validate ownership on every session operation.

One client must not observe or corrupt another client's state. Execution models and connection-pool scope are explicit. Avoid hidden shared mutable connections and never broaden a deployment threat model silently.

## Security contract

Read `docs/security.md` for any change touching listeners, methods, SQL execution, credentials, headers, sessions, routes, or limits.

- TLS configuration either applies on a TLS-capable scheme or is rejected; never silently ignore it.
- Keep transport authentication, application authentication, and authorization separate.
- Free-form remote DuckDB SQL is dangerous by design. ducknng is not an automatic sandbox; deployment policy must constrain it.
- `query_open` can mutate state even when opt-in unary `exec` is absent.
- Bind values through prepared statements; do not interpolate remote data into administrative SQL.
- Preserve CRLF/control-character checks, scoped outbound credentials, redacted introspection, and fail-closed profile resolution.
- Public internet deployments need a narrow gateway or fixed route API rather than raw SQL.

## DuckDB API discipline

Do not rely on a timeless “stable only” slogan. Inspect the current branch:

- `Makefile` pins build/test/header versions and stable versus unstable mode.
- `docs/unstable_api.md` records adopted, rejected, and exceptional groups.
- version-sensitive or deprecated use belongs in focused compatibility files with a concrete reason and removal condition.
- exact unstable-ABI builds must match their runtime.

Never spread an unstable convenience call through the tree. Never replace streaming or type semantics with a silent materialized fallback merely to avoid an API audit.

## Tests and generated docs

Public behavior needs the real path it claims:

- `test/sql/`: public SQL, server, sessions, transport, security, lifecycle, and type round trips
- `test/property/`: deterministic parser, codec, wire, transport, and arithmetic invariants
- `test/http_smoke.py`, `test/ws_smoke.py`, `test/rpc_smoke.R`: real interop paths
- `test/browser/`: actual browser/wasm behavior

Typical gates:

```bash
make release
make test_release
make prop
make prop-sanitize
```

Run relevant interop tests when changing those paths:

```bash
make http_smoke
make ws_smoke
make rpc_smoke_r
```

For public SQL/docs changes:

```bash
make function_catalog
make rdm
make check_news
```

Edit `README.Rmd` and inspect rendered `README.md`. Add a runnable example for new user-visible behavior unless a concrete runtime limitation is documented. Keep browser wasm and native artifacts, carriers, threading, and linker flags distinct.

## Completion

Verify descriptor/registry/manifest agreement, catalog generation, protocol/type/security/lifetime docs, malformed and valid paths, explicit resource cleanup, focused property/sanitizer tests, SQL tests, interop for the changed carrier, NEWS, and `git diff --check`.
