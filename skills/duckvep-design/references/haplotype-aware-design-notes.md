# Haplotype-Aware Design Notes

Per-variant consequence prediction can be insufficient when phased variants interact.

A DuckVEP design should explicitly decide:

- whether v1 is haplotype-aware
- whether phased VCF/BCF input is required for some consequence paths
- whether an upstream engine such as `bcftools csq` should be used as the semantic baseline for this part
- how haplotype/grouped consequence results will be represented in SQL

Do not hide this as a minor implementation detail; it is a core semantic design choice.
