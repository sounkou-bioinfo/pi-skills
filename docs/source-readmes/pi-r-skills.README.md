# pi-r-skills

Pi skills for R package development, including project-native workflows plus optional fast formatting with `air`, linting with `jarl`, and CRAN-facing review guidance informed by the CRAN Cookbook.

## Install

```bash
pi install git:github.com/sounkou-bioinfo/pi-r-skills
```

Pin a specific release:

```bash
pi install git:github.com/sounkou-bioinfo/pi-r-skills@v0.4.0
```

## Included skills

- `r-package-development`
- `s7-development`
- `duckhts-development`
- `duckhts-rewrite-porting`
- `duckhts-wasm-debugging`

## When to use `duckhts-development`

Load `duckhts-development` when you are:

- working in `RGenomicsETL/duckhts`
- changing DuckDB extension code under `src/`
- changing the bundled R package under `r/Rduckhts/`
- adding public functions that require `functions.yaml`, SQL tests, and tinytests
- touching wasm/webR build logic
- porting existing genomics tools into DuckHTS with exact-compatibility goals

## When to use `duckhts-rewrite-porting`

Load `duckhts-rewrite-porting` when you are:

- porting an existing genomics tool into DuckHTS
- targeting exact compatibility with a pinned upstream version
- validating against upstream outputs or behavior
- working on mosdepth-, bcftools-, or WisecondorX-aligned logic
- documenting attribution, validation scope, and citation requirements

## When to use `duckhts-wasm-debugging`

Load `duckhts-wasm-debugging` when you are:

- debugging DuckHTS in webR
- debugging DuckHTS in duckdb-wasm
- checking wasm symbol exports or loader ABI issues
- working on `wasm_http_hfile.c` or Emscripten-specific build logic
- investigating browser runtime vs package-artifact mismatches

## When to use `s7-development`

Load `s7-development` when you are:

- defining S7 classes with `S7::new_class()`
- defining S7 generics or methods with `S7::new_generic()` and `S7::method()`
- writing validators, properties, getters, or setters
- integrating S7 into an R package
- dealing with S3/S4 compatibility or migration toward S7
- debugging package issues around method registration, collation order, or S7 documentation

## Update

If you installed the unpinned git package, update with:

```bash
pi update
```

Or update just this package explicitly:

```bash
pi update git:github.com/sounkou-bioinfo/pi-r-skills
```

If you installed a pinned tag, move to the new release explicitly:

```bash
pi install git:github.com/sounkou-bioinfo/pi-r-skills@v0.4.0
```

## Development

See [CHANGELOG.md](CHANGELOG.md) for release history.

This repo is a Pi package. Pi auto-loads skills from `skills/`, and `package.json` declares the package explicitly under the `pi` key.
