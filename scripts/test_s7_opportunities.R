#!/usr/bin/env Rscript

file_arg <- grep("^--file=", commandArgs(trailingOnly = FALSE), value = TRUE)
test_dir <- dirname(normalizePath(sub("^--file=", "", file_arg[[1]]), mustWork = TRUE))
script <- normalizePath(file.path(test_dir, "..", "skills", "s7-development", "scripts", "consumer_opportunities.R"), mustWork = TRUE)

run_report <- function(path, ...) {
  output <- suppressWarnings(system2("Rscript", c(script, "--format=json", ..., path), stdout = TRUE, stderr = TRUE))
  status <- attr(output, "status")
  if (!is.null(status) && status != 0L) stop(paste(output, collapse = "\n"), call. = FALSE)
  jsonlite::fromJSON(paste(output, collapse = "\n"), simplifyVector = FALSE)
}

if (!requireNamespace("jsonlite", quietly = TRUE)) stop("Tests require jsonlite.", call. = FALSE)
package <- tempfile("consumer-opportunities-")
dir.create(file.path(package, "R"), recursive = TRUE)
on.exit(unlink(package, recursive = TRUE), add = TRUE)
writeLines(c(
  'draw <- S7::new_generic("draw", "x")',
  'area <- S7::new_generic("area", "x")',
  'record <- S7::new_generic("record", "x")',
  'print_card <- function(x) { draw(x); area(x); record(x) }',
  'solo <- function(x) draw(x)',
  'unrelated <- function(x, y) { draw(x); area(y) }',
  'nested <- function(x) { local <- function() area(x); draw(x) }'
), file.path(package, "R", "generics.R"))
writeLines(c(
  'write_card <- function(value) { area(value); draw(value); record(value) }',
  'invalid <- function(x) { draw(x); length(x) }'
), file.path(package, "R", "consumers.R"))

result <- run_report(package, "--max-groups=2")
stopifnot(
  identical(result$files_scanned, 2L),
  identical(result$total_candidate_count, 3L),
  identical(result$truncated, TRUE),
  length(result$candidates) == 2L,
  all(vapply(result$candidates, function(group) length(group$consumers) == 2L, logical(1))),
  all(vapply(result$candidates, function(group) {
    identical(sort(vapply(group$consumers, `[[`, character(1), "function_name")), c("print_card", "write_card"))
  }, logical(1)))
)
writeLines(sprintf('consumer_%d <- function(x) { draw(x); area(x) }', seq_len(3L)), file.path(package, "R", "extra.R"))
bounded <- run_report(package, "--max-groups=1")
stopifnot(
  identical(length(bounded$candidates), 1L),
  identical(bounded$candidates[[1]]$consumer_count, 5L),
  identical(bounded$candidates[[1]]$sites_truncated, TRUE),
  length(bounded$candidates[[1]]$consumers) == 4L
)
unlink(file.path(package, "R", "extra.R"))
writeLines('bad <- function(x) { draw(x) ', file.path(package, "R", "broken.R"))
error_output <- suppressWarnings(system2("Rscript", c(script, package), stdout = TRUE, stderr = TRUE))
stopifnot(!is.null(attr(error_output, "status")), any(grepl("Tree-sitter parse error", error_output, fixed = TRUE)))
unlink(file.path(package, "R", "broken.R"))

writeLines(c(
  'draw <- S7::new_generic("draw", "x")',
  'draw_a <- function(x) draw(x)',
  'draw_b <- function(y) draw(y)'
), file.path(package, "R", "generics.R"))
unlink(file.path(package, "R", "consumers.R"))
empty <- run_report(package)
stopifnot(identical(empty$total_candidate_count, 0L), identical(empty$truncated, FALSE))
writeLines(c(
  'plain_a <- function(x) checkmate::assert_string(x)',
  'plain_b <- function(label) checkmate::assert_string(label)',
  'different <- function(label) checkmate::assert_string(label, min.chars = 1L)',
  'guard_a <- function(x) { if (!is.character(x) || length(x) != 1L) stop("bad") }',
  'guard_b <- function(value) { if (!is.character(value) || length(value) != 1L) stop("bad") }',
  'reverse <- function(value) { if (is.character(value) && length(value) == 1L) stop("bad") }',
  'other_cardinality <- function(value) { if (!is.character(value) || length(value) != 2L) stop("bad") }',
  'unrelated <- function(x, y) { if (!is.character(x) || length(y) != 1L) stop("bad") }',
  'nested <- function(x) { f <- function() checkmate::assert_string(x); f() }'
), file.path(package, "R", "checks.R"))
scalar <- run_report(package)
stopifnot(
  identical(scalar$repeated_scalar_checks$total_candidate_count, 2L),
  identical(sort(vapply(scalar$repeated_scalar_checks$candidates, `[[`, character(1), "kind")), c("checkmate", "guard")),
  all(vapply(scalar$repeated_scalar_checks$candidates, function(group) length(group$consumers) == 2L, logical(1)))
)
pattern <- paste(rep("a", 200L), collapse = "")
writeLines(sprintf('long_%d <- function(x) checkmate::assert_string(x, pattern = "%s")', 1:2, pattern),
           file.path(package, "R", "long-checks.R"))
bounded_scalar <- run_report(package)
long_group <- Filter(function(group) isTRUE(group$signature_truncated), bounded_scalar$repeated_scalar_checks$candidates)
stopifnot(length(long_group) == 1L, nchar(long_group[[1]]$signature) == 140L)
cat("S7 consumer and scalar-check opportunity report: OK\n")
