---
name: duckhts-wasm-debugging
description: Guides wasm, webR, and duckdb-wasm debugging for DuckHTS, including artifact verification, symbol/export checks, browser-runtime constraints, and package-vs-runtime distinctions. Use when debugging DuckHTS in webR, browser wasm, or duckdb-wasm environments.
---

# DuckHTS Wasm and webR Debugging

Use this skill when debugging DuckHTS in:

- webR
- browser worker runtimes
- duckdb-wasm
- Emscripten/wasm package builds

This is a specialized skill because DuckHTS wasm behavior is intentionally different from native Linux/macOS builds.

## Mandatory first reads

1. `AGENTS.md`
2. `r/Rduckhts/configure`
3. relevant wasm-related source files, especially:
   - `src/wasm_http_hfile.c`
   - `src/include/wasm_socket_compat.h`
4. any local harness scripts mentioned in repo guidance

## Core runtime distinctions

Always distinguish between:

- host/native build artifacts
- webR package artifacts
- duckdb-wasm side-module artifacts

Do not assume results from one runtime apply to another.

## Practical rules

- reproduce wasm package failures in the webR container/browser workflow, not from host build directories
- do not assume `inst/duckhts_extension/build/` in the repo is a real wasm payload
- for package wasm debugging, inspect the built `Rduckhts_<Version>.tgz`
- for duckdb-wasm harness debugging, inspect the actual side-module artifact loaded by duckdb-wasm

## Symbol/export checks

When a wasm extension fails to load:

- inspect symbol presence
- inspect actual wasm exports
- do not stop at `strings` or symbol-table presence alone

A symbol may exist in the module but still not be exported for the loader.

For init-symbol failures, confirm that the required DuckDB init symbol is actually exported.

## Linker/ABI rules

- preserve Emscripten-specific linker flags in final wasm extension linking
- keep wasm behavior gated on real Emscripten target detection
- do not let wasm workarounds leak into non-wasm targets
- treat BigInt / exception / side-module ABI flags as part of runtime compatibility, not optional cleanup

## Networking rules on wasm

DuckHTS repo guidance currently treats wasm networking carefully:

- do not re-enable host `pkg-config` curl assumptions for wasm
- do not assume host Linux curl headers mean usable wasm curl support
- keep browser HTTP behavior aligned with the repo’s `wasm_http_hfile.c` strategy unless runtime assumptions have changed
- respect browser constraints such as same-origin and CORS behavior

## Browser/runtime debugging checklist

When debugging a load/runtime problem:

1. identify the exact runtime: webR vs duckdb-wasm
2. identify the exact payload file actually loaded
3. confirm target detection path used during build
4. inspect export section for required init symbol
5. inspect wasm-specific link flags in final link step
6. verify whether the issue is loader ABI, runtime networking, or file registration
7. compare against known-good local harness behavior

## Things not to misdiagnose

Repo guidance notes that some browser-side warnings can be noisy but non-fatal. Do not confuse unrelated browser console noise with the root cause if the extension loads and HTS smoke tests pass.

## Related skills

- [DuckHTS development](../duckhts-development/SKILL.md)

## References

- [DuckHTS repo workflow](../duckhts-development/references/repo-workflow.md)
