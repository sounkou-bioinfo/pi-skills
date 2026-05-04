---
name: duckhts-development
description: Guides development in the DuckHTS repo, including DuckDB extension work, Rduckhts package integration, vendored htslib workflows, SQL and tinytest coverage, wasm/webR constraints, and exact-compatible rewrites of upstream genomics tools. Use when working in github.com/RGenomicsETL/duckhts.
---

# DuckHTS Development

Use this skill when working in the `RGenomicsETL/duckhts` repository.

This skill is repo-specific. It is derived from `duckhts/AGENTS.md`, the package/build files, design notes, and test layout.

## What this repo is

DuckHTS is:

- a DuckDB extension in C for HTS/genomics file formats
- an R package (`r/Rduckhts/`) that bundles and exposes that extension
- a repo with SQL conformance tests, R tinytests, vendored code, and design notes

Core source layout:

- extension sources: `src/`, headers in `src/include/`
- SQL tests: `test/sql/`
- R package: `r/Rduckhts/`
- benchmark notebooks: `benchmarks/`
- design notes: `design/`
- vendored sources: `third_party/`
- upstream mirrors / pinned rewrite references: `.sync/` when present

## Mandatory first reads

Before changing code:

1. Read `AGENTS.md`
2. Read the relevant source files before editing
3. Read the relevant tests to understand expected behavior
4. If mirroring external tool behavior, consult `.sync/` mirrors before secondary sources

If the task touches a known design area, read these first:

- `design/better_scans.md` for weighted contig claiming / future scan design
- `design/fastq_throughput.md` for FASTQ performance work
- `design/duckhts_mosdepth.md` for native mosdepth rewrite / compatibility work

## Changelog rules are mandatory

Every user-visible change must update both:

- `NEWS.md` (repo / extension, newest first)
- `r/Rduckhts/NEWS.md` (R package, newest first)

Scope rule:

- `r/Rduckhts/NEWS.md` is only for R package user-facing changes
- repo-only tooling or extension-internal workflow notes belong in root `NEWS.md`

Do not consider a user-visible change complete until both changelogs are correct.

## Documentation workflow

`functions.yaml` is the source of truth for public function docs.

After adding/removing/renaming public functions:

1. update `functions.yaml`
2. run:

```bash
python3 scripts/render_function_catalog.py
```

3. verify generated files under:

- `r/Rduckhts/inst/function_catalog/`
- `community-extensions/extensions/duckhts/description.yml`

Additional rules:

- `community-extensions/` is a local sync copy only; do not commit it
- `r/Rduckhts/README.Rmd` is wired to generated function catalog output; do not hand-maintain duplicated function lists
- benchmark `.Rmd` / `.md` files belong in `benchmarks/`

## Extension + R package coupling

DuckHTS changes often span both the extension and the R package.

When adding a new source file under `src/`, update all required build wiring:

- `CMakeLists.txt`
- `r/Rduckhts/R/bootstrap.R`
- `r/Rduckhts/configure`
- `r/Rduckhts/configure.win`

A new public function is incomplete until it is wired through:

- extension build
- R package build
- Unix package path
- Windows package path

## Mandatory R package workflow after extension source changes

After any extension source change, run:

```bash
cd ~/duckhts/r/Rduckhts/
Rscript bootstrap.R ~/duckhts/
THREADS=4 make test
```

Critical rule:

- never run `R CMD INSTALL .` from `r/Rduckhts/`
- always build a tarball and install the tarball

Use package-oriented commands from `r/Rduckhts/` such as:

```bash
make rd
make build
make check
make test
```

## Testing requirements

Every public feature needs two levels of testing:

1. SQL conformance in `test/sql/`
2. R package tests in `r/Rduckhts/inst/tinytest/`

Guidance:

- one `.test` file per feature family
- one tinytest file per wrapper family
- README examples must be deterministic, short, and use bundled `inst/extdata/`

Fixture rules:

- VCF/BCF fixtures should be generated with `test/scripts/vcfpp.R` via `vcfppR`, not handwritten
- record them in `vcfpp_manifest.tsv`
- if new fixtures are needed for SQL tests, document them in `test/scripts/prepare_test_data.sh`
- copy needed fixtures into the R package bundle as required

## Build and vendoring rules

- build scripts must be deterministic and non-interactive
- no network access in the extension build step
- network is allowed only in explicit vendoring scripts
- no vcpkg for CRAN-oriented package builds; use CMake/autotools paths required by the repo
- pin exact upstream versions/commits
- checksum-verify downloads
- support offline rebuilds once sources are fetched
- do not edit vendored code directly; use explicit patch files

## Rduckhts package conventions

Relevant observed package workflow traits:

- package uses roxygen2
- package uses tinytest
- package has custom `configure` and `configure.win`
- package builds vendored `htslib` inside bundled extension assets
- package must stay CRAN compatible

Follow package style already present in `r/Rduckhts/`.

## Native code conventions

### Platform/build layer

Read and respect:

- `r/Rduckhts/configure`
- `r/Rduckhts/configure.win`

These scripts intentionally:

- choose toolchain pieces through `R CMD config`
- distinguish wasm vs non-wasm logic carefully
- keep Windows and Unix handling separate
- manage htslib feature toggles explicitly
- preserve runtime linking behavior intentionally

Do not casually simplify platform conditionals without checking all package targets.

### Porting / rewriting existing tools

When DuckHTS ports or rewrites an existing tool, follow a strict compatibility-rewrite discipline.

This repo explicitly points to `rewrites.bio`-style principles:

- credit the original authors clearly
- emulate the upstream tool exactly for the declared scope
- be explicit about validation scope and pinned upstream version
- build small, validate continuously
- consult pinned upstream mirrors before secondary descriptions

When doing rewrite work:

1. identify the exact upstream tool and pinned version/commit
2. define what must match exactly
3. document what is in scope vs deferred
4. validate against the upstream executable or mirror continuously
5. never silently change semantics while claiming compatibility
6. keep attribution and citation visible in docs

This is especially important for work like:

- mosdepth-compatible coverage
- bcftools-inspired liftover / score / munge behavior
- WisecondorX-style streaming dedup logic

### Rewrite discipline checklist

For an existing-tool port, capture:

- upstream name
- exact version
- exact commit/tag if possible
- local validation date
- exact commands/scripts used for validation
- known unsupported features
- exact output contract that must match

Prefer compatibility-specific files and tests over vague “inspired by” implementations.

## Upstream-mirroring rules

When mirroring external tool behavior:

- consult `.sync/` mirrors first when present
- use upstream source as the primary semantic oracle
- use design docs to record compatibility targets and phased implementation
- if `.sync/` is missing locally, do not invent behavior from memory; note the absence and re-establish the pinned source before making compatibility claims
- for R package references, another useful pattern is generating a single `llm.txt`-style dump with `rdocdump`, so source, documentation, and vignettes can be reviewed together when a full git mirror is unnecessary

## Wasm / webR / browser rules

Wasm support in DuckHTS is special-case and must not be treated like native Linux.

Key rules from repo guidance:

- reproduce wasm failures in the webR container/browser workflow, not from host build directories
- do not assume host-built artifacts are wasm artifacts
- inspect the built `Rduckhts_<Version>.tgz` when debugging package wasm behavior
- preserve wasm-specific linker flags and export requirements
- keep wasm-specific behavior gated on real Emscripten target detection
- do not re-enable host libcurl assumptions on wasm
- treat webR and duckdb-wasm as distinct runtimes with distinct artifacts

If touching:

- `wasm_http_hfile.c`
- wasm loader/export logic
- package wasm build rules
- browser HTTP behavior

then re-read the wasm section in `AGENTS.md` before making changes.

## Domain-specific notes

### CSQ / ANN / BCSQ typing

- builtin typing rules live in `src/vep_parser.c`
- seed from bcftools mirror behavior
- unresolved fields default to `String`
- if you extend rules, update both SQL and R tests

### Coverage / interval work

Phase 10 guidance in `AGENTS.md` matters:

- fixed-width bins use arithmetic
- `cgranges` is for irregular interval joins only
- each counting model should have its own function
- all new coverage functions need R wrappers, `functions.yaml` entries, and benchmarks

### WisecondorX / dedup logic

- `FILE_OFFSET` ordering in `read_bam()` matters for exact streaming order reproduction
- use repo scripts and referenced `RWisecondorX/AGENTS.md` semantics when reproducing larp/larp2 logic

## Recommended working patterns

### For a new public extension function

1. read similar existing C implementation in `src/`
2. read matching SQL tests
3. implement C source and header changes
4. wire build files
5. add/update `functions.yaml`
6. add SQL tests in `test/sql/`
7. add tinytests in `r/Rduckhts/inst/tinytest/`
8. bootstrap R package
9. run package tests
10. update both changelogs

### For an upstream-compatible rewrite

1. read `AGENTS.md`
2. read the relevant design file
3. read `.sync/` upstream mirror first
4. define exact compatibility target
5. implement smallest viable slice
6. validate against upstream output
7. extend scope incrementally
8. document attribution, validation scope, and citations

## Related skills

- For general R package conventions, also load [the R package development skill](../r-package-development/SKILL.md)
- For S7-based R package work, also load [the S7 development skill](../s7-development/SKILL.md)

## References

- [Repo workflow reference](references/repo-workflow.md)
- [Rewrite and porting guidance](references/rewrite-porting.md)
- [Testing checklist](references/testing-checklist.md)
