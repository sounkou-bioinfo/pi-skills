# Vendoring Strategy for R Packages with Native Code

Use this when the package ships third-party C or C++ code.

## Principles

- Keep provenance explicit: upstream project, version, URL, commit, and checksum
- Keep local patches explicit and reviewable
- Treat patch stacks as part of the vendoring design
- Prefer a reproducible update path over one-off manual copies
- Separate vendored source management from package source where practical

## Recommended layout

```text
tools/
  vendor/
  patches/
  update-vendor.R
  update-vendor.sh
src/
  <copied-or-unpacked-build-inputs>
configure
configure.win
src/Makevars
src/Makevars.win
inst/
  LICENSE.note
```

## Recommended workflow

1. Download or copy upstream source into `tools/vendor/`
2. Record version and checksum
3. Apply local patches from `tools/patches/`
4. Copy or unpack the exact build inputs into `src/` using a script
5. Apply named patch files from `tools/patches/` when needed
6. Document the process in `tools/` or `README` notes

## Concrete R examples

### Example: `Authors@R` with vendored code credited via `cph`

```r
Authors@R: c(
    person(
      given = "Your", family = "Name",
      email = "you@example.org",
      role = c("aut", "cre")
    ),
    person(
      given = "Upstream", family = "Project Authors",
      role = "cph",
      comment = "Bundled C source in src/; see inst/LICENSE.note"
    )
)
```

### Example: write `inst/LICENSE.note` from R

```r
license_note <- c(
  "This package bundles code from UpstreamLib.",
  "Upstream source: https://example.org/upstreamlib",
  "Version: 1.2.3",
  "Copyright holders: Upstream Project Authors",
  "License: BSD-2-Clause",
  "Local changes: patch for Windows build and symbol visibility."
)

writeLines(license_note, "inst/LICENSE.note")
```

### Example: vendor a release tarball with base R

```r
url <- "https://example.org/upstreamlib-1.2.3.tar.gz"
out <- file.path("tools", "vendor", basename(url))
dir.create(file.path("tools", "vendor"), recursive = TRUE, showWarnings = FALSE)
download.file(url, out, mode = "wb")
tools::md5sum(out)
```

### Example: unpack vendored source from R

```r
tarball <- "tools/vendor/upstreamlib-1.2.3.tar.gz"
outdir <- file.path("tools", "vendor", "upstreamlib-1.2.3")
dir.create(outdir, recursive = TRUE, showWarnings = FALSE)
utils::untar(tarball, exdir = outdir)
```

### Example: copy only needed C files into `src/`

```r
dir.create("src", showWarnings = FALSE)
files <- c(
  "tools/vendor/upstreamlib-1.2.3/upstreamlib/src/foo.c",
  "tools/vendor/upstreamlib-1.2.3/upstreamlib/src/bar.c",
  "tools/vendor/upstreamlib-1.2.3/upstreamlib/include/upstreamlib.h"
)
file.copy(files, "src", overwrite = TRUE)
```

### Example: apply a simple text patch from R

```r
path <- "src/foo.c"
x <- readLines(path, warn = FALSE)
x <- sub("#include <malloc.h>", "#include <stdlib.h>", x, fixed = TRUE)
writeLines(x, path)
```

### Example: apply patch files during vendor refresh

```r
patches <- Sys.glob("tools/patches/*.patch")
for (p in patches) {
  system2("patch", c("-p1", "-i", normalizePath(p)),
          stdout = TRUE, stderr = TRUE,
          wd = "tools/vendor/upstreamlib-1.2.3")
}
```

Prefer numbered patch files such as:

```text
tools/patches/
  0001-drop-flat-namespace.patch
  0002-ucrt-import-defs.patch
  0003-fix-header-search-order.patch
```

Each patch should encode one reasoned local change.

### Example: keep a machine-readable vendor manifest

```r
vendor <- list(
  package = "upstreamlib",
  version = "1.2.3",
  url = "https://example.org/upstreamlib-1.2.3.tar.gz",
  md5 = unname(tools::md5sum("tools/vendor/upstreamlib-1.2.3.tar.gz")),
  files = c("foo.c", "bar.c", "upstreamlib.h"),
  patches = c("0001-windows-build.patch")
)

jsonlite::write_json(vendor, "tools/vendor/vendor.json", auto_unbox = TRUE, pretty = TRUE)
```

### Example: one R update script in `tools/update-vendor.R`

```r
url <- "https://example.org/upstreamlib-1.2.3.tar.gz"
tarball <- file.path("tools", "vendor", basename(url))
source_dir <- file.path("tools", "vendor", "upstreamlib-1.2.3")

unlink("src/foo.c")
unlink("src/bar.c")
unlink("src/upstreamlib.h")

dir.create(file.path("tools", "vendor"), recursive = TRUE, showWarnings = FALSE)
download.file(url, tarball, mode = "wb")
dir.create(source_dir, recursive = TRUE, showWarnings = FALSE)
utils::untar(tarball, exdir = source_dir)

patches <- Sys.glob("tools/patches/*.patch")
for (p in patches) {
  system2("patch", c("-p1", "-i", normalizePath(p)),
          stdout = TRUE, stderr = TRUE,
          wd = source_dir)
}

files <- c(
  file.path(source_dir, "upstreamlib/src/foo.c"),
  file.path(source_dir, "upstreamlib/src/bar.c"),
  file.path(source_dir, "upstreamlib/include/upstreamlib.h")
)
file.copy(files, "src", overwrite = TRUE)

license_note <- c(
  "This package bundles code from UpstreamLib.",
  sprintf("Source: %s", url),
  sprintf("MD5: %s", unname(tools::md5sum(tarball))),
  sprintf("Patches: %s", paste(basename(patches), collapse = ", ")),
  "Copyright holders: Upstream Project Authors",
  "License: BSD-2-Clause"
)
writeLines(license_note, "inst/LICENSE.note")
```

Prefer putting scripts like this in `tools/` and running them explicitly instead of editing vendored files by hand.

## configure and Makevars strategy

For native-code packages, also inspect and document:

- `configure`
- `configure.win`
- `src/Makevars`
- `src/Makevars.win`

Concrete practices illustrated by `Rtinycc`-style workflows:

- Use `R CMD config` to discover `MAKE`, `CC`, and `AR`
- Pass R's compiler choice into upstream builds instead of choosing a compiler manually
- Keep Unix and Windows build logic separate when header search paths and runtime linking differ
- On Unix-alikes, use platform-aware rpath settings when shipping companion shared libraries
- On Windows, prefer DLL colocating or explicit import-library handling instead of Unix-style rpath
- Comment why a given include path is intentionally excluded, especially when vendored headers would shadow the R toolchain headers
- When platform-specific adaptations are needed, define them in a small platform layer instead of spreading `#ifdef` blocks throughout unrelated files
- Prefer a stable internal API such as `platform_*` wrappers that isolate OS-specific behavior behind one header and a few implementation files
- Keep macro-heavy compatibility code localized to those files whenever possible

## What to document

- Upstream repository and release
- Why code is vendored
- What was modified locally
- How to refresh to a new upstream version
- License and attribution implications
- Which upstream people or organizations should appear in `Authors@R` as `cph`

## What to avoid

- Editing vendored files in `src/` with no update script or patch trail
- Carrying important local changes outside named patch files or documented configure logic
- Mixing handwritten package code and third-party code without boundaries
- Losing upstream version information

## CRAN-oriented notes

- Ensure bundled code licensing is compatible and documented
- Keep `inst/LICENSE.note` or equivalent attribution up to date
- Avoid shipping unnecessary upstream files in the built package
- For bundled third-party code, list copyright holders in `Authors@R` with role `cph` when appropriate
