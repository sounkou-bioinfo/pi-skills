---
name: rho-development
description: Guides development in the RGenomicsETL/Rho monorepo: evidence-driven dialectical refinement, modern R and functional S7 OOP, s7contract interfaces, asynchronous tasks and streams, explicit capabilities, provider and session protocols, authored Rmd tests, and monorepo gates. Use when working in Rho or its rho.* packages.
---

# Rho Development

Use this skill only for the Rho monorepo. Also load `sounkou-engineering-style` for the shared house style.

## Mandatory first reads

Read `AGENTS.md`, then follow its contract table rather than guessing from package names:

- `docs/architecture.md`: package ownership and current public concepts
- `docs/synthesis.md`: distinctions that currently survive executable pressure
- `docs/refinements.md`: open contradictions and required evidence
- `dev-notes/design/functional-oop.md`: S7 and `s7contract`
- `dev-notes/design/async-effects.md`: tasks, streams, cancellation, and placement
- `dev-notes/design/provider-and-event-protocols.md`: providers, operations, events
- `dev-notes/design/session-resource-topologies.md`: journals, resolvers, CAS, coordination, execution
- `docs/pi-parity.md`: verified Pi behavior only
- `ROADMAP.md`: delivery order, not implementation status

Read the owning package source and its authored test Rmd before changing a contract.

## Repository thesis

Rho closes an agent runtime over explicit capabilities without fixing where models, workers, sessions, or scientific data live. Preserve these independent decisions:

- session journal: ordered typed entries, identity, lineage, committed progress
- resolver: virtual resource to typed handle plus receipt
- CAS: identity of immutable bytes, not freshness or coordination
- coordination port: changing jobs, leases, observations, and notes
- execution binding: current R, mirai, persistent process, embedded model, recursive agent, or remote endpoint

Do not collapse these into a filesystem path, universal backend, global manager, or one agent-loop switch.

## Dialectical development

A new abstraction enters core only after two real implementations or consumers require the same motion.

1. State the current thesis and its consumer.
2. Exercise the contradictory provider, host, transport, or topology.
3. Add the focused executable fixture.
4. Keep the smaller synthesis; change all monorepo consumers together.
5. Update `docs/synthesis.md` only when evidence changes the design.
6. Update `docs/refinements.md` with pressure and proof still required, not feature wishes.
7. Mark parity `verified` only after an executable fixture or integration run.

Do not preserve rejected designs as compatibility layers or permanent ADRs.

## Functional OOP in R

- Public behavior varying by class enters through an S7 generic and method.
- Broad default methods implement a complete shared case; unsupported behavior remains a typed value and fails closed.
- Attach reusable constraints to S7 properties. Use class validators for cross-property invariants.
- Define small structural `s7contract` interfaces from consuming packages. Use `assert_implements()` at capability admission, not on every call.
- Introduce traits only for demonstrated opt-in conformance, default methods, or associated metadata.
- Use explicit environment properties for real mutable identity; mutate through named functions or generics.
- Keep durable schemas independent of package names, S7 class names, and current property layout. Use explicit semantic adapters and stable tags.
- Every package defining S7 methods calls `S7::methods_register()` from `.onLoad()`.
- Package namespaces provide privacy. Do not create dot-prefixed pseudo-private helpers.

## Effects and placement

- Effectful public APIs return `RhoTask`, `RhoStream`, `RhoDuplex`, or a typed operational value.
- Waiting is explicit at `rho_await()`, a CLI edge, or a test helper. Package code does not poll with `Sys.sleep()`.
- Every asynchronous test has a finite timeout and verifies relevant ordering.
- Scheduling and placement are separate. `rho.agent` may schedule; typed bindings choose current-session R, mirai, persistent, embedded, recursive, or remote execution.
- Higher packages use `rho.compute`; they do not call mirai, `parallel`, or `future` directly.
- Credentials, connections, filesystems, clocks, stores, and placement are injected capabilities, not ambient process discoveries.
- Cancellation, timeout, EOF, close, and peer loss remain distinct where consequences differ.

## Provider, tool, and event rules

- Derive provider behavior from typed endpoint and catalog values, never model-name patterns.
- Keep provider wire dialects private; public streams expose canonical Rho assistant events.
- `ToolSpec` is executable host code. `RhoOperation` is a semantic request bound by a provider, extension, evaluator, or remote service. Do not masquerade provider-hosted work as a local tool call.
- An event exists only if it is emitted, transported, consumed, ordered relative to mutation, and tested. Remove dead declarations.
- Persisted-state events occur after commit. Await policy/context handlers before the action they govern.

## Package practice

- Target the R version declared by the repo; current guidance uses modern R without legacy compatibility shims.
- Authored tests live in `packages/<pkg>/inst/tinytest/rmd/*.Rmd`.
- Generated `packages/<pkg>/inst/tinytest/test-*.R` files are not edited.
- Roxygen owns `NAMESPACE` and `man/`; Air formats authored R.
- Keep generated model catalogs and documentation synchronized through repository scripts.

Typical focused flow from the monorepo root:

```bash
Rscript scripts/purl-tests.R
Rscript -e 'tinytest::run_test_file("packages/<pkg>/inst/tinytest/test-<name>.R")'
make check-style
```

Package and monorepo gates:

```bash
make test
make check
make public-ready   # release/publication work only
```

Other generated-source checks:

```bash
make check-purled-tests
make check-models
make check-parity
make check-secrets
```

Run the focused fixture first. Use `public-ready` only when the task actually targets publication; report live provider or credential-dependent checks that were not run.

## Completion

A behavior claim needs authored documentation plus an executable fixture. Before finishing, check dependency direction, generated R tests, model data if touched, style, package tests, docs, and `git diff --check`. Update all affected packages together when a shared contract changes.
