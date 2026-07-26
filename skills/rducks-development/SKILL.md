---
name: rducks-development
description: Guides development in the Rducks R package and bundled DuckDB C extension, including strict execution plans, R-thread and SEXP ownership, direct versus Quack/NNG worker marshalling, exact DuckDB unstable-ABI artifacts, runtime capability probes, generated catalogs, wasm, and tarball-based tinytest/check workflows. Use when working in sounkou-bioinfo/Rducks.
---

# Rducks Development

Use this skill for the Rducks repository. Also load `sounkou-engineering-style` and `r-package-development`.

## Read before editing

1. `AGENTS.md`
2. `docs/ARCHITECTURE.md`
3. `docs/EXECUTION_PLANS.md`
4. `docs/SUPPORT_MATRIX.md`
5. `docs/BUILD.md` for extension or ABI work
6. `docs/WASM.md` for webR/wasm work
7. relevant `R/`, `tools/ext/`, and `inst/tinytest/` files
8. `Makefile`, `configure`, and `configure.win` before build changes

The code-level support predicates and generated marshalling matrix are the type/plan truth. Architecture docs explain the contract; do not copy a changing type inventory into this skill.

## Layer ownership

- R validates package arguments, creates normalized descriptors/specs, records connection-local defaults, prepares evaluator wrappers, and owns local worker-provider setup.
- The extension owns DuckDB catalog registration, database-scoped runtime records, native callbacks, execution backends, queues, counters, and NNG client pools.
- DuckDB SQL type, NULL, error, and result semantics remain canonical in native code. R selects and validates plans; it does not redefine SQL semantics.

Keep function kind, R evaluation mode, and execution plan distinct:

- function kind: scalar UDF, aggregate, or table function
- scalar-UDF mode: row-wise `scalar` or chunk-wise `vectorized`
- execution plan: marshalling plus concurrency, currently public `inproc` or `ipc`

## Strict-plan rule

A scalar UDF freezes its evaluator and marshalling metadata at registration. Later plan changes affect future registration and matching runtime settings, not existing UDF semantics.

Unsupported combinations fail. Never silently change:

- direct to wire or wire to direct
- vectorized calls to row-wise calls
- NNG worker execution to same-process execution
- Quack bytes to R serialization
- an exact DuckDB ABI artifact to a nearby version

Use diagnostics and counters to prove the selected engine actually ran.

## Thread and lifetime rules

- DuckDB worker threads never call the R API.
- In-process R work occurs only on the recorded R thread. The extension-owned queue serializes callbacks there; it is not parallel R execution.
- Borrowed DuckDB vectors and chunks are callback-local.
- Borrowed or transient `SEXP`s do not cross to a worker thread.
- Preserve R evaluator objects while native catalog metadata can call them. Release on safe R-thread paths; if a native destructor is unsafe, queue release or leak conservatively rather than call `R_ReleaseObject()` off-thread.
- A queued cross-thread request carries owned native input and result state.
- Quack payloads are owned bytes only at an intentional process boundary.
- `rducks_release(con)` clears an attachment; it does not unregister database-catalog functions still visible to sibling connections.

## Runtime capability and ABI discipline

Rducks uses required unstable C API slots, so it builds one exact `C_STRUCT_UNSTABLE` extension artifact per version declared in `tools/ext/duckdb_capi/versions.txt`.

- Vendored headers, version manifest, metadata footer, runtime `SELECT version()`, and installed artifact path must agree exactly.
- Unsupported DuckDB versions fail before `LOAD`; no patch-version fallback.
- Do not label an artifact stable while calling unstable slots.
- Keep `RDUCKS_DUCKDB_VERSIONS` for reduced developer builds only; release builds include every declared version.
- Runtime-dependent layouts such as `VARIANT` are enabled by a canonical logical-type and real physical-vector probe. Version identity alone is not a capability test. Fail closed when the probe disagrees.
- Keep generated unstable-API reporting aligned with actual calls.

Header and native dependency refreshes are explicit vendoring operations:

```bash
Rscript tools/fetch_duckdb_headers.R --ref vX.Y.Z
Rscript tools/vendor_nng_mbedtls.R --force
```

Inspect and retain provenance/hash metadata. Do not fetch during package compilation.

## Direct and worker data planes

- `direct`: materialize DuckDB vectors directly to/from R on the recorded R thread.
- `wire`/`ipc`: DuckDB chunk to owned Quack bytes to persistent NNG R worker to owned result bytes to DuckDB output.
- Quack is a declared DuckDB BinarySerializer subset, not Arrow and not R serialization.
- Same-host mori sharing currently applies only to selected long-lived globals. Do not claim SQL chunk shared-memory handles without an implemented capability.

Do not revive removed Arrow-era plan axes unless a new, measured contract requires them.

## Generated and authored files

- Edit roxygen in `R/`; never hand-edit `man/*.Rd` or generated `NAMESPACE` content.
- Run `make catalog` after changing the documented public surface; inspect `inst/function_catalog/`.
- Edit `README.Rmd`, then run `make rdm`; inspect `README.md` as a reader.
- Add concise user-visible entries to the top development section of `NEWS.md`.
- Dev/test SQL probes remain gated by `RDUCKS_DEV_SURFACES=true`; do not leak them into production registration.

## Validation

The package Makefile builds a tarball, installs it into a temporary library, and runs tinytest with development surfaces enabled:

```bash
make test
make check
```

Use focused tests under `inst/tinytest/` while iterating, especially:

- execution plan and engine selection
- exact extension version selection
- direct scalar/vector paths
- Quack round trip and malformed payloads
- wire support contract
- runtime-gated `VARIANT`
- lifecycle/release behavior

For docs and generated surfaces:

```bash
make rd
make catalog
make rdm
```

Wasm/webR is a distinct artifact and runtime. Use the repository browser/container harness and inspect the built package payload; do not infer wasm behavior from host objects.
