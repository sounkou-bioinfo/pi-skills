---
name: bioinformatics-ffi-and-bindings
description: Guides library-first bioinformatics rewrites that expose mature native code through bindings, extensions, FFI, or embedded runtimes across R, Python, SQL, and wasm. Use when building reusable interfaces around existing C/C++ libraries instead of standalone-only rewrites.
---

# Bioinformatics FFI and Bindings

Use this skill when the best rewrite path is not a new application binary, but a reusable interface around mature native code.

Typical cases:

- exposing a C/C++ bioinformatics library to R or Python
- embedding a library in a database extension
- building host-language wrappers around native kernels
- exposing one engine across CLI, SQL, R, Python, and wasm
- designing FFI-friendly APIs instead of app-only entry points

## Core mindset

A strong modernization path is often:

- keep the proven native core
- adapt the interfaces
- expose reusable primitives broadly
- minimize glue complexity and dependency sprawl

The innovation may live in the interface layer, not in replacing every algorithm.

## Main principles

### Prefer stable native cores

If an existing C/C++ library already solves the hard algorithmic part well:

- reuse it first
- wrap it carefully
- validate it in the new host environment

Do not rewrite the core just because you need a new frontend.

### Design for FFI early

An FFI-friendly core should prefer:

- explicit ownership rules
- simple structs and buffers at API boundaries
- narrow, well-defined entry points
- minimal hidden global state
- predictable error handling

Avoid leaking host-language assumptions into the native layer.

### Separate kernel from wrapper policy

Keep the native engine focused on core semantics.
Keep wrapper layers responsible for:

- argument reshaping
- host-language ergonomics
- table/data-frame conversions
- convenience defaults
- package-specific docs and examples

### One core, many surfaces

Ask whether one validated implementation can be surfaced through:

- CLI
- R package
- Python binding
- DuckDB extension
- wasm/browser worker
- service endpoint

This often yields more value than maintaining multiple diverging implementations.

### Keep dependency surface small

Bindings are not free if they drag in a large new stack.
Prefer interface layers that preserve the portability of the underlying library.

### Validate the wrapper, not just the core

Even if the underlying library is correct, wrappers can still break semantics through:

- type conversion mistakes
- indexing mismatches
- ownership bugs
- string/encoding issues
- silent truncation or coercion

Test wrapper behavior directly.

## Practical design questions

- What is the narrowest stable native API we can expose?
- Which data structures should stay native?
- Which conversions should happen only at the outer layer?
- What ownership and lifetime rules need to be documented?
- Can one implementation serve multiple host environments?
- Does this design still work in constrained targets like CRAN or wasm?

## Good outcomes

- one native engine with multiple bindings
- explicit error and ownership contracts
- low dependency burden
- reusable primitives instead of one-off app logic
- test coverage at both native and wrapper layers

## Anti-patterns

- wrapper logic duplicated independently across languages
- hidden ownership or lifetime assumptions
- host-specific hacks in the native core
- dependency-heavy interface layers for small gains
- reimplementing a stable library just to change the frontend

## References

- [Binding design notes](references/binding-design-notes.md)
- [Validation checklist](references/wrapper-validation-checklist.md)
