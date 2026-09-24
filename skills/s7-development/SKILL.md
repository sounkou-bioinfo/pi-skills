---
name: s7-development
description: Use when implementing or changing R S7 classes, properties, methods, or package integration.
---

# S7 development

## Class contract

Use `S7::new_class()` with explicit properties and a constructor for user-facing defaults/coercion. Properties own field types and access semantics; validators own cross-property object invariants. A consumer that needs behavior from different classes may own a small `s7contract` interface. Method availability does not establish the meaning of the behavior; test that separately. Do not turn recurring scalar checks into an interface when a property, constructor, or simple `checkmate` check owns the contract.

Prefer immutable/functional updates. Computed properties use getters; writable derived state needs an explicit setter and invariant. Avoid hidden environments unless identity/mutability is the actual abstraction.

## Dispatch

Define behavior with `S7::new_generic()` and `S7::method()`. Keep generic bodies minimal. Declare `...` behavior deliberately; do not absorb misspelled arguments accidentally. Use multiple dispatch only when behavior genuinely depends on every dispatched argument. For inheritance, call `super()` when preserving parent behavior rather than copying it.

## Compatibility

Treat S3/S4 interop as an explicit adapter. Register methods in `.onLoad()` when package loading order requires it. Export classes/generics intentionally, maintain `Collate` order where needed, and document constructor/property/method contracts rather than object internals.

## Package-wide consumer opportunities

When several package functions appear to need the same behavior, run the optional read-only [consumer opportunity report](scripts/consumer_opportunities.R) on the package directory. Resolve the script relative to this skill's directory:

```sh
Rscript /path/to/s7-development/scripts/consumer_opportunities.R --max-groups=8 /path/to/package
```

It reports pairs of package-defined S7 generics called on the same formal argument by at least two top-level functions, and repeated scalar-check syntax (namespaced `checkmate` calls or simple `stop()` guards) across functions, with bounded file/line evidence. `--format=json` provides the same bounded groups for tooling. It uses the anti-slop Tree-sitter parser, scans package `R/` files, and fails on parse errors. It intentionally omits single-operation interfaces, indirect/dynamic calls, nested-function checks, and semantics outside this syntax. A hit is a place to read the consumers and relevant implementations, not a requirement to introduce `s7contract` or consolidate checks. Ask what each consumer requires, whether an alternative implementation could satisfy it, and which behavior a method-presence check cannot prove. Compare ordinary dispatch, S7 properties/constructors, and a simple argument check; use an interface only when the consumer actually needs shared behavior from multiple implementations. Do not reshape code to produce or avoid a hit.

## Proof

Test construction, invalid objects, property access/setters, dispatch specificity, inheritance, missing/dots behavior, serialization if supported, and package load with dependencies in different orders. For a consumer-owned interface, test implementations and the behavior the consumer depends on, not just method presence. Use the focused files under `references/` only for the active S7 mechanism.
