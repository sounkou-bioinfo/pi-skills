#!/usr/bin/env Rscript

(function() {
  root <- tempfile("memory-design-")
  dir.create(root)
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  files <- c(
    "docs/memory-lode-design.Rmd", "docs/memory-lode-design.css",
    "extensions/memory/index.ts", "extensions/memory/store.ts",
    "extensions/plannotator/config.ts"
  )
  for (file in files) {
    target <- file.path(root, file)
    dir.create(dirname(target), recursive = TRUE, showWarnings = FALSE)
    stopifnot(file.copy(file, target))
  }

  env <- new.env(parent = globalenv())
  output <- litedown::fuse(file.path(root, "docs/memory-lode-design.Rmd"), envir = env)
  stopifnot(file.exists(output), file.info(output)$size > 0)
  html <- xml2::read_html(output)
  ids <- xml2::xml_attr(xml2::xml_find_all(html, "//*[@id]"), "id")
  figures <- xml2::xml_find_all(html, "//img")
  alt <- xml2::xml_attr(figures, "alt")
  stopifnot(
    !anyDuplicated(ids), length(figures) == 4L,
    all(startsWith(xml2::xml_attr(figures, "src"), "data:image/png;base64,")),
    !anyNA(alt), all(nzchar(alt))
  )
  stopifnot(
    env$NOTE_BYTES == 280,
    env$PROJECTION_BYTES == 12 * 1024,
    env$proj == 12,
    env$MEM_POLICY > 0, env$REVIEW_POLICY > 0,
    nrow(env$fr) <= env$WAKE_EXAMPLE_ROWS,
    env$fr[1L, 1L] == 0, tail(env$fr[, 2L], 1L) == env$N,
    all(head(env$fr[, 2L], -1L) == tail(env$fr[, 1L], -1L))
  )

  previous <- setwd(file.path(root, "docs"))
  on.exit(setwd(previous), add = TRUE, after = FALSE)
  writeLines(c(
    "const LITERAL = 2_048;",
    "const PRODUCT = 3 * 1_024;",
    "const UNSUPPORTED = otherValue;",
    "const MALFORMED = __;"
  ), file.path(root, "limits.ts"))
  stopifnot(
    env$const_num("limits.ts", "LITERAL") == 2048,
    env$const_num("limits.ts", "PRODUCT") == 3072
  )
  for (name in c("MISSING", "UNSUPPORTED", "MALFORMED")) {
    error <- tryCatch(env$const_num("limits.ts", name), error = identity)
    stopifnot(inherits(error, "error"), grepl(name, conditionMessage(error), fixed = TRUE))
  }
  error <- tryCatch(env$policy_bytes("limits.ts", "MISSING POLICY"), error = identity)
  stopifnot(inherits(error, "error"), grepl("MISSING POLICY", conditionMessage(error), fixed = TRUE))
  message("Memory design renders with source-owned limits and embedded figures; missing inputs fail explicitly.")
})()
