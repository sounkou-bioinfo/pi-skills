# SQL and Interop Test Pyramid

## Suggested weighting

- many SQL-level regression tests
- some native/unit tests for parsers and ownership-sensitive helpers
- some wrapper tests
- a focused set of end-to-end interop tests

## Why

DuckDB extensions often fail at boundaries: SQL registration, memory ownership, wrapper argument translation, and real transport behavior.
