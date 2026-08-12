---
name: bioinformatics-ffi-and-bindings
description: Design bindings around mature native bioinformatics libraries. Use when exposing a C/C++ core to R, Python, SQL, wasm, or an embedded runtime instead of rewriting it.
---

# Bioinformatics FFI and bindings

## Contract

Reuse a stable native core and make the language boundary explicit.

- Separate native semantics from wrapper defaults, validation, naming, and display policy.
- Define ownership for every handle, buffer, string, callback, error, and borrowed view.
- Keep callbacks small; do not let foreign runtimes retain stack pointers or temporary language objects.
- Return host-visible errors instead of aborting the host process.
- Bound all input-driven allocation and length conversion before crossing integer widths.
- Expose a small C-compatible surface when multiple runtimes must share one core.
- Keep one semantic implementation; wrappers translate values and policy rather than reimplement algorithms.
- Treat wasm and threaded hosts as distinct ownership/runtime targets, not compiler flags on a desktop design.

## Validation

Test the native oracle and every public wrapper separately:

1. scalar/edge/error cases against the native or upstream oracle;
2. lifetime tests for close, finalization, repeated load/unload, and callbacks;
3. wrapper defaults, missing values, vectorization, and type conversion;
4. installed-artifact or external-client execution, not only in-tree calls;
5. platform-specific ABI/export behavior.

Document the native version, supported subset, unsupported semantics, and the exact comparison command. See `references/binding-design-notes.md` for the ownership checklist.
