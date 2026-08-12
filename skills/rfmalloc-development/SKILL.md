---
name: rfmalloc-development
description: Work in the Rfmalloc monorepo on typed out-of-core storage, C-callable contracts, backend fallback, GGML vendoring, architecture programs, numerical oracles, cross-package checks, and GPU evidence.
---

# Rfmalloc development

## Package ownership

Read monorepo authorities and identify the owning package before editing. Keep storage/readers, codecs, compute backends, model/runtime orchestration, and statistical consumers separate. A cross-package contract change updates every affected `inst/include` declaration, implementation, registration, and consumer test.

Current package ownership:

- `Rfmalloc`: file-backed ALTREP storage, runtime, codec and matmul registries, bounded panel operations, typed accessors
- `Rggml`: one generated official GGML carrier, C-callables, CPU/BLAS and opt-in GPU backends
- `Rgguf`: R-facing GGUF storage adapter over the official implementation carried by Rggml
- `Rllm`: composition, architecture programs, storage binding, lowering, model execution
- `Rpgen`: genomics readers and bounded record-panel transfer
- `RfmallocStatgen`: statistical-genetics consumers over Rfmalloc contracts

Do not re-vendor the same engine or parser in sibling packages.

## Invariants

- Typed byte spans carry explicit type, shape, offset, length, and ownership metadata.
- Fallback backends preserve documented semantics; acceleration availability never changes correctness silently.
- Bit-exact codecs define byte order, width, missing/sentinel behavior, and round-trip oracle.
- The bound Rllm architecture AST/program is the executable authority; generated backend programs are derived.
- GGML/GGUF vendoring is generated, pinned, licensed, and reproducible; for Rggml, `inst/ggml` is generated from a pinned official tree and never hand-edited — change `tools/vendor-ggml/manifest.txt`, a named patch, or overlay, then re-run the vendoring recipe and re-run source equality/provenance gates.
- Numerical tests state tolerances and compare to independent oracles.
- GPU claims require the real rig workflow and recorded hardware/runtime evidence. Real GPU performance comes from `ssh rig`, not the CI software Vulkan path — do not infer GPU speed from lavapipe correctness or cached view construction.

## Completion

Run focused package tests, affected reverse/cross-package tests, generated-source checks, and tarball `R CMD check` for each changed package. Remove failed benchmark artifacts. Generic R package workflow belongs to `r-package-development`.
