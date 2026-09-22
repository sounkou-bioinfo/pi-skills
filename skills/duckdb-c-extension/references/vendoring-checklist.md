# Vendoring Checklist

For each dependency, capture:

- upstream URL
- pinned version/tag/commit
- license
- why vendored instead of system dependency
- local patch files
- build flags used
- tests required after an upgrade

## Useful validation after a bump

- build on Linux/macOS/Windows if supported
- inspect exported symbols if symbol isolation matters
- run smoke tests for the dependency-specific feature path
- re-check any code that depends on internal headers or struct layout
