# Rewrite Workflow

## Minimal rewrite loop

1. Pin upstream version
2. Identify one narrow slice of functionality
3. Implement it
4. Validate output against upstream
5. Add regression tests
6. Expand scope

## Questions to answer early

- What exact problem does the rewrite solve?
- Is the goal speed, deployment, portability, composition, or all of these?
- Which users need exact compatibility?
- Which output artifacts must remain identical?
- What downstream tools depend on those artifacts?

## Deliverables worth keeping in-repo

- validation scripts
- benchmark scripts
- pinned upstream references
- explicit compatibility notes
- changelog entries for semantic differences
