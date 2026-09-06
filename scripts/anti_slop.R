#!/usr/bin/env Rscript

# Compatibility launcher. The self-contained skill owns the analyzer runtime.
file_arg <- grep("^--file=", commandArgs(trailingOnly = FALSE), value = TRUE)
if (length(file_arg) != 1L) stop("Cannot locate the anti-slop launcher", call. = FALSE)
launcher <- normalizePath(
  sub("^--file=", "", file_arg[[1]]),
  winslash = "/",
  mustWork = TRUE
)
analyzer <- normalizePath(
  file.path(dirname(launcher), "..", "skills", "r-c-anti-slop", "scripts", "anti_slop.R"),
  winslash = "/",
  mustWork = TRUE
)
source(analyzer, local = .GlobalEnv)
main(commandArgs(trailingOnly = TRUE))
