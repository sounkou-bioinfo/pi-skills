# DuckHTS Testing Checklist

## Every public feature needs both

1. SQL conformance tests in `test/sql/`
2. R package tests in `r/Rduckhts/inst/tinytest/`

## Check before finishing

- SQL semantics covered
- R wrapper behavior covered
- deterministic fixture data used
- function catalog updated if public API changed
- README examples still deterministic
- both changelogs updated

## Fixture rules

- Prefer generated VCF/BCF fixtures via `test/scripts/vcfpp.R`
- Record VCF fixture provenance in `vcfpp_manifest.tsv`
- Document new fixture prep in `test/scripts/prepare_test_data.sh`
- Copy package-needed fixtures into bundled R package data as required

## Special cases

### Rewrite / compatibility features

- validate against upstream tool behavior, not only local expectations
- record pinned upstream version/commit
- add regression tests for exact edge cases discovered during conformance work

### Wasm/webR features

- reproduce in the intended runtime
- verify symbol/export behavior, not only file presence
- do not treat native and wasm artifacts as interchangeable
