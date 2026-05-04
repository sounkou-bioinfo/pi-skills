# Issue Notes for S7 Development

Sampled from open issues in `RConsortium/S7`.

## Patterns worth knowing

### Definition order matters

Issue `#588`: class and method definition order can matter during package load or `load_all()`.

Practical implication:
- define classes before methods that reference them
- be aware of file collation order

### Suggested-package methods are non-trivial

Issue `#573`: registering methods for classes from suggested packages needs care around load hooks and delayed registration.

Practical implication:
- inspect `.onLoad()` strategy carefully
- avoid assuming optional-package methods are trivial to wire up

### Operator method documentation is awkward

Issue `#562`: documenting methods for `[`, `[<-`, `[[`, and `[[<-` can be awkward with roxygen2 and `R CMD check`.

Practical implication:
- prefer conservative changes
- verify with package checks
- review upstream issues before finalizing a pattern

### Replacement-method checks can be noisy

Issue `#569`: replacement methods may trigger `R CMD check` warnings.

Practical implication:
- test replacement-method documentation and signatures carefully

## Other recent issue themes

- defaults and docs clarity (`#603`)
- validation error class requests (`#602`)
- introspection helpers (`#594`, `#597`)
- missing-argument dispatch (`#595`)
- base matrix dispatch edge cases (`#572`)
