import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension, { ARCHITECTURE_REFINEMENT_BLOCK, EXPERT_DISCIPLINE_BLOCK, PROMPT_SECTIONS } from "./index.js";

test("each policy is a bounded, separately named prompt section", () => {
  assert.deepEqual(PROMPT_SECTIONS, {
    expert_decision_discipline: EXPERT_DISCIPLINE_BLOCK,
    architecture_refinement: ARCHITECTURE_REFINEMENT_BLOCK,
  });
  for (const [name, block] of Object.entries(PROMPT_SECTIONS)) {
    assert.match(name, /^[a-z][a-z0-9_-]*$/);
    assert(Buffer.byteLength(block, "utf8") <= 1_024);
    assert.equal(block, block.trim());
  }
});

test("expert discipline favors evidence-producing work over duplicate answer sampling", () => {
  assert.match(EXPERT_DISCIPLINE_BLOCK, /observe-act-inspect-revise cycles/);
  assert.match(EXPERT_DISCIPLINE_BLOCK, /Do not run independent models on one unchanged question merely to rank outputs/);
  assert.match(EXPERT_DISCIPLINE_BLOCK, /revisit with new evidence/);
  assert.match(EXPERT_DISCIPLINE_BLOCK, /user-requested comparisons/);
  assert.match(EXPERT_DISCIPLINE_BLOCK, /distinct evidence-producing subproblems/);
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

test("extension sets only its own prompt sections and never replaces the whole prompt", async () => {
  type Event = { systemPromptOptions: { sections: Record<string, string> } };
  let handler: ((event: Event) => unknown) | undefined;
  const pi = {
    on(name: string, callback: typeof handler) {
      assert.equal(name, "before_agent_start");
      handler = callback;
    },
  } as unknown as ExtensionAPI;

  extension(pi);
  assert(handler);
  const event: Event = { systemPromptOptions: { sections: { other_extension: "Other policy." } } };
  assert.equal(await handler(event), undefined);
  assert.deepEqual(event.systemPromptOptions.sections, { other_extension: "Other policy.", ...PROMPT_SECTIONS });
  const firstTurn = structuredClone(event);
  assert.equal(await handler(event), undefined);
  assert.deepEqual(event, firstTurn);
});
