# Project memory

[Operating notes](operations.md) · [Orientation workflow](../skills/project-orientation/SKILL.md)

Memory preserves learning and evidence, not hidden instructions. It cannot
certify correctness, applicability, or human understanding.

## Identity and scope

`memory op=status` reports the active project, identity source, checkout state,
resolved graph and counts. The tool defaults to that project:

- `graph=project`: active project; an error if none is known.
- `graph=global`: `memory:shared`, for genuinely cross-project knowledge.
- `graph=legacy`: explicit, read-only access to v1 history.
- An exact graph ID: explicit access to another project or named scope.

`PI_MEMORY_PROJECT` supplies an explicit stable ID (1–180 UTF-8 bytes). Otherwise,
a Git checkout's `origin` supplies the identity. HTTPS/SSH/SCP forms normalize to host/path;
credentials, query strings and fragments are discarded. Fork origins differ.
GitHub paths are case-normalized; other hosts retain path case. No network lookup
or remote fetch is used to decide identity.

Without a usable origin, identity is a hash of the local Git common-directory
path: worktrees share it, but independent clones or moves need an override to
share memory. Non-Git directories need an override for project-scoped writes;
there is no implicit directory-name identity or global write fallback. Remote
aliases, redirects, unusual ports, shared-origin forks and intentional project
splits also need an explicit override. Check `status` rather than guessing.

Scope and sharing are separate. The existing SQLite location remains local by
default; this adds no synchronization, team-access policy, export, or automatic
promotion into `AGENTS.md`. Project labels are relevance boundaries, **not an
access-control boundary** for users who can read the database.

## Current knowledge, history and applicability

Use a stable subject/predicate for one evolving fact or decision, for example:

```json
{"op":"note","subject":"rlm/watchdog","predicate":"design:decision","text":"Termination belongs outside the evaluator: a post-await infinite loop blocked the in-process watchdog.","evidence":{"source":"extensions/rlm/rlm.test.ts","revision":"<actually tested revision>","runtime":"<observed loaded artifact, if known>"}}
```

The example's placeholders must be replaced or omitted, not saved as evidence.
Text remains one line of at most 280 UTF-8 bytes. Each optional evidence field is
one line of at most 500 UTF-8 bytes. The automatically recorded checkout/project
is a separate transaction-receipt field: it is **not** proof the claim was tested
there. A dirty flag includes tracked and untracked work and is not a content hash.
Keep source observations distinct from claims about installed/loaded artifacts.

- `recall` searches current semantic slots in the selected scope by default.
  `history=true` includes superseded notes. Legacy recall remains historical.
- `wake` is a bounded historical frontier. `zoom` follows its exact summary IDs.
  Historical summaries may contain superseded claims, not current policy.
- `nap` requests/submits compression **in one graph**. Use the returned graph,
  summary ID and source hash. Evidence/recorded-context metadata is included in
  leaf compression sources. Summary wording is still model-authored and fallible.
- `forget` invalidates a summary and its ancestors only in the selected graph.
- `as_of` accepts a transaction or timestamp. Immutable stanza/transaction IDs
  remain stable; numeric note positions and summary ranges are local to a graph.
- `sql` exposes scoped `as_of_statement`, `as_of_note`, `current_note`, summary and
  traversal views. Raw `memo.*` relations remain available for explicit cross-scope
  audits; they are not scope-filtered. SELECT-only execution is not row-level ACL.

Automatic context arrives as projections. Each projection selects up to eight
current records (global, current project, and task matches) plus current
replacements for records shown earlier, within 12 KiB. FTS uses a shared corpus
but scope/current-slot filtering precedes ordering and limits. Oversized
collections omit whole records with an explicit notice; omitted records can
appear in a later projection. Superseded versions, legacy records and other
projects are not injected automatically. Current slots can still contain stale
beliefs: task-dependent verification matters.

A projection is added only on the first request of a user turn, immediately
before that user message, and only when it carries something new: a record the
branch has not shown for the active project, or a different project. Records
already shown are not repeated. When a later note replaces a shown record's
subject and predicate, the replacement leads the next projection, and the text
tells the model that the later record replaces the earlier one. Notes written
during a turn appear on the next user turn. Identity is resolved when a
projection is built and on each tool invocation; out-of-band Git changes without
a tool call are seen at the next turn. No claim of continuous filesystem
monitoring or loaded-runtime detection is made.

Delivered projections never change or move, so provider prompt caches and
Claude's preserved thinking stay valid across turns. Each is recorded as a
`pi-memory-projection-v1` custom entry on the session branch, with its
transaction, recorded checkout and FTS query, and replays byte-identically after
reload or tree navigation. These entries are not model messages, and the
model-visible text omits the transaction and checkout receipts. A projection
whose user message is edited, removed or compacted is no longer sent, and its
records become eligible again. Session files therefore contain delivered memory
text.

## Existing databases and older sessions

No history is rewritten, guessed into a project, or silently declared global.
New scoped notes and summaries use distinct `memory:scoped-note/` and
`memory:scoped-summary/` identifiers. The original physical schema and v1 views
remain unchanged; v1 note/summary views exclude the new identifiers while raw
statement views still contain all records. V1 mixed summaries
and old snapshots stay available through explicit legacy reads. Contextual views
resolve v1 and scoped version slots separately, so a matching old label cannot
supersede a scoped fact (or vice versa). Raw `memo.*` views retain their v1 rules.

An old graph label—even one matching a new project/global name—does not promote
a v1 record into a scoped tree or automatic context. Use `graph=legacy` and SQL
filters to inspect particular old labels. The new automatic global graph is
deliberately **not** the old `memory:global` label. Review a relevant legacy claim
and save a new scoped note with its source and applicability; do not bulk relabel
mixed history. Old notes and summaries remain.

The low-level store retains unscoped v1 operations for compatibility; supplying
a graph opts into the scoped protocol, so reads/compression must use that same
graph. The Pi tool always resolves a scope and rejects legacy mutations. Updating a checkout does
not update running sessions. Finish live work, update/install dependencies and
reload each session deliberately. Tests cover v1 view isolation and new-connection
snapshot reads, not a matrix of concurrently loaded old/new Pi hosts.

The storage path, WAL/native dependencies and cold-cache requirements are in
[operating notes](operations.md). Current tests and missing failure/host evidence
are listed in [the coverage inventory](../TEST_PLAN.md).
