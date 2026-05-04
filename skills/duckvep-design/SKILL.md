---
name: duckvep-design
description: Guides design of a DuckDB-native variant effect prediction system, including consequence prediction kernels, transcript/annotation caches, haplotype-aware consequence paths, bcftools csq alignment opportunities, and careful planning for indexes and metadata stores. Use when exploring DuckVEP-style functionality.
---

# DuckVEP Design

Use this skill when planning a DuckDB-native variant effect prediction system — a possible “DuckVEP” direction.

This skill is design-first and exploratory. It assumes the goal is not merely to copy VEP as a CLI, but to ask what a SQL-native, library-first, cache-aware consequence system could look like.

## Core question

A DuckVEP-like system should ask:

- which parts belong in reusable C/native kernels?
- which parts should be SQL-visible table/scalar functions?
- which caches and indexes are essential for startup and throughput?
- where can existing battle-tested libraries already carry part of the burden?

## Immediate opportunity: htslib + bcftools csq-aligned path

One very important design direction is to consider building on what already exists in the htslib / bcftools ecosystem.

In particular:

- `bcftools csq` already supports haplotype-aware consequence annotation
- `htslib` already provides the VCF/BCF/index transport substrate
- DuckHTS already has HTS reading infrastructure and SQL-native file access patterns

This suggests that a DuckVEP plan should not start from “write a full new VEP engine from scratch”.

Instead, evaluate at least three design paths:

### Path A: direct consequence engine rewrite

Build a native consequence engine in C/C++ with DuckDB-facing wrappers.

Pros:
- maximum control over SQL-native interfaces
- full freedom over caches/formats
- can be shaped around DuckDB execution model from day one

Cons:
- largest validation burden
- haplotype-aware correctness is hard
- transcript/HGVS/csq semantics are subtle

### Path B: bcftools csq-aligned / embedded path

Leverage bcftools-style consequence machinery where possible, exposing it through DuckDB-facing kernels or wrappers.

Pros:
- reuse battle-tested consequence logic
- haplotype-aware support is already a serious advantage
- easier compatibility story for a first phase

Cons:
- integration boundaries may be awkward
- SQL-native decomposition may be less elegant initially
- internal data structures may not align perfectly with DuckDB interfaces

### Path C: hybrid path

Use existing consequence engines for the hardest semantic core first, while building:

- SQL-native readers
- transcript/annotation caches
- supplementary annotation stores
- queryable wrappers and macros
- richer output decomposition in DuckDB

This is likely the most pragmatic early direction.

## Haplotype-aware consequences are a major design constraint

Any serious DuckVEP discussion must account for the fact that:

- naïve per-variant consequence prediction can be wrong
- compound effects across phased variants matter
- haplotype-aware CSQ is one of the nontrivial strengths of `bcftools csq`

So a DuckVEP plan should explicitly decide:

- is v1 haplotype-aware or not?
- if not, how is that limitation documented?
- if yes, what data model carries phase/haplotype context?
- how are phased VCF/BCF inputs represented in SQL?

Do not understate this complexity.

## Caches and indexes need careful planning

This is probably the most important architectural warning.

A DuckVEP-like system will likely need multiple classes of indexed or cached assets:

### 1) Transcript / gene model cache

Potential forms:

- parsed GFF/GTF cache
- binary transcript model cache
- interval-indexed transcript lookup structures

Questions:

- is startup dominated by transcript parsing?
- should transcript models be precompiled into binary assets?
- should those assets be DuckDB-readable tables, binary blobs, or extension-owned caches?

### 2) Reference sequence access

Need efficient indexed access to FASTA/reference slices.

Questions:

- use FASTA + FAI directly?
- memory-map local references?
- stage sequence chunks in cache?
- what is the wasm story, if any?

### 3) Supplementary annotation stores

Potentially needed for:

- population AF
- ClinVar-like significance
- dbNSFP-like score sets
- conservation tracks
- regulatory annotations

Questions:

- should these live as DuckDB tables?
- tabix-indexed side files?
- compact chunked binary stores?
- hybrid: build-time import into DuckDB-managed tables plus optional external stores?

### 4) Consequence lookup/index structures

If a custom engine is built, think about indexes for:

- transcript overlap queries
- exon/CDS/UTR intervals
- splice windows
- per-gene/transcript metadata

Indexing strategy may matter as much as language choice.

## SQL-native design questions

Should DuckVEP expose:

- a row-wise scalar consequence UDF?
- a table function over VCF/BCF inputs?
- macros that wrap `read_bcf(...)`-style sources?
- transcript/gene consequence join tables?
- HGVS helper functions?

A likely good shape is layered:

1. reader layer for VCF/BCF records and sample/phase context
2. transcript/reference/cache layer
3. consequence kernel layer
4. SQL wrappers/macros for user-facing workflows
5. optional compatibility projection to VEP-like CSQ fields

Also separate clearly between:

- exact-key annotation sources
- interval-overlap annotation sources
- track/window sources
- computed sources such as CSQ/HGVS

Do not force all annotation sources into one physical format or one execution strategy.

## Output contract questions

Decide early whether DuckVEP wants to optimize for:

- VEP-compatible CSQ output
- richer structured outputs
- both

Likely best answer:

- keep a compatibility projection for familiar workflows
- also expose more structured SQL-native consequence tables

In practice, a many-source system often needs multiple output layers:

- variant-level exact annotations
- transcript-level consequences
- interval-overlap outputs
- optional final wide or nested projection for users

## Suggested phased roadmap

### Phase 1: feasibility / architecture

- define whether bcftools csq alignment is the initial semantic baseline
- audit which parts can be reused via htslib/bcftools today
- prototype transcript/reference/cache loading in DuckDB context
- define SQL-visible input/output shapes
- define a source registry and source classes for multi-source annotation

### Phase 2: minimal consequence path

- start with a narrow compatibility target
- likely coding + splice + basic transcript overlap
- clarify haplotype-aware support explicitly
- validate on real benchmark subsets

### Phase 3: cache and index hardening

- transcript binary caches
- efficient reference access
- annotation side stores
- startup amortization and benchmarked throughput
- shared preparation of input variants: normalized contigs, packed exact keys, chunk/bin routing
- batch exact sources around shared keys and interval sources around shared span planning

### Phase 4: richer annotation ecosystem

- HGVS helpers
- supplementary annotations
- structured outputs + compatibility outputs
- host-language wrappers

## Practical recommendation

Do not start with the assumption that the best path is a full greenfield VEP rewrite.

Start by asking:

- what can htslib already do for transport and indexing?
- what can `bcftools csq` already do for haplotype-aware semantics?
- what should DuckDB add that upstream tools do not provide well?
- where do SQL-native decomposition and queryability create unique value?
- how should many annotation sources be federated instead of flattened into one giant physical store?

That may lead to a much stronger DuckVEP.

A good early design is:

- source registry
- shared prepared-variant stage
- exact-source adapters
- interval-source adapters
- consequence/reference/transcript kernels loaded once per stage
- wide or nested user output only as a final projection

## Related skills

- [Genomics SQL rewrites](../genomics-sql-rewrites/SKILL.md)
- [Library-first bio rewrites](../library-first-bio-rewrites/SKILL.md)
- [Bioinformatics rewrite and porting](../bioinformatics-rewrite-porting/SKILL.md)

## References

- [DuckVEP architecture questions](references/architecture-questions.md)
- [Cache and index planning](references/cache-and-index-planning.md)
- [Haplotype-aware design notes](references/haplotype-aware-design-notes.md)
- [Multi-source annotation planning](references/multi-source-annotation-planning.md)
