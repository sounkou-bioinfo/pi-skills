# Storage and formats

## Mainstream first

Start by asking whether a mainstream format already solves the problem:

- BGZF + tabix/CSI;
- BCF;
- FASTA + FAI;
- Parquet;
- DuckDB tables/views, including as metadata sources;
- SQLite.

Move to a specialized archive only when:

- lookup patterns are narrow and repeated;
- parsing or general-format overhead dominates;
- startup or repeated annotation latency is a major bottleneck;
- compact domain-specific keys or compression materially help.

A good SQL-native genomics design often wins through indexing and data layout,
not just faster code. See `interval-vs-exact-lookups.md`, `duckdb-index-planning.md`,
and the `echtvar`/fastVEP case notes.

## Cache provenance

A generated cache or index records:

- source file paths and versions;
- genome build and coordinate conventions;
- contig naming assumptions;
- build command or configuration;
- schema/encoding version;
- software version that generated it;
- lossy encoding choices;
- regeneration instructions.

A cache without provenance becomes technical debt quickly.
