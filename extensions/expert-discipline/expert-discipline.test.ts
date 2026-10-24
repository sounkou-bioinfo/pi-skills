import assert from "node:assert/strict";
import test from "node:test";
import { getCurrentSystemMessage, type Message } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension, { ARCHITECTURE_REFINEMENT_BLOCK, CLARIFICATION_GATE_BLOCK, EXPERT_DISCIPLINE_BLOCK, PROMPT_SECTIONS } from "./index.js";

test("each policy is a bounded, separately named prompt section", () => {
  assert.deepEqual(PROMPT_SECTIONS, {
    expert_decision_discipline: EXPERT_DISCIPLINE_BLOCK,
    architecture_refinement: ARCHITECTURE_REFINEMENT_BLOCK,
    clarification_gate: CLARIFICATION_GATE_BLOCK,
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

test("clarification requires a material unresolved choice and an explicit resolution", () => {
  assert.match(CLARIFICATION_GATE_BLOCK, /Before consequential analysis, execution, or edits, pause affected work/);
  assert.match(CLARIFICATION_GATE_BLOCK, /materially different plausible readings/);
  assert.match(CLARIFICATION_GATE_BLOCK, /constraints conflict/);
  assert.match(CLARIFICATION_GATE_BLOCK, /correction exposes an unresolved assumption/);
  assert.match(CLARIFICATION_GATE_BLOCK, /analogies, acceptance cases, or constraints/);
  assert.match(CLARIFICATION_GATE_BLOCK, /Ask one focused question/);
  assert.match(CLARIFICATION_GATE_BLOCK, /alternatives, consequences, and a recommendation, not assumed approval/);
  assert.match(CLARIFICATION_GATE_BLOCK, /resolution or explicit delegation within accepted constraints/);
  assert.match(CLARIFICATION_GATE_BLOCK, /a generic continue is not resolution/);
});

test("clarification preserves factual inspection, settled decisions, and routine work", () => {
  assert.match(CLARIFICATION_GATE_BLOCK, /bounded inspection and safe probes that do not commit to an interpretation/);
  assert.match(CLARIFICATION_GATE_BLOCK, /tests cannot decide intent/);
  assert.match(CLARIFICATION_GATE_BLOCK, /user is absent, report the pending choice and keep affected work paused/);
  assert.match(CLARIFICATION_GATE_BLOCK, /Proceed on settled decisions, scoped delegation, or routine work without a material intent fork/);
  assert.match(CLARIFICATION_GATE_BLOCK, /Revisit settled decisions only when evidence, changed constraints, or corrections invalidate their premises/);
  assert.match(CLARIFICATION_GATE_BLOCK, /Do not manufacture ambiguity or demand a full specification/);
});

function loadHandlers() {
  const handlers = new Map<string, unknown>();
  extension({ on: (name: string, callback: unknown) => handlers.set(name, callback) } as unknown as ExtensionAPI);
  assert.deepEqual([...handlers.keys()], ["before_agent_start", "context_with_system"]);
  return {
    beforeStart: handlers.get("before_agent_start") as (event: { systemPromptOptions: { sections: Record<string, string> } }) => unknown,
    context: handlers.get("context_with_system") as (event: { messages: Message[] }) => { messages: Message[] } | undefined,
  };
}

const renderedSections = Object.fromEntries(Object.entries(PROMPT_SECTIONS).map(([name, block]) => [name, `<${name}>\n${block}\n</${name}>`]));

test("extension sets only its own prompt sections and never replaces the whole prompt", () => {
  const { beforeStart } = loadHandlers();
  const event = { systemPromptOptions: { sections: { other_extension: "Other policy." } } };
  assert.equal(beforeStart(event), undefined);
  assert.deepEqual(event.systemPromptOptions.sections, { other_extension: "Other policy.", ...PROMPT_SECTIONS });
  const firstTurn = structuredClone(event);
  assert.equal(beforeStart(event), undefined);
  assert.deepEqual(event, firstTurn);
});

test("current policy sections require no outgoing transcript change", () => {
  const { context } = loadHandlers();
  const messages: Message[] = [{ role: "system", content: "Base.", sections: renderedSections, timestamp: 0 }];
  const original = structuredClone(messages);
  assert.equal(context({ messages }), undefined);
  assert.deepEqual(messages, original);
});

test("outgoing policy restoration preserves history, unrelated removals, and tool declarations", () => {
  const { context } = loadHandlers();
  const messages: Message[] = [
    { role: "system", content: "Base.", sections: { ...renderedSections, other_extension: "Other policy." },
      toolsAdded: [{ name: "read", description: "Read", parameters: { type: "object", properties: {} } }], timestamp: 0 },
    { role: "user", content: "Inspect.", timestamp: 1 },
    { role: "system", content: "Additional instruction.", sections: { clarification_gate: null, architecture_refinement: "Stale.", other_extension: null },
      toolsRemoved: [{ name: "read" }], toolsAdded: [{ name: "probe", description: "Probe", parameters: { type: "object", properties: {} } }], timestamp: 2 },
  ];
  const original = structuredClone(messages);
  const result = context({ messages });
  assert(result);
  assert.deepEqual(messages, original);
  assert.deepEqual(result.messages.slice(0, -1), original);
  assert.equal(result.messages[0], messages[0]);
  assert.deepEqual(result.messages.at(-1), { role: "system", content: "", timestamp: 0, sections: {
    architecture_refinement: renderedSections.architecture_refinement,
    clarification_gate: renderedSections.clarification_gate,
  } });
  const effective = getCurrentSystemMessage(result.messages);
  assert.deepEqual(effective?.sections, renderedSections);
  assert.deepEqual(effective?.toolsAdded?.map((tool) => tool.name), ["probe"]);
  assert.equal(effective?.content, "Base.\n\nAdditional instruction.");
  assert.equal(context(result), undefined, "repeated projection does not duplicate policy updates");
  assert.deepEqual(context({ messages }), result, "unchanged source context produces identical repair bytes");
});

test("a context without policy sections receives only this extension's named sections", () => {
  const { context } = loadHandlers();
  const messages: Message[] = [{ role: "user", content: "Resume.", timestamp: 1 }];
  const result = context({ messages });
  assert(result);
  assert.deepEqual(result.messages.at(-1), { role: "system", content: "", sections: renderedSections, timestamp: 0 });
  assert.deepEqual(getCurrentSystemMessage(result.messages)?.sections, renderedSections);
});
