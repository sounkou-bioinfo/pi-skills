# ClawBio GWAS lookup port

Behavior was inspected from `ClawBio/skills/gwas-lookup/gwas_lookup_api` at upstream revision `c5de985ae257afb05c06972fe2c4bfa1e90867d1` (MIT). The port keeps operation contracts, not Python implementation or its derived common schema.

| ClawBio client | Metaskill provider/operation | Port decision |
|---|---|---|
| `ensembl.get_variant_info` | `ensembl/variation` | Fixed Ensembl host, rsID path |
| `ensembl.get_vep_annotation` | `ensembl/vep` | Fixed Ensembl host, rsID path |
| `gwas_catalog.get_associations` | `gwas_catalog/associations` | Upgraded from legacy v1 path to v2 `rs_id` filter |
| `open_targets.get_variant` | `open_targets/variant` | GraphQL variables and `CHROM_POS_REF_ALT` construction |
| `open_targets.get_credible_sets` | `open_targets/credible_sets` | GraphQL variables; schema errors remain explicit |
| `gtex.get_eqtls` | `gtex_v8/eqtls` | Preserves `chr{c}_{p}_{r}_{a}_b38`, dataset `gtex_v8` |
| `finngen.get_phewas` | `finngen_r12/phewas` | Preserves r12 `CHR:POS-REF-ALT` request |
| `pheweb_ukb.get_phewas` | `pheweb_ukb/phewas` | Preserves UKB-TOPMed request |
| `pheweb_bbj.get_phewas` | `pheweb_bbj/phewas` | Requires explicitly named GRCh37 position |
| `portaldev.resolve_rsid` | `portaldev/resolve_rsid` | Preserves rsID/build query; marks development status |
| `eqtl_catalogue.get_associations` | `eqtl_catalogue/associations` | Fails closed because the upstream API now returns HTTP 410 |

## Deliberate differences

- One metaskill and one tool replace per-provider client/skill sprawl.
- A declarative provider/operation catalog replaces repeated URL-construction code.
- Bounded JSON, per-origin serialization, minimum spacing, capped exponential backoff, and source receipts are shared; network sandboxing remains the host's responsibility.
- Batch requests provide ClawBio-like fan-out while preserving each raw upstream payload and error independently.
- Raw responses replace hand-normalized records because field names and semantics differ by source and release.
- The GWAS Catalog port targets recommended REST API v2 rather than reproducing obsolete v1 HAL search paths.
- Open Targets variant/credible-set selections were updated to the current v4 schema (`rsIds`, current allele/frequency fields, paged `CredibleSets.rows`, and per-variant `locus` statistics); removed ClawBio fields are not emulated.
- No persistent cache is hidden inside the extension. For reproducible cached computation, promote resources into pi-bio-agent manifests/CAS/ledger runs.

## Compatibility proof

Use one known variant with explicit coordinates, such as a returned Ensembl mapping, and compare request construction plus key upstream fields. Do not claim output compatibility with ClawBio's normalized dictionaries unless fixtures prove every field and empty/error behavior. API availability is time-dependent; a successful historical request is not a permanent provider guarantee.
