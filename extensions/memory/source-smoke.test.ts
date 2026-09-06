import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { MemoryDatabase, GLOBAL_GRAPH } from "./store.js";
import { buildTurnProjection } from "./index.js";
import { resolveProject } from "./project.js";

/** Explicit Pi -e fixture, not an automatically registered production extension. */
export default function memorySourceSmoke(pi: ExtensionAPI): void {
  pi.registerCommand("memory-source-smoke", {
    description: "Isolated scoped-memory source loader probe; no model request",
    handler: async (_args, ctx) => {
      try {
        const tool = pi.getAllTools().find((entry) => entry.name === "memory");
        assert(tool, "memory tool must be registered");
        const schema = tool.parameters as { properties?: Record<string, { description?: string }> };
        assert(schema.properties?.evidence);
        assert.match(schema.properties.graph?.description ?? "", /legacy/);
        assert(process.env.PI_MEMORY_DB, "Use the playbook's temporary database/agent sandbox");
        const active = await resolveProject(ctx.cwd, process.env.PI_MEMORY_PROJECT);
        assert.equal(active.graph, "project:source-smoke");
        const db = await MemoryDatabase.open(process.env.PI_MEMORY_DB, "source-smoke-auditor");
        try {
          await db.note({ graph: active.graph, text: "Loader-scoped sentinel." });
          await db.note({ graph: GLOBAL_GRAPH, text: "Shared loader preference." });
          await db.note({ graph: "project:foreign", text: "Foreign loader sentinel." });
          const projection = await buildTurnProjection(db, "source", "loader", active);
          assert.match(projection.text, /Loader-scoped sentinel/);
          assert.match(projection.text, /Shared loader preference/);
          assert.doesNotMatch(projection.text, /Foreign loader sentinel/);
          console.log("SOURCE_MEMORY_SMOKE_OK");
        } finally { await db.close(); }
      } catch (error) {
        console.error(error);
        process.exitCode = 1;
      }
    },
  });
}
