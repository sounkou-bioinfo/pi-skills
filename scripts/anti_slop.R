#!/usr/bin/env Rscript

# AST-only, configurable checks for redundant R and unsafe C extension patterns.
# This script deliberately has no regex parser fallback: treesitter and the
# language grammar named by --language must be installed.

rule_defaults <- c(
  "r-final-return" = "warning",
  "r-rethrow-handler" = "warning",
  "r-duplicate-adjacent-guard" = "warning",
  "r-else-null" = "warning",
  "r-private-helper-usage" = "warning",
  "r-conditional-sprawl" = "warning",
  "r-implicit-length-test" = "warning",
  "c-final-void-return" = "warning",
  "c-duplicate-adjacent-guard" = "warning",
  "c-empty-else" = "warning",
  "c-runtime-assert" = "warning"
)

usage <- function() {
  paste(
    "Usage: Rscript scripts/anti_slop.R [options] FILE_OR_DIRECTORY",
    "",
    "Options:",
    "  --language auto|r|c    Source language (default: auto from source suffix)",
    "  --config FILE          JSON rule configuration",
    "  --format text|json     Result format (default: text)",
    "  --max-findings N       Maximum findings to emit (default: 100)",
    sep = "\n"
  )
}

fail <- function(message) stop(message, call. = FALSE)

require_package <- function(package) {
  if (!requireNamespace(package, quietly = TRUE)) {
    fail(paste0(
      "anti-slop requires R package '", package,
      "'. Install it before analysis; no parser fallback is available."
    ))
  }
}

parse_args <- function(args) {
  out <- list(language = "auto", config = NULL, format = "text", max_findings = 100L, path = NULL)
  i <- 1L
  while (i <= length(args)) {
    arg <- args[[i]]
    take_value <- function(option) {
      i <<- i + 1L
      if (i > length(args) || startsWith(args[[i]], "--")) fail(paste0(option, " requires a value"))
      args[[i]]
    }
    if (arg == "--language") {
      out$language <- take_value(arg)
    } else if (startsWith(arg, "--language=")) {
      out$language <- sub("^--language=", "", arg)
    } else if (arg == "--config") {
      out$config <- take_value(arg)
    } else if (startsWith(arg, "--config=")) {
      out$config <- sub("^--config=", "", arg)
    } else if (arg == "--format") {
      out$format <- take_value(arg)
    } else if (startsWith(arg, "--format=")) {
      out$format <- sub("^--format=", "", arg)
    } else if (arg == "--max-findings") {
      out$max_findings <- suppressWarnings(as.integer(take_value(arg)))
    } else if (startsWith(arg, "--max-findings=")) {
      out$max_findings <- suppressWarnings(as.integer(sub("^--max-findings=", "", arg)))
    } else if (arg %in% c("-h", "--help")) {
      cat(usage(), "\n")
      quit(status = 0L)
    } else if (startsWith(arg, "--")) {
      fail(paste0("Unknown option: ", arg))
    } else if (is.null(out$path)) {
      out$path <- arg
    } else {
      fail("Provide exactly one source FILE")
    }
    i <- i + 1L
  }
  if (is.null(out$path)) fail("Provide one source FILE")
  if (!out$language %in% c("auto", "r", "c")) fail("--language must be auto, r, or c")
  if (!out$format %in% c("text", "json")) fail("--format must be text or json")
  if (is.na(out$max_findings) || out$max_findings < 1L) fail("--max-findings must be a positive integer")
  out
}

infer_language <- function(path) {
  suffix <- tolower(tools::file_ext(path))
  if (suffix %in% c("r")) return("r")
  if (suffix %in% c("c", "h", "inc")) return("c")
  fail("Cannot infer language from source suffix; use --language r or --language c")
}

source_paths <- function(path, language) {
  path <- normalizePath(path, winslash = "/", mustWork = TRUE)
  if (!dir.exists(path)) return(path)

  git_root <- tryCatch(
    suppressWarnings(system2("git", c("-C", path, "rev-parse", "--show-toplevel"), stdout = TRUE, stderr = FALSE)),
    error = function(error) structure(character(), status = 1L)
  )
  git_root <- if (identical(attr(git_root, "status") %||% 0L, 0L) && length(git_root) == 1L && dir.exists(git_root)) {
    normalizePath(git_root, winslash = "/", mustWork = TRUE)
  } else {
    NULL
  }
  candidates <- if (!is.null(git_root)) {
    relative <- if (identical(path, git_root)) "." else substring(path, nchar(git_root) + 2L)
    tracked <- tryCatch(
      suppressWarnings(system2("git", c("-C", git_root, "ls-files", "--", relative), stdout = TRUE, stderr = FALSE)),
      error = function(error) structure(character(), status = 1L)
    )
    file.path(git_root, tracked)
  } else {
    list.files(path, recursive = TRUE, full.names = TRUE, include.dirs = FALSE, no.. = TRUE)
  }
  candidates <- candidates[file.exists(candidates) & !dir.exists(candidates)]
  inferred <- vapply(candidates, function(candidate) {
    tryCatch(infer_language(candidate), error = function(error) NA_character_)
  }, character(1))
  included <- !is.na(inferred) & (language == "auto" | inferred == language)
  paths <- sort(unique(normalizePath(candidates[included], winslash = "/", mustWork = TRUE)))
  if (length(paths) == 0L) {
    fail(paste0("No ", if (language == "auto") "R or C" else toupper(language), " source files found under: ", path))
  }
  paths
}

read_rule_config <- function(path) {
  rules <- rule_defaults
  max_findings <- NULL
  if (is.null(path)) return(list(rules = rules, max_findings = max_findings))
  require_package("jsonlite")
  if (!file.exists(path)) fail(paste0("Rule configuration does not exist: ", path))
  config <- tryCatch(
    jsonlite::fromJSON(path, simplifyVector = FALSE),
    error = function(error) fail(paste0("Invalid anti-slop JSON configuration: ", conditionMessage(error)))
  )
  if (!is.list(config)) fail("Anti-slop JSON configuration must be an object")
  if (!is.null(config$rules)) {
    if (!is.list(config$rules) || is.null(names(config$rules))) {
      fail("Configuration field 'rules' must be an object mapping rule names to warning, error, or off")
    }
    unknown <- setdiff(names(config$rules), names(rule_defaults))
    if (length(unknown) > 0L) fail(paste0("Unknown anti-slop rule(s): ", paste(unknown, collapse = ", ")))
    for (name in names(config$rules)) {
      severity <- config$rules[[name]]
      if (!is.character(severity) || length(severity) != 1L || !severity %in% c("warning", "error", "off")) {
        fail(paste0("Rule '", name, "' must be warning, error, or off"))
      }
      rules[[name]] <- severity
    }
  }
  if (!is.null(config$max_findings)) {
    max_findings <- suppressWarnings(as.integer(config$max_findings))
    if (is.na(max_findings) || max_findings < 1L) fail("Configuration 'max_findings' must be a positive integer")
  }
  list(rules = rules, max_findings = max_findings)
}

node_type <- treesitter::node_type
node_text <- treesitter::node_text
node_named_children <- treesitter::node_named_children
node_parent <- treesitter::node_parent
node_field <- treesitter::node_child_by_field_name

walk_tree <- function(node, visitor) {
  visitor(node)
  for (child in node_named_children(node)) walk_tree(child, visitor)
}

node_name <- function(node) {
  if (is.null(node)) return("")
  trimws(node_text(node))
}

normalized_node_text <- function(node) gsub("[[:space:]]+", "", node_text(node))

node_location <- function(node) {
  start <- treesitter::node_start_point(node)
  end <- treesitter::node_end_point(node)
  list(
    line = treesitter::point_row(start) + 1L,
    column = treesitter::point_column(start) + 1L,
    end_line = treesitter::point_row(end) + 1L,
    end_column = treesitter::point_column(end) + 1L
  )
}

new_finding <- function(rule, severity, message, path, node) {
  location <- node_location(node)
  c(
    list(
      rule = rule,
      severity = severity,
      message = message,
      path = path,
      excerpt = trimws(node_text(node))
    ),
    location
  )
}

function_name <- function(node, function_field = "function") {
  fun <- node_field(node, function_field)
  if (is.null(fun)) return("")
  node_name(fun)
}

call_argument_nodes <- function(call) {
  arguments <- node_field(call, "arguments")
  if (is.null(arguments)) return(list())
  Filter(function(node) identical(node_type(node), "argument"), node_named_children(arguments))
}

r_function_body <- function(node) node_field(node, "body")

is_r_return_call <- function(node) {
  identical(node_type(node), "call") && identical(function_name(node), "return")
}

r_handler_rethrows <- function(handler) {
  if (!identical(node_type(handler), "function_definition")) return(FALSE)
  parameters <- node_field(handler, "parameters")
  if (is.null(parameters)) return(FALSE)
  params <- Filter(function(node) identical(node_type(node), "parameter"), node_named_children(parameters))
  if (length(params) != 1L) return(FALSE)
  caught <- node_field(params[[1]], "name")
  body <- r_function_body(handler)
  if (is.null(caught) || is.null(body) || !identical(node_type(body), "call") || !identical(function_name(body), "stop")) {
    return(FALSE)
  }
  arguments <- call_argument_nodes(body)
  length(arguments) == 1L && identical(node_name(node_field(arguments[[1]], "value")), node_name(caught))
}

r_pure_guard <- function(node) {
  type <- node_type(node)
  if (type %in% c("identifier", "integer", "float", "complex", "string", "null", "true", "false")) return(TRUE)
  if (type %in% c("binary_operator", "unary_operator", "parenthesized_expression")) {
    return(all(vapply(node_named_children(node), r_pure_guard, logical(1))))
  }
  if (!identical(type, "call")) return(FALSE)
  allowed <- c(
    "is.null", "is.na", "is.character", "is.numeric", "is.logical", "is.integer",
    "is.double", "is.factor", "is.list", "is.vector", "is.matrix", "is.data.frame",
    "length", "nrow", "ncol", "nzchar", "isTRUE", "isFALSE"
  )
  if (!function_name(node) %in% allowed) return(FALSE)
  arguments <- call_argument_nodes(node)
  all(vapply(arguments, function(argument) r_pure_guard(node_field(argument, "value")), logical(1)))
}

r_terminates <- function(node) {
  if (identical(node_type(node), "call")) return(function_name(node) %in% c("stop", "return"))
  if (!identical(node_type(node), "braced_expression")) return(FALSE)
  statements <- node_named_children(node)
  length(statements) == 1L && r_terminates(statements[[1]])
}

r_unwrap_parentheses <- function(node) {
  if (!identical(node_type(node), "parenthesized_expression")) return(node)
  children <- node_named_children(node)
  if (length(children) != 1L) return(node)
  r_unwrap_parentheses(children[[1]])
}

r_boolean_clause_count <- function(node) {
  node <- r_unwrap_parentheses(node)
  if (!identical(node_type(node), "binary_operator") || !node_name(node_field(node, "operator")) %in% c("&&", "||", "&", "|")) {
    return(1L)
  }
  r_boolean_clause_count(node_field(node, "lhs")) + r_boolean_clause_count(node_field(node, "rhs"))
}

r_is_length_call <- function(node) {
  identical(node_type(r_unwrap_parentheses(node)), "call") && identical(function_name(r_unwrap_parentheses(node)), "length")
}

r_is_implicit_length_test <- function(node) {
  node <- r_unwrap_parentheses(node)
  if (r_is_length_call(node)) return(TRUE)
  identical(node_type(node), "unary_operator") &&
    identical(node_name(node_field(node, "operator")), "!") &&
    r_is_length_call(node_field(node, "rhs"))
}

r_condition_sites <- function(root) {
  sites <- list()
  walk_tree(root, function(node) {
    type <- node_type(node)
    if (type %in% c("if_statement", "while_statement")) {
      condition <- node_field(node, "condition")
      if (!is.null(condition)) sites[[length(sites) + 1L]] <<- condition
      return()
    }
    if (!identical(type, "call") || !function_name(node) %in% c("ifelse", "if_else", "dplyr::if_else")) return()
    arguments <- call_argument_nodes(node)
    if (length(arguments) > 0L) {
      condition <- node_field(arguments[[1]], "value")
      if (!is.null(condition)) sites[[length(sites) + 1L]] <<- condition
    }
  })
  sites
}

r_private_helper_definitions <- function(root) {
  definitions <- list()
  for (statement in node_named_children(root)) {
    if (!identical(node_type(statement), "binary_operator") || !node_name(node_field(statement, "operator")) %in% c("<-", "=")) next
    name <- node_field(statement, "lhs")
    definition <- node_field(statement, "rhs")
    if (is.null(name) || is.null(definition) || !identical(node_type(name), "identifier") || !identical(node_type(definition), "function_definition")) next
    if (startsWith(node_name(name), ".")) definitions[[node_name(name)]] <- statement
  }
  definitions
}

find_r_final_return <- function(root, path, severity) {
  findings <- list()
  walk_tree(root, function(node) {
    if (!identical(node_type(node), "function_definition")) return()
    body <- r_function_body(node)
    if (is.null(body) || !identical(node_type(body), "braced_expression")) return()
    statements <- node_named_children(body)
    if (length(statements) == 0L) return()
    final <- statements[[length(statements)]]
    if (is_r_return_call(final)) {
      findings[[length(findings) + 1L]] <<- new_finding(
        "r-final-return", severity,
        "The final expression of an R function is returned automatically; remove this final return().",
        path, final
      )
    }
  })
  findings
}

find_r_rethrow_handler <- function(root, path, severity) {
  findings <- list()
  walk_tree(root, function(node) {
    if (!identical(node_type(node), "call") || !identical(function_name(node), "tryCatch")) return()
    for (argument in call_argument_nodes(node)) {
      name <- node_field(argument, "name")
      value <- node_field(argument, "value")
      if (identical(node_name(name), "error") && r_handler_rethrows(value)) {
        findings[[length(findings) + 1L]] <<- new_finding(
          "r-rethrow-handler", severity,
          "This tryCatch(error = function(e) stop(e)) handler only rethrows the caught error.",
          path, argument
        )
      }
    }
  })
  findings
}

find_r_duplicate_adjacent_guard <- function(root, path, severity) {
  findings <- list()
  walk_tree(root, function(node) {
    if (!identical(node_type(node), "braced_expression")) return()
    statements <- node_named_children(node)
    if (length(statements) < 2L) return()
    for (index in seq_len(length(statements) - 1L)) {
      first <- statements[[index]]
      second <- statements[[index + 1L]]
      if (!identical(node_type(first), "if_statement") || !identical(node_type(second), "if_statement")) next
      first_condition <- node_field(first, "condition")
      second_condition <- node_field(second, "condition")
      first_consequence <- node_field(first, "consequence")
      if (is.null(first_condition) || is.null(second_condition) || is.null(first_consequence)) next
      if (!r_pure_guard(first_condition) || !r_terminates(first_consequence)) next
      if (identical(normalized_node_text(first_condition), normalized_node_text(second_condition))) {
        findings[[length(findings) + 1L]] <<- new_finding(
          "r-duplicate-adjacent-guard", severity,
          "An immediately preceding pure guard has the same condition and terminates; this guard is unreachable or redundant.",
          path, second
        )
      }
    }
  })
  findings
}

find_r_else_null <- function(root, path, severity) {
  findings <- list()
  walk_tree(root, function(node) {
    if (!identical(node_type(node), "if_statement") || !identical(node_type(node_parent(node)), "braced_expression")) return()
    alternative <- node_field(node, "alternative")
    if (!is.null(alternative) && identical(node_type(alternative), "null")) {
      findings[[length(findings) + 1L]] <<- new_finding(
        "r-else-null", severity,
        "A standalone if statement already yields NULL when its condition is false; remove else NULL.",
        path, alternative
      )
    }
  })
  findings
}

find_r_private_helper_usage <- function(root, path, severity, call_counts = NULL) {
  definitions <- r_private_helper_definitions(root)
  if (length(definitions) == 0L) return(list())
  if (is.null(call_counts)) {
    calls <- character()
    walk_tree(root, function(node) {
      if (identical(node_type(node), "call")) calls <<- c(calls, function_name(node))
    })
    call_counts <- table(calls)
  }
  lapply(names(definitions), function(name) {
    count <- if (name %in% names(call_counts)) unname(call_counts[[name]]) else 0L
    new_finding(
      "r-private-helper-usage", severity,
      sprintf(
        "Private helper %s has %d direct call site(s) in this analysis scope. Justify the distinct repeated invariant or effect it owns; otherwise inline it or consolidate authority.",
        name, count
      ),
      path, definitions[[name]]
    )
  })
}

find_r_conditional_sprawl <- function(root, path, severity) {
  lapply(Filter(function(condition) r_boolean_clause_count(condition) > 3L, r_condition_sites(root)), function(condition) {
    count <- r_boolean_clause_count(condition)
    new_finding(
      "r-conditional-sprawl", severity,
      sprintf(
        "This conditional has %d atomic boolean clauses. State and justify its one decision/admission invariant; split only where distinct invariants really exist.", count
      ),
      path, condition
    )
  })
}

find_r_implicit_length_test <- function(root, path, severity) {
  lapply(Filter(r_is_implicit_length_test, r_condition_sites(root)), function(condition) {
    new_finding(
      "r-implicit-length-test", severity,
      sprintf(
        "Condition %s relies on numeric-to-logical coercion: 0L is FALSE and positive lengths are TRUE. State the intended cardinality explicitly with length(...) == 0L or > 0L.",
        dQuote(trimws(node_text(condition)))
      ),
      path, condition
    )
  })
}

c_pure_guard <- function(node) {
  type <- node_type(node)
  if (type %in% c("identifier", "field_identifier", "number_literal", "char_literal", "string_literal", "null", "true", "false")) return(TRUE)
  if (type %in% c(
    "parenthesized_expression", "binary_expression", "unary_expression", "pointer_expression",
    "field_expression", "subscript_expression", "sizeof_expression", "cast_expression"
  )) {
    return(all(vapply(node_named_children(node), c_pure_guard, logical(1))))
  }
  FALSE
}

c_is_return_statement <- function(node) identical(node_type(node), "return_statement")

find_c_final_void_return <- function(root, path, severity) {
  findings <- list()
  walk_tree(root, function(node) {
    if (!identical(node_type(node), "function_definition")) return()
    type <- node_field(node, "type")
    body <- node_field(node, "body")
    if (is.null(type) || node_name(type) != "void" || is.null(body) || !identical(node_type(body), "compound_statement")) return()
    statements <- node_named_children(body)
    if (length(statements) == 0L) return()
    final <- statements[[length(statements)]]
    if (c_is_return_statement(final) && identical(gsub("[[:space:]]+", "", node_text(final)), "return;")) {
      findings[[length(findings) + 1L]] <<- new_finding(
        "c-final-void-return", severity,
        "A void function falls through at its end; remove this final return; statement.",
        path, final
      )
    }
  })
  findings
}

find_c_duplicate_adjacent_guard <- function(root, path, severity) {
  findings <- list()
  walk_tree(root, function(node) {
    if (!identical(node_type(node), "compound_statement")) return()
    statements <- node_named_children(node)
    if (length(statements) < 2L) return()
    for (index in seq_len(length(statements) - 1L)) {
      first <- statements[[index]]
      second <- statements[[index + 1L]]
      if (!identical(node_type(first), "if_statement") || !identical(node_type(second), "if_statement")) next
      first_condition <- node_field(first, "condition")
      second_condition <- node_field(second, "condition")
      first_consequence <- node_field(first, "consequence")
      if (is.null(first_condition) || is.null(second_condition) || is.null(first_consequence)) next
      if (!c_pure_guard(first_condition) || !c_is_return_statement(first_consequence)) next
      if (identical(normalized_node_text(first_condition), normalized_node_text(second_condition))) {
        findings[[length(findings) + 1L]] <<- new_finding(
          "c-duplicate-adjacent-guard", severity,
          "An immediately preceding side-effect-free guard has the same condition and returns; this guard is unreachable or redundant.",
          path, second
        )
      }
    }
  })
  findings
}

find_c_empty_else <- function(root, path, severity) {
  findings <- list()
  walk_tree(root, function(node) {
    if (!identical(node_type(node), "if_statement")) return()
    alternative <- node_field(node, "alternative")
    if (is.null(alternative) || !identical(node_type(alternative), "else_clause")) return()
    alternative_children <- node_named_children(alternative)
    if (length(alternative_children) != 1L || !identical(node_type(alternative_children[[1]]), "compound_statement")) return()
    if (length(node_named_children(alternative_children[[1]])) == 0L) {
      findings[[length(findings) + 1L]] <<- new_finding(
        "c-empty-else", severity,
        "An empty else block has no effect; remove else {}.",
        path, alternative
      )
    }
  })
  findings
}

find_c_runtime_assert <- function(root, path, severity) {
  findings <- list()
  walk_tree(root, function(node) {
    if (!identical(node_type(node), "call_expression") || !identical(function_name(node), "assert")) return()
    findings[[length(findings) + 1L]] <<- new_finding(
      "c-runtime-assert", severity,
      "assert() can abort an embedded host; use an explicit status or host-visible error for runtime validation.",
      path, node
    )
  })
  findings
}

find_parse_errors <- function(root, path) {
  findings <- list()
  walk_tree(root, function(node) {
    if (!treesitter::node_is_error(node) && !treesitter::node_is_missing(node)) return()
    findings[[length(findings) + 1L]] <<- new_finding(
      "parse-error", "error",
      "Tree-sitter could not parse this source exactly; anti-slop did not run style rules.",
      path, node
    )
  })
  if (treesitter::node_has_error(root) && length(findings) == 0L) {
    findings[[1]] <- new_finding(
      "parse-error", "error",
      "Tree-sitter could not parse this source exactly; anti-slop did not run style rules.",
      path, root
    )
  }
  findings
}

findings_for_language <- function(root, language, path, rules, private_helper_calls = NULL) {
  finders <- if (language == "r") {
    list(
      "r-final-return" = find_r_final_return,
      "r-rethrow-handler" = find_r_rethrow_handler,
      "r-duplicate-adjacent-guard" = find_r_duplicate_adjacent_guard,
      "r-else-null" = find_r_else_null,
      "r-private-helper-usage" = find_r_private_helper_usage,
      "r-conditional-sprawl" = find_r_conditional_sprawl,
      "r-implicit-length-test" = find_r_implicit_length_test
    )
  } else {
    list(
      "c-final-void-return" = find_c_final_void_return,
      "c-duplicate-adjacent-guard" = find_c_duplicate_adjacent_guard,
      "c-empty-else" = find_c_empty_else,
      "c-runtime-assert" = find_c_runtime_assert
    )
  }
  findings <- list()
  for (rule in names(finders)) {
    severity <- rules[[rule]]
    if (identical(severity, "off")) next
    findings <- c(findings, if (identical(rule, "r-private-helper-usage")) {
      finders[[rule]](root, path, severity, private_helper_calls)
    } else {
      finders[[rule]](root, path, severity)
    })
  }
  findings
}

format_text <- function(result) {
  header <- sprintf(
    "%s: %s (%s): %d finding(s) across %d file(s)",
    result$path,
    if (result$ok) "parsed" else "parse error",
    result$language,
    length(result$findings),
    length(result$files)
  )
  if (length(result$findings) == 0L) return(header)
  lines <- vapply(result$findings, function(finding) {
    sprintf(
      "%s:%d:%d: %s %s: %s\n  %s",
      finding$path, finding$line, finding$column,
      toupper(finding$severity), finding$rule, finding$message, finding$excerpt
    )
  }, character(1))
  paste(c(header, lines), collapse = "\n")
}

parse_source <- function(path, language) {
  source_text <- paste(readLines(path, warn = FALSE, encoding = "UTF-8"), collapse = "\n")
  grammar <- if (language == "r") treesitter.r::language() else treesitter.c::language()
  parser <- treesitter::parser(grammar)
  root <- treesitter::tree_root_node(treesitter::parser_parse(parser, source_text))
  list(path = path, language = language, root = root, parse_errors = find_parse_errors(root, path))
}

r_private_helper_call_counts <- function(parsed_sources) {
  calls <- character()
  for (source in parsed_sources) {
    if (source$language != "r" || length(source$parse_errors) > 0L) next
    walk_tree(source$root, function(node) {
      if (identical(node_type(node), "call") && startsWith(function_name(node), ".")) {
        calls <<- c(calls, function_name(node))
      }
    })
  }
  table(calls)
}

analyze_parsed_source <- function(source, rules, private_helper_calls) {
  findings <- if (length(source$parse_errors) > 0L) {
    source$parse_errors
  } else {
    findings_for_language(source$root, source$language, source$path, rules, private_helper_calls)
  }
  list(path = source$path, language = source$language, ok = length(source$parse_errors) == 0L, findings = findings)
}

main <- function(args = commandArgs(trailingOnly = TRUE)) {
  options <- parse_args(args)
  if (!file.exists(options$path)) fail(paste0("Source path does not exist: ", options$path))
  input_path <- normalizePath(options$path, winslash = "/", mustWork = TRUE)
  paths <- source_paths(input_path, options$language)
  languages <- vapply(paths, function(path) if (options$language == "auto") infer_language(path) else options$language, character(1))
  config <- read_rule_config(options$config)
  max_findings <- config$max_findings %||% options$max_findings

  require_package("treesitter")
  for (grammar_package in unique(ifelse(languages == "r", "treesitter.r", "treesitter.c"))) require_package(grammar_package)

  parsed_sources <- unname(Map(parse_source, paths, languages))
  private_helper_calls <- r_private_helper_call_counts(parsed_sources)
  analyses <- lapply(parsed_sources, analyze_parsed_source, rules = config$rules, private_helper_calls = private_helper_calls)
  findings <- head(unname(unlist(lapply(analyses, `[[`, "findings"), recursive = FALSE)), max_findings)
  result <- list(
    path = input_path,
    language = if (length(unique(languages)) == 1L) languages[[1]] else "mixed",
    ok = all(vapply(analyses, `[[`, logical(1), "ok")),
    files = lapply(analyses, function(analysis) list(
      path = analysis$path,
      language = analysis$language,
      ok = analysis$ok,
      finding_count = length(analysis$findings)
    )),
    findings = findings
  )

  if (options$format == "json") {
    require_package("jsonlite")
    cat(jsonlite::toJSON(result, auto_unbox = TRUE, pretty = TRUE, null = "null"), "\n", sep = "")
  } else {
    cat(format_text(result), "\n", sep = "")
  }
  invisible(result)
}

`%||%` <- function(left, right) if (is.null(left)) right else left

if (sys.nframe() == 0L) main()
