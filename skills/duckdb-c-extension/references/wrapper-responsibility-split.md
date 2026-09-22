# Wrapper Responsibility Split

## Native layer owns

- SQL semantics
- heavy computation
- transport or file parsing
- memory-sensitive logic
- compatibility shims

## R layer owns

- package installation/load ergonomics
- friendly helper names
- argument translation from R types
- docs/examples for R users
- wrapper-level tests
