---
name: rho-development
description: Use for Rho implementation, package-boundary changes, or authored Rmd test workflows.
---

# Rho development

## Architecture

Follow `AGENTS.md`'s contract table. Select documentation for the affected contract rather than reading the whole monorepo map:

- package ownership: `docs/architecture.md`;
- design refinement/evidence: `docs/synthesis.md` and the relevant contradiction in `docs/refinements.md`;
- S7 / `s7contract`: `dev-notes/design/functional-oop.md`;
- tasks, streams, cancellation, placement: `dev-notes/design/async-effects.md`;
- providers, operations, events: `dev-notes/design/provider-and-event-protocols.md`;
- session resources and execution: `dev-notes/design/session-resource-topologies.md`;
- Pi compatibility claims: `docs/pi-parity.md`. `ROADMAP.md` is delivery order, not implementation status.

Keep journal, resolver, content-addressed storage, coordination, and execution as distinct concepts. Add a shared abstraction only after two real consumers establish the invariant; update synthesis, refinement, and parity evidence together.

Use functional S7 objects. S7 validators/properties own object invariants; `s7contract` owns admission conformance at package/interface boundaries. Avoid mutable pseudo-object systems and validator duplication.

Effects are explicit: tasks/streams expose await/cancel/error semantics, while placement is a separate capability/policy decision. Do not hide blocking work behind synchronous-looking APIs.

Provider, tool, event, and session protocols define ordering, ownership, cancellation, capability checks, and durable identity. Unknown/unsupported capabilities fail explicitly.

## Package proof

Authored `.Rmd` tests are authorities; purled/generated `.R` files are artifacts and must remain in sync. Use focused tests and affected generation checks while iterating. Before runtime/package handoff, run the current Makefiles' required monorepo/tarball gates, including applicable `make check-parity`, `make check-secrets`, `make check-models`, and `make check-purled-tests`; `make public-ready` is for release/publication work. Plain prose edits need relevant docs checks, but executable Rmd tests are not prose-only. Generic R package mechanics belong to `r-package-development`; this skill owns Rho's refinement, capability, S7, and async contracts.
