# Compatibility porting

## Questions to answer early

- What exact problem does the rewrite solve: speed, deployment, portability, composition?
- Which users need exact compatibility?
- Which output artifacts must remain identical?
- What downstream tools depend on those artifacts?

## Minimal loop

1. Pin the upstream version.
2. Identify one narrow slice of functionality.
3. Implement it.
4. Validate output against upstream.
5. Add regression tests.
6. Expand scope.

## Claims

A compatibility claim states:

- exact upstream version;
- exact command;
- exact dataset;
- what equivalence means: byte identity, field equality, or numeric tolerance.

Keep validation scripts, benchmark scripts, pinned upstream references, and
compatibility notes in the repository. Record semantic differences in the changelog.
Document unsupported features explicitly.

## Attribution

Make upstream credit visible in the README, function or command docs, citations,
and release notes when relevant.
