---
name: ducknng-development
description: Use for ducknng implementation, build, or RPC/transport contract changes.
---

# ducknng development

## Authorities and layers

Follow repository instructions and consult the current branch contract for the affected registry, session, or carrier. The registry is the semantic authority; generated RPC manifests/descriptors are derived.

Keep these layers distinct:

1. SQL/RPC registry and validation;
2. service/session/request state;
3. Quack/Arrow serialization;
4. NNG, HTTP, and WebSocket carriers;
5. DuckDB adapters and generated public catalog.

A carrier changes bytes and framing, not RPC/session/auth semantics.

## Invariants

- Make server, listener/socket, session, AIO, request, payload, and callback ownership explicit.
- Never reuse or free AIO/request buffers while callbacks can observe them.
- Bind session tokens to their owner and fail closed on malformed, oversized, unauthenticated, or cross-session input.
- `query_open` can mutate state even when opt-in unary `exec` is absent — do not treat it as read-only by default.
- Bound frames, vectors, recursion, decompression, and retained requests before allocation.
- Keep unstable DuckDB APIs behind the repository compatibility layer and audit supported versions.
- Return errors through DuckDB/transport surfaces; never abort the host.
- Regenerate public manifests/catalogs from their authority; do not hand-edit generated copies.

## Gates

Use the smallest changed-carrier test while iterating. Before runtime/build handoff, run the gates required by the current Makefile for that contract; release and interop claims retain their full gates. Typical targets include `release`, `test_release`, `prop`, `prop-sanitize`, `function_catalog`, `rdm`, and `check_news`. Prose-only changes need the relevant documentation checks, not an automatic browser/sanitizer run.
