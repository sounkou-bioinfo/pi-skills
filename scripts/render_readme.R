#!/usr/bin/env Rscript

args <- commandArgs(trailingOnly = FALSE)
file_arg <- grep("^--file=", args, value = TRUE)
script_path <- if (length(file_arg)) sub("^--file=", "", file_arg[[1]]) else "scripts/render_readme.R"
repo_root <- normalizePath(file.path(dirname(script_path), ".."), winslash = "/", mustWork = TRUE)
setwd(repo_root)

trailing <- commandArgs(trailingOnly = TRUE)
check <- "--check" %in% trailing

if (!requireNamespace("rmarkdown", quietly = TRUE)) {
  stop("Install the R package 'rmarkdown' to render README.md", call. = FALSE)
}
if (!requireNamespace("jsonlite", quietly = TRUE)) {
  stop("Install the R package 'jsonlite' to render README.md", call. = FALSE)
}

output_file <- if (check) ".README.generated.md" else "README.md"

rmarkdown::render(
  input = "README.Rmd",
  output_file = output_file,
  quiet = TRUE,
  envir = new.env(parent = globalenv())
)

rendered <- readLines(output_file, warn = FALSE, encoding = "UTF-8")
while (length(rendered) && !nzchar(rendered[[1]])) rendered <- rendered[-1]
writeLines(rendered, output_file, useBytes = TRUE)

if (check) {
  generated <- readLines(output_file, warn = FALSE, encoding = "UTF-8")
  current <- readLines("README.md", warn = FALSE, encoding = "UTF-8")
  if (!identical(generated, current)) {
    unlink(output_file)
    stop("README.md is stale; run `npm run render:readme`.", call. = FALSE)
  }
  unlink(output_file)
  message("README.md is current")
} else {
  message("wrote README.md")
}
