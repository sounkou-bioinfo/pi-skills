# fastVEP Notes

From repo inspection, fastVEP appears to emphasize:

- modular architecture across many Rust crates
- consequence prediction as a core engine
- binary transcript caches
- memory-mapped FASTA access
- tabix-indexed lookups
- custom binary supplementary annotation formats (`.osa`, `.osa2`, `.osi`, `.oga`)
- startup amortization and high throughput
- a web/server interface alongside CLI use

Interesting DuckDB/C rewrite questions:

- which caches or annotation stores should become DuckDB-readable binary assets?
- which parts are best as scalar/table functions?
- where can SQL composition replace orchestration glue?
- can alternative file formats reduce repeated startup or parsing costs?
