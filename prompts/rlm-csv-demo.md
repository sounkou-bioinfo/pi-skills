---
description: Exercise RLM over parsed CSV context with repl_eval or r_eval
argument-hint: "[task override]"
---
Use the `rlm` tool with:

- `task`: `The context is CSV. Count rows and report the names where score >= 7. Prefer repl_eval or r_eval. $@`
- `contextKind`: `csv`
- `context`:

```text
name,score
alpha,5
beta,7
gamma,9
```

- `mode`: `auto`

Then report the final answer and mention which strategy was used.
