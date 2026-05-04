# Binding Design Notes

## Prefer narrow native interfaces

Good boundaries often use:

- plain structs
- explicit buffers
- clear ownership transfer
- simple status/error returns

## Keep layers separate

- native layer: core semantics and performance
- wrapper layer: host-language ergonomics
- docs/tests: show exactly what gets converted where

## Portability questions

- Will this still package cleanly on CRAN?
- Will it work in HPC or offline installs?
- Can it be compiled to wasm if needed?
