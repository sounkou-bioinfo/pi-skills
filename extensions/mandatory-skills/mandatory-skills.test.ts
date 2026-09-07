import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension, {
  appendMandatorySkills,
  MANDATORY_SKILLS,
  MANDATORY_SKILLS_BLOCK,
  MANDATORY_SKILLS_MARKER,
} from "./index.js";

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

  const base = "Base prompt\nwith exact content.";
  const result = appendMandatorySkills(base);
  assert.equal(result, `${base}\n\n${MANDATORY_SKILLS_BLOCK}`);
  assert.equal(appendMandatorySkills(result), result);
  assert.equal((result.match(new RegExp(MANDATORY_SKILLS_MARKER, "g")) ?? []).length, 1);
});

test("extension supplies mandatory skills through the system prompt", async () => {
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
  assert.equal(result.systemPrompt, `Base\n\n${MANDATORY_SKILLS_BLOCK}`);
});
