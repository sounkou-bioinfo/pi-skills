# Compatibility Boundary Checklist

Ask:

- Which calls depend on unstable DuckDB headers?
- Which external APIs are known to churn?
- Which public SQL names are already exposed to users?
- Which wrapper helpers are part of package docs/examples?
- Which paths need explicit regression tests before bumping versions?
