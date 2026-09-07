---
name: native-tool-discipline
description: Apply whenever selecting tools, commands, scripts, or file-editing methods. Keeps work in harness-native tools and the repository's implementation languages.
---

Use the narrowest native tool that directly performs the operation.

- Inspect files with the read tool.
- Make targeted replacements with the edit tool.
- Use the write tool for new files or intentional complete rewrites.
- Use shell utilities for straightforward file operations, searches, and byte
  counts.
- Use the repository's language and existing tooling for project logic.

Do not use Python as a generic shell, text-editing, counting, JSON, or file
transformation escape hatch. Unnecessary Python primes unrelated Python
patterns and increases implementation slop.

Python is appropriate when the repository or task is Python-based, the user
requests it, or a specific Python capability makes the operation materially
safer or clearer than the native alternatives.
