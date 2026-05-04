# Cache and Index Planning

Potential cache/index classes for DuckVEP:

- transcript/gene model caches
- FASTA/reference indexed access
- supplementary annotation stores
- overlap indexes for transcripts/exons/CDS/UTRs/splice windows

Questions:

- what dominates startup today?
- what should be precompiled vs parsed at runtime?
- what should be DuckDB tables vs external binary stores?
- what must remain portable to constrained targets?
