# Multi-Source Annotation Planning

Real annotation systems usually need many sources, not one.

Classify sources by access pattern:

- exact-key sources: gnomAD, ClinVar, dbSNP, exact score tables
- interval sources: transcripts, exons, CDS, regulatory regions, blacklists
- track/window sources: conservation, coverage, positional tracks
- computed sources: consequences, HGVS, nearest-gene logic

Design implications:

- do not force all sources into one physical format
- prepare variants once: normalize contigs, compute packed exact keys, compute chunk/bin routing
- batch exact sources around a shared exact key
- batch interval sources around shared span/chunk planning
- load transcript/reference caches once per stage, not once per source
- keep outputs structured; only flatten to a wide table at the end if needed

A useful architecture is registry + source adapters + unified planner.
