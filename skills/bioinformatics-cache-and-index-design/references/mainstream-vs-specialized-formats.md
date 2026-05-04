# Mainstream vs Specialized Formats

Start by asking whether a mainstream format already solves the problem well enough:

- BGZF + tabix/CSI
- BCF
- FASTA + FAI
- Parquet
- DuckDB tables
- SQLite

Move to specialized archives only when:

- lookup patterns are narrow and repeated
- parsing/general-format overhead dominates
- startup or repeated annotation latency is a major bottleneck
- compact domain-specific keys or compression materially help
