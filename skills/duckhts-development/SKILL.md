---
name: duckhts-development
description: Work in RGenomicsETL/duckhts across the C extension, Rduckhts, tests, docs, vendoring, benchmarks, and compatible upstream rewrites. Use for any DuckHTS implementation change.
---

# DuckHTS development

## Authorities

Read repository `AGENTS.md`, `ARCHITECTURE.md`, `STYLE.md`, `design/README.md`, and relevant source/tests before editing. Repository instructions win over this skill.

- `functions.yaml` is the only hand-maintained public SQL catalog.
- Extension source is under `src/`; R package integration is under `r/Rduckhts/`.
- `.sync/` pinned mirrors precede secondary sources for compatibility work.
- `r/duckhtsbench` owns benchmark/corpus artifact identity, derivation, staging, and receipts.

## Completion gates

Every user-visible change updates root `NEWS.md`; update `r/Rduckhts/NEWS.md` only for package-visible changes. Public features normally need SQL conformance and R tinytests.

After extension-source changes:

```bash
cd /root/duckhts/r/Rduckhts
Rscript bootstrap.R /root/duckhts
THREADS=4 make test
```

Never run `R CMD INSTALL .` from `r/Rduckhts/`; build and install a tarball. New translation units must enter `src/duckhts_sources.tsv` so native, Unix R, and Windows R builds agree.

For public function/signature/docs changes: edit `functions.yaml`, run `python3 scripts/render_function_catalog.py`, bootstrap Rduckhts, and verify generated package/catalog output. Do not commit the local `community-extensions/` sync copy. Render README files only from their corresponding `.Rmd`.

Use deterministic, offline extension builds. Pin/checksum vendors and patch through ledgered files; do not edit vendored source directly. Preserve core fixtures and clean generated test output.

## Compatibility rewrites

For mosdepth/bcftools/samtools/VEP-like behavior, record upstream version/commit, supported subset, output/error contract, unsupported features, attribution, and exact comparison commands. Read `.sync/` first and validate continuously against pinned upstream behavior. Baseline SQL/tinytest coverage is not a substitute for upstream conformance.

## Native invariants

Keep ownership explicit and bound input-driven allocation. Mutable htslib handles, iterators, and caches are per-thread. Do not conflate htslib decompression workers with DuckDB parallelism. Preserve declared VCF-header typing; broken headers require explicit repair layers. Keep coverage counting models on separate surfaces.

For wasm-specific debugging, use `duckhts-wasm-debugging`.
