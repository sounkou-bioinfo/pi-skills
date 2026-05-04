---
description: Exercise the RLM tool with a deterministic R computation that should require r_eval
argument-hint: "[extra instructions]"
---
Use the `rlm` tool with:

- `task`: `Run set.seed(1995); sum(rnorm(100)) in R and return just the numeric result. Use r_eval. $@`
- `context`:

```text
R numeric task
```

- `mode`: `auto`

Then report the final answer and mention whether `r_eval` was used.
