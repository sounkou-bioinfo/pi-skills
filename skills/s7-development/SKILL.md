---
name: s7-development
description: Guides development of R code and packages using S7 classes, generics, methods, validators, properties, compatibility layers, and package integration. Use when designing or maintaining S7-based APIs or migrating S3/S4 code toward S7.
---

# S7 Development

Use this skill when creating or maintaining R code that uses the `S7` package, especially for:

- defining S7 classes with `new_class()`
- defining generics with `new_generic()`
- registering methods with `method()`
- writing validators and properties with `new_property()`
- handling S3/S4 compatibility
- building S7-based R packages

This skill is based on the S7 vignettes in `RConsortium/S7` and current issue patterns in that repository.

## First principles

Prefer S7 when you want:

- formal class definitions
- explicit property validation
- controlled inheritance
- explicit generics and methods
- compatibility with S3 without inheriting all of S3's informality

Key design ideas from S7:

- S7 objects are implemented on top of S3
- classes are formal objects created by `new_class()`
- properties are formal and validated
- dispatch is explicit and simpler than S4
- `super()` is preferred over implicit next-method behavior

## Core workflow

### Define classes

Use `new_class()` and assign the result to an object with the same name as the class:

```r
Person <- S7::new_class("Person", properties = list(
  name = S7::class_character,
  age = S7::class_double
))
```

Important:

- keep the R object name identical to the class name
- define classes before methods that reference them
- if files are sourced in collation order, ensure class definitions are available before method registration

Open issue theme:

- class/method definition order matters in package development and `load_all()` workflows

### Construct objects

Use the generated constructor unless a custom constructor is truly needed:

```r
Person(name = "Ada", age = 37)
```

Prefer the default constructor unless you need:

- non-standard user-facing arguments
- derived property values
- special construction rules

If you write a custom constructor, end with `new_object()`.

### Define properties

Use the short form when class-only constraints are enough:

```r
properties = list(
  name = S7::class_character,
  age = S7::class_double
)
```

Use `new_property()` when you need:

- property-level validation
- defaults
- getters
- setters
- dynamic or computed properties

```r
count_prop <- S7::new_property(
  class = S7::class_double,
  validator = function(value) {
    if (length(value) != 1) "must be length 1"
  }
)
```

Guidance:

- use property validators for single-property constraints
- use class validators for interactions between properties
- do not repeat the property name in property-level validation messages; S7 adds it

### Validate objects

Use class validators for cross-field invariants:

```r
Range <- S7::new_class("Range",
  properties = list(
    start = S7::class_double,
    end = S7::class_double
  ),
  validator = function(self) {
    if (self@end < self@start) {
      "@end must be greater than or equal to @start"
    }
  }
)
```

When mutating multiple interdependent properties, avoid intermediate invalid states by updating them together:

```r
S7::props(x) <- list(start = 2, end = 10)
```

Prefer `props(x) <- ...` over multiple separate `@<-` assignments when temporary invalid states are possible.

## Generics and methods

### Define generics

Create generics with `new_generic()`:

```r
speak <- S7::new_generic("speak", "x")
```

Assign the generic to an object with the same name.

### Register methods

Register methods with `method()`:

```r
S7::method(speak, Person) <- function(x) {
  paste("Hello, I am", x@name)
}
```

Guidance:

- generic and method signatures must be compatible
- the dispatched arguments must be present in the method and must not gain defaults
- methods may add extra arguments only when the generic design allows it

### Dots discipline

Prefer generics with `...` only when needed.

Design guidance from the vignette:

- generic with `...`, method without `...` is often safer
- use method `...` only when recursive forwarding or heterogeneous method interfaces require it
- avoid swallowing misspelled arguments unless there is a strong reason

### Custom generic bodies

Supply a custom generic body only when needed, for example to:

- remove `...`
- add required arguments
- add optional arguments
- validate non-dispatch arguments

A custom generic body must call `S7_dispatch()`.

### Inheritance and `super()`

Use `parent =` to define class hierarchies.
Use `super()` when a subclass method deliberately delegates to a parent-class method.

Prefer explicit `super()` calls over clever or implicit method chaining.

### Multiple dispatch

S7 supports multiple dispatch. Use it deliberately and sparingly.

```r
op <- S7::new_generic("op", c("x", "y"))
```

Useful special classes:

- `class_any()`
- `class_missing()`

Be cautious with missing-argument dispatch because issue traffic shows this area can expose edge cases.

## S3 and S4 compatibility

### S3 interoperability

Remember:

- S7 objects are also S3 objects
- S7 can work with S3 generics and S3 classes
- S7 classes can extend S3 classes
- S3 classes can extend S7 classes

Typical migration path:

- formalize an existing S3 class with `new_class()`
- keep compatibility methods where needed
- avoid rewriting everything at once unless necessary

### S4 interoperability

Remember:

- S7 properties are similar to S4 slots
- S7 does not support multiple inheritance
- S4 unions map to S7 unions differently from S4 dispatch semantics

Use S7 unions mainly as registration/property conveniences, not as a direct mental copy of S4 dispatch behavior.

## Using S7 in a package

### Always register methods in `.onLoad()`

If a package uses S7 methods, add:

```r
.onLoad <- function(...) {
  S7::methods_register()
}
```

This is especially important for methods involving generics from other packages.

### Exported classes

If users should construct your class directly:

- export the class constructor
- document its arguments
- set the `package =` argument in `new_class()` for exported classes so same-named classes from different packages are disambiguated

Example:

```r
Widget <- S7::new_class("Widget",
  package = "yourpkg",
  properties = list(
    x = S7::class_double
  )
)
```

### Package-level namespace details

If your package code uses `@` and you need compatibility with R < 4.3.0, use the package-level raw namespace directive described in the S7 package vignette:

```r
#' @rawNamespace if (getRversion() < "4.3.0") importFrom("S7", "@")
NULL
```

### File ordering and collation

Be aware that S7 package code is sensitive to definition order.

Practical guidance:

- define classes before methods that reference them
- keep foundational generics/classes in files that collate early
- if needed, use file naming or explicit collation conventions to ensure correct load order

This is a recurring issue in real package development.

## Documentation practice

Document:

- classes intended for user construction
- exported generics
- important user-facing constructors and helpers

Current caveats from issue traffic:

- documenting operator-like S7 methods such as `[`, `[<-`, `[[`, and `[[<-` is still awkward
- replacement methods may trigger `R CMD check` warnings in some setups
- package-level guidance for documenting methods is still evolving

So:

- do not assume roxygen2 patterns for standard functions transfer cleanly to all S7 operator methods
- prefer conservative, test-backed documentation changes when working with operator methods
- check existing S7 issues before inventing a workaround

## Current issue patterns to watch

Recent open issues suggest extra caution around:

- defaults and documentation clarity
- validation error classes
- method introspection helpers
- method/class definition order
- missing-argument dispatch behavior
- methods for classes from suggested packages
- replacement methods and `R CMD check`
- documenting special operator methods

When working near these areas, inspect the latest upstream issues before making package architecture decisions.

## Best practices

- keep class and generic object names identical to their declared names
- define classes before methods
- prefer property validators for local checks and class validators for cross-property rules
- prefer the default constructor unless customization is necessary
- use `props()` for multi-property updates
- call `S7::methods_register()` in `.onLoad()`
- export and document user-facing classes and generics
- use `package =` for exported classes
- use `super()` explicitly
- keep compatibility with S3 intentional and minimal
- be conservative with multiple dispatch
- verify package-development edge cases against upstream issues

## References

- [S7 basics](references/s7-basics.md)
- [Classes and objects](references/classes-and-objects.md)
- [Generics and methods](references/generics-and-methods.md)
- [Compatibility](references/compatibility.md)
- [Using S7 in packages](references/packages.md)
- [Issue notes](references/issue-notes.md)
