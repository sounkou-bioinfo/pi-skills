---
name: duckvep-design
description: Design DuckDB-native variant consequence prediction. Use when transcript/reference caches, haplotype-aware consequences, bcftools csq reuse, annotation joins, or structured outputs are central.
---

# DuckVEP design

## Required choices

Before implementing a consequence engine, compare:

- direct native rewrite;
- pinned `bcftools csq`-aligned reuse/embedding;
- a hybrid kernel plus compatibility projection.

Record the chosen upstream/reference semantics and why reuse is or is not viable. Decide explicitly whether the supported path is row-wise or haplotype-aware; do not imply haplotype support from per-variant output.

## Data model

Plan separate authorities for:

1. transcript/gene models and canonical selection policy;
2. reference sequence identity and indexed access;
3. exact-key supplementary annotations;
4. interval annotations;
5. computed consequence kernels.

A compiled model identity includes source release, species, assembly, reference, consequence-engine version, and policy. Derived caches need public producers and receipts.

## SQL contract

Keep readers, normalization, transcript overlap, allele/transcript consequence mechanics, annotation joins, and presentation separate. Expose structured consequence rows/structs first; compatibility strings are projections with documented ordering and field semantics.

Validate against pinned upstream behavior on synthetic transcript/strand/CDS/splice/haplotype cases and representative real corpora. Do not use private caches as reproducibility proof. Use the focused cache/haplotype references when those decisions are active.
