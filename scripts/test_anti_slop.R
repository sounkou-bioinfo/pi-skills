#!/usr/bin/env Rscript

file_arg <- grep("^--file=", commandArgs(trailingOnly = FALSE), value = TRUE)
test_path <- if (length(file_arg) > 0L) sub("^--file=", "", file_arg[[1]]) else "scripts/test_anti_slop.R"
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
expect_identical(limited_r_result$truncated, TRUE, "A bounded result must disclose truncation")
expect_identical(limited_r_result$total_finding_count, 4L, "A bounded result must preserve its total finding count")
inline_limited_r_result <- parse_result("--language=r", "--max-findings=1", r_path)
expect_identical(length(inline_limited_r_result$findings), 1L, "Inline option values must match separate option values")

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

aliased_condition_path <- file.path(work, "aliased-condition.R")
writeLines(c(
  "display_name <- function(nm) {",
  "  valid_name <- !is.null(nm) && length(nm) == 1L && !is.na(nm) && nzchar(nm)",
  "  if (valid_name) return(nm)",
  "  NA_character_",
  "}",
  "display_name_all <- function(nm) {",
  "  valid_name <- all(c(!is.null(nm), length(nm) == 1L, !is.na(nm), nzchar(nm)))",
  "  if (valid_name) return(nm)",
  "  NA_character_",
  "}"
), aliased_condition_path)
aliased_condition_result <- parse_result(aliased_condition_path)
aliased_condition_findings <- Filter(
  function(finding) identical(finding$rule, "r-conditional-sprawl"),
  aliased_condition_result$findings
)
aliased_condition_checks <- c(
  length(aliased_condition_findings) == 2L,
  all(vapply(aliased_condition_findings, function(finding) {
    grepl("!is.null(nm)", finding$excerpt, fixed = TRUE)
  }, logical(1)))
)
if (!all(aliased_condition_checks)) {
  fail("Assigning a sprawling boolean expression or all(c(...)) equivalent to a one-use alias must not evade the conditional-sprawl rule")
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
expect_identical(valid_r_result$engines$jarl, "off", "Results must disclose that Jarl was not requested")
expect_identical(length(valid_r_result$disabled_rules), 0L, "Default analysis must disclose that no rules were disabled")
no_function_r_path <- file.path(work, "no-function.R")
writeLines("value <- 1L", no_function_r_path)
no_function_r_result <- parse_result(no_function_r_path)
expect_identical(length(no_function_r_result$findings), 0L, "A valid R file without function definitions must analyze cleanly")

branch_r_path <- file.path(work, "branch-slop.R")
writeLines(c(
  "redundant_else <- function(x) {",
  "  if (is.null(x)) stop(\"missing\") else x",
  "  if (is.character(x)) return(x) else as.character(x)",
  "  x",
  "}",
  "identical_branches <- function(x) if (is.character(x)) x else x",
  "effectful_condition <- function(x) if (trace(x)) x else x",
  "different_branches <- function(x) if (is.null(x)) 0L else x",
  "not_standalone <- function(x) identity(if (is.null(x)) stop(\"missing\") else x)",
  "non_terminating <- function(x) {",
  "  if (is.null(x)) warning(\"missing\") else x",
  "  x",
  "}",
  "multi_statement_branch <- function(x) {",
  "  if (is.null(x)) { warning(\"missing\"); return(x) } else x",
  "  x",
  "}"
), branch_r_path)
branch_r_result <- parse_result(branch_r_path)
branch_rules <- vapply(branch_r_result$findings, `[[`, character(1), "rule")
expect_identical(
  sort(branch_rules),
  sort(c("r-redundant-else-after-termination", "r-redundant-else-after-termination", "r-identical-if-branches")),
  "Redundant terminating else branches and identical pure branches must be diagnosed conservatively"
)
branch_config_path <- file.path(work, "branch-rules.json")
writeLines('{"rules":{"r-redundant-else-after-termination":"off","r-identical-if-branches":"off"}}', branch_config_path)
configured_branch_result <- parse_result("--config", branch_config_path, branch_r_path)
expect_identical(length(configured_branch_result$findings), 0L, "Configuration must disable the new branch rules")

predicate_r_path <- file.path(work, "predicate-slop.R")
writeLines(c(
  "reference_is_one_string <- function(value) {",
  "  is.character(value) && length(value) == 1L && !is.na(value) && nzchar(value)",
  "}",
  "",
  "reference_is_relative_path <- function(value) {",
  "  reference_is_one_string(value) &&",
  "    !grepl(\"(^|/|\\\\\\\\)\\\\.\\\\.($|/|\\\\\\\\)\", value)",
  "}"
), predicate_r_path)
predicate_r_result <- parse_result(predicate_r_path)
predicate_rules <- vapply(predicate_r_result$findings, `[[`, character(1), "rule")
expect_identical(
  sort(predicate_rules),
  sort(c("r-single-use-predicate-helper", "r-scalar-validator-helper", "r-path-threat-model", "r-conditional-sprawl")),
  "Translated scalar validators, sprawling predicates, one-use predicate chains, and false path threat models must be diagnosed"
)

reused_predicate_path <- file.path(work, "reused-predicate.R")
writeLines(c(
  "is_nonempty <- function(value) is.character(value) && nzchar(value)",
  "first_consumer <- function(value) is_nonempty(value)",
  "second_consumer <- function(value) is_nonempty(value)"
), reused_predicate_path)
reused_predicate_result <- parse_result(reused_predicate_path)
if ("r-single-use-predicate-helper" %in% vapply(reused_predicate_result$findings, `[[`, character(1), "rule")) {
  fail("A predicate with two direct call sites must not be diagnosed as a single-use helper chain")
}

complexity_r_path <- file.path(work, "complexity.R")
complexity_function <- function(name, decisions) c(
  sprintf("%s <- function(x) {", name),
  sprintf("  if (x == %dL) x <- x + 1L", seq_len(decisions)),
  "  x",
  "}"
)
writeLines(c(
  complexity_function("complexity_14", 13L),
  complexity_function("complexity_15", 14L),
  "cyclocomp_constructs_16 <- function(a, b, c, x) {",
  "  if (a && b || c) x <- x",
  "  for (i in x) x <- x",
  "  for (i in x) x <- x",
  "  for (i in x) x <- x",
  "  for (i in x) x <- x",
  "  while (a) break",
  "  repeat break",
  "  a && b",
  "}",
  "vectorized_and_ifelse_do_not_count <- function(a, b, c) {",
  "  ifelse(a & b | c, a, b)",
  "}",
  "outer <- function(x) {",
  paste0("  ", complexity_function("inner", 15L)),
  "  inner(x)",
  "}"
), complexity_r_path)
complexity_r_result <- parse_result(complexity_r_path)
complexity_findings <- Filter(function(finding) identical(finding$rule, "r-cyclomatic-complexity"), complexity_r_result$findings)
expect_identical(length(complexity_findings), 3L, "Complexity 14 must pass; complexity 15 must fail, including cyclocomp control constructs and a nested function scored independently")
complexity_messages <- vapply(complexity_findings, `[[`, character(1), "message")
complexity_checks <- c(
  any(grepl("complexity_15 has cyclomatic complexity 15", complexity_messages, fixed = TRUE)),
  any(grepl("cyclocomp_constructs_16 has cyclomatic complexity 16", complexity_messages, fixed = TRUE)),
  any(grepl("inner has cyclomatic complexity 16", complexity_messages, fixed = TRUE)),
  !any(grepl("vectorized_and_ifelse_do_not_count has cyclomatic complexity", complexity_messages, fixed = TRUE)),
  !any(grepl("outer has cyclomatic complexity", complexity_messages, fixed = TRUE))
)
if (!all(complexity_checks)) {
  fail("Cyclomatic diagnostics must enforce complexity below 15 and exclude nested bodies from the outer score")
}

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
expect_identical(configured_c_result$disabled_rules, list("c-runtime-assert"), "Results must disclose disabled rules")
empty_config_path <- file.path(work, "empty-rules.json")
writeLines("{}", empty_config_path)
empty_config_result <- parse_result("--config", empty_config_path, c_path)
expect_identical(
  sort(vapply(empty_config_result$findings, `[[`, character(1), "rule")),
  sort(vapply(c_result$findings, `[[`, character(1), "rule")),
  "An empty configuration object must preserve default rules"
)
invalid_config_path <- file.path(work, "invalid-rules.json")
writeLines('{"rules":{"not-a-rule":"off"}}', invalid_config_path)
invalid_config_result <- run_analyzer("--config", invalid_config_path, c_path)
if (invalid_config_result$code == 0L || !grepl("Unknown anti-slop rule", invalid_config_result$output, fixed = TRUE)) {
  fail("Unknown configured rules must fail explicitly")
}

missing_jarl_command <- file.path(work, "missing-jarl")
missing_jarl_result <- run_analyzer("--jarl", missing_jarl_command, valid_r_path)
missing_jarl_c_result <- run_analyzer("--jarl", missing_jarl_command, c_path)
missing_jarl_checks <- c(
  missing_jarl_result$code != 0L,
  missing_jarl_c_result$code != 0L,
  grepl("Requested Jarl executable was not found", missing_jarl_result$output, fixed = TRUE),
  grepl("Requested Jarl executable was not found", missing_jarl_c_result$output, fixed = TRUE)
)
if (!all(missing_jarl_checks)) {
  fail("An explicitly requested missing Jarl executable must fail clearly, even when the scope has no R files")
}
if (.Platform$OS.type != "windows") {
  fake_jarl_path <- file.path(work, "fake-jarl")
  jarl_payload <- jsonlite::toJSON(list(
    diagnostics = list(list(
      message = list(name = "unreachable_code", body = "This code is unreachable.", suggestion = NULL),
      filename = normalizePath(valid_r_path, winslash = "/", mustWork = TRUE),
      range = list(0L, 1L),
      location = list(row = 2L, column = 2L),
      fix = list(content = "", start = 0L, end = 0L, to_skip = TRUE)
    )),
    errors = list()
  ), auto_unbox = TRUE, null = "null")
  writeLines(c("#!/bin/sh", "cat <<'JARL_JSON'", jarl_payload, "JARL_JSON", "exit 1"), fake_jarl_path)
  Sys.chmod(fake_jarl_path, mode = "0755")
  jarl_result <- parse_result("--jarl", fake_jarl_path, valid_r_path)
  expect_identical(jarl_result$engines$jarl, "ran", "Results must prove that requested Jarl analysis ran")
  jarl_c_result <- parse_result("--jarl", fake_jarl_path, c_path)
  expect_identical(jarl_c_result$engines$jarl, "no-r-input", "Results must distinguish a Jarl request with no R input")
  jarl_findings <- Filter(function(finding) startsWith(finding$rule, "jarl/"), jarl_result$findings)
  if (length(jarl_findings) != 1L) {
    fail("Requested Jarl diagnostics must be validated, namespaced, and normalized to one-based locations")
  }
  jarl_checks <- c(
    identical(jarl_findings[[1]]$rule, "jarl/unreachable_code"),
    identical(jarl_findings[[1]]$line, 2L),
    identical(jarl_findings[[1]]$column, 3L)
  )
  if (!all(jarl_checks)) {
    fail("Requested Jarl diagnostics must be validated, namespaced, and normalized to one-based locations")
  }

  invalid_jarl_payload <- sub('"row":2', '"row":2.5', jarl_payload, fixed = TRUE)
  writeLines(c("#!/bin/sh", "cat <<'JARL_JSON'", invalid_jarl_payload, "JARL_JSON", "exit 1"), fake_jarl_path)
  invalid_jarl_result <- run_analyzer("--jarl", fake_jarl_path, valid_r_path)
  if (invalid_jarl_result$code == 0L || !grepl("malformed diagnostic location", invalid_jarl_result$output, fixed = TRUE)) {
    fail("Jarl diagnostics with fractional locations must fail explicitly")
  }
}

tree_path <- file.path(work, "tree")
dir.create(file.path(tree_path, "nested"), recursive = TRUE)
writeLines(c(
  ".across_files <- function(x) x",
  "is_scalar <- function(x) is.character(x) && nzchar(x)"
), file.path(tree_path, "helper.R"))
writeLines(c(
  "f <- function(x) {",
  "  if (!length(x)) return(.across_files(x))",
  "  if (is_scalar(x)) return(x)",
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
tree_predicate <- Filter(function(finding) identical(finding$rule, "r-single-use-predicate-helper"), tree_result$findings)
if (length(tree_predicate) != 1L || !grepl("is_scalar has one direct call, from f", tree_predicate[[1]]$message, fixed = TRUE)) {
  fail("Directory scans must connect non-dot predicate helpers to callers across the analysis scope")
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
