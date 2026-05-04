# Changelog

## 0.2.1

- Updated the function-catalog skill to recommend DuckHTS-style generated `functions.md` / `functions.tsv` artifacts from a JSON-formatted `functions.yaml` manifest.
- Replaced the shell/PyYAML function-catalog generator reference with a Python standard-library stub (`generate_function_catalog.py`).
- Updated the example `functions.example.yaml` to use the JSON-formatted YAML style expected by the Python renderer.

## 0.2.0

- Added `LICENSE`.
- Added install-test snippets to `README.md`.
- Added `functions.example.yaml` and `generate-function-catalog.sh` as minimal function-catalog references.
- Added a DuckTinyCC case study covering use of `access->get_database(info)` and an extension-managed persistent connection during extension init.
- Expanded the R-bindings skill with the README.Rmd + custom knitr SQL engine documentation pattern used in DuckTinyCC and DuckHTS, with a generic example.
- Added a CRAN-oriented R bootstrap pattern reference for DuckDB extension packages, covering `configure` / `configure.win`, `src/Makevars*`, installed payloads under `inst/duckdb_extension/`, and explicit runtime loading.

## 0.1.0

- Initial release.
- Added skills for DuckDB C extension architecture, vendoring, API stability, R bindings, function catalogs, and testing/interop.
- Distilled generic patterns inspired by projects such as DuckHTS and DuckTinyCC without tying the guidance to one domain.
