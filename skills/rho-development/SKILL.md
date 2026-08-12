---
name: rho-development
description: Work in RGenomicsETL/Rho on evidence-driven refinement, S7/s7contract interfaces, async tasks and streams, capabilities, providers, sessions, authored Rmd tests, and monorepo gates.
---

# Rho development

## Architecture

Read monorepo authorities first, per `AGENTS.md`'s contract table rather than guessing from package names: `docs/architecture.md` (package ownership), `docs/synthesis.md` (distinctions that currently survive executable pressure), `docs/refinements.md` (open contradictions and required evidence), `dev-notes/design/functional-oop.md` (S7 and `s7contract`), `dev-notes/design/async-effects.md` (tasks, streams, cancellation, placement), `dev-notes/design/provider-and-event-protocols.md` (providers, operations, events), `dev-notes/design/session-resource-topologies.md` (journals, resolvers, CAS, coordination, execution), and `docs/pi-parity.md` (verified Pi behavior only; `ROADMAP.md` is delivery order, not implementation status).

Keep journal, resolver, content-addressed storage, coordination, and execution as distinct concepts. Add a shared abstraction only after two real consumers establish the invariant; update synthesis, refinement, and parity evidence together.

Use functional S7 objects. S7 validators/properties own object invariants; `s7contract` owns admission conformance at package/interface boundaries. Avoid mutable pseudo-object systems and validator duplication.

Effects are explicit: tasks/streams expose await/cancel/error semantics, while placement is a separate capability/policy decision. Do not hide blocking work behind synchronous-looking APIs.

Provider, tool, event, and session protocols define ordering, ownership, cancellation, capability checks, and durable identity. Unknown/unsupported capabilities fail explicitly.

## Package proof

Authored `.Rmd` tests are authorities; purled/generated `.R` files are artifacts and must remain in sync. Run formatting/style, purl/generated-source checks, focused tests, monorepo tests, and tarball checks required by current Makefiles, including the specific targets `make check-parity`, `make check-secrets`, `make check-models`, `make check-purled-tests`, and (release/publication work only) `make public-ready`. Generic R package mechanics belong to `r-package-development`; this skill owns Rho's refinement, capability, S7, and async contracts.
