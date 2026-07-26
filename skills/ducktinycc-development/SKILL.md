---
name: ducktinycc-development
description: Guides development in DuckTinyCC: in-memory TinyCC state and relocated artifact lifetime, generated scalar-UDF wrappers, recursive DuckDB/C descriptors, embedded runtime assets, trusted native-code boundaries, allocator domains, SQL stability, source-split conventions, upstream precedents, and extension/community tests. Use when working in sounkou-bioinfo/DuckTinyCC.
---

# DuckTinyCC Development

Use this skill for the DuckTinyCC repository. Also load `sounkou-engineering-style`.

## Reconcile guidance with the current tree

Read:

1. `AGENTS.md`
2. the top development section of `NEWS.md`
3. `docs/LIFETIME_OWNERSHIP.md`
4. `docs/C_FUNCTION_DOCS.md`
5. `README.Rmd`, `Makefile`, `CMakeLists.txt`, `description.yml`
6. relevant `src/tcc_module_*.inc`, `src/tcc_module.c`, and `test/sql/tcc_module_modes.test`
7. `.sync/Rtinycc` for TinyCC/runtime precedents and `.sync/duckhts` for DuckDB C extension patterns

`AGENTS.md` contains dated progress snapshots. Current source, release metadata, NEWS, and tests override stale status text. In particular, do not encode old Windows exclusions or old monolithic-source assumptions without checking current CMake and `description.yml`.

## Runtime model

- `tcc_new_state` resets staged session inputs and increments the logical state id; it does not allocate a `TCCState`.
- Compile/codegen paths create a real `TCCState`, apply staged paths/options/includes/defines/sources/symbols, compile, relocate in memory, find module init, and register generated UDFs.
- Relocated code remains valid only while its owning `TCCState` artifact remains alive.
- On error, destroy the TCC state immediately. On replacement/shutdown, registry or module-state destruction owns `tcc_artifact_destroy`.
- SQL registration metadata and compiled-artifact lifetime must move together; never leave a function pointer into deleted relocated code.

The split `tcc_module_*.inc` files are focused implementation sections included by one translation unit. Preserve this where it keeps shared private state and compile structure honest; do not turn it into a fake object hierarchy or multiply external symbols merely to satisfy a file-count rule.

## Generated wrapper and descriptor contract

Generated wrappers unpack DuckDB values, call the target C symbol, and write results through the recursive typed descriptor bridge.

- Descriptor structs for LIST, ARRAY, STRUCT, MAP, and UNION are borrowed views into DuckDB vector storage plus bounded bridge scratch. Generated code never frees or retains their fields after the call.
- Preserve DuckDB UNION physical layout: tag child first, member children after it.
- Empty descriptor semantics, NULL validity, offsets, and global versus row-local indexing are API contracts; add recursive and NULL tests when changing them.
- Wrapper mode names describe the real ABI. `chunk_scalar_loop` is a chunk-local scalar loop, not Arrow or a table batch ABI.
- Function stability is explicit. Side-effecting, allocating, freeing, mutating, or pointer-backed helpers are volatile; pure metadata helpers may be consistent.
- Use table/X-macro authority for repeated type traits or helper registration where it prevents drift, but do not abstract one-off control flow.

## Ownership and heaps

DuckTinyCC has distinct allocator domains:

- DuckDB heap: extension state, metadata, generated source, bind/init payloads, bridge scratch
- libc heap: pointer-registry allocations and generated helper allocations
- libtcc internal ownership: compiler state and relocated artifact

Never cross deallocators. Document ownership transfer, allocator, stack bounds, thread safety, locks, and error surface on critical C boundaries using `docs/C_FUNCTION_DOCS.md` tags.

Pointer registry handles are caller-owned and explicitly freed. Reads/writes are bounds-checked. A raw address from `tcc_dataptr` is an unsafe value, not a lifetime extension.

## Trusted native-code boundary

Generated C runs in the DuckDB process and is not sandboxed.

- Default `-nostdlib` avoids implicit libc resolution and improves self-contained deployment; an include or `extern` declaration does not link a symbol.
- Explicit libc linking, injected callbacks, inline assembly, syscalls, `exit`, `abort`, or non-local control transfer can terminate or corrupt DuckDB.
- Ordinary R callback examples use protected R evaluation for R errors, but that does not contain arbitrary native control flow.
- True containment requires an external process boundary. Do not promise in-process safety for hostile C.

Run dangerous control-flow probes only through the repository's opt-in subprocess script.

## Embedded runtime assets

CMake generates embedded `libtcc1.a` and runtime/header/import-definition asset arrays. First use extracts them to a content-hash-keyed temporary tree.

- Asset relative paths are part of the manifest and may include subdirectories.
- The content key covers the archive plus all manifest names and bytes; otherwise an old extraction tree can be reused incorrectly.
- Set the extracted lib path before TinyCC output-type setup so `{B}` include paths resolve correctly.
- Do not depend on system development headers for the deployed community artifact.
- Keep extraction thread-safe, bounded, diagnosable, and reusable across processes.

Generated embedded C is a build artifact; change source assets or the CMake generator, not generated output.

## Public API and release discipline

- Public SQL names use `tcc_*`; current main entry is `tcc_module(...)` plus documented helpers.
- Pre-1.0 cleanup may break behavior when it removes incorrect complexity, but the change must be explicit in the top `NEWS.md` development section.
- Public docs describe implemented modes and canonical type grammar only.
- `README.md` is generated from `README.Rmd` with the repository renderer; inspect runnable output.
- Check actual version authority and community metadata before changing versions. Do not copy dated version examples from `AGENTS.md`.

## Validation

Focused and normal extension gates:

```bash
make debug
make test_debug
make release
make test_release
```

Deployment/runtime gates:

```bash
make test_embedded_release
make community_sim
```

Documentation:

```bash
make rdm
```

Use `scripts/test_unsafe_udf_control_flow.sh` only when the trusted-native boundary is the task, and run it as a subprocess so expected termination cannot kill the development harness.

For parser, bridge, or codegen changes, add SQL coverage for canonical scalar types, recursively nested composites, NULL/empty cases, malformed tokens/source, duplicate SQL names, wrapper modes, and lifecycle replacement. Finish with NEWS, generated README review, and `git diff --check`.
