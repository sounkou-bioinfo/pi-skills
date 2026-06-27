#!/usr/bin/env Rscript

# Render generated function catalog artifacts from functions.yaml.
#
# The manifest is expected to be JSON-formatted YAML/JSON so R can parse it
# deterministically with jsonlite. Keep this script small and project-local.

die <- function(...) {
  message(...)
  quit(status = 1, save = "no")
}

escape_md <- function(text) {
  text <- as.character(if (is.null(text)) "" else text)
  text <- gsub("\\|", "\\\\|", text)
  gsub("[\r\n]+", " ", text)
}

clean_tsv <- function(text) {
  text <- as.character(if (is.null(text)) "" else text)
  gsub("[\r\n\t]+", " ", text)
}

field <- function(entry, name, default = "") {
  value <- entry[[name]]
  if (is.null(value)) return(default)
  as.character(value)
}

deprecated_since <- function(entry) {
  deprecated <- entry[["deprecated"]]
  if (is.list(deprecated)) field(deprecated, "since") else ""
}

load_manifest <- function(path) {
  if (!requireNamespace("jsonlite", quietly = TRUE)) {
    die("Install the R package 'jsonlite' to parse ", path)
  }

  payload <- tryCatch(
    jsonlite::fromJSON(path, simplifyVector = FALSE),
    error = function(error) die("Failed to parse ", path, ": ", conditionMessage(error))
  )

  functions <- payload[["functions"]]
  if (!is.list(functions)) {
    die(path, " is missing a top-level 'functions' array")
  }
  functions
}

render_markdown <- function(functions) {
  lines <- c(
    "# Function Catalog",
    "",
    "This file is generated from `functions.yaml`.",
    "",
    "| name | kind | returns | since | deprecated | description |",
    "|---|---|---|---|---|---|"
  )

  for (entry in functions) {
    lines <- c(
      lines,
      sprintf(
        "| `%s` | %s | `%s` | %s | %s | %s |",
        escape_md(field(entry, "name")),
        escape_md(field(entry, "kind")),
        escape_md(field(entry, "returns")),
        escape_md(field(entry, "since")),
        escape_md(deprecated_since(entry)),
        escape_md(field(entry, "description"))
      )
    )
  }

  paste0(paste(lines, collapse = "\n"), "\n")
}

write_tsv <- function(path, functions) {
  header <- c("name", "kind", "returns", "since", "deprecated", "description")
  rows <- lapply(functions, function(entry) {
    c(
      field(entry, "name"),
      field(entry, "kind"),
      field(entry, "returns"),
      field(entry, "since"),
      deprecated_since(entry),
      field(entry, "description")
    )
  })

  lines <- c(
    paste(header, collapse = "\t"),
    vapply(rows, function(row) paste(clean_tsv(row), collapse = "\t"), character(1))
  )
  writeLines(lines, path, useBytes = TRUE)
}

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 2) {
  die("usage: generate_function_catalog.R <functions.yaml> <outdir>")
}

manifest_path <- normalizePath(args[[1]], winslash = "/", mustWork = TRUE)
outdir <- normalizePath(args[[2]], winslash = "/", mustWork = FALSE)
dir.create(outdir, recursive = TRUE, showWarnings = FALSE)

functions <- load_manifest(manifest_path)
md_path <- file.path(outdir, "functions.md")
tsv_path <- file.path(outdir, "functions.tsv")
writeLines(render_markdown(functions), md_path, useBytes = TRUE)
write_tsv(tsv_path, functions)
message("wrote ", md_path)
message("wrote ", tsv_path)
