---
name: rfmalloc-development
description: Use for implementation, build, or cross-package contract changes in the Rfmalloc monorepo.
---

# Rfmalloc development

## Package ownership

Follow monorepo instructions and identify the package owning the change; consult architecture documents when ownership or cross-package contracts are affected. Keep storage/readers, codecs, compute backends, model/runtime orchestration, and statistical consumers separate. A cross-package contract change updates every affected `inst/include` declaration, implementation, registration, and consumer test.

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

Use focused package tests while iterating. Before runtime/build/package handoff, run required generated-source and tarball checks for changed packages, plus affected reverse/cross-package tests. Prose-only edits need relevant documentation checks; GPU claims still require the real rig evidence above. Clean only task-owned disposable artifacts and retain failure evidence needed for reproduction. Generic R package workflow belongs to `r-package-development`.
