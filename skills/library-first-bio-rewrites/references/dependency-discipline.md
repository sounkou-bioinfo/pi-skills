# Dependency Discipline

Dependency choice is an architectural decision.

## Costs of dependency bloat

- harder vendoring
- harder CRAN packaging
- larger binaries
- more transitive breakage risk
- more auditing burden
- more difficult wasm/HPC/offline deployment

## Before adding a dependency

Ask:

- is the capability already available in existing trusted libraries?
- is this dependency essential or merely convenient?
- can it be vendored and audited sanely?
- does it fit the target deployment environments?

Prefer fewer, better-understood dependencies over novelty for its own sake.
