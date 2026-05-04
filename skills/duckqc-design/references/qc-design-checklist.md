# QC Design Checklist

Before implementation, ask:

- which QC metrics can share one pass?
- which metrics need annotation indexes?
- which outputs must remain compatibility-friendly?
- which outputs should be queryable tables instead?
- which reductions are per-thread mergeable?
- which whole-dataset summaries need a separate reduction phase?
