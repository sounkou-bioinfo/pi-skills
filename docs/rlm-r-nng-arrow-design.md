# RLM R Sessions over NNG + nanoarrow

## Direction

Replace webR-oriented `r_eval` with real system R. The current interim path runs configurable system `Rscript` directly. The target path is persistent R worker sessions that communicate with Pi over NNG using a byte-level protocol. RLM remains the recursive orchestration feature; the R session layer is a reusable runtime bus that RLM can consume.

## Confirmed decisions

- **No webR as the default RLM R runtime.** Real system R is the serious path.
- **No stdio fallback.** Use NNG only.
- **Node transport:** use a Rust/N-API bridge around an ergonomic NNG Rust crate.
- **R worker dependencies:** keep minimal:
  - `nanonext` for NNG
  - `nanoarrow` for Arrow-compatible data handling and IPC bytes
- **DuckDB integration first:** DuckHTS is the first serious target; the design should compose cleanly with DuckDB-native extensions such as DuckHTS, `ducknng`, and `ducktinycc`.
- **Parquet handling:** prefer DuckDB on the Node/runtime side instead of custom parquet parsing code.
- **Multiple sessions:** support isolated R worker environments.
- **Sticky sessions:** `session_id -> worker` routing; one session stays attached to the same R process.
- **First scheduling model:** per-session message queue/lock. More distributed scheduling can come later.
- **Shared state:** one persistent `.GlobalEnv` per session, available to both agent and user.
- **Artifacts:** artifact is a response serialization mode, not an afterthought.
- **Model-facing output:** prefer concise summaries and handles; full output/artifacts are stored and can be inspected.

## Important distinction: C data vs wire bytes

`nanoarrow`/Arrow C Data Interface is enough for representing tables/arrays at the R boundary, but raw C pointers do **not** cross process or remote boundaries. The NNG wire protocol must send bytes.

Practical rule:

- inside R worker: use `nanoarrow` arrays/streams where useful
- over NNG: send protocol-defined byte messages
- table payloads: Arrow IPC-compatible bytes generated/consumed through `nanoarrow`
- images/files: raw bytes plus metadata
- object/session references: typed records in the protocol envelope

## NNG channels

Use NNG patterns according to role:

- **REQ/REP**: eval requests and final responses
- **PUB/SUB**: logs, progress, artifact announcements, session events
- **PAIR**: control path such as cancel/shutdown for one session
- **SURVEY/RESPONDENT**: worker discovery and capability reports
- **PUSH/PULL**: optional future job queue / scaling layer

Initial implementation can use REQ/REP plus optional PUB/SUB events.

## Session modes

- `spawn`: Pi starts a local R worker.
- `container`: Pi starts an R container worker.
- `connect`: Pi connects to an existing local/remote worker.

Example session IDs:

- `default`
- `project-qc`
- `remote-hpc-1`
- `rlm-run-<id>-node-<id>`

## Byte protocol sketch

All NNG messages are bytes with a small fixed header plus typed sections. This avoids JSON control messages.

Proposed frame layout:

```text
magic              8 bytes   "PIRNGA1\0"
header_len         u32 le
section_count      u32 le
headers            bytes     protocol-defined binary header table
sections           bytes[]   payload sections
```

Each section has metadata in the header table:

```text
section_id
kind               eval_code | arrow_ipc | bytes | artifact | error | summary | object_ref | control
content_type       text/x-r | application/vnd.apache.arrow.stream | image/png | text/plain | ...
name               optional
encoding           utf8 | binary | arrow_ipc_stream
flags              bitset
byte_offset
byte_length
```

The exact header table can itself be Arrow IPC bytes to stay self-describing, but it must be cheap to parse and versioned.

## Message kinds

Required high-level message kinds:

- `hello`
- `capabilities`
- `create_session`
- `attach_session`
- `eval`
- `result`
- `final`
- `rlm_call`
- `resume`
- `artifact`
- `objects`
- `error`
- `cancel`
- `shutdown`
- `heartbeat`

## Eval semantics

Pi sends an `eval` message with:

- `session_id`
- `eval_id`
- R code bytes
- optional context payload sections
- output/truncation preferences

R worker evaluates in the session `.GlobalEnv`.

R worker returns one of:

- `result`: normal value/summary/artifacts
- `final`: RLM final result
- `rlm_call`: request child RLM call; Pi executes child and sends `resume`
- `error`: structured error

## R helper API

Available inside the R worker session:

```r
context_load()
context_r_load_code()
install_r_packages(c("pkg"))
save_plot("plot.png", expr)
rlm_call(task, subcontext = NULL, context_kind = NULL)
FINAL(x)
FINAL_VAR("name")
```

Old webR package helper names should not be kept or documented; use `install_r_packages()` for system-R package setup.

## Error handling requirements

Errors must be first-class protocol messages. Preserve:

- `error_class`
- `error_message`
- `condition_call`
- base traceback if available
- `rlang` backtrace if available
- stdout/stderr/log tail
- `session_alive`
- `recoverable`
- protocol/schema version
- serialization failure details

Distinguish:

- R evaluation error, session alive
- R interrupt/cancel
- worker crash
- NNG connection failure
- Arrow/nanoarrow serialization failure
- payload too large
- protocol version mismatch

## Output and truncation policy

Mirror Pi bash semantics:

- configurable model-facing output truncation
- default similar to bash: last 2000 lines or 50KB where text is involved
- full output stored when truncated
- artifact/object/table handles returned in summaries
- hidden execution mode analogous to `!!command`

The model should usually see:

```text
r_eval session=default eval=<id>
summary: ...
objects: df=data.frame[1203991 x 18]
artifacts: plot_001=image/png
truncated: full output saved at ...
```

## User-facing access

Primary UX should be slash commands:

```text
/r attach default
/r eval head(df)
/r objects
/r artifacts
/r sessions
/r close default
```

Convenience via Pi `user_bash` intercept:

```text
!r head(df)     # include summary in model context
!!r head(df)    # execute but exclude from model context
```

## Core Pi integration path

Phase 0: current interim implementation uses configurable system `Rscript` plus Node-side DuckDB for parquet context loading.

Phase 1: implement persistent NNG-backed system-R workers as this package's RLM/R-session extension, with DuckHTS as the first integration target.

Phase 2: expose it as a general runtime session primitive:

```text
Pi agent loop -> runtime session manager -> nng-arrow workers
```

This would support R first, then potentially Python, DuckDB, genomics kernels, or remote tool daemons.

## Open issues

1. Choose the exact Rust NNG crate and N-API packaging strategy.
2. Decide whether the protocol header table is fixed binary, Arrow IPC, or a hybrid.
3. Confirm `nanoarrow` R APIs for producing/consuming Arrow IPC bytes without full `arrow` dependency.
4. Define maximum message sizes and chunking rules.
5. Define remote artifact storage for workers whose file paths are not visible to Pi.
6. Implement cancellation strategy for local, container, and remote sessions.
7. Decide how much session lifecycle state is persisted across Pi restarts.
8. Define capability discovery schema.
