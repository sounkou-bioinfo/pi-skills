import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension, { MANDATORY_SKILLS, MANDATORY_SKILLS_BLOCK, MANDATORY_SKILLS_SECTION } from "./index.js";

test("mandatory skill block contains each complete policy once", () => {
  assert.deepEqual(
    MANDATORY_SKILLS.map(({ name }) => name),
    ["no-ghosts", "native-tool-discipline"],
  );
  for (const { name, source } of MANDATORY_SKILLS) {
    assert.match(source, new RegExp(`^---\\nname: ${name}\\n`));
    assert.equal(
      MANDATORY_SKILLS_BLOCK.split(`<mandatory_skill name="${name}">`).length - 1,
      1,
    );
  }
  assert.match(MANDATORY_SKILLS[0].source, /Tests state the final behavior, regardless of RED\/GREEN sequencing\./);
  assert.match(MANDATORY_SKILLS[1].source, /Unnecessary Python primes unrelated Python\s+patterns/);
});

test("extension supplies mandatory skills as one named prompt section and never replaces the whole prompt", async () => {
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
  assert.equal(await handler(event), undefined);
  assert.deepEqual(event.systemPromptOptions.sections, { other_extension: "Other policy.", [MANDATORY_SKILLS_SECTION]: MANDATORY_SKILLS_BLOCK });
});
