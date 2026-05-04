# Threading and Scan Models

Useful genomics-SQL threading patterns:

- atomic batch claiming for parallel variant/record scans
- per-thread readers/file handles when underlying IO is not thread-safe
- sequential contig/header traversal when exact output ordering matters
- single-thread accumulation when whole-dataset semantics dominate
- background worker pools only when the host lifecycle cannot express the needed phases cleanly

Questions to ask:

- does output order matter?
- does exact compatibility require deterministic traversal?
- can Scan stream chunk-by-chunk?
- what must be per-thread vs global state?
