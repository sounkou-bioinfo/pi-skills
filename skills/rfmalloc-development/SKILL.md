---
name: rfmalloc-development
description: "Guides development in the Rfmalloc monorepo and its Rfmalloc, Rggml, Rgguf, Rllm, Rpgen, and RfmallocStatgen packages: typed out-of-core storage, C-callable contracts, backend fallback, generated GGML vendoring, architecture programs, numerical oracles, cross-package checks, and GPU-rig evidence. Use when working in sounkou-bioinfo/Rfmalloc."
---

# Rfmalloc Development

Use this skill for the Rfmalloc monorepo. Also load `sounkou-engineering-style` and `r-package-development`.

## Mandatory first reads

1. root `AGENTS.md`
2. `SYNTHESIS.md`
3. the touched package's `AGENTS.md`, `DESCRIPTION`, `NEWS.md`, and `Makefile`
4. relevant C-callable header, registry, source, and tinytests
5. `docs/rig-tunnel-setup.Rmd` for real GPU measurements

Treat `SYNTHESIS.md` as the current result of experiments, not a frozen API. Its “next contradictions” are investigations, not implemented behavior.

## One repo, one story

The monorepo explores out-of-core computation over pluggable storage codecs and compute backends. Package boundaries separate current responsibilities, but cross-package contracts land and are validated together.

Current package ownership:

- `Rfmalloc`: file-backed ALTREP storage, runtime, codec and matmul registries, bounded panel operations, typed accessors
- `Rggml`: one generated official GGML carrier, C-callables, CPU/BLAS and opt-in GPU backends
- `Rgguf`: R-facing GGUF storage adapter over the official implementation carried by Rggml
- `Rllm`: composition, architecture programs, storage binding, lowering, model execution
- `Rpgen`: genomics readers and bounded record-panel transfer
- `RfmallocStatgen`: statistical-genetics consumers over Rfmalloc contracts

Do not re-vendor the same engine or parser in sibling packages.

## Durable distinctions

Keep three decisions independent:

1. A source reader emits bounded records with explicit semantics.
2. A storage destination owns allocation, lifetime, alignment, packing, and layout, or explicitly borrows a read-only span from another owner.
3. A compute consumer chooses the algorithm appropriate to those semantics.

Materialize only when the algorithm requires another representation, never merely because control crosses a package boundary. Device residency is execution context, not another storage format.

Use the record-panel API for source-to-storage transfer and storage-span/typed-accessor APIs for read-side consumption. Do not force haplotypes, banded LD, quantized tensors, hardcalls, and doubles through one fake universal dense representation.

## C-callable and backend contracts

- `inst/include/*.h` C-callables are cross-package contracts. Update all monorepo producers and consumers in the same change.
- While all consumers are here, do not add API versions or compatibility shims just to record an internal evolution.
- Returned `SEXP`s follow R ownership rules; raw views retain an owning `SEXP` for their lifetime.
- Every byte span states owner, extent, alignment, mutability, and runtime context.
- A compute backend may decline a product by returning non-zero. Rfmalloc's bounded decode plus BLAS fallback must remain correct. Backend choice changes speed, never meaning.
- Codec decoders match the official GGML `to_float` reference bit-for-bit where that is the declared contract.
- On x86, stage ISA-specific objects and select at runtime without polluting R's recorded flags. On aarch64, use the supported NEON baseline.

## Architecture programs

Rllm's executable authority is the bound program: serializable architecture AST, typed storage bindings, and validated lowering.

- R is the surface syntax; freezing removes builder environments and leaves data.
- Adapters trace programs and declare typed parameters. The tensor directory validates names and shapes before borrowing payloads.
- Do not dispatch on model-family names in C or maintain a second native model plan.
- Grow the constrained operator grammar through reusable dataflow, state, and multi-result operations forced by real models.
- The dense R interpreter and native operator builder are semantic oracles and fallbacks. Generated C, if used, is a cache derived from the AST, never another authority.
- Claims for real models require the declared pure-R, upstream, codec, cache, and byte-boundary comparisons.

## Vendoring and licensing

The repository is GPL (>= 2); retained MIT/BSD upstream code is credited in each package's `inst/COPYRIGHTS`.

For Rggml:

- `inst/ggml` is generated from a pinned official tree.
- Never hand-edit it or generated `src/Makevars`.
- Change `tools/vendor-ggml/manifest.txt`, a named patch, or overlay, then run the vendoring recipe.
- Keep the vendored-recipe equality gate green.

Do not vendor without updating provenance and `inst/COPYRIGHTS`.

## Working and documentation style

- Write C with explicit ownership, bounds, and cleanup; write R with native vector/package semantics.
- `NAMESPACE` and `man/*.Rd` are roxygen-generated.
- Tests use tinytest under `packages/<pkg>/inst/tinytest/`.
- Each touched package gets a concise user-visible `NEWS.md` bullet when behavior changes.
- `README.Rmd` is the source where present; render and inspect output.
- Prose and commit messages in this repository do not use em dashes.
- Do not keep a failed performance experiment as an API. Record the evidence in synthesis, remove the slower path, and state the remaining contradiction precisely.

## Validation

Install/test the stack in dependency order with repository automation:

```bash
make test
```

For focused iteration after local sibling installation:

```bash
Rscript -e 'tinytest::run_test_file("packages/<pkg>/inst/tinytest/<file>.R")'
```

Before finishing, build and check every touched package from a tarball as required by root `AGENTS.md`:

```bash
R CMD build packages/<pkg>
R CMD check --no-manual <pkg>_*.tar.gz
```

For codec changes, always run both the pinned GGML fixture and live cross-package codec consistency tests named in `AGENTS.md`. Run `tests/integration.R` through `make test` for cross-package contracts.

Real GPU performance comes from `ssh rig`, not the CI software Vulkan path. Read `docs/rig-tunnel-setup.Rmd`, use the documented CUDA toolchain and full `nvidia-smi` path, and record model, codec, prompt/batch shape, tokens, backend, warmup, and repeated results. Do not infer GPU speed from lavapipe correctness or cached view construction.

## Completion

Check every current consumer of a changed C-callable or AST node, fallback correctness, generated vendor equality, platform-sensitive flags, tinytests, package tarballs, integration, attribution, NEWS, and `git diff --check`.
