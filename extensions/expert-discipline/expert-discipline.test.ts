import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension, { appendExpertDiscipline, EXPERT_DISCIPLINE_BLOCK, EXPERT_DISCIPLINE_MARKER } from "./index.js";

test("discipline appends one byte-stable block and preserves the base prompt", () => {
  const base = "Base prompt\nwith exact content.";
  const result = appendExpertDiscipline(base);
  assert.equal(result, `${base}\n\n${EXPERT_DISCIPLINE_BLOCK}`);
  assert.equal(appendExpertDiscipline(result), result);
  assert.equal((result.match(new RegExp(EXPERT_DISCIPLINE_MARKER, "g")) ?? []).length, 1);
  assert(Buffer.byteLength(EXPERT_DISCIPLINE_BLOCK, "utf8") <= 1_024);
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
  assert.equal(result.systemPrompt, `Base\n\n${EXPERT_DISCIPLINE_BLOCK}`);
  assert.deepEqual(nextTurn, result);
});
