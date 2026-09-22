# State Ownership Patterns

## Useful ownership scopes

- **process-global**: only for registries that must span multiple loads, and even then key them carefully
- **per-database**: preferred for extension runtime state
- **per-service**: listeners, worker pools, session maps, transport handles
- **per-session**: connection, prepared statement, pending/result state, cached schema
- **per-request**: parsed payloads, temporary buffers, transient chunks

## Rule of thumb

If two threads may touch the same object, its ownership and lock discipline should be explicit in the struct definition or close to it.
