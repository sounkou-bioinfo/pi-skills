---
name: s7-development
description: Implement or migrate R APIs with S7 classes, properties, validators, generics, multiple dispatch, inheritance, compatibility, and package registration.
---

# S7 development

## Class contract

Use `S7::new_class()` with explicit properties and a constructor for user-facing defaults/coercion. Properties own field types and access semantics; validators own cross-property object invariants. Admission conformance for external interfaces belongs to `s7contract`, not duplicate class validators.

Prefer immutable/functional updates. Computed properties use getters; writable derived state needs an explicit setter and invariant. Avoid hidden environments unless identity/mutability is the actual abstraction.

## Dispatch

Define behavior with `S7::new_generic()` and `S7::method()`. Keep generic bodies minimal. Declare `...` behavior deliberately; do not absorb misspelled arguments accidentally. Use multiple dispatch only when behavior genuinely depends on every dispatched argument. For inheritance, call `super()` when preserving parent behavior rather than copying it.

## Compatibility

Treat S3/S4 interop as an explicit adapter. Register methods in `.onLoad()` when package loading order requires it. Export classes/generics intentionally, maintain `Collate` order where needed, and document constructor/property/method contracts rather than object internals.

## Proof

Test construction, invalid objects, property access/setters, dispatch specificity, inheritance, missing/dots behavior, serialization if supported, and package load with dependencies in different orders. Use the focused files under `references/` only for the active S7 mechanism.
