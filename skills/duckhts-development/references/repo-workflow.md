# DuckHTS Repo Workflow Reference

Derived from `duckhts/AGENTS.md` and package/build files.

## Important files to read first

- `AGENTS.md`
- `functions.yaml`
- `r/Rduckhts/configure`
- `r/Rduckhts/configure.win`
- `r/Rduckhts/Makefile`
- relevant design notes in `design/`

## Mandatory post-extension-change workflow

```bash
cd ~/duckhts/r/Rduckhts/
Rscript bootstrap.R ~/duckhts/
THREADS=4 make test
```

## Package reminders

- Never run `R CMD INSTALL .` from `r/Rduckhts/`
- Build a tarball and install the tarball
- Keep CRAN compatibility
- Update both `NEWS.md` and `r/Rduckhts/NEWS.md` for user-visible changes

## When adding a public function

- implement extension code
- wire `CMakeLists.txt`
- wire `r/Rduckhts/R/bootstrap.R`
- wire `r/Rduckhts/configure`
- wire `r/Rduckhts/configure.win`
- update `functions.yaml`
- regenerate function catalog
- add SQL tests
- add R tinytests
