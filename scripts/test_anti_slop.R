#!/usr/bin/env Rscript

file_arg <- grep("^--file=", commandArgs(trailingOnly = FALSE), value = TRUE)
test_path <- if (length(file_arg)) sub("^--file=", "", file_arg[[1]]) else "scripts/test_anti_slop.R"
script <- normalizePath(file.path(dirname(test_path), "anti_slop.R"), winslash = "/", mustWork = TRUE)

`%||%` <- function(left, right) if (is.null(left)) right else left

fail <- function(message) stop(message, call. = FALSE)
expect_identical <- function(actual, expected, label) {
  if (!identical(actual, expected)) {
    fail(paste0(label, "\nExpected: ", paste(expected, collapse = ", "), "\nActual: ", paste(actual, collapse = ", ")))
  }
}

run_analyzer <- function(...) {
  output <- suppressWarnings(system2("Rscript", c(script, ...), stdout = TRUE, stderr = TRUE))
  list(code = attr(output, "status") %||% 0L, output = paste(output, collapse = "\n"))
}

parse_result <- function(...) {
  result <- run_analyzer("--format", "json", ...)
  if (result$code != 0L) fail(paste0("Analyzer failed:\n", result$output))
  jsonlite::fromJSON(result$output, simplifyVector = FALSE)
}

if (!requireNamespace("jsonlite", quietly = TRUE)) fail("test_anti_slop.R requires jsonlite")

work <- tempfile("anti-slop-test-")
dir.create(work)
on.exit(unlink(work, recursive = TRUE, force = TRUE), add = TRUE)

r_path <- file.path(work, "redundant.R")
writeLines(c(
  "f <- function(x) {",
  "  if (is.null(x)) stop(\"missing\")",
  "  if (is.null(x)) stop(\"missing twice\")",
  "  tryCatch(g(), error = function(e) stop(e))",
  "  if (x) 1 else NULL",
  "  return(x)",
  "}"
), r_path)
r_result <- parse_result(r_path)
expect_identical(
  sort(vapply(r_result$findings, `[[`, character(1), "rule")),
  sort(c("r-final-return", "r-rethrow-handler", "r-duplicate-adjacent-guard", "r-else-null")),
  "R rules should identify only their structured fixtures"
)

limited_r_result <- parse_result("--max-findings", "1", r_path)
expect_identical(length(limited_r_result$findings), 1L, "--max-findings must bound emitted diagnostics")

private_r_path <- file.path(work, "private-and-conditional.R")
writeLines(c(
  ".once <- function(x) x + 1L",
  ".never <- function(x) x",
  "f <- function(x, a, b, c, d) {",
  "  y <- .once(x)",
  "  if (a && b && c && d) y <- y + 1L",
  "  if (!length(x)) y <- 0L",
  "  ifelse(length(x), y, 0L)",
  "}"
), private_r_path)
private_r_result <- parse_result(private_r_path)
private_rules <- vapply(private_r_result$findings, `[[`, character(1), "rule")
expect_identical(
  sort(private_rules),
  sort(c(
    "r-private-helper-usage", "r-private-helper-usage", "r-conditional-sprawl",
    "r-implicit-length-test", "r-implicit-length-test"
  )),
  "Private helper usage, conditional sprawl, and implicit length tests must be diagnosed"
)
private_findings <- Filter(function(finding) identical(finding$rule, "r-private-helper-usage"), private_r_result$findings)
if (!any(grepl(".once has 1 direct call site", vapply(private_findings, `[[`, character(1), "message"), fixed = TRUE)) ||
    !any(grepl(".never has 0 direct call site", vapply(private_findings, `[[`, character(1), "message"), fixed = TRUE))) {
  fail("Private-helper diagnostics must report direct call-site counts")
}

valid_r_path <- file.path(work, "valid.R")
writeLines(c(
  "f <- function(x) {",
  "  if (!is.character(x) || length(x) != 1L || is.na(x)) stop(\"x must be one string\")",
  "  x",
  "}"
), valid_r_path)
valid_r_result <- parse_result(valid_r_path)
expect_identical(length(valid_r_result$findings), 0L, "A normal scalar admission guard must not be diagnosed")

c_path <- file.path(work, "redundant.c")
writeLines(c(
  "void f(char *x) {",
  "  if (x == NULL) return;",
  "  if (x == NULL) return;",
  "  if (x) x++; else {}",
  "  assert(x);",
  "  return;",
  "}"
), c_path)
c_result <- parse_result(c_path)
expect_identical(
  sort(vapply(c_result$findings, `[[`, character(1), "rule")),
  sort(c("c-final-void-return", "c-duplicate-adjacent-guard", "c-empty-else", "c-runtime-assert")),
  "C rules should identify only their structured fixtures"
)

config_path <- file.path(work, "rules.json")
writeLines('{"rules":{"c-runtime-assert":"off"}}', config_path)
configured_c_result <- parse_result("--config", config_path, c_path)
if ("c-runtime-assert" %in% vapply(configured_c_result$findings, `[[`, character(1), "rule")) {
  fail("Rule configuration must disable c-runtime-assert")
}
invalid_config_path <- file.path(work, "invalid-rules.json")
writeLines('{"rules":{"not-a-rule":"off"}}', invalid_config_path)
invalid_config_result <- run_analyzer("--config", invalid_config_path, c_path)
if (invalid_config_result$code == 0L || !grepl("Unknown anti-slop rule", invalid_config_result$output, fixed = TRUE)) {
  fail("Unknown configured rules must fail explicitly")
}

tree_path <- file.path(work, "tree")
dir.create(file.path(tree_path, "nested"), recursive = TRUE)
writeLines(".across_files <- function(x) x", file.path(tree_path, "helper.R"))
writeLines(c(
  "f <- function(x) {",
  "  if (!length(x)) return(.across_files(x))",
  "  x",
  "}"
), file.path(tree_path, "nested", "consumer.R"))
writeLines("void f(void) { return; }", file.path(tree_path, "nested", "helper.c"))
writeLines("not source", file.path(tree_path, "ignored.txt"))
tree_result <- parse_result(tree_path)
expect_identical(tree_result$language, "mixed", "Directory scans must report mixed R/C source")
expect_identical(length(tree_result$files), 3L, "Directory scans must recurse over recognized source files only")
tree_private <- Filter(function(finding) identical(finding$rule, "r-private-helper-usage"), tree_result$findings)
if (length(tree_private) != 1L || !grepl(".across_files has 1 direct call site", tree_private[[1]]$message, fixed = TRUE)) {
  fail("Directory scans must count direct private-helper calls across the analysis scope")
}

invalid_path <- file.path(work, "broken.R")
writeLines("f <- function( { return(x) }", invalid_path)
invalid_result <- parse_result(invalid_path)
expect_identical(invalid_result$ok, FALSE, "Syntax errors must be reported rather than analyzed heuristically")
expect_identical(
  unique(vapply(invalid_result$findings, `[[`, character(1), "rule")),
  "parse-error",
  "Parse errors must suppress style findings"
)

unknown_path <- file.path(work, "unknown.txt")
invisible(file.copy(valid_r_path, unknown_path))
unknown_result <- run_analyzer(unknown_path)
if (unknown_result$code == 0L || !grepl("Cannot infer language", unknown_result$output, fixed = TRUE)) {
  fail("An unknown source suffix must fail explicitly rather than use a parser fallback")
}

message("anti-slop tests passed")
