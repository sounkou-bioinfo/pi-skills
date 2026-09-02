# Proposal: OpenAI Codex server-side compaction with a recoverable portable checkpoint

**Repository:** `sounkou-bioinfo/pi-skills`  
**Proposed extension:** `extensions/openai-codex-compaction/`  
**Command:** `/compact-openai-codex`  
**Status:** implementation proposal; do not open a PR until the extraction experiment passes

## 1. Objective

Add an opt-in Pi compaction strategy for the **`openai-codex` subscription provider only**.

The extension must use OpenAI Codex's native Responses compaction-v2 protocol for same-model continuation, but it must not treat an opaque encrypted `compaction` item as a sufficient result. Every accepted native checkpoint must also have a readable, locally persisted **portable textual projection produced by replaying that exact checkpoint through the same exact Codex model**.

The required result of one successful compaction is therefore:

1. the provider-native encrypted `compaction` item, for high-fidelity continuation on the compatible Codex model;
2. a same-model rendered checkpoint, for Pi's `CompactionEntry.summary`, model switching, export, inspection, and recovery; and
3. deterministic validation metadata describing what exact state was preserved or lost.

A **blob-only result is failure**. If native compaction succeeds but text extraction fails, the extension must not install the native checkpoint as the active Pi compaction. It returns control to Pi's normal compactor.

This is not client-side cryptographic decryption. The client submits an authenticated checkpoint back to the provider; the provider verifies/decrypts it internally; the same model is asked to render the compacted working state into a portable representation. Until experiments establish otherwise, the output must be called a **textual projection** or **rendered checkpoint**, not the canonical plaintext of the encrypted blob.

## 2. Scope

### In scope

- `openai-codex/*` models whose Pi model descriptor has:

  ```ts
  model.provider === "openai-codex" &&
  model.api === "openai-codex-responses"
  ```

- Codex Responses compaction v2, requested by appending:

  ```json
  { "type": "compaction_trigger" }
  ```

  to an ordinary streamed Codex Responses request.

- Pi manual `/compact`, threshold compaction, and overflow recovery through the existing `session_before_compact` lifecycle.
- Session/branch-local `/compact-openai-codex on|off|status|probe` control.
- Same-exact-model extraction of a readable checkpoint.
- Exact-model/account-scoped replay after restart, tree navigation, fork, or switching away and back.
- Fail-open fallback to Pi's normal compaction.
- Offline tests plus an explicit, synthetic live probe.

### Deliberately out of scope

- Direct API-provider models under `openai/*`.
- Azure OpenAI.
- `store: true`, `previous_response_id`, automatic `context_management`, or any custom OpenAI provider registration.
- A custom WebSocket implementation. Pi's existing `openai-codex-responses` transport remains authoritative.
- Cross-provider replay.
- Treating all models in a nominal family as ciphertext-compatible.
- Exfiltration of hidden system/developer instructions or hidden chain-of-thought.
- Vendoring the complete verbatim-compaction or catalog-residual projects in the first PR.
- A session-wide SQLite/FTS archive in the first PR.

The narrow scope deletes most of the complexity in `algal/pi-openai-server-compaction`: no direct-OpenAI transport override, no WebSocket state machine, no HTTP fallback wrapper, no `previous_response_id`, and no `context_management` patching.

## 3. User-facing behavior

The command selects a strategy; it is not a second independent compaction operation.

```text
/compact-openai-codex
/compact-openai-codex status
    Show whether the strategy is enabled on the active branch, the active
    model, whether a compatible checkpoint exists, and the last result.

/compact-openai-codex on
    Persist enablement on the active branch. Future automatic compaction and
    normal /compact use Codex-native compaction when the active model is an
    eligible openai-codex model.

/compact-openai-codex off
    Persist disablement on the active branch. Future compactions use Pi's
    normal strategy and opaque Codex checkpoints are ignored.

/compact-openai-codex probe
    Run a synthetic, non-mutating live experiment against the active exact
    Codex model. Produce a local diagnostic report; do not alter session
    history or enable production use automatically.
```

The default is **off**.

Normal operation is:

```text
/compact-openai-codex on
/compact [optional focus]
```

or simply allow Pi's ordinary automatic threshold/overflow compaction to fire.

Turning the strategy off does not reverse an already written Pi compaction boundary. The append-only pre-compaction entries remain in the session JSONL, but Pi's active portable projection is the `summary` stored at that boundary. Turning the strategy on again may reactivate a compatible persisted native checkpoint.

## 4. Prior art and the exact delta

### 4.1 `algal/pi-openai-server-compaction`

Primary implementation prior art:

- <https://github.com/algal/pi-openai-server-compaction>
- architecture: <https://github.com/algal/pi-openai-server-compaction/blob/main/ARCHITECTURE.md>
- Codex compaction implementation: <https://github.com/algal/pi-openai-server-compaction/blob/main/src/remote-compaction.ts>

Useful pieces to port or adapt:

- Codex authentication/account-id extraction;
- Responses-item conversion;
- compaction-v2 request and SSE parsing;
- `CompactionEntry.details` persistence;
- exact-model reconstruction after reload/tree operations;
- fail-open behavior;
- preservation of a portable Pi summary alongside native state.

Pieces explicitly not needed here:

- direct `openai/*` provider override;
- custom WebSocket transport;
- `store: true`;
- `context_management`;
- `previous_response_id` continuation;
- Azure support.

The principal semantic delta is that the prior-art extension generates an **independent Pi text summary in parallel** with native compaction. This proposal instead asks the same Codex model to render the **actual returned native checkpoint** and uses that rendered checkpoint as Pi's portable summary.

### 4.2 Prior-art defects that must be designed out

#### Issue #17 / PR #18: silently dropped Pi-visible context

- <https://github.com/algal/pi-openai-server-compaction/issues/17>
- <https://github.com/algal/pi-openai-server-compaction/pull/18>

A blind post-compaction rewrite of:

```ts
payload.input = explicitHistory;
```

is unsafe when the extension's private converter does not represent every message Pi would have sent. The reported failure dropped:

- extension-injected `custom` messages / persisted `custom_message` entries;
- `bashExecution`;
- `branchSummary`;
- `compactionSummary`; and
- an unanswered trailing user turn.

The implementation must use Pi's exported projection functions as the semantic source of truth:

```ts
import {
  buildSessionContext,
  convertToLlm,
  sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";
```

It must not maintain a second hand-written list of Pi message kinds.

After a checkpoint, request construction must be expressed as:

```text
compatible native replacement prefix
+ every provider-visible post-checkpoint tail item
```

not as a stale cached history replacing the whole request. The newest unanswered user/custom message must always be flushed into the request.

#### Issue #14: compaction usage is now reportable

- <https://github.com/algal/pi-openai-server-compaction/issues/14>

Current Pi supports `CompactionResult.usage`. The extension must aggregate the successful native-compaction and text-extraction calls into top-level `compaction.usage`, while retaining a per-call breakdown in `details`.

#### Issues #16 and #2: direct-OpenAI transport failures

- <https://github.com/algal/pi-openai-server-compaction/issues/16>
- <https://github.com/algal/pi-openai-server-compaction/issues/2>

These concern the direct `openai/*` custom HTTP/WebSocket and `previous_response_id` paths. They are excluded by the Codex-only design.

### 4.3 Pi core constraints

Relevant Pi references:

- native compaction checkpoints request, closed as not planned: <https://github.com/earendil-works/pi/issues/6492>
- provider/session projection drift: <https://github.com/earendil-works/pi/issues/6451>
- compaction/continuation settlement: <https://github.com/earendil-works/pi/issues/5886>
- RPC abort during compaction: <https://github.com/earendil-works/pi/issues/8920>
- stale compaction inside a tool pair: <https://github.com/earendil-works/pi/issues/8667>
- fork boundary at a removed label: <https://github.com/earendil-works/pi/issues/8989>
- cold restore of a failed overflow assistant: <https://github.com/earendil-works/pi/issues/7724>

Consequences for this implementation:

- stay inside `session_before_compact`; do not append a compaction entry independently;
- use Pi's supplied `firstKeptEntryId` and `tokensBefore`;
- honor `event.signal` in both network calls;
- never synthesize a fake user turn to continue the agent;
- exclude aborted/error assistant tails from replay;
- test manual, threshold, overflow, resume, fork, and tree paths;
- leave ordinary Codex transport to Pi.

### 4.4 Verbatim compaction

- <https://github.com/kaushikgopal/pi-kaush/tree/main/extensions/pi-verbatim-compaction>
- standalone fork: <https://github.com/pi-pod/pi-verbatim-compaction>

Verbatim compaction does not decode a Codex checkpoint. It supplies two valuable things:

1. a portable control arm in which the model selects deletion ranges but deterministic host code preserves every surviving line exactly; and
2. a principled fallback target when a generated summary or rendered checkpoint is untrustworthy.

For the first PR, do not copy or depend on the full implementation. Reuse its experimental principle:

> the model selects; deterministic host code validates and mutates.

The live probe should compare Codex textual projection against an extractive/verbatim baseline. Production failure should return control to Pi's native compactor; a later PR can define explicit interoperability with verbatim compaction rather than relying on extension load order.

### 4.5 Catalog residual

- <https://github.com/professorpalmer/catalog-residual>
- paper: <https://professorpalmer.github.io/catalog-residual/paper.pdf>

Catalog residual is not a decoder either. It provides the validation and evaluation design:

- exact handle extraction for paths, symbols, commands, URIs, errors, decisions, and constraints;
- last-wins handling of superseded state;
- negative controls;
- deterministic substring oracles rather than an LLM judge;
- evidence that generated summary prose and extractive handles have complementary failure modes.

The first implementation should use a small deterministic **checkpoint manifest** as a diagnostic and acceptance guard. A later optional SQLite/FTS vault can recover material omitted from both portable summary and active native state, but it is not required to establish checkpoint textualization.

## 5. Mechanical protocol

### 5.1 Acquire provider-visible history

The compaction request must describe what Pi actually intended to send, not merely raw `entry.type === "message"` entries.

Preferred source during `session_before_compact`:

```ts
const branch = event.branchEntries;
const messages = branch.flatMap(sessionEntryToContextMessages);
const llmMessages = convertToLlm(messages);
```

Where possible, compare this projection to `ctx.sessionManager.buildSessionContext().messages` in tests. Preserve tool-call/tool-result pairing and Pi's compaction boundary.

Convert the resulting LLM messages into Responses input items while retaining:

- user messages;
- assistant output text;
- reasoning item signatures/encrypted content already persisted by Pi;
- function calls and outputs;
- input images when supported;
- Pi-projected custom/bash/branch/compaction messages.

No unsupported message may disappear silently. Conversion failure must abort the native path and fall back.

### 5.2 Request native Codex compaction v2

Resolve auth only through Pi's active model registry:

```ts
const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
```

Never read or persist raw credentials independently.

Send a normal streamed request to the current Codex Responses endpoint, normally:

```text
POST https://chatgpt.com/backend-api/codex/responses
```

with the ordinary input plus a trailing control item:

```ts
const body = {
  model: model.id,
  store: false,
  stream: true,
  instructions: ctx.getSystemPrompt(),
  input: [...responseItems, { type: "compaction_trigger" }],
  tools: buildResponsesTools(pi.getAllTools(), pi.getActiveTools()),
  tool_choice: "auto",
  parallel_tool_calls: true,
  include: ["reasoning.encrypted_content"],
  reasoning: observedReasoningShape,
  text: observedTextShape,
  prompt_cache_key: sessionId,
};
```

The request must preserve the current normal-turn reasoning/text shape when observable. It must advertise the current Codex remote-compaction-v2 beta feature when the backend requires it. Header construction should be shared with `codex-web-search` rather than copied a third time.

The SSE collector must require:

- a completed response;
- exactly one output item with `type === "compaction"`;
- non-empty `encrypted_content`; and
- no failed/incomplete status.

A `compaction_trigger` is a request control and is never persisted as conversation history.

### 5.3 Construct the native replacement prefix

Mirror current Codex, not the older 20K-token shape in early third-party implementations.

At the time of this proposal, upstream Codex v2:

- retains selected real user/developer/system messages and selected agent messages;
- applies a **64,000-token retained-message budget**; and
- appends the returned `compaction` item last.

Pin the behavior to an upstream commit in tests and isolate it behind:

```ts
buildCodexV2ReplacementHistory(input, compactionItem): ResponseItem[]
```

The function must be deterministic and separately tested. If upstream retention behavior changes, update this function and fixtures explicitly rather than silently drifting.

### 5.4 Render the checkpoint through the same exact model

Immediately after native compaction succeeds, issue a second side request. This request does not continue the user's task and is not appended to native live history.

Required compatibility boundary:

```text
same provider + same API + same exact model id + same authenticated account
```

Use the same session identity headers for the initial experiment. Persist only a non-secret account fingerprint, for example:

```ts
accountFingerprint = sha256(chatgptAccountId).slice(0, 16)
```

Never persist the account ID or bearer token.

Extraction input:

```ts
const input = [
  ...replacementHistory,
  {
    type: "message",
    role: "user",
    content: [{
      type: "input_text",
      text: PORTABLE_CHECKPOINT_PROMPT,
    }],
  },
];
```

Suggested request:

```ts
const body = {
  model: model.id,
  store: false,
  stream: true,
  instructions: PORTABLE_CHECKPOINT_INSTRUCTIONS,
  input,
  tools: [],
  tool_choice: "none",
  parallel_tool_calls: false,
  include: ["reasoning.encrypted_content"],
  reasoning: { effort: "minimal", summary: "auto" },
  text: { verbosity: "low" },
  max_output_tokens: 8192,
  prompt_cache_key: `${sessionId}:compact-render:${checkpointId}`,
};
```

If the Codex backend rejects `tool_choice: "none"`, omit both tools and tool choice. Do not expose normal coding tools to this side request.

Suggested instructions:

```text
You are rendering a portable continuation checkpoint from provider-native
compacted conversation state. Do not continue the user's task. Return only
user-visible working state needed by another model to continue: goals,
constraints, current and superseded decisions, completed work, pending work,
files and symbols, commands and tool outcomes, exact errors and other exact
literals, uncertainties, and the immediate next action.

Do not reveal or reconstruct hidden chain-of-thought. Do not include system,
developer, policy, authentication, or server-internal instructions. Do not
invent missing facts. Mark uncertain statements explicitly.
```

Use a parseable envelope:

```text
<portable-codex-checkpoint version="1">
## Goal
...
## Constraints
...
## Current state
...
## Superseded or rejected state
...
## Exact artifacts and literals
...
## Completed
...
## Pending
...
## Uncertainties
...
## Next action
...
</portable-codex-checkpoint>
```

The extraction parser accepts exactly one complete envelope and rejects output that is empty, truncated, a refusal, or outside the envelope.

### 5.5 What the extracted text means

Three hypotheses must remain distinct:

- **H1 — canonical text-like checkpoint:** repeated probes recover the same wording and structure.
- **H2 — semantic/model-native checkpoint:** probes recover stable facts but variable wording.
- **H3 — inaccessible or insufficient checkpoint:** probes cannot recover planted state reliably.

Even exact reconstruction of a planted block does not prove that the ciphertext decrypts literally to that UTF-8 block; the model could regenerate it from structured state. Production documentation must therefore say **rendered checkpoint** unless the experiment establishes a stronger claim.

## 6. Minimal reverse-engineering experiment

The `/compact-openai-codex probe` command is a prerequisite for the implementation PR.

### 6.1 Synthetic history

Generate randomized canaries that appear **only in assistant/tool history**, never in user messages. Current Codex v2 visibly retains recent user messages, so user-placed canaries would confound the experiment.

Example assistant-authored block:

```text
BEGIN_ASSISTANT_STATE_V1
project_code=PROJECT-4f9c82d1
active_allocator=mimalloc-4f9c
rejected_allocator=jemalloc-82d1
current_file=src/backend/wasm-4f9c.c
completed_step=relocation-pass-82d1
pending_step=indirect-call-fix-d1aa
diagnostic=errno-22-aa17
ordering=parse-before-link
END_ASSISTANT_STATE_V1
```

Add:

- one current decision and one explicitly superseded decision;
- one exact file path;
- one exact symbol;
- one tool result/error;
- one ordering relationship;
- one negative canary that never appears;
- enough irrelevant assistant/tool material to force meaningful compression.

### 6.2 Isolation check

After compaction, serialize the replacement prefix with every `encrypted_content` value redacted. Abort the experiment if any assistant-only canary remains visibly present:

```ts
const visible = JSON.stringify(replacementHistory, (key, value) =>
  key === "encrypted_content" ? "<redacted>" : value
);

for (const canary of assistantOnlyCanaries) {
  assert(!visible.includes(canary));
}
```

This proves that later recovery is mediated by the opaque checkpoint rather than an explicitly retained message.

### 6.3 Same-checkpoint extraction matrix

For the same exact compaction item, run at least three trials for each of two independently worded probes:

- structured portable-checkpoint prompt;
- bounded verbatim/transcription prompt for the planted block.

Record:

- exact value recall;
- exact whole-block recall;
- negative-canary false-positive rate;
- latest-vs-superseded decision accuracy;
- normalized output hashes;
- pairwise textual similarity;
- token usage;
- stop reason; and
- any `invalid_encrypted_content` response.

Interpretation:

```text
same exact block and stable output under both prompts
    strong evidence for a stable text-like representation

all facts stable but wording varies
    evidence for a semantic/model-native representation

partial or unstable state
    lossy checkpoint or unreliable textualization
```

### 6.4 Independent-compaction test

Compact the same synthetic history twice:

```text
H -> C1 -> render(C1) = T1
H -> C2 -> render(C2) = T2
```

Compare extracted fields and normalized text, not ciphertext bytes. Authenticated encryption is expected to make ciphertext equality uninformative.

### 6.5 One-token perturbation

Change exactly one canary value and repeat. Determine whether the textual projection changes locally or is globally regenerated.

### 6.6 Retention-pressure sweep

Increase irrelevant assistant/tool history while preserving the same canary block. Measure where exact literals, relationships, and current/superseded state disappear.

### 6.7 Sibling-model decoder matrix

A same-family model may be able to consume the item, as earlier reasoning-trace replay research demonstrated for encrypted reasoning artifacts. That must be treated as an experiment, not a production invariant.

Test only with synthetic data:

```text
producer: active exact model
consumer A: same exact model
consumer B: sibling model 1
consumer C: sibling model 2
```

Record three distinct outcomes:

1. rejected as `invalid_encrypted_content`;
2. accepted but poor reconstruction;
3. accepted with useful reconstruction.

Production extraction remains pinned to the exact producer model even if one current sibling happens to work. Compatibility can change server-side without a Pi release.

## 7. Deterministic checkpoint manifest

The manifest is not a second generated summary. It is a bounded, deterministic audit surface extracted from the compacted-away provider-visible transcript.

Initial categories:

```ts
interface CheckpointManifestV1 {
  filePaths: string[];
  symbols: string[];
  commands: string[];
  urls: string[];
  errorLiterals: string[];
  numericLiterals: string[];
  decisionStems: Array<{
    topic: string;
    latest: string;
    superseded: string[];
  }>;
  syntheticCanaries?: {
    required: string[];
    forbidden: string[];
  };
}
```

Bound each category by count and bytes. Redact likely secrets. Do not persist arbitrary full tool output in `details` merely to validate a summary; the full original session already remains in JSONL.

Validation report:

```ts
interface CheckpointValidationV1 {
  status: "pass" | "warn" | "fail";
  exactRecovered: string[];
  exactMissing: string[];
  forbiddenInvented: string[];
  latestDecisionConflicts: string[];
  outputBytes: number;
  truncated: boolean;
}
```

For production v1:

- a complete, non-empty extraction envelope is mandatory;
- invented forbidden literals or a current/superseded inversion is a hard failure;
- missing noncritical handles are recorded as warnings rather than requiring impossible full recall;
- probe-mode canaries use strict all-or-nothing acceptance.

If validation hard-fails, discard the native path and let Pi compact normally.

## 8. Persistence model

Persist branch-local enablement using an append-only custom entry:

```ts
pi.appendEntry("openai-codex-compaction-setting", {
  version: 1,
  enabled: true,
});
```

On `session_start` and `session_tree`, scan the active branch for the latest setting entry. Clear runtime caches before switch/fork/tree and reconstruct afterward.

Suggested compaction details:

```ts
interface OpenAICodexCompactionDetailsV1 {
  version: 1;
  implementation: "responses_compaction_v2";
  provider: "openai-codex";
  modelKey: string;                // provider:api:model id
  accountFingerprint: string;      // non-secret hash, never raw account id
  compactionResponseId?: string;
  replacementHistory: ResponseItem[];
  renderedCheckpoint: {
    version: 1;
    text: string;
    producerModelKey: string;
    extractorModelKey: string;
    promptVersion: string;
  };
  manifest: CheckpointManifestV1;
  validation: CheckpointValidationV1;
  usage?: {
    nativeCompaction?: Usage;
    checkpointRender?: Usage;
    total?: Usage;
  };
}
```

The Pi result is:

```ts
return {
  compaction: {
    summary: renderedCheckpoint.text,
    firstKeptEntryId: event.preparation.firstKeptEntryId,
    tokensBefore: event.preparation.tokensBefore,
    usage: combinedUsage,
    details: {
      openaiCodexCompaction: details,
    },
  },
};
```

The encrypted item is sensitive session state. UI/debug output must redact `encrypted_content`; documentation must warn users not to publish session JSONL files.

## 9. Post-compaction replay

### 9.1 Compatibility key

Native replay is allowed only when all match:

```text
provider
API kind
exact model id
account fingerprint
checkpoint format version
```

A model-name family match is insufficient.

### 9.2 Reconstruct native state

On session start/tree/compaction completion:

1. find the latest active compaction entry containing valid `openaiCodexCompaction` details;
2. verify exact compatibility;
3. start with persisted `replacementHistory`;
4. append every provider-visible branch item after that compaction;
5. retain an unanswered trailing user/custom turn;
6. include assistant/tool completions only when they belong to the same exact model and are not aborted/error outputs.

### 9.3 Patch only the replaced prefix

Do not assume a private `explicitHistory` cache is a complete substitute for Pi's current request.

Preferred implementation:

- derive the canonical current tail from Pi's actual outgoing payload or exported session projection;
- identify the Pi textual compaction-summary prefix corresponding to the latest checkpoint;
- replace that prefix with native `replacementHistory`;
- preserve all later payload items exactly.

Fallback implementation, if prefix identity cannot be made robust:

- rebuild the whole input from Pi's exported provider-visible projection;
- prove by tests that it is equivalent to the unmodified Pi payload for every supported message kind;
- fail closed to the unmodified payload for an unknown item kind.

Never delete `messages`, tool outputs, custom messages, or a pending user turn merely because the checkpoint cache is stale.

### 9.4 Model switching

For an incompatible model, return `undefined` from `before_provider_request`. Pi sends the readable `CompactionEntry.summary` and retained messages normally.

Switching back to the exact producer model/account may reactivate the persisted native checkpoint after reconstruction.

## 10. Failure semantics

The extension is fail-open with respect to Pi usability:

```text
native compaction failure
    -> return undefined
    -> Pi normal compaction

native compaction succeeds, rendering fails
    -> discard native candidate
    -> return undefined
    -> Pi normal compaction

rendering succeeds, validation hard-fails
    -> discard native candidate
    -> return undefined
    -> Pi normal compaction

post-compaction checkpoint incompatible or corrupt
    -> do not patch outgoing request
    -> Pi portable summary path
```

Abort behavior:

- combine `event.signal` with bounded timeouts;
- abort both network readers promptly;
- never persist a partially received compaction item or truncated rendered checkpoint;
- do not leave a runtime flag that causes later requests to replay a failed candidate.

## 11. Proposed module layout

```text
extensions/openai-codex-compaction/
  index.ts
      command registration, Pi event hooks, orchestration

  auth.ts
      shared Codex auth/header construction; preferably factored with
      extensions/codex-web-search rather than copied

  protocol.ts
      endpoint resolution, request bodies, SSE parser, exactly-one-compaction
      validation, usage parsing

  projection.ts
      Pi session/message -> Responses items, current payload tail splice,
      exact-model filtering

  replacement-history.ts
      current Codex-v2 retention shape and token-bounded retained messages

  extraction.ts
      same-model checkpoint rendering request, envelope parser, prompt versions

  manifest.ts
      deterministic exact-handle extraction, last-wins diagnostics,
      secret redaction, validation

  state.ts
      branch-local setting and ephemeral reconstructed checkpoint cache

  probe.ts
      synthetic canaries, repeated extraction matrix, report writer

  openai-codex-compaction.test.ts
      offline tests
```

Repository integration:

```text
package.json
  add test:openai-codex-compaction and include it in npm test

tsconfig.json
  include extensions/openai-codex-compaction/**/*.ts

README.Rmd / README.md
  document command, exact scope, privacy warning, fallback behavior

CHANGELOG.md
  record experimental opt-in extension
```

## 12. Orchestration sketch

```ts
export default function openAICodexCompaction(pi: ExtensionAPI): void {
  const runtime = new RuntimeState();

  pi.registerCommand("compact-openai-codex", {
    description: "Control or probe Codex-native compaction with portable text extraction",
    handler: async (args, ctx) => handleCommand(pi, runtime, args, ctx),
  });

  pi.on("session_start", (_event, ctx) => runtime.reconstruct(ctx));
  pi.on("session_tree", (_event, ctx) => runtime.reconstruct(ctx));
  pi.on("session_compact", (_event, ctx) => runtime.reconstruct(ctx));
  pi.on("session_before_switch", (_event, ctx) => runtime.clear(ctx));
  pi.on("session_before_fork", (_event, ctx) => runtime.clear(ctx));
  pi.on("session_before_tree", (_event, ctx) => runtime.clear(ctx));
  pi.on("model_select", () => runtime.clearCompatibleCheckpoint());
  pi.on("session_shutdown", () => runtime.clearAll());

  pi.on("session_before_compact", async (event, ctx) => {
    if (!runtime.enabledFor(ctx)) return undefined;
    if (!isExactOpenAICodexModel(ctx.model)) return undefined;

    try {
      const projected = projectCompactionInput(event, ctx);
      const manifest = buildCheckpointManifest(projected.compactedRegion);

      const native = await requestCodexCompactionV2({
        model: ctx.model,
        input: projected.fullProviderHistory,
        signal: event.signal,
        systemPrompt: ctx.getSystemPrompt(),
        tools: pi.getAllTools(),
      });

      const replacementHistory = buildCodexV2ReplacementHistory(
        projected.fullProviderHistory,
        native.compactionItem,
      );

      const rendered = await renderNativeCheckpoint({
        model: ctx.model,
        replacementHistory,
        signal: event.signal,
      });

      const validation = validateRenderedCheckpoint(rendered.text, manifest);
      if (validation.status === "fail") return undefined;

      return {
        compaction: buildPiCompactionResult({
          event,
          native,
          replacementHistory,
          rendered,
          manifest,
          validation,
        }),
      };
    } catch (error) {
      notifyOnce(ctx, safeFailureMessage(error));
      return undefined;
    }
  });

  pi.on("before_provider_request", (event, ctx) => {
    const checkpoint = runtime.compatibleCheckpoint(ctx);
    if (!checkpoint) return undefined;
    return spliceNativePrefixIntoCurrentPayload(event.payload, checkpoint, ctx);
  });
}
```

## 13. Test plan

### 13.1 Offline unit tests

Provider gating:

- exact `openai-codex` + `openai-codex-responses` accepted;
- direct `openai`, Azure, custom providers rejected;
- exact model/account mismatch rejects replay.

Command/state:

- default off;
- `on`, `off`, and `status`;
- branch-local persistence;
- tree reconstruction;
- off ignores existing native details;
- on can reactivate a compatible existing checkpoint.

Projection:

- ordinary user/assistant/tool calls and outputs;
- `custom_message` / `custom`;
- `bashExecution` including `excludeFromContext`;
- branch and compaction summaries;
- images;
- unanswered trailing user turn;
- unanswered extension-injected turn;
- aborted/error assistant exclusion;
- cross-model assistant tail exclusion;
- unknown message kind fails rather than disappearing.

Protocol:

- trailing `compaction_trigger` exactly once;
- `store:false`;
- correct model, instructions, tools, reasoning/text shape;
- SSE split across arbitrary chunk boundaries;
- exactly one compaction item required;
- failed/incomplete response rejected;
- secret redaction in errors;
- timeout and abort propagation.

Extraction:

- replacement history plus probe;
- no coding tools;
- complete envelope accepted;
- missing/duplicate/truncated envelope rejected;
- hidden-instruction/refusal-shaped output rejected;
- output-byte/token bounds.

Manifest/validation:

- exact paths, symbols, errors, commands, URIs, and canaries;
- secret redaction;
- current/superseded last-wins fixture;
- forbidden negative canary causes failure;
- missing noncritical handle records warning.

Usage:

- native and render usage combined into `CompactionResult.usage`;
- breakdown retained in details;
- failed side calls do not report successful usage.

Replay:

- patch preserves every current Pi payload tail item;
- custom messages after compaction survive;
- newest unanswered turn survives;
- fork/resume/tree produce the same reconstructed native prefix;
- incompatible model leaves payload byte-for-byte unchanged.

### 13.2 Synthetic live probe

Run only on explicit `/compact-openai-codex probe`:

- assistant-only randomized canaries;
- visible-retention isolation check;
- two prompts x three repeats;
- independent duplicate compactions;
- one-token perturbation;
- optional sibling-model matrix;
- JSON and Markdown diagnostic output with all ciphertext redacted.

### 13.3 End-to-end Pi tests

Using `pi --mode rpc` with an isolated Pi home:

- manual `/compact`;
- threshold compaction;
- overflow recovery;
- same-session continuation;
- resume/reload;
- switch away and back;
- fork after compaction;
- tree navigation;
- label immediately before retained boundary;
- extension `sendMessage()` after compaction;
- session whose leaf is an unanswered user/custom message;
- `/compact-openai-codex off` before and after a checkpoint;
- abort during native request;
- abort during rendering request.

Confirm that ordinary turns use Pi's built-in Codex transport and that no custom provider is registered.

## 14. Acceptance criteria for the first PR

The implementation PR should not be opened until the probe establishes all of the following on at least one current `openai-codex` model:

1. The returned encrypted `compaction` item can be replayed into the same exact model/account.
2. Random assistant-only canaries absent from visible retained history can be recovered through that replay.
3. A bounded portable checkpoint can be rendered without exposing hidden reasoning or system/developer instructions.
4. Negative canaries are not invented in the probe trials.
5. The extension never commits a blob-only compaction.
6. Extraction failure cleanly falls back to Pi compaction.
7. Custom Pi context and an unanswered trailing turn survive post-compaction replay.
8. Exact-model/account mismatch leaves Pi's outgoing payload unchanged.
9. Native and rendering usage appears in Pi's compaction usage totals.
10. Resume, fork, tree navigation, model switch away/back, and on/off behavior have regression coverage.

A stronger public claim that the experiment recovered the **canonical compaction text** requires additional evidence:

- high exact-output stability across independently worded probes;
- reproducibility across repeated requests and independent compactions; and
- behavior inconsistent with ordinary semantic regeneration.

Until then, the feature description remains “native Codex compaction with a recoverable same-model textual projection.”

## 15. Open questions to resolve in the experiment

1. Is the compaction item accepted only under the same session identifiers, or under any request from the same account/exact model?
2. Does `tool_choice: "none"` work on the subscription backend for the rendering call?
3. Does the rendering request need the original system prompt, a dedicated rendering instruction, or both?
4. Is output more stable as Markdown, constrained JSON, or a verbatim delimited block?
5. How much exact state is in the encrypted item versus the visibly retained 64K-token user/developer/system prefix?
6. Does current server-side mitigation reject sibling-model replay, and at what boundary: model id, account, session, or provider deployment?
7. Can Pi's current outgoing payload be safely prefix-spliced, or should replay input be rebuilt from exported session projection with an equivalence test?
8. Should warning-level manifest misses still install native state, or should production v1 require stricter coverage?
9. Should a later PR integrate an extractive/verbatim fallback directly or merely document interoperability?
10. Should a later session-scoped SQLite/FTS vault index compacted-away text for exact historical recall?

## 16. Proposed implementation sequence

1. **Probe-only protocol slice**
   - shared Codex auth/header helper;
   - compaction-v2 request/SSE parser;
   - same-model rendering request;
   - synthetic canary report;
   - no Pi compaction hook yet.

2. **Production compaction hook**
   - branch-local on/off/status;
   - native request + mandatory rendering;
   - portable Pi summary + details + usage;
   - fail-open fallback.

3. **Safe replay**
   - exact model/account gating;
   - canonical Pi projection;
   - post-checkpoint tail splice;
   - resume/tree/fork/model-switch tests.

4. **Validation hardening**
   - deterministic manifest;
   - negative controls and last-wins checks;
   - redaction/privacy review.

5. **Benchmark and optional residual recovery**
   - compare Pi summary, Codex textual projection, and verbatim/extractive control;
   - evaluate catalog/hybrid manifest coverage;
   - decide whether an FTS vault or embedded verbatim fallback earns a later PR.

## 17. Decision requested

Approve the following issue-level direction before code is opened as a PR:

- Codex subscription provider only;
- default off and branch-local `/compact-openai-codex on|off|status|probe`;
- current Responses compaction v2;
- exact-model/account native replay;
- mandatory same-model textual projection;
- no blob-only success;
- deterministic validation diagnostics;
- ordinary Pi Codex transport unchanged;
- fail-open fallback to Pi compaction;
- probe evidence required before implementation PR.
