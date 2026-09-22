# Deterministic Testing Rules

- every SQL test file should be self-contained
- load the extension explicitly
- use `ORDER BY` for multi-row results unless sort-insensitive checking is deliberate
- avoid raw time/session/thread assertions
- prefer explicit cleanup helpers over `sleep`
- for large results, use counts, aggregates, or hashes instead of giant literals
