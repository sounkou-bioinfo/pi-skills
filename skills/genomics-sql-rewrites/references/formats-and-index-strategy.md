# Formats and Index Strategy

Consider all of these as first-class design choices:

- native text formats for interoperability
- parquet companions for metadata
- binary caches for startup-sensitive annotation models
- FASTA and tabix-style indexes
- chunked binary lookup stores for annotation databases
- DuckDB tables/views as metadata sources where appropriate

A good SQL-native genomics design often wins through better indexing and better data layout, not just faster code.
