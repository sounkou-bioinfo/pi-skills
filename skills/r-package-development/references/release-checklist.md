# R Package Release Checklist

## Before release

- Confirm `DESCRIPTION` metadata is accurate
- Update `Version`
- Update `NEWS.md` if present, keeping newest changes first
- Regenerate docs with `make rd` or `roxygen2::roxygenize(load_code = "source")`
- Run tests with the project workflow, e.g. `make test` or `tinytest::test_package()`
- Run local checks with `make check` or `R CMD check`
- Review examples, vignettes, and long-running code
- Confirm no accidental development files are included
- Review `.Rbuildignore`
- Ensure URLs are valid and maintained

## For CRAN-oriented releases

- Check incoming feasibility notes and existing CRAN policies
- Keep examples non-interactive and fast
- Avoid network dependence unless safely wrapped
- Resolve all `ERROR`s and `WARNING`s
- Minimize or explain `NOTE`s
- Refresh `cran-comments.md` if used
- Test on multiple R versions or platforms when possible

## Helpful commands

```bash
make rd
make test
make check
R CMD build .
R CMD check *.tar.gz
```
