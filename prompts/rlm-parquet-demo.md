---
description: Exercise RLM over parquet context with repl_eval and R loader snippets
argument-hint: "[replace the placeholder parquet path in the prompt]"
---
Use the `rlm` tool with:

- `task`: `The context is parquet. Prefer r_eval with context_load() for row/column inspection. Also surface the loader snippet via context_r_load_code() or repl_eval+rLoadCode(), and mention the generated R loading approach. $@`
- `contextKind`: `parquet`
- `contextPath`: `path/to/data.parquet`
- `mode`: `auto`

Then report the final answer, whether `repl_eval` was used, and summarize the suggested R loading code.
