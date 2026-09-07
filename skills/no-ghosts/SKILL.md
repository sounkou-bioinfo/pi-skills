---
name: no-ghosts
description: Apply whenever writing or editing any prose artifact or test - docs, code comments, PR descriptions, commit messages, issues, READMEs. Keeps edit history out of the text.
---

Don't catalog the history of the artifact. Keep wording one-shot and
standalone. The text doesn't need an internal change-log.

The reader only sees the final version. Anything that was added then removed
during the work netted to zero, don't mention it. When editing, replace,
don't annotate: "do abc", not "do abc, never xyz". The result should read
like it was written right the first time.

Tests state the final behavior, regardless of RED/GREEN sequencing.

Exception: "don't do X" is fine when X is a real trap a fresh reader would
walk into on their own, not just "it used to be here".
