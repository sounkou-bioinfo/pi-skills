---
name: ducknng-development
description: Work in sounkou-bioinfo/ducknng on RPC manifests, NNG/HTTP/WebSocket carriers, Quack/Arrow payloads, session/AIO lifetime, security, DuckDB APIs, catalogs, and interop tests.
---

# ducknng development

## Authorities and layers

Read repository instructions and current branch contracts first. The registry is the semantic authority; generated RPC manifests/descriptors are derived.

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
- Bound frames, vectors, recursion, decompression, and retained requests before allocation.
- Keep unstable DuckDB APIs behind the repository compatibility layer and audit supported versions.
- Return errors through DuckDB/transport surfaces; never abort the host.
- Regenerate public manifests/catalogs from their authority; do not hand-edit generated copies.

## Gates

Run the smallest changed-carrier smoke first, then repository gates covering release SQL, properties, sanitizers, browser/interop behavior, generated function catalog, docs, and changelog. Typical named gates include `release`, `test_release`, `prop`, `prop-sanitize`, `function_catalog`, `rdm`, and `check_news`; use the current Makefile as command authority.
