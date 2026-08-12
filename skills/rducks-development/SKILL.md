---
name: rducks-development
description: Work in sounkou-bioinfo/Rducks on execution plans, R-thread/SEXP ownership, direct and Quack/NNG marshalling, exact DuckDB ABI artifacts, capability probes, generated catalogs, wasm, and package gates.
---

# Rducks development

## Ownership

Read repository instructions first. R owns user-facing admission and orchestration; native code owns execution and marshalling. R API calls and SEXP mutation/allocation remain on the R thread. Protect values across allocation and never retain borrowed R memory beyond its contract.

`rducks_release(con)` clears an attachment; it does not unregister database-catalog functions still visible to sibling connections.

## Plan and ABI

Freeze a strict execution plan at registration. Do not silently substitute a different plan, data plane, or DuckDB ABI later. Exact per-version unstable artifacts are part of identity; fail before `LOAD` when the required artifact is absent or incompatible.

Use runtime capability probes for optional types/features such as `VARIANT`; version strings are not sufficient. Keep direct in-process transport distinct from Quack/NNG worker marshalling and test both where claimed. `RDUCKS_DUCKDB_VERSIONS` limits reduced developer builds to a subset of declared versions (release builds still include every declared version); `RDUCKS_DEV_SURFACES=true` gates dev/test SQL probes so they do not leak into production registration.

Generated catalogs/docs derive from their authority; authored R files remain authored. Keep wasm artifacts and runtime assumptions separate from native package builds.

## Gates

Use current repository commands, normally covering:

- package tests and tarball check;
- generated R documentation and catalog drift;
- README rendering;
- direct and worker data planes;
- exact ABI/load failures;
- wasm harness where touched.

Generic R package mechanics belong to `r-package-development`; this skill owns Rducks-specific plan, thread, ABI, and transport contracts.
