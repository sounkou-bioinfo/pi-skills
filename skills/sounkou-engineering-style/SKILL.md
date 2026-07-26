---
name: sounkou-engineering-style
description: Applies the working and coding style used across sounkou-bioinfo and RGenomicsETL projects: one-controller conceptual control without agent/worktree sprawl, evidence-driven dialectical design, one semantic authority, explicit C ownership and bounds, idiomatic R and S7, composable SQL, focused changes, and executable proof. Use when working in DuckHTS, Rducks, Rfmalloc, ducknng, DuckTinyCC, Rho, or when the user asks for "our style".
---

# Sounkou Engineering Style

Use this as the house style. A repository's current `AGENTS.md`, `STYLE.md`, architecture, tests, and build files override this general skill.

## Establish authority before editing

1. Inspect `git status` and preserve unrelated or uncommitted work.
2. Read the repository guidance and the source, tests, generated-file rules, and build targets relevant to the change.
3. Name the current semantic authority. Typical authorities are an executable test, registry, manifest, C header, schema, or authored R source.
4. Distinguish current implementation, open pressure, and future proposal. Never present a roadmap or stale design note as implemented behavior.
5. If authorities disagree, do not average them. Trace producers, consumers, generators, and tests; report the drift and fix the correct source.

Do not create a branch, commit, broad generated diff, dependency migration, or planning artifact unless requested.

## Control concepts, not agent topology

Keep one human-auditable controller and one coherent mental model of the software. The important output is control of the ideas: data structures, ownership, state transitions, semantic authorities, failure boundaries, performance model, and proof—not the number of files or agent calls produced.

- Use the model for locally precise implementation while retaining explicit control of system-level choices. State important structures and invariants concretely enough that an implementation can be judged against them.
- Reconstruct a codebase's conceptual model from its current authority files, source boundaries, and tests. Prefer improving an existing architecture/design authority when requested over generating parallel summaries that immediately drift.
- Do not fan out subagents merely to read more files, brainstorm alternatives, or simulate review. First inspect, grep, evaluate, and test with one controller.
- A child call needs a materially independent question, a minimal context, an explicit evidence contract, and a hard budget. Recursion is an exception used to resolve a contradiction, not a coverage strategy.
- Do not create worktrees or branches per task or per agent. Use one working tree by default; isolate work only when the user requests genuinely concurrent, independently integrable change sets.
- Spend saved review time on concept-level review and QA: inspect changes, identify affected contracts, run production-shaped integration scenarios, compare performance, and test surprising or sloppy user-visible behavior.

This follows the distinction in antirez's [Control the ideas, not the code](https://antirez.com/news/169) and the release-focused QA approach in [A new era for software testing](https://antirez.com/news/168), while retaining this repository's requirement for executable evidence.

## Dialectical movement is an engineering loop

Do not freeze the first plausible abstraction into an ADR.

1. **Thesis:** state the smallest concrete contract required by a current consumer.
2. **Contradiction:** push it against a materially different provider, platform, format, topology, or upstream oracle.
3. **Executable counterexample:** make the mismatch visible in a focused test, differential fixture, Rmd, integration run, or benchmark.
4. **Synthesis:** retain the smallest distinction or interface that explains both cases.
5. **Integration:** change every current consumer together when they share the repository; do not add internal compatibility ceremony merely to preserve the rejected form.
6. **Cleanup:** remove obsolete helpers, duplicate authorities, completed plans, and claims disproved by the evidence.

A pressure ledger records unresolved contradictions and required evidence; it is not a feature queue. A roadmap orders delivery; it is not a parity claim. A synthesis document describes what currently survives; it is not a frozen API. Public claims graduate only with linked executable evidence.

## One authority, no speculative surface

- Keep one hand-maintained source for each semantic decision; derive catalogs, docs, wrappers, and descriptors mechanically.
- Public APIs describe behavior implemented now. No ignored arguments, reserved flags, placeholder fields, fake events, or future-only interfaces.
- An event exists only when a producer emits it, a transport carries it, a consumer handles it, and a fixture proves payload and order.
- Split an abstraction only when a current second implementation or consumer pulls the split.
- Prefer a narrow failure over a broad claim with silent fallback.
- Code and tests replace completed implementation plans. Git history and issues retain the path and backlog.

## C: systems code, not object ceremony

Write C as systems code with visible state and ownership.

- Return host-visible errors or explicit status values for malformed input, resource exhaustion, and unsupported behavior. Production library code does not abort an embedded host.
- Check addition, multiplication, narrowing, offsets, lengths, nesting, queues, and input-driven allocation before use.
- State allocator families and borrowed, owned, or transferred lifetime. Pair each owned object with one destroy path; `goto cleanup` is valid when it makes teardown auditable.
- Keep worker-owned mutable state isolated. Locks protect registry structure and lifetime transitions, not independent kernel work.
- Separate parsing, validation, mutation, execution, and materialization when those are real phases. Do not manufacture tiny objects, generic context bags, factories, or callback indirection.
- Use `_Static_assert` for compile-time relationships. A production invariant is a checked branch, not a runtime `assert()`.
- Scalar code is the correctness oracle for SIMD. Dispatch is centralized and capability-driven, never private ISA checks scattered through callers.
- Isolate unstable, deprecated, platform, transport, and vendor APIs behind the narrowest concrete adapter that current code needs.

## R: use the language

Write R as an R package author, not as translated Python.

- Prefer vectors, language objects, lazy evaluation, closures, environments, active bindings, package namespaces, and standard conditions when they clarify the contract.
- Use an S7 class when a semantic value changes behavior, a property for a reusable field constraint, a generic for an open operation, and a method for the class-specific answer.
- Let S7 properties and class validators own invariants and messages. Do not reopen validated objects with duplicate `is_*()` helpers.
- Define small structural `s7contract` interfaces from the consumer's needs. Assert conformance at admission boundaries, not before every call. Traits require a real need for opt-in conformance, defaults, or metadata.
- Stateful identity may live in an explicit environment property; mutation goes through named functions or generics.
- Keep effects and capabilities explicit. Do not discover credentials, stores, connections, clocks, paths, or worker placement from ambient globals when they are part of behavior.
- Edit roxygen and authored Rmd sources, then regenerate `NAMESPACE`, `man/`, tests, and README output through project commands.

## SQL and DuckDB

- Relations are the composition surface. Preserve typed values, stable identifiers, provenance, and explicit ordering.
- Let DuckDB plan filters, projection, joins, memory, spill, and ordinary Parquet layouts before inventing a custom store.
- Keep exact-key lookup, interval overlap, and computed kernels as distinct physical operations when their costs and semantics differ.
- Use C for bounded reusable mechanics; use SQL for composition, joins, evidence, and final projections.
- A runtime capability is established by an API or layout probe, not guessed from a version or model-name string.

## Evidence and completion

Start with the narrowest relevant check, then run the repository gate appropriate to the changed contract.

- Add a regression before or with a bug fix.
- Use differential or independent oracles for compatibility and numerical work.
- Property tests, sanitizers, malformed-input tests, and lifecycle races complement public-surface tests.
- Benchmark the real claimed path. Record revision, workload, input and output denominators, threads, machine, and result. Do not claim no regression across incomparable runs.
- Update user-facing source docs and changelogs when behavior changes; inspect generated output as a reader.
- Finish with `git diff --check`, focused tests, and an explicit account of checks not run.

## Review questions

- What is the one authority for this decision?
- Which contradiction forced this abstraction?
- Is every allocation bounded and owned?
- Can malformed input crash the host or escape a lifetime?
- Is fallback explicit and semantically valid?
- Is mutable state scoped to the right database, session, worker, or process?
- Does the public claim have a real producer, consumer, and executable proof?
- Can any new layer, shim, flag, or plan be deleted because no current consumer needs it?
