# Functions YAML Pattern

A minimal entry might capture:

```yaml
- name: my_table_function
  kind: table
  category: IO
  signature: my_table_function(path, threads := 1)
  returns: table
  r_alias: mypkg_my_table_function
  since: 0.1.0
  description: Read records from a custom source into DuckDB.
  examples:
    - SELECT * FROM my_table_function('data.bin');
```

## Typical generated outputs

- markdown reference tables
- TSV catalogs for package installs
- wrapper docs or alias maps
- validation reports ensuring declared functions exist
