# Using S7 in Packages

Based on `vignettes/packages.Rmd` from `RConsortium/S7`.

## Required package practice

Always register methods in `.onLoad()`:

```r
.onLoad <- function(...) {
  S7::methods_register()
}
```

## Exported classes

If users construct your class directly:

- export it
- document it
- set `package = "yourpkg"` in `new_class()`

## Pre-R-4.3 support for `@`

If package code uses `@`, the vignette recommends:

```r
#' @rawNamespace if (getRversion() < "4.3.0") importFrom("S7", "@")
NULL
```

## Documentation caveat

Method documentation guidance is still evolving upstream.
