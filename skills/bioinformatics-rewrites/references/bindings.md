# Bindings

## Narrow native interfaces

Good boundaries use:

- plain structs;
- explicit buffers;
- clear ownership transfer;
- simple status/error returns.

Keep the native layer for core semantics and performance, the wrapper layer for
host-language ergonomics, and docs/tests that show exactly what is converted where.

## Portability questions

- Will this still package cleanly on CRAN?
- Will it work in HPC or offline installs?
- Can it be compiled to wasm if a real consumer needs it?

## Wrapper validation

A proven native core does not guarantee a correct binding layer. Validate:

- type conversions;
- indexing conventions;
- string and encoding behavior;
- ownership and lifetime rules;
- null/missing handling;
- host-specific error reporting.
