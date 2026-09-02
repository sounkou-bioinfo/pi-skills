#!/usr/bin/env Rscript

# AST-only, configurable checks for redundant R and unsafe C extension patterns.
# This script deliberately has no regex parser fallback: treesitter and the
# language grammar named by --language must be installed.

rule_defaults <- c(
  "r-final-return" = "warning",
  "r-rethrow-handler" = "warning",
  "r-duplicate-adjacent-guard" = "warning",
  "r-else-null" = "warning",
  "r-redundant-else-after-termination" = "warning",
  "r-identical-if-branches" = "warning",
  "r-private-helper-usage" = "warning",
  "r-single-use-predicate-helper" = "warning",
  "r-scalar-validator-helper" = "warning",
  "r-path-threat-model" = "warning",
  "r-conditional-sprawl" = "warning",
  "r-implicit-length-test" = "warning",
  "r-cyclomatic-complexity" = "warning",
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
    "  --jarl COMMAND         Also run the installed Jarl R linter",
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

take_cli_value <- function(args, index, option, inline_value) {
  if (!is.null(inline_value)) return(list(value = inline_value, index = index))
  index <- index + 1L
  if (index > length(args)) fail(paste0(option, " requires a value"))
  if (startsWith(args[[index]], "--")) fail(paste0(option, " requires a value"))
  list(value = args[[index]], index = index)
}

validate_cli_options <- function(options) {
  if (is.null(options$path)) fail("Provide one source FILE")
  if (!options$language %in% c("auto", "r", "c")) fail("--language must be auto, r, or c")
  if (!options$format %in% c("text", "json")) fail("--format must be text or json")
  if (is.na(options$max_findings)) fail("--max-findings must be a positive integer")
  if (options$max_findings < 1L) fail("--max-findings must be a positive integer")
  options
}

parse_args <- function(args) {
  out <- list(language = "auto", config = NULL, format = "text", max_findings = 100L, jarl = NULL, path = NULL)
  option_fields <- c(
    "--language" = "language",
    "--config" = "config",
    "--format" = "format",
    "--max-findings" = "max_findings",
    "--jarl" = "jarl"
  )
  i <- 1L
  while (i <= length(args)) {
    arg <- args[[i]]
    has_inline_value <- startsWith(arg, "--") && grepl("=", arg, fixed = TRUE)
    option <- if (has_inline_value) sub("=.*$", "", arg) else arg
    inline_value <- if (has_inline_value) sub("^[^=]*=", "", arg) else NULL
    if (option %in% names(option_fields)) {
      parsed <- take_cli_value(args, i, option, inline_value)
      value <- parsed$value
      if (option == "--max-findings") value <- suppressWarnings(as.integer(value))
      out[[option_fields[[option]]]] <- value
      i <- parsed$index
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
  validate_cli_options(out)
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

merge_rule_config <- function(rules, configured_rules) {
  if (is.null(configured_rules)) return(rules)
  if (!is.list(configured_rules)) {
    fail("Configuration field 'rules' must be an object mapping rule names to warning, error, or off")
  }
  if (is.null(names(configured_rules))) {
    fail("Configuration field 'rules' must be an object mapping rule names to warning, error, or off")
  }
  unknown <- setdiff(names(configured_rules), names(rules))
  if (length(unknown) > 0L) fail(paste0("Unknown anti-slop rule(s): ", paste(unknown, collapse = ", ")))
  for (name in names(configured_rules)) {
    severity <- configured_rules[[name]]
    if (!is.character(severity)) fail(paste0("Rule '", name, "' must be warning, error, or off"))
    if (length(severity) != 1L) fail(paste0("Rule '", name, "' must be warning, error, or off"))
    if (!severity %in% c("warning", "error", "off")) fail(paste0("Rule '", name, "' must be warning, error, or off"))
    rules[[name]] <- severity
  }
  rules
}

configured_max_findings <- function(value) {
  if (is.null(value)) return(NULL)
  value <- suppressWarnings(as.integer(value))
  if (length(value) != 1L) fail("Configuration 'max_findings' must be a positive integer")
  if (is.na(value)) fail("Configuration 'max_findings' must be a positive integer")
  if (value < 1L) fail("Configuration 'max_findings' must be a positive integer")
  value
}

read_rule_config <- function(path) {
  if (is.null(path)) return(list(rules = rule_defaults, max_findings = NULL))
  require_package("jsonlite")
  if (!file.exists(path)) fail(paste0("Rule configuration does not exist: ", path))
  config <- tryCatch(
    jsonlite::fromJSON(path, simplifyVector = FALSE),
    error = function(error) fail(paste0("Invalid anti-slop JSON configuration: ", conditionMessage(error)))
  )
  if (!is.list(config)) fail("Anti-slop JSON configuration must be an object")
  list(
    rules = merge_rule_config(rule_defaults, config$rules),
    max_findings = configured_max_findings(config$max_findings)
  )
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
  if (is.null(caught)) return(FALSE)
  if (is.null(body)) return(FALSE)
  if (!identical(node_type(body), "call")) return(FALSE)
  if (!identical(function_name(body), "stop")) return(FALSE)
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

r_top_level_function_definitions <- function(root) {
  definitions <- list()
  for (statement in node_named_children(root)) {
    if (!identical(node_type(statement), "binary_operator")) next
    if (!node_name(node_field(statement, "operator")) %in% c("<-", "=")) next
    name <- node_field(statement, "lhs")
    definition <- node_field(statement, "rhs")
    if (is.null(name)) next
    if (is.null(definition)) next
    if (!identical(node_type(name), "identifier")) next
    if (!identical(node_type(definition), "function_definition")) next
    definitions[[node_name(name)]] <- statement
  }
  definitions
}

r_private_helper_definitions <- function(root) {
  definitions <- r_top_level_function_definitions(root)
  if (length(definitions) == 0L) return(definitions)
  definitions[startsWith(names(definitions), ".")]
}

r_function_expression <- function(definition) {
  body <- r_function_body(definition)
  if (is.null(body)) return(NULL)
  if (!identical(node_type(body), "braced_expression")) return(body)
  statements <- node_named_children(body)
  if (length(statements) == 1L) return(statements[[1]])
  NULL
}

r_predicate_expression <- function(node, helper_names, require_predicate = FALSE) {
  node <- r_unwrap_parentheses(node)
  type <- node_type(node)
  if (type %in% c("identifier", "integer", "float", "complex", "string", "null", "true", "false")) return(!require_predicate)
  if (identical(type, "unary_operator")) {
    return(identical(node_name(node_field(node, "operator")), "!") && r_predicate_expression(node_field(node, "rhs"), helper_names))
  }
  if (identical(type, "binary_operator")) {
    operator <- node_name(node_field(node, "operator"))
    return(operator %in% c("&&", "||", "&", "|", "==", "!=", "<", ">", "<=", ">=", "%in%") &&
      all(vapply(node_named_children(node), r_predicate_expression, logical(1), helper_names = helper_names)))
  }
  if (!identical(type, "call")) return(FALSE)
  predicate_calls <- c(
    "grepl", "identical", "startsWith", "endsWith", "file.exists", "file.access",
    "length", "nrow", "ncol", "nzchar", "isTRUE", "isFALSE"
  )
  name <- function_name(node)
  if (!name %in% helper_names && !name %in% predicate_calls && !startsWith(name, "is.")) return(FALSE)
  if (require_predicate && name %in% c("length", "nrow", "ncol", "file.access")) return(FALSE)
  arguments <- call_argument_nodes(node)
  all(vapply(arguments, function(argument) r_predicate_expression(node_field(argument, "value"), helper_names), logical(1)))
}

r_function_call_names <- function(node) {
  calls <- character()
  visit <- function(current) {
    if (identical(node_type(current), "function_definition")) return()
    if (identical(node_type(current), "call")) calls <<- c(calls, function_name(current))
    for (child in node_named_children(current)) visit(child)
  }
  visit(node)
  calls
}

r_assigned_function_name <- function(definition) {
  assignment <- node_parent(definition)
  if (is.null(assignment) || !identical(node_type(assignment), "binary_operator")) return("")
  name <- node_field(assignment, "lhs")
  if (is.null(name) || !identical(node_type(name), "identifier")) "" else node_name(name)
}

r_enclosing_assigned_function_name <- function(node) {
  ancestor <- node_parent(node)
  while (!is.null(ancestor)) {
    if (identical(node_type(ancestor), "function_definition")) {
      name <- r_assigned_function_name(ancestor)
      if (nzchar(name)) return(name)
    }
    ancestor <- node_parent(ancestor)
  }
  ""
}

r_cyclomatic_node_score <- function(node) {
  type <- node_type(node)
  if (identical(type, "function_definition")) return(0L)
  score <- if (identical(type, "if_statement")) {
    1L
  } else if (type %in% c("for_statement", "while_statement")) {
    2L
  } else if (identical(type, "repeat_statement")) {
    1L
  } else if (identical(type, "binary_operator") && node_name(node_field(node, "operator")) %in% c("&&", "||")) {
    1L
  } else {
    0L
  }
  children <- Filter(function(child) !identical(node_type(child), "function_definition"), node_named_children(node))
  score + sum(vapply(children, r_cyclomatic_node_score, integer(1)))
}

r_cyclomatic_complexity <- function(definition) {
  body <- r_function_body(definition)
  1L + if (is.null(body)) 0L else r_cyclomatic_node_score(body)
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

find_r_redundant_else_after_termination <- function(root, path, severity) {
  findings <- list()
  walk_tree(root, function(node) {
    if (!identical(node_type(node), "if_statement") || !identical(node_type(node_parent(node)), "braced_expression")) return()
    consequence <- node_field(node, "consequence")
    alternative <- node_field(node, "alternative")
    if (is.null(alternative) || is.null(consequence) || !r_terminates(consequence)) return()
    findings[[length(findings) + 1L]] <<- new_finding(
      "r-redundant-else-after-termination", severity,
      "A standalone if branch already stops or returns; remove the redundant else and outdent its alternative.",
      path, alternative
    )
  })
  findings
}

find_r_identical_if_branches <- function(root, path, severity) {
  findings <- list()
  walk_tree(root, function(node) {
    if (!identical(node_type(node), "if_statement")) return()
    condition <- node_field(node, "condition")
    consequence <- node_field(node, "consequence")
    alternative <- node_field(node, "alternative")
    if (any(vapply(list(condition, consequence, alternative), is.null, logical(1)))) return()
    if (!r_pure_guard(condition)) return()
    if (!identical(normalized_node_text(consequence), normalized_node_text(alternative))) return()
    findings[[length(findings) + 1L]] <<- new_finding(
      "r-identical-if-branches", severity,
      "A side-effect-free condition selects identical branches; remove the conditional after confirming that forcing the condition is not part of the contract.",
      path, node
    )
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

find_r_single_use_predicate_helper <- function(root, path, severity, call_scope) {
  definitions <- r_top_level_function_definitions(root)
  if (length(definitions) == 0L) return(list())
  helper_names <- names(definitions)
  findings <- list()
  for (name in helper_names) {
    count <- if (name %in% names(call_scope$counts)) unname(call_scope$counts[[name]]) else 0L
    callers <- unique(call_scope$callers[[name]] %||% character())
    if (count != 1L || length(callers) != 1L || identical(callers[[1]], name)) next
    definition <- node_field(definitions[[name]], "rhs")
    expression <- r_function_expression(definition)
    if (is.null(expression) || !r_predicate_expression(expression, helper_names, require_predicate = TRUE)) next
    findings[[length(findings) + 1L]] <- new_finding(
      "r-single-use-predicate-helper", severity,
      sprintf(
        "Predicate helper %s has one direct call, from %s. This helper chain obscures one admission expression; inline it unless the helper owns an independently reused invariant.",
        name, callers[[1]]
      ),
      path, definitions[[name]]
    )
  }
  findings
}

find_r_scalar_validator_helper <- function(root, path, severity) {
  findings <- list()
  definitions <- r_top_level_function_definitions(root)
  for (name in names(definitions)) {
    statement <- definitions[[name]]
    definition <- node_field(statement, "rhs")
    expression <- r_function_expression(definition)
    if (is.null(expression)) next
    calls <- unique(r_function_call_names(expression))
    if (!all(c("is.character", "length", "is.na", "nzchar") %in% calls)) next
    findings[[length(findings) + 1L]] <- new_finding(
      "r-scalar-validator-helper", severity,
      sprintf(
        "Scalar-string helper %s hand-rolls a translated type/cardinality/missingness layer. Put a concise admission check at a real boundary, or rely on the trusted producer contract, instead of composing reusable is_* predicates.",
        name
      ),
      path, statement
    )
  }
  findings
}

find_r_path_threat_model <- function(root, path, severity) {
  findings <- list()
  definitions <- r_top_level_function_definitions(root)
  for (name in names(definitions)) {
    statement <- definitions[[name]]
    definition <- node_field(statement, "rhs")
    body <- r_function_body(definition)
    if (is.null(body)) next
    parent_segment_guard <- FALSE
    visit <- function(node) {
      if (identical(node_type(node), "function_definition")) return()
      if (identical(node_type(node), "call") && identical(function_name(node), "grepl")) {
        arguments <- call_argument_nodes(node)
        if (length(arguments) > 0L) {
          pattern <- node_field(arguments[[1]], "value")
          pattern_text <- if (is.null(pattern) || !identical(node_type(pattern), "string")) "" else node_text(pattern)
          if (grepl("\\\\.\\\\.", pattern_text, fixed = TRUE) &&
              (grepl("/", pattern_text, fixed = TRUE) || grepl("\\\\", pattern_text, fixed = TRUE))) {
            parent_segment_guard <<- TRUE
          }
        }
      }
      for (child in node_named_children(node)) {
        if (!identical(node_type(child), "function_definition")) visit(child)
      }
    }
    visit(body)
    if (!parent_segment_guard) next
    findings[[length(findings) + 1L]] <- new_finding(
      "r-path-threat-model", severity,
      sprintf(
        "Path helper %s rejects parent segments as if it crossed a privilege boundary. Document the distinct producer/consumer principals and privileges; same-principal local R config does not justify traversal-security boilerplate.",
        name
      ),
      path, statement
    )
  }
  findings
}

find_r_cyclomatic_complexity <- function(root, path, severity) {
  findings <- list()
  walk_tree(root, function(node) {
    if (!identical(node_type(node), "function_definition")) return()
    complexity <- r_cyclomatic_complexity(node)
    if (complexity < 15L) return()
    name <- r_assigned_function_name(node)
    findings[[length(findings) + 1L]] <<- new_finding(
      "r-cyclomatic-complexity", severity,
      sprintf(
        "R function %s has cyclomatic complexity %d; the policy requires less than 15. Reduce control-flow paths or justify the irreducible decision structure.",
        if (nzchar(name)) name else "<anonymous>", complexity
      ),
      path, node
    )
  })
  findings
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
    if (is.null(type)) return()
    if (node_name(type) != "void") return()
    if (is.null(body)) return()
    if (!identical(node_type(body), "compound_statement")) return()
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

findings_for_language <- function(root, language, path, rules, private_helper_calls = NULL, call_scope = NULL) {
  finders <- if (language == "r") {
    list(
      "r-final-return" = find_r_final_return,
      "r-rethrow-handler" = find_r_rethrow_handler,
      "r-duplicate-adjacent-guard" = find_r_duplicate_adjacent_guard,
      "r-else-null" = find_r_else_null,
      "r-redundant-else-after-termination" = find_r_redundant_else_after_termination,
      "r-identical-if-branches" = find_r_identical_if_branches,
      "r-private-helper-usage" = find_r_private_helper_usage,
      "r-single-use-predicate-helper" = find_r_single_use_predicate_helper,
      "r-scalar-validator-helper" = find_r_scalar_validator_helper,
      "r-path-threat-model" = find_r_path_threat_model,
      "r-conditional-sprawl" = find_r_conditional_sprawl,
      "r-implicit-length-test" = find_r_implicit_length_test,
      "r-cyclomatic-complexity" = find_r_cyclomatic_complexity
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
    } else if (identical(rule, "r-single-use-predicate-helper")) {
      finders[[rule]](root, path, severity, call_scope)
    } else {
      finders[[rule]](root, path, severity)
    })
  }
  findings
}

jarl_assert <- function(condition, message) {
  if (!isTRUE(condition)) fail(message)
  invisible(TRUE)
}

jarl_finding <- function(diagnostic) {
  malformed <- "Jarl returned a malformed diagnostic"
  malformed_location <- "Jarl returned a malformed diagnostic location"
  jarl_assert(is.list(diagnostic), malformed)
  jarl_assert(all(vapply(c("message", "location"), function(name) is.list(diagnostic[[name]]), logical(1))), malformed)
  fields <- list(
    name = diagnostic$message$name,
    body = diagnostic$message$body,
    filename = diagnostic$filename,
    row = diagnostic$location$row,
    column = diagnostic$location$column
  )
  string_fields <- fields[c("name", "body", "filename")]
  valid_strings <- vapply(string_fields, function(value) all(c(is.character(value), length(value) == 1L)), logical(1))
  jarl_assert(all(valid_strings), malformed)
  coordinates <- unlist(fields[c("row", "column")], use.names = FALSE)
  jarl_assert(is.numeric(coordinates), malformed_location)
  jarl_assert(length(coordinates) == 2L, malformed_location)
  jarl_assert(all(is.finite(coordinates)), malformed_location)
  jarl_assert(all(coordinates == floor(coordinates)), malformed_location)
  jarl_assert(coordinates[[1]] >= 1, malformed_location)
  jarl_assert(coordinates[[2]] >= 0, malformed_location)
  jarl_assert(coordinates[[1]] <= .Machine$integer.max, malformed_location)
  jarl_assert(coordinates[[2]] < .Machine$integer.max, malformed_location)
  path <- normalizePath(fields$filename, winslash = "/", mustWork = TRUE)
  line <- as.integer(coordinates[[1]])
  column <- as.integer(coordinates[[2]]) + 1L
  source_lines <- readLines(path, warn = FALSE, encoding = "UTF-8")
  suggestion <- diagnostic$message$suggestion
  message <- fields$body
  has_suggestion <- is.character(suggestion)
  if (has_suggestion) has_suggestion <- length(suggestion) == 1L
  if (has_suggestion) has_suggestion <- nzchar(suggestion)
  if (has_suggestion) message <- paste0(message, " Suggestion: ", suggestion)
  excerpt <- ""
  if (line <= length(source_lines)) excerpt <- trimws(source_lines[[line]])
  list(
    rule = paste0("jarl/", fields$name),
    severity = "warning",
    message = message,
    path = path,
    excerpt = excerpt,
    line = line,
    column = column,
    end_line = line,
    end_column = column
  )
}

find_jarl_findings <- function(command, paths) {
  executable <- unname(Sys.which(command))
  if (!nzchar(executable)) fail(paste0("Requested Jarl executable was not found: ", command))
  if (length(paths) == 0L) return(list())
  require_package("jsonlite")
  stdout_path <- tempfile("anti-slop-jarl-stdout-")
  stderr_path <- tempfile("anti-slop-jarl-stderr-")
  on.exit(unlink(c(stdout_path, stderr_path), force = TRUE), add = TRUE)
  status <- tryCatch(
    suppressWarnings(system2(
      executable,
      c("check", "--output-format", "json", shQuote(paths)),
      stdout = stdout_path,
      stderr = stderr_path
    )),
    error = function(error) fail(paste0("Jarl execution failed: ", conditionMessage(error)))
  )
  stdout <- paste(readLines(stdout_path, warn = FALSE, encoding = "UTF-8"), collapse = "\n")
  stderr <- paste(readLines(stderr_path, warn = FALSE, encoding = "UTF-8"), collapse = "\n")
  payload <- tryCatch(
    jsonlite::fromJSON(stdout, simplifyVector = FALSE),
    error = function(error) fail(paste0("Jarl returned malformed JSON: ", conditionMessage(error), if (nzchar(stderr)) paste0("\n", stderr) else ""))
  )
  if (!is.list(payload) || !is.list(payload$diagnostics) || !is.list(payload$errors)) {
    fail("Jarl returned malformed JSON: expected diagnostics and errors arrays")
  }
  if (length(payload$errors) > 0L) {
    errors <- vapply(payload$errors, function(error) {
      if (is.list(error) && is.character(error$error) && length(error$error) == 1L) error$error else "Unknown Jarl error"
    }, character(1))
    fail(paste(c("Jarl analysis failed:", errors), collapse = "\n"))
  }
  if (!status %in% c(0L, 1L)) {
    fail(paste0("Jarl exited with status ", status, if (nzchar(stderr)) paste0(": ", stderr) else ""))
  }
  lapply(payload$diagnostics, jarl_finding)
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

r_direct_call_scope <- function(parsed_sources) {
  calls <- character()
  callers <- list()
  for (source in parsed_sources) {
    if (source$language != "r" || length(source$parse_errors) > 0L) next
    walk_tree(source$root, function(node) {
      if (!identical(node_type(node), "call")) return()
      callee <- function_name(node)
      if (!nzchar(callee)) return()
      calls <<- c(calls, callee)
      caller <- r_enclosing_assigned_function_name(node)
      if (nzchar(caller)) callers[[callee]] <<- c(callers[[callee]], caller)
    })
  }
  list(counts = table(calls), callers = callers)
}

analyze_parsed_source <- function(source, rules, private_helper_calls, call_scope) {
  findings <- if (length(source$parse_errors) > 0L) {
    source$parse_errors
  } else {
    findings_for_language(source$root, source$language, source$path, rules, private_helper_calls, call_scope)
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
  call_scope <- r_direct_call_scope(parsed_sources)
  analyses <- lapply(
    parsed_sources,
    analyze_parsed_source,
    rules = config$rules,
    private_helper_calls = call_scope$counts,
    call_scope = call_scope
  )
  if (!is.null(options$jarl)) {
    parsed_ok <- vapply(parsed_sources, function(source) length(source$parse_errors) == 0L, logical(1))
    jarl_paths <- paths[languages == "r" & parsed_ok]
    jarl_findings <- find_jarl_findings(options$jarl, jarl_paths)
    analysis_paths <- vapply(analyses, `[[`, character(1), "path")
    for (finding in jarl_findings) {
      index <- match(finding$path, analysis_paths)
      if (is.na(index)) fail(paste0("Jarl returned a diagnostic outside the analysis scope: ", finding$path))
      analyses[[index]]$findings <- c(analyses[[index]]$findings, list(finding))
    }
  }
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
