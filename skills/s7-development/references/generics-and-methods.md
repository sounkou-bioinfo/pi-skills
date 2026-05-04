# Generics and Methods

Based on `vignettes/generics-methods.Rmd` from `RConsortium/S7`.

## Main tools

- `new_generic()`
- `method()`
- `S7_dispatch()`
- `super()`
- `class_any()`
- `class_missing()`

## Signature rules

- Methods must include the generic's dispatched arguments
- Dispatched arguments must not gain defaults in methods
- Extra method arguments are only appropriate when the generic interface allows them

## Dots guidance

- Prefer method signatures that do not silently swallow misspelled arguments
- Use `...` only when forwarding behavior or heterogeneous interfaces require it

## Custom generics

Custom generic bodies are useful when you need to:

- omit `...`
- require extra arguments
- add optional named arguments
- validate arguments before dispatch

Every custom body must call `S7_dispatch()`.

## Dispatch guidance

- Prefer single dispatch by default
- Use multiple dispatch deliberately
- Use `super()` explicitly for parent-class delegation
