---
name: bioinformatics-cache-and-index-design
description: Guides cache, index, and annotation-store design for bioinformatics rewrites, including when to use mainstream interoperable formats versus specialized high-performance encodings. Use when startup cost, repeated lookup performance, interval access, or annotation storage strategy are central design concerns.
---

# Bioinformatics Cache and Index Design

Use this skill when cache design, index design, or annotation storage layout is a major part of the architecture.

This skill is useful for projects like:

- DuckVEP-style consequence engines
- DuckQC-style reusable QC systems
- DuckHTS-style readers and indexed analytics
- population annotation tools
- transcript/reference caches
- interval-heavy genome analysis systems

## Core position

In many bioinformatics rewrites, the most important architectural decisions are not:

- language choice
- wrapper language
- CLI shape

but rather:

- what is parsed once vs every run
- what is indexed and how
- what storage layout matches the query workload
- what should remain in mainstream interoperable formats
- what is worth converting into specialized caches

A fast engine on a poor layout often loses to a merely good engine on the right layout.

## Main design questions

Ask early:

- what dominates startup time?
- what dominates steady-state throughput?
- are queries point lookups, interval joins, scans, or mixed?
- are inputs reused enough to justify precomputation?
- must the format remain broadly interoperable?
- is the workload mostly local, cloud, HPC, embedded, or wasm?
- how will caches be invalidated, versioned, and attributed?

## Prefer mainstream formats by default

In many cases, the best answer is still to use widely adopted formats first.

Typical mainstream choices:

- `BGZF + tabix/CSI` for genomic interval lookup over text-like formats
- `BCF` for compact indexed variant transport
- `FASTA + FAI` for reference sequence access
- `Parquet` for columnar metadata and analytics-friendly side tables
- `DuckDB tables` for repeatedly queried annotation/summary data in SQL-native systems
- `SQLite` for portable embedded relational metadata stores when SQL is enough

For DuckDB specifically, remember that the engine already offers a lot:

- columnar storage
- row-group statistics and pruning
- predicate/projection pushdown
- persistent ART indexes
- expression indexes

So first ask whether a planner-friendly DuckDB schema already solves enough of the workload before inventing a new serving format.

Advantages:

- existing ecosystem tools
- easy interchange
- lower maintenance burden
- easier validation and debugging
- easier adoption by users

Do not invent a new cache format unless the workload justifies it.

## But specialized formats can be worth it

Sometimes mainstream formats are not enough.

A custom cache or index may be justified when:

- the same heavy parsing cost is paid constantly
- lookup patterns are extremely narrow and repeated
- per-record overhead of general formats is too expensive
- the problem benefits from compact domain-specific keys
- startup and latency dominate user experience
- you need very high-throughput annotation against huge reference datasets

## Important design dimensions

### 1) Parse-at-runtime vs precompiled cache

Parse at runtime when:

- startup cost is small
- files are used rarely
- interoperability matters more than raw speed

Precompile caches when:

- the same GTF/GFF/VCF/reference-derived model is reused many times
- parsing and normalization are expensive
- users benefit from amortized startup

### 2) Text compatibility vs binary cache

Text is best for:

- interchange
- inspection
- debugging
- ecosystem compatibility

Binary is best for:

- fast startup
- compact repeated lookup
- cache-friendly access patterns
- exact in-memory layout control

Often the best pattern is:

- keep the canonical source in mainstream format
- generate derived binary caches with explicit provenance and versioning

### 3) Generic relational store vs domain-specific archive

Relational/columnar stores are best when:

- users need ad hoc queries
- schema evolution is manageable
- SQL composition is a feature

Domain-specific archives are best when:

- query patterns are narrow and known
- specialized compression pays off
- the archive acts like a serving index, not a general database

### 4) Whole-genome scan vs sparse lookup

Optimize differently for:

- whole-dataset scans
- region-restricted scans
- point variant annotation
- transcript overlap queries
- repeated sample-by-sample interactive use

## Existing innovative structures worth studying

### `echtvar`

`echtvar` is a good example of a specialized annotation archive rather than a mainstream “VCF + tabix” approach.

From inspection, useful ideas include:

- genome chunking into fixed-size windows (`1 << 20` bases)
- compact encoding of many small variants into a 32-bit key
- a supplemental store for long variants that do not fit the compact key
- delta encoding + stream-vbyte integer compression
- zip-contained per-chromosome / per-chunk payloads
- field-specific stored payloads rather than re-reading a large general-purpose VCF
- low-cardinality string handling via integer coding plus string lookup tables

Why this is interesting:

- it matches a very specific workload: high-throughput annotation against large population datasets
- it compresses the key space and payloads around actual lookup needs
- it trades some generality for much faster repeated annotation

This is exactly the kind of design worth considering when a mainstream format is functionally correct but operationally too expensive.

### Other structure families to think about

Even when not copied directly, these ideas are worth considering:

- interval trees / nested containment structures for overlap-heavy queries
- cache-oblivious interval trees for repeated genomic interval lookups
- succinct or compact key encodings for restricted alphabets / allele models
- chunked block stores with side indexes
- columnar side stores for annotation attributes
- memory-mapped binary reference assets
- compressed bitmap or bitset indexes for presence/filter-style queries

## Mainstream formats that are often the right answer

### BGZF + tabix/CSI

Use when:

- you need broad ecosystem compatibility
- interval/range lookup on line-oriented genomic files is enough
- you want minimal custom machinery

### BCF

Use when:

- variants are the core transport format
- compact binary representation matters
- you want mature htslib support

### Parquet

Use when:

- annotation data is table-shaped
- analytics and projection pushdown matter
- SQL/dataframe interop is valuable
- row-oriented VCF semantics are not required for the side store itself

### DuckDB tables

Use when:

- the system is already SQL-native
- users benefit from joins, filtering, and ad hoc exploration
- metadata companions should be immediately queryable
- you want the planner to help with chunk/span pruning before a specialized kernel runs

### SQLite

Use when:

- you need a portable embedded SQL store
- data volumes and access patterns fit B-tree-style storage
- you want something more standard than a custom binary archive

## Workload-first recommendations

### For transcript models

Consider:

- original GTF/GFF as canonical source
- derived binary transcript cache for repeated use
- interval indexes for exon/CDS/UTR/splice lookup
- optional SQL-visible table projection for debugging and ad hoc analysis
- DuckDB chunk/span pruning to narrow candidates before interval-kernel refinement

### For supplementary annotation databases

Consider these tiers:

1. start with mainstream indexed files or tables
2. benchmark the actual lookup bottleneck
3. only then introduce specialized chunked archives if justified

### For reference sequence access

Start with:

- FASTA + FAI
- memory mapping if local repeated access helps

Only go beyond that if sequence slicing truly dominates.

### For population AF / dbNSFP / ClinVar-like annotation

Potential options in increasing specialization:

- VCF/BCF + tabix/CSI
- Parquet or DuckDB side tables
- DuckDB exact-key tables with ART or expression indexes on hot lookup keys
- specialized archives like `echtvar` when repeated high-throughput annotation demands it

## Cache invalidation, provenance, and compatibility

Any generated cache should record:

- source files and versions
- build command / config
- genome build / contig naming assumptions
- schema version
- encoding version
- upstream tool or annotation provenance

Also plan for:

- invalidation when source files change
- deterministic regeneration where possible
- compatibility across architectures and runtimes

## Anti-patterns

Avoid:

- creating a novel format before measuring bottlenecks
- storing opaque binary blobs without provenance/versioning
- confusing an exchange format with a serving format
- forcing custom formats when Parquet / BCF / SQLite / DuckDB tables would suffice
- assuming the “fastest benchmark” format is best if it harms maintainability badly
- assuming one index structure should handle exact-key and interval-overlap workloads equally well

## Practical rule of thumb

Start mainstream.

Move to specialized caches only when you can say clearly:

- what bottleneck they remove
- what query pattern they optimize
- how they will be versioned and regenerated
- why an existing mainstream format is insufficient

## Related skills

- [Genomics SQL rewrites](../genomics-sql-rewrites/SKILL.md)
- [DuckVEP design](../duckvep-design/SKILL.md)
- [Library-first bio rewrites](../library-first-bio-rewrites/SKILL.md)

## References

- [Mainstream vs specialized formats](references/mainstream-vs-specialized-formats.md)
- [Echtvar notes](references/echtvar-notes.md)
- [Interval vs exact lookups](references/interval-vs-exact-lookups.md)
- [Cache provenance checklist](references/cache-provenance-checklist.md)
