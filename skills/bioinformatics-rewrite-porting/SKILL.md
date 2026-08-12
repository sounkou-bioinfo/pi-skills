---
name: bioinformatics-rewrite-porting
description: Define and validate a compatible port of an existing bioinformatics tool. Use when behavior or output claims target a named upstream implementation.
---

# Bioinformatics rewrite and porting

## Compatibility contract

Before implementation, record:

- upstream project and authors;
- exact version or commit and license;
- supported inputs, options, outputs, ordering, errors, and numerical tolerances;
- explicitly unsupported behavior;
- comparison datasets and commands.

Credit upstream visibly. Disclose AI assistance where project policy requires it; generated code receives the same review and proof obligations as human code.

## Workflow

1. Read pinned source before secondary descriptions.
2. Build the smallest useful compatible slice.
3. Keep compatibility projection separate from richer native APIs.
4. Fail loudly for deferred options; do not silently approximate.
5. Compare against the upstream executable continuously on synthetic edge fixtures and representative real data.
6. Classify mismatches as intentional scope, upstream quirk preserved, or defect.
7. Benchmark equivalent workloads only; report inputs, denominators, threads, environment, and revision.
8. Preserve acquisition, derivation, and validation receipts so another machine can rerun the proof.

Do not claim exact compatibility from matching a few happy-path rows. Do not copy unlicensed source or hide provenance behind vague inspiration language.

Use `references/validation-and-attribution.md` for the release checklist.
