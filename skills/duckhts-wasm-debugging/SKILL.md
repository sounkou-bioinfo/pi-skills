---
name: duckhts-wasm-debugging
description: Debug DuckHTS in webR, browser workers, Emscripten, or duckdb-wasm. Use when the failing artifact or runtime is wasm rather than native host DuckDB/R.
---

# DuckHTS wasm debugging

## Runtime identity

Distinguish:

- host build artifacts;
- the built `Rduckhts_<Version>.tgz` used by webR;
- a webR package runtime;
- a duckdb-wasm extension side module and worker/browser runtime.

Reproduce in the actual target runtime and inspect the artifact actually loaded there. A host `.Rcheck` file with a wasm-looking name is not evidence.

## Checks

- Preserve Emscripten linker flags and DuckDB init-symbol exports.
- Verify the wasm export section; `strings` or a symbol table alone is insufficient.
- Gate wasm behavior on real Emscripten target detection.
- Keep the canonical socket/i64 compatibility shim in `src/include/wasm_socket_compat.h`.
- Keep htslib curl/S3/GCS disabled unless the browser transport model changes.
- Browser HTTP uses `src/wasm_http_hfile.c`: same-origin works; remote URLs require CORS; proxy environment variables do not control XHR/fetch.
- Validate packaging, worker loading, SQL execution, and error reporting, not only compilation.

Do not diagnose an init-export failure as package installation success, or webR behavior as proof for duckdb-wasm. Follow the repository's browser/container workflow and then run the ordinary DuckHTS package gates for shared code.
