---
name: rfmalloc-development
description: Work in the Rfmalloc monorepo on typed out-of-core storage, C-callable contracts, backend fallback, GGML vendoring, architecture programs, numerical oracles, cross-package checks, and GPU evidence.
---

# Rfmalloc development

## Package ownership

Read monorepo authorities and identify the owning package before editing. Keep storage/readers, codecs, compute backends, model/runtime orchestration, and statistical consumers separate. A cross-package contract change updates every affected `inst/include` declaration, implementation, registration, and consumer test.

## Invariants

- Typed byte spans carry explicit type, shape, offset, length, and ownership metadata.
- Fallback backends preserve documented semantics; acceleration availability never changes correctness silently.
- Bit-exact codecs define byte order, width, missing/sentinel behavior, and round-trip oracle.
- The bound Rllm architecture AST/program is the executable authority; generated backend programs are derived.
- GGML/GGUF vendoring is generated, pinned, licensed, and reproducible; re-run source equality/provenance gates after changes.
- Numerical tests state tolerances and compare to independent oracles.
- GPU claims require the real rig workflow and recorded hardware/runtime evidence.

## Completion

Run focused package tests, affected reverse/cross-package tests, generated-source checks, and tarball `R CMD check` for each changed package. Remove failed benchmark artifacts. Generic R package workflow belongs to `r-package-development`.
