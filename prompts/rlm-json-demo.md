---
description: Exercise RLM over parsed JSON context with repl_eval and recursive subcalls
argument-hint: "[task override]"
---
Use the `rlm` tool with:

- `task`: `Use repl_eval and callRlm. The context is JSON. Select only the records with keep=true, then answer with the kept names joined by commas. $@`
- `contextKind`: `json`
- `context`:

```json
[{"name":"alpha","keep":false},{"name":"beta","keep":true},{"name":"gamma","keep":true}]
```

- `mode`: `auto`

Then report the final answer and mention whether recursive child calls happened.
