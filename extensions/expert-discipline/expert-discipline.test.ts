import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension, {
  appendExpertDiscipline, EXPERT_DISCIPLINE_BLOCK, EXPERT_DISCIPLINE_MARKER,
  ARCHITECTURE_REFINEMENT_BLOCK, ARCHITECTURE_REFINEMENT_MARKER,
} from "./index.js";

test("discipline appends bounded byte-stable blocks and preserves the base prompt", () => {
  const base = "Base prompt\r\nwith exact content.\nλ 🧬";
  const result = appendExpertDiscipline(base);
  assert.equal(result, `${base}\n\n${EXPERT_DISCIPLINE_BLOCK}\n\n${ARCHITECTURE_REFINEMENT_BLOCK}`);
  assert.equal(appendExpertDiscipline(result), result);
  for (const [marker, block] of [
    [EXPERT_DISCIPLINE_MARKER, EXPERT_DISCIPLINE_BLOCK],
    [ARCHITECTURE_REFINEMENT_MARKER, ARCHITECTURE_REFINEMENT_BLOCK],
  ]) {
    assert.equal(result.split(marker).length - 1, 1);
    assert(Buffer.byteLength(block, "utf8") <= 1_024);
  }
});

test("each policy block is appended only when absent from the chained prompt", () => {
  for (const [present, missing] of [
    [EXPERT_DISCIPLINE_BLOCK, ARCHITECTURE_REFINEMENT_BLOCK],
    [ARCHITECTURE_REFINEMENT_BLOCK, EXPERT_DISCIPLINE_BLOCK],
  ]) {
    const base = `Base\n\n${present}`;
    assert.equal(appendExpertDiscipline(base), `${base}\n\n${missing}`);
  }
});

test("the nudge requests proactive discovery-based activation with scoped authority", () => {
  assert.match(ARCHITECTURE_REFINEMENT_BLOCK, /When architecture-refinement is available in the skill list/);
  assert.match(ARCHITECTURE_REFINEMENT_BLOCK, /proactively read and apply/);
  assert.match(ARCHITECTURE_REFINEMENT_BLOCK, /Do not wait for the user/);
  assert.match(ARCHITECTURE_REFINEMENT_BLOCK, /listed file location/);
  assert.match(ARCHITECTURE_REFINEMENT_BLOCK, /R-developer EDA ethos/);
  assert.match(ARCHITECTURE_REFINEMENT_BLOCK, /Preserve accepted constraints and user authority/);
  assert.match(ARCHITECTURE_REFINEMENT_BLOCK, /routine mechanical edits/);
});

test("extension changes only the chained system prompt", async () => {
  let handler: ((event: { systemPrompt: string }) => Promise<{ systemPrompt: string }>) | undefined;
  const pi = {
    on(name: string, callback: typeof handler) {
      assert.equal(name, "before_agent_start");
      handler = callback;
    },
  } as unknown as ExtensionAPI;

  extension(pi);
  assert(handler);
  const result = await handler({ systemPrompt: "Base" });
  const nextTurn = await handler({ systemPrompt: "Base" });
  assert.equal(result.systemPrompt, `Base\n\n${EXPERT_DISCIPLINE_BLOCK}\n\n${ARCHITECTURE_REFINEMENT_BLOCK}`);
  assert.deepEqual(nextTurn, result);
});
