#!/usr/bin/env Rscript

file_arg <- grep("^--file=", commandArgs(trailingOnly = FALSE), value = TRUE)
if (length(file_arg) != 1L) stop("Run this script with Rscript.", call. = FALSE)
script_dir <- dirname(normalizePath(sub("^--file=", "", file_arg[[1]]), mustWork = TRUE))
source(file.path(script_dir, "..", "..", "r-c-anti-slop", "scripts", "anti_slop.R"), local = TRUE)

usage <- function() {
  "Usage: Rscript consumer_opportunities.R [--format=text|json] [--max-groups=N] PACKAGE_DIR"
}

parse_options <- function(args) {
  options <- list(format = "text", max_groups = 8L, path = NULL)
  for (arg in args) {
    if (arg %in% c("-h", "--help")) {
      cat(usage(), "\n")
      quit(status = 0L)
    }
    if (startsWith(arg, "--format=")) {
      options$format <- substring(arg, nchar("--format=") + 1L)
    } else if (startsWith(arg, "--max-groups=")) {
      options$max_groups <- positive_integer(substring(arg, nchar("--max-groups=") + 1L), "--max-groups must be a positive integer")
    } else if (startsWith(arg, "--")) {
      fail(paste0("Unknown option: ", arg))
    } else if (is.null(options$path)) {
      options$path <- arg
    } else {
      fail(usage())
    }
  }
  if (is.null(options$path) || !options$format %in% c("text", "json")) fail(usage())
  options
}

package_generics <- function(sources) {
  generics <- character()
  for (source in sources) {
    for (statement in node_named_children(source$root)) {
      if (!identical(node_type(statement), "binary_operator")) next
      if (!node_name(node_field(statement, "operator")) %in% c("<-", "=")) next
      name <- node_field(statement, "lhs")
      value <- node_field(statement, "rhs")
      if (is.null(name) || !identical(node_type(name), "identifier")) next
      if (is.null(value) || !identical(node_type(value), "call")) next
      if (function_name(value) %in% c("S7::new_generic", "new_generic")) {
        generics <- c(generics, node_name(name))
      }
    }
  }
  unique(generics)
}

formal_names <- function(definition) {
  parameters <- node_field(definition, "parameters")
  if (is.null(parameters)) return(character())
  params <- Filter(function(node) identical(node_type(node), "parameter"), node_named_children(parameters))
  setdiff(vapply(params, function(param) node_name(node_field(param, "name")), character(1)), "...")
}

consumer_calls <- function(definition, generics) {
  formals <- formal_names(definition)
  calls <- list()
  visit <- function(node) {
    if (identical(node_type(node), "function_definition")) return()
    if (identical(node_type(node), "call") && function_name(node) %in% generics) {
      arguments <- call_argument_nodes(node)
      if (length(arguments) > 0L && !nzchar(node_name(node_field(arguments[[1]], "name")))) {
        receiver <- node_field(arguments[[1]], "value")
        if (!is.null(receiver) && identical(node_type(receiver), "identifier") && node_name(receiver) %in% formals) {
          calls[[length(calls) + 1L]] <<- list(generic = function_name(node), receiver = node_name(receiver))
        }
      }
    }
    for (child in node_named_children(node)) visit(child)
  }
  body <- r_function_body(definition)
  if (!is.null(body)) visit(body)
  calls
}

consumer_evidence <- function(sources, generics, package_path) {
  evidence <- list()
  for (source in sources) {
    definitions <- r_top_level_function_definitions(source$root)
    for (name in names(definitions)) {
      definition <- node_field(definitions[[name]], "rhs")
      calls <- consumer_calls(definition, generics)
      for (receiver in unique(vapply(calls, `[[`, character(1), "receiver"))) {
        operations <- unique(vapply(Filter(function(call) identical(call$receiver, receiver), calls), `[[`, character(1), "generic"))
        if (length(operations) < 2L) next
        evidence[[length(evidence) + 1L]] <- list(
          function_name = name,
          receiver = receiver,
          path = substring(source$path, nchar(package_path) + 2L),
          line = node_location(definitions[[name]])$line,
          operations = sort(operations)
        )
      }
    }
  }
  evidence
}

scalar_checkmate_site <- function(node, formals) {
  callee <- function_name(node)
  if (!startsWith(callee, "checkmate::")) return(NULL)
  callee <- substring(callee, nchar("checkmate::") + 1L)
  if (!startsWith(callee, "assert_") && !startsWith(callee, "check_")) return(NULL)
  arguments <- call_argument_nodes(node)
  if (length(arguments) == 0L) return(NULL)
  receiver <- node_field(arguments[[1]], "value")
  if (is.null(receiver) || !identical(node_type(receiver), "identifier") || !node_name(receiver) %in% formals) return(NULL)
  options <- vapply(arguments[-1L], node_text, character(1))
  list(kind = "checkmate", signature = paste(c(callee, options), collapse = ", "), receiver = node_name(receiver))
}

scalar_guard_signature <- function(node, receiver) {
  node <- r_unwrap_parentheses(node)
  type <- node_type(node)
  if (identical(type, "identifier")) {
    if (identical(node_name(node), receiver)) return("<arg>")
    return(node_name(node))
  }
  if (identical(type, "unary_operator")) {
    return(paste0(node_name(node_field(node, "operator")), scalar_guard_signature(node_field(node, "rhs"), receiver)))
  }
  if (identical(type, "binary_operator")) {
    return(paste0("(", scalar_guard_signature(node_field(node, "lhs"), receiver), " ",
                  node_name(node_field(node, "operator")), " ",
                  scalar_guard_signature(node_field(node, "rhs"), receiver), ")"))
  }
  if (identical(type, "call")) {
    args <- vapply(call_argument_nodes(node), function(arg) scalar_guard_signature(node_field(arg, "value"), receiver), character(1))
    return(paste0(function_name(node), "(", paste(args, collapse = ", "), ")"))
  }
  node_text(node)
}

scalar_guard_sites <- function(node, formals) {
  consequence <- node_field(node, "consequence")
  if (!is.null(consequence) && identical(node_type(consequence), "braced_expression")) {
    statements <- node_named_children(consequence)
    consequence <- if (length(statements) == 1L) statements[[1]] else NULL
  }
  if (is.null(consequence) || !identical(node_type(consequence), "call") ||
      !function_name(consequence) %in% c("stop", "base::stop")) return(list())
  condition <- node_field(node, "condition")
  predicates <- c("is.character", "is.numeric", "is.integer", "is.logical", "is.double",
                  "is.factor", "is.null", "is.na", "anyNA", "nzchar", "length", "inherits")
  calls <- r_function_call_names(condition)
  if (length(calls) == 0L || !all(calls %in% predicates)) return(list())
  checks <- list()
  walk_tree(condition, function(part) {
    if (!identical(node_type(part), "call")) return()
    arguments <- call_argument_nodes(part)
    if (length(arguments) == 0L) return()
    value <- node_field(arguments[[1]], "value")
    if (is.null(value) || !identical(node_type(value), "identifier") || !node_name(value) %in% formals) return()
    checks[[node_name(value)]] <<- c(checks[[node_name(value)]], function_name(part))
  })
  lapply(names(checks)[lengths(lapply(checks, unique)) >= 2L], function(receiver) {
    list(kind = "guard", signature = scalar_guard_signature(condition, receiver), receiver = receiver)
  })
}

scalar_sites <- function(sources, package_path) {
  sites <- list()
  for (source in sources) {
    definitions <- r_top_level_function_definitions(source$root)
    for (name in names(definitions)) {
      definition <- node_field(definitions[[name]], "rhs")
      formals <- formal_names(definition)
      if (length(formals) == 0L) next
      visit <- function(node) {
        if (identical(node_type(node), "function_definition")) return()
        matches <- if (identical(node_type(node), "call")) {
          list(scalar_checkmate_site(node, formals))
        } else if (identical(node_type(node), "if_statement")) {
          scalar_guard_sites(node, formals)
        } else {
          list()
        }
        for (match in Filter(Negate(is.null), matches)) {
          sites[[length(sites) + 1L]] <<- c(match, list(
            function_name = name,
            path = substring(source$path, nchar(package_path) + 2L), line = node_location(node)$line
          ))
        }
        for (child in node_named_children(node)) visit(child)
      }
      body <- r_function_body(definition)
      if (!is.null(body)) visit(body)
    }
  }
  sites
}

scalar_groups <- function(sites) {
  groups <- list()
  for (site in sites) {
    key <- paste(site$kind, site$signature, sep = "\037")
    if (is.null(groups[[key]])) groups[[key]] <- list(kind = site$kind, signature = site$signature, consumers = list())
    groups[[key]]$consumers[[length(groups[[key]]$consumers) + 1L]] <- site[c("function_name", "receiver", "path", "line")]
  }
  groups <- Filter(function(group) {
    references <- vapply(group$consumers, function(site) paste(site$path, site$function_name, sep = ":"), character(1))
    length(unique(references)) >= 2L
  }, groups)
  if (length(groups) == 0L) return(groups)
  groups[order(-vapply(groups, function(group) length(group$consumers), integer(1)), names(groups))]
}

candidate_groups <- function(evidence) {
  groups <- list()
  for (consumer in evidence) {
    for (pair in combn(consumer$operations, 2L, simplify = FALSE)) {
      key <- paste(pair, collapse = "\037")
      if (is.null(groups[[key]])) groups[[key]] <- list(generics = pair, consumers = list())
      groups[[key]]$consumers[[length(groups[[key]]$consumers) + 1L]] <- consumer[c("function_name", "receiver", "path", "line")]
    }
  }
  groups <- Filter(function(group) {
    sites <- vapply(group$consumers, function(consumer) paste(consumer$path, consumer$function_name, sep = ":"), character(1))
    length(unique(sites)) >= 2L
  }, groups)
  if (length(groups) == 0L) return(groups)
  groups[order(-vapply(groups, function(group) length(group$consumers), integer(1)), names(groups))]
}

main <- function(args = commandArgs(trailingOnly = TRUE)) {
  options <- parse_options(args)
  package_path <- normalizePath(options$path, winslash = "/", mustWork = TRUE)
  r_dir <- file.path(package_path, "R")
  if (!dir.exists(r_dir)) fail("Expected a package R/ directory.")
  require_package("treesitter")
  require_package("treesitter.r")
  paths <- list.files(r_dir, recursive = TRUE, full.names = TRUE, include.dirs = FALSE)
  paths <- sort(paths[tolower(tools::file_ext(paths)) == "r"])
  if (length(paths) == 0L) fail("No R source files found under the package R/ directory.")
  sources <- lapply(paths, parse_source, language = "r")
  errors <- unlist(lapply(sources, `[[`, "parse_errors"), recursive = FALSE)
  if (length(errors) > 0L) fail(paste0("Tree-sitter parse error: ", errors[[1]]$path, ":", errors[[1]]$line))
  groups <- candidate_groups(consumer_evidence(sources, package_generics(sources), package_path))
  scalar <- scalar_groups(scalar_sites(sources, package_path))
  bound_groups <- function(groups) lapply(head(groups, options$max_groups), function(group) {
    count <- length(group$consumers)
    if (!is.null(group$signature)) {
      group$signature_truncated <- nchar(group$signature) > 140L
      if (group$signature_truncated) group$signature <- paste0(substr(group$signature, 1L, 137L), "...")
    }
    c(group[setdiff(names(group), "consumers")], list(
      consumer_count = count,
      sites_truncated = count > 4L,
      consumers = head(group$consumers, 4L)
    ))
  })
  candidates <- bound_groups(groups)
  result <- list(
    files_scanned = length(sources),
    total_candidate_count = length(groups),
    truncated = length(groups) > options$max_groups,
    candidates = unname(candidates),
    repeated_scalar_checks = list(
      total_candidate_count = length(scalar),
      truncated = length(scalar) > options$max_groups,
      candidates = unname(bound_groups(scalar))
    )
  )
  if (identical(options$format, "json")) {
    require_package("jsonlite")
    cat(jsonlite::toJSON(result, auto_unbox = TRUE, pretty = TRUE), "\n", sep = "")
  } else {
    cat(sprintf("%d candidate pair(s) across %d R file(s)%s\n", length(groups), length(sources), if (result$truncated) " (truncated)" else ""))
    for (group in result$candidates) {
      sites <- vapply(group$consumers, function(site) sprintf("%s:%d %s(%s)", site$path, site$line, site$function_name, site$receiver), character(1))
      cat(paste(group$generics, collapse = " + "), ": ", paste(sites, collapse = "; "),
          if (group$sites_truncated) sprintf("; ... (%d consumers total)", group$consumer_count) else "", "\n", sep = "")
    }
    cat(sprintf("%d repeated scalar-check pattern(s)%s\n", length(scalar), if (result$repeated_scalar_checks$truncated) " (truncated)" else ""))
    for (group in result$repeated_scalar_checks$candidates) {
      sites <- vapply(group$consumers, function(site) sprintf("%s:%d %s(%s)", site$path, site$line, site$function_name, site$receiver), character(1))
      cat(group$kind, " ", group$signature, ": ", paste(sites, collapse = "; "),
          if (group$sites_truncated) sprintf("; ... (%d consumers total)", group$consumer_count) else "", "\n", sep = "")
    }
  }
  invisible(result)
}

if (sys.nframe() == 0L) main()
