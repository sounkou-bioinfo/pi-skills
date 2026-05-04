# Interval vs Exact Lookups

Separate these workloads early.

Exact-key workloads:

- normalized `(contig, pos, ref, alt)` lookup
- population AF
- ClinVar/dbSNP exact matching
- bundled exact-variant score stores

These often benefit from:

- packed variant keys
- ART indexes for point lookups or selective joins
- chunked exact-key payloads
- specialized serving formats such as `echtvar`

Interval workloads:

- transcript overlap
- exon/CDS/UTR/splice lookup
- regulatory region overlap
- interval-heavy QC or coverage tasks

These often benefit from:

- chunk/span pruning at the storage/planner level
- in-memory interval kernels such as `cgranges`-like structures
- interval trees, NCList/AIList families, or similar overlap-oriented data structures

Do not assume one index structure should serve both jobs equally well.
