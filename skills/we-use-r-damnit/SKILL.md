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
A directly invoked local closure (`f <- function(...) ...; f(...)`) deserves
review even when it does more than validate an argument. Keep it when its
lexical state, evaluation timing, callback role, or scoped effects have a
purpose; do not introduce one merely to repackage an operation or evade a
helper warning.

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
between fields, and methods implement behavior. A consumer may use `s7contract`
when it needs a shared behavioral interface across implementations; repeated
syntax alone does not establish that need.
Keep these responsibilities distinct. A new dependency or class needs a semantic
purpose beyond wrapping an ordinary value.

## Validate the contract, then compute

Validate at public admission and trust or representation transitions. Within an
established contract, write the operation rather than checking the same facts
again. Let S7 properties/constructors own structured objects; use a simple
`checkmate` assertion for a plain argument when that dependency is already part
of the package:

```r
labelled <- function(x, label) {
  checkmate::assert_string(label)
  structure(x, label = label)
}
```

Choose checks from the requirement:

| Requirement | Check at its owner |
|---|---|
| Numeric semantics | `is.numeric()` plus the domain restrictions the operation needs, including real-only or class restrictions where relevant. |
| Integer-valued number | Finiteness and integrality; `is.integer()` tests integer type, so it rejects `1` and accepts `1L`. |
| Exact native representation | Native entry points check type, shape, width, and ownership before access; use `typeof()` in R only for a separate R-level contract. |
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
local unless it represents a genuinely shared invariant. When repeated scalar
checks appear across functions in an R package, the optional read-only
[consumer opportunity report](../s7-development/scripts/consumer_opportunities.R)
provides bounded file/line evidence. Resolve the script relative to its skill;
compare callers and the actual admission owner before moving a check into a
constructor, property, or shared helper. Matching predicate names alone do not
establish a shared contract.

## Be Like Charlie Gao

In [nanonext](https://github.com/r-lib/nanonext), R presents sockets and async
operations while C owns native handles, transport, serialization, and cleanup.
Place policy and composition in R; validate representation, width, and lifetime
where native code must rely on them. Reuse the underlying library rather than
rebuilding its machinery. Keep native pointer ownership, failure cleanup, and
calls into that library legible. A short `.Call` wrapper is a consequence of
clear ownership, not a target for every R function.

Choose the failure channel from the consumer contract. An expected, recoverable
transport failure can be a classed error value, distinct from an ordinary
integer result; a pending async operation is a separate state. An adapter such
as a promise can translate that value into a condition. Invalid inputs and
operations without a useful failure value can signal conditions directly.
Do not impose errors-as-values on ordinary R functions or repeat native safety
checks in R without a separate R-level contract.

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

After a behaviorally coherent first pass and affected tests, run the
[anti-slop audit](../r-c-anti-slop/SKILL.md) as a mandatory consistency second
pass on the changed R source (use the package scope when cross-function evidence
matters). Review conditional clause counts and cyclomatic complexity then, not
while designing the operation. Inspect each finding against the contract and
behavior: clarify a genuinely tangled decision, or keep and justify code whose
structure serves it. A warning does not require a score below its threshold.

Splitting conditions or hiding them in helpers, including one-use local closures,
to meet a threshold does not simplify a contract. Direct boolean aliases and
one-use local closures are reviewable syntax, not proof of motive. A clean scan
cannot establish correctness, clarity, or mature R idiom.
