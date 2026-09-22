# Deprecation Policy Template

For each deprecated public item, record:

- name
- surface: SQL / R / CLI / wire / config
- deprecated in version
- replacement
- removal target or review point
- whether a warning, alias, or compatibility wrapper remains

## Suggested wording

"`old_name` is deprecated as of vX.Y.Z. Use `new_name` instead. The old entry point may be removed after vA.B or the next major release."
