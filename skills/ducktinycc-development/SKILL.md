---
name: ducktinycc-development
description: Use for DuckTinyCC compiler integration, generated UDF bridges, artifact lifetime, or build changes.
---

# DuckTinyCC development

## Runtime contract

Follow repository instructions and consult the contract for the compiler, bridge, or artifact being changed. Distinguish staged `tcc_new_state` setup from a real `TCCState`, and keep relocated compiled code alive for every registered SQL function that can call it. Registration metadata owns the compiled artifact lifetime.

Generated wrappers obey recursive DuckDB/C descriptors, including borrowed type descriptors, UNION member/tag rules, NULL validity, child indexing, and vector cardinality. Do not hand-diverge generated and runtime semantics.

Keep allocator domains explicit: DuckDB, TinyCC, libc, and extension registries free only their own allocations. Pointer registries and finalizers have one owner and tolerate partial initialization.

## Security and assets

Runtime compilation executes unsandboxed native code. Keep that trusted-code contract explicit; validate shape and bounds but do not claim language sandboxing. Unsafe control-flow tests run in subprocesses. Default `-nostdlib` avoids implicit libc resolution and improves self-contained deployment; an include or `extern` declaration does not link a symbol.

Embedded runtime assets are content-addressed and verified before extraction/loading. Preserve deterministic extraction order and provenance. The content key covers the archive plus all manifest names and bytes; otherwise an old extraction tree can be reused incorrectly.

## Gates

Use affected SQL and subprocess safety tests during implementation. Before compiler/runtime/build handoff, run the repository-required debug/release, embedded-release, community-simulation, and generated-output gates. Prose-only changes need relevant documentation checks. Generic C/SQL style belongs to `sounkou-engineering-style`; this skill owns TinyCC and generated-bridge invariants.
