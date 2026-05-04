# DuckTinyCC Case Study: Using the DuckDB Database and Connection Objects at Extension Init

This note distills one useful pattern from `DuckTinyCC`.

## Source location

At the time this skill was written, the relevant logic lived in:

- `DuckTinyCC/src/ducktinycc.c`

Key details visible there:

- the extension uses `DUCKDB_EXTENSION_ENTRYPOINT_CUSTOM(...)`
- it obtains the database handle from `access->get_database(info)`
- it stores a per-database registry entry keyed by `duckdb_database`
- it opens a persistent DuckDB connection with `duckdb_connect(database, &entry->connection)`
- it registers its SQL module surface exactly once per database

## Why this pattern matters

This is a good example of a generic extension-init pattern when the extension needs more than one transient registration callback.

Instead of treating init as a one-shot place to register functions and forget state, DuckTinyCC treats init as the place to:

1. identify the owning database instance
2. key extension-managed runtime state by that database
3. create or reuse a persistent host connection for extension-managed registration/runtime work
4. make registration idempotent per database

## Simplified shape

The logic is roughly:

```c
DUCKDB_EXTENSION_ENTRYPOINT_CUSTOM(duckdb_extension_info info,
                                   struct duckdb_extension_access *access) {
    duckdb_database database = NULL;

    if (access && info) {
        duckdb_database *db_ptr = access->get_database(info);
        if (db_ptr) {
            database = *db_ptr;
        }
    }

    if (!database) {
        access->set_error(info, "failed to get database handle");
        return false;
    }

    // look up/create per-database registry entry
    // open persistent connection if missing
    // register module surface once
    return true;
}
```

## Generic lessons

### 1) Prefer per-database state over one unkeyed global singleton

If the host may involve multiple DuckDB database handles, key extension state by `duckdb_database` rather than assuming only one database exists.

### 2) `get_database(info)` is the bridge from init-time metadata to long-lived runtime ownership

If the stable extension access surface provides the database pointer, use it early and store it in runtime state.

### 3) A persistent extension-managed connection can be appropriate

DuckTinyCC uses a persistent connection because generated module init code needs a stable host connection for SQL registration.

That pattern can also make sense for extensions that need:

- internal helper registration
- extension-owned catalogs/tables
- controlled runtime queries during extension-managed workflows

### 4) Registration should be idempotent per database

DuckTinyCC tracks whether its module surface is already registered for that database. That avoids duplicate registration on repeated loads.

### 5) Keep the reason for the persistent connection narrow

A persistent connection is useful, but it should not become a vague dumping ground for unrelated concurrent work.

Ask:

- is this connection just for registration/control-plane work?
- can worker/session execution use separate connections if concurrency grows?
- what happens on repeated load/unload paths?

## When to copy this pattern

This pattern is a good fit when:

- the extension owns long-lived runtime state
- registration must be idempotent per database
- generated code or helper modules need a stable host connection
- the extension may be loaded multiple times against the same database handle

## When to be more careful

Be more careful if:

- the extension will run heavy concurrent query work through the same connection
- per-session isolation is needed
- shutdown/unload semantics are not fully defined
- the connection is only being used because state ownership was not designed clearly

## Bottom line

DuckTinyCC shows a pragmatic init pattern:

- get the database handle from `access->get_database(info)`
- key runtime state by that database
- open a persistent connection only when the extension genuinely needs one
- make registration idempotent per database

That is a strong generic pattern for stateful DuckDB C extensions.
