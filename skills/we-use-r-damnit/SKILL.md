---
name: we-use-r-damnit
description: Apply whenever writing, editing, reviewing, or generating R code, including package code, scripts, tests, and executable Rmd examples. Use R-native vectors, functions, dispatch, lexical environments, and language objects with contract-directed validation.
---

# We Use R Damnit

Write R that an experienced R programmer would recognize: express the computation
in R's native abstractions, establish each necessary contract at its owner, and
keep the operation visible. The target is mature R, not Python or TypeScript
transliterated into R syntax, and not merely a low lint score.

Follow the repository's behavior, dependencies, and object-system contracts.
Use these examples as idioms, not templates to paste into every function.

## Values and operations first

Start with vectors, lists, functions, and existing operations. State the
computation directly:

```r
center <- function(x) {
  x - mean(x)
}
```

Here missing values propagate through `mean()`. Choose a different missing-value
policy only when the interface calls for it. Preserve names, dimensions, classes,
and zero-length behavior when they are part of the contract. Make recycling and
dimension dropping deliberate.

Use `lengths()`, `lapply()`, `vapply()`, `Map()`, or a reduction when they express
the operation. Use a clear preallocated loop when the work is sequential or the
loop is easier to understand. Vectorization is not a reason to allocate an
unnecessary large intermediate. Use `seq_along()` for possibly empty inputs.

## Functions and lexical scope

A function names a coherent operation. A helper earns its place by clarifying
that operation or owning a repeated named invariant. Keep simple local
expressions local; avoid forwarding layers and miniature validation frameworks.

Closures capture configuration naturally. This reusable shift captures the
offset's value at construction:

```r
shift_by <- function(offset) {
  force(offset)
  function(x) x + offset
}
```

Force captured arguments when that eager capture is the contract. Otherwise
respect R's promises and evaluation order. Use environments for genuine identity
or mutable state, with ownership and lifetime explicit. Ordinary values and
functional updates remain the default.

## Code is structured data

Use symbols, calls, expressions, formulas, and lexical environments when code
itself is the domain. Construct a call as a call:

```r
expr <- call("log", as.name("x"), base = 10)
result <- eval(expr, envir = list(x = 100), enclos = baseenv())
```

Use `quote()`, `substitute()`, `bquote()`, or the project's expression tooling
according to whether the job is capture, substitution, or construction. Preserve
argument names and language structure. Assemble language objects rather than
executable strings; parse actual source text with the appropriate parser.

An expression captured from a caller may need its lexical environment. Preserve
that context with a closure, formula, or the project's quosure convention.
`eval()` is not a sandbox: evaluating untrusted expressions requires a separate
security design.

Homoiconic, lispy style means composition and first-class functions and language
objects. It does not require metaprogramming where an ordinary function suffices.

## Semantic objects and dispatch

Use a class when a semantic kind of value changes behavior. Use generics and
methods for class-dependent operations rather than repeated class switches.
Respect established S3/S4 APIs; for S7 work, apply the
[S7 contract](../s7-development/SKILL.md).

In S7, properties own field constraints, object validators own relationships
between fields, and methods implement behavior. External interface admission
belongs to the project's admission mechanism, such as `s7contract` where used.
Keep these responsibilities distinct. A new dependency or class needs a semantic
purpose beyond wrapping an ordinary value.

## Validate the contract, then compute

Validate at public admission and trust or representation transitions. Within an
established contract, write the operation rather than checking the same facts
again. A simple public argument can have a simple guard:

```r
labelled <- function(x, label) {
  if (!is.character(label) || length(label) != 1L || is.na(label)) {
    stop("`label` must be one non-missing string.", call. = FALSE)
  }
  structure(x, label = label)
}
```

Choose checks from the requirement:

| Requirement | R mechanism |
|---|---|
| Numeric semantics | `is.numeric()` plus the domain restrictions the operation needs, including real-only or class restrictions where relevant. |
| Integer-valued number | Finiteness and integrality; `is.integer()` tests integer type, so it rejects `1` and accepts `1L`. |
| Exact native representation | `typeof()` plus the required shape, class, width, and ownership checks. |
| Class membership | The object system's membership predicate, such as `inherits()` for S3; use dispatch for behavior. |
| Scalar cardinality | `length(x) == 1L` where the interface actually requires a scalar. |
| Missing values | `is.na()` for a known scalar, `anyNA()` for a vector, or the operation's explicit missing-value policy. |

Separate type, cardinality, and domain only as far as needed for safe evaluation
and useful errors. Use short-circuit `||`/`&&` for scalar guards; use vector
predicates and an intentional reduction for vector contracts.

For ordinary numeric values, `!is.finite(x)` already rejects `NA`, `NaN`, and
infinities. Do not add an `is.na()` check for the same rejection. Check integer
range when representability matters, such as conversion to an R integer or a
native width. Coercion is an explicit API decision, not validation;
`suppressWarnings(as.integer(x))` is banned.

Use the existing admission library for substantial schemas. Keep a small guard
local unless it represents a genuinely shared invariant. R-side admission does
not replace C-side memory-safety, allocation, width, or lifetime checks at a
native entry point.

## Errors and effects have owners

Let R, DBI, and underlying operations report errors when they already express
the contract. Add handling for meaningful context, cleanup, translation, or a
specified recovery. Preserve failure semantics: `NULL`, an empty vector, and a
guessed default are different results, not interchangeable error recovery.

Keep I/O and mutation explicit. Register `on.exit(..., add = TRUE)` after resource
acquisition and restore any temporary options or process state. Use targeted
condition handling only for an identified condition with a defined response.

## Review the computation, not its cosmetic score

Read the function as an R program: is the operation visible, are its semantics
preserved, and does each check or abstraction have an owner and purpose?

Test public results, meaningful invalid inputs, and the relevant empty,
missing-value, attribute, dispatch, evaluation-environment, or lifetime cases.
State final behavior in test names and assertions. Use the project's formatter
and linter for mechanics, not as the definition of good design.

Treat anti-slop diagnostics as review evidence. Splitting conditions or hiding
them in helpers to meet a threshold does not simplify a contract. A clean scan
cannot establish correctness, clarity, or mature R idiom.
