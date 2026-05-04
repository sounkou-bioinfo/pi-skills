# One-Pass Design Checklist

Before implementation:

- list the repeated passes in the current workflow
- identify duplicated parse/decompression work
- define the minimal fused output set
- separate compatibility outputs from enriched outputs
- define every metric precisely
- decide what is pre-filter and post-filter
- write validation cases for each emitted output

Good one-pass design saves work without blurring semantics.
