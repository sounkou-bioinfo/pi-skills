---
name: rho-development
description: Work in RGenomicsETL/Rho on evidence-driven refinement, S7/s7contract interfaces, async tasks and streams, capabilities, providers, sessions, authored Rmd tests, and monorepo gates.
---

# Rho development

## Architecture

Read monorepo authorities first. Keep journal, resolver, content-addressed storage, coordination, and execution as distinct concepts. Add a shared abstraction only after two real consumers establish the invariant; update synthesis, refinement, and parity evidence together.

Use functional S7 objects. S7 validators/properties own object invariants; `s7contract` owns admission conformance at package/interface boundaries. Avoid mutable pseudo-object systems and validator duplication.

Effects are explicit: tasks/streams expose await/cancel/error semantics, while placement is a separate capability/policy decision. Do not hide blocking work behind synchronous-looking APIs.

Provider, tool, event, and session protocols define ordering, ownership, cancellation, capability checks, and durable identity. Unknown/unsupported capabilities fail explicitly.

## Package proof

Authored `.Rmd` tests are authorities; purled/generated `.R` files are artifacts and must remain in sync. Run formatting/style, purl/generated-source checks, focused tests, monorepo tests, and tarball checks required by current Makefiles. Generic R package mechanics belong to `r-package-development`; this skill owns Rho's refinement, capability, S7, and async contracts.
