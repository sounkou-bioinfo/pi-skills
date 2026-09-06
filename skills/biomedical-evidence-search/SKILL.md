---
name: biomedical-evidence-search
description: Use for variant, gene, trait, eQTL/PheWAS, score, or literature lookups via biomedical_search.
---

# Biomedical evidence search

Use the single `biomedical_search` tool, not a new per-provider skill or client.
`list` discovers providers; `describe` gives a provider's current operations and
arguments; `call` runs 1–12 fixed read-only operations. Describe unfamiliar
contracts instead of guessing names. Reuse an already-observed contract within
the task rather than rediscovering it before every call.

Resolve identifiers and assembly before coordinate queries. Batch independent
calls when useful; bound pagination with `max_pages` (1–20). Partial failures and
page/byte limits must remain visible. Profiles are routing metadata, not a
network sandbox; the host's network policy remains authoritative.

## Load the reference for the question

- Source selection, provider-specific semantics, or ontology-wide GWAS SNP
  enumeration: [provider contracts](references/resources.md). For enumeration,
  claim "all" only when `complete=true`; otherwise report the retrieved extent.
- gpmapr uploads or archive/TSV workflows: [R package guide](references/gpmapr.md).
  The search tool itself is read-only.
- Imported-client compatibility or provenance: [upstream port](references/upstream-port.md).

## Evidence contract

Summarize returned payloads with provider/operation, arguments, identifiers and
assembly, pagination extent, source URLs, limitations, and failed calls. Do not
force heterogeneous scores, p-values, effect directions, or evidence classes into
a common schema. Abstain where missing evidence would require guessing.

Europe PMC supports literature discovery; LitVar2 indexes variant publications.
LitVar2 API results do **not** substantiate web-interface snippets or quotations.
Inspect the actual page before attributing a snippet, and identify that source.
API evidence supports retrieval, not clinical diagnosis or treatment advice.
