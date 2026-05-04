# Classes and Objects

Based on `vignettes/classes-objects.Rmd` from `RConsortium/S7`.

## Main tools

- `new_class()`
- `new_property()`
- `validate()`
- `props()`
- `new_object()`

## Guidance

- Use property validators for single-field constraints
- Use class validators for relationships between properties
- Use `props(x) <- ...` when updating multiple interdependent properties
- Prefer the default constructor unless you need special construction semantics
- Custom constructors must end in `new_object()`

## Property features

`new_property()` can define:

- `class`
- `validator`
- `default`
- `getter`
- `setter`

## Typical patterns

- required properties
- frozen/read-only properties
- deprecated properties via getter/setter shims
- computed properties
- dynamic read-write properties
