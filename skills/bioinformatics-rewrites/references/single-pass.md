# Single-pass analytics

Computing several outputs from one scan saves I/O, decompression, intermediate
files, and repeated parses. Examples: counts with strand splits, GC summaries,
MAPQ summaries, or primary outputs with summary side products.

## Before implementation

- List the repeated passes in the current workflow.
- Identify duplicated parse/decompression work.
- Define the minimal fused output set.
- Separate compatibility outputs from enriched outputs.
- Define every metric precisely.
- Decide what is pre-filter and post-filter, and document it.
- Write validation cases for each emitted output.

## Validation

Validate separately:

- main output correctness;
- each extra statistic;
- empty and small inputs;
- filtered versus unfiltered behavior;
- compatibility-critical outputs against upstream reference tools;
- a benchmark against the original multi-pass workflow.

A fast fused pass is useful only if each emitted number can be trusted.
