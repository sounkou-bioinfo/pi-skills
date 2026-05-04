# S7 Basics

Based on `vignettes/S7.Rmd` from `RConsortium/S7`.

## Core ideas

- S7 provides formal classes, generics, and methods
- Objects are created from class objects returned by `new_class()`
- Properties are declared formally
- Methods are registered with `method()`
- Inheritance dispatches up the parent chain

## Minimal example

```r
Dog <- S7::new_class("Dog", properties = list(
  name = S7::class_character,
  age = S7::class_numeric
))

speak <- S7::new_generic("speak", "x")
S7::method(speak, Dog) <- function(x) "Woof"

lola <- Dog(name = "Lola", age = 11)
speak(lola)
```

## Important convention

Keep the R object name the same as the class or generic name.
