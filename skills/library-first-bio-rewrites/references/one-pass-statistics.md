# One-Pass Statistics Notes

A strong rewrite opportunity is to compute multiple outputs from one scan of the data.

Examples:

- counts + strand splits
- counts + GC summaries
- counts + MAPQ summaries
- primary outputs + summary side products

## Benefits

- less I/O
- less decompression
- fewer intermediate files
- fewer repeated parses

## Requirements

- each statistic must have a clear definition
- compatibility-critical outputs must stay compatible
- validation should cover each emitted statistic, not only the main output
- pre-filter and post-filter summaries must be documented explicitly
