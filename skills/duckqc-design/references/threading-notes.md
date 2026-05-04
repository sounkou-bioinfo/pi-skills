# DuckQC Threading Notes

Potential good pattern:

- immutable shared annotation/index state
- per-thread readers
- per-thread accumulators
- explicit reduction step

Questions:

- do outputs require deterministic order?
- can metrics be reduced associatively?
- does the host table-function lifecycle support the needed phases cleanly?
