# Runtime Layering Checklist

Use this checklist when sketching a new extension architecture.

## Questions to answer early

- What is the minimal SQL surface for phase 1?
- Which objects are per-database versus per-session?
- Which APIs are most likely to churn across DuckDB versions?
- Which heavy operations must not run inside callbacks?
- What is the exact shutdown order?

## Suggested layering rule

Put volatile or external-facing calls behind thin adapters, then keep the rest of the codebase talking to your own internal interfaces.

## Suggested shutdown order

1. mark runtime/service as shutting down
2. stop accepting new work
3. signal workers
4. join workers
5. destroy active sessions/results/statements
6. free transport objects
7. free registries and buffers
