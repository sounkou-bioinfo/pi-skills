import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DuckDBInstance } from "@duckdb/node-api";
import { GLOBAL_GRAPH, MemoryDatabase, type SummaryTask } from "./store.js";
import { buildTurnProjection, selectGraph } from "./index.js";
import { canonicalRemote, resolveProject } from "./project.js";

test("Semantic SQL views preserve append-only statement history and as_of", async () => {
  const fixture = await memoryFixture();
  try {
    const first = await fixture.db.note({
      text: "The memory store uses an earlier design.",
      subject: "memory:architecture",
      predicate: "memory:storage",
    });
    const firstStatus = await fixture.db.status(first.transactionId);
    const second = await fixture.db.note({
      text: "The memory store uses SQLite WAL.",
      subject: "memory:architecture",
      predicate: "memory:storage",
    });

    const old = await fixture.db.semanticSql(
      "SELECT value FROM as_of_statement WHERE subject = 'memory:architecture' AND predicate = 'memory:storage'",
      first.transactionId,
    );
    const current = await fixture.db.semanticSql(
      "SELECT value FROM as_of_statement WHERE subject = 'memory:architecture' AND predicate = 'memory:storage'",
    );
    const byTime = await fixture.db.semanticSql(
      "SELECT value FROM as_of_statement WHERE subject = 'memory:architecture' AND predicate = 'memory:storage'",
      firstStatus.transactionTime,
    );
    const history = await fixture.db.semanticSql(
      "SELECT value, valid_from_transaction, valid_to_transaction FROM memo.statement_history WHERE subject = 'memory:architecture' ORDER BY valid_from_transaction",
    );
    const timeline = await fixture.db.semanticSql(
      "SELECT transaction_id, transaction_time FROM memo.transactions ORDER BY transaction_id",
    );

    assert.deepEqual(old.rows.map((row) => row.value), ["The memory store uses an earlier design."]);
    assert.deepEqual(byTime.rows.map((row) => row.value), ["The memory store uses an earlier design."]);
    assert.deepEqual(current.rows.map((row) => row.value), ["The memory store uses SQLite WAL."]);
    assert.deepEqual(history.rows.map((row) => row.valid_to_transaction), [second.transactionId, null]);
    assert(Date.parse(String(timeline.rows[1]?.transaction_time)) > Date.parse(String(timeline.rows[0]?.transaction_time)));
    assert.equal((await fixture.db.status()).journalMode, "WAL");
    const header = await readFile(fixture.path);
    assert.equal(header[18], 2, "SQLite write version is WAL");
    assert.equal(header[19], 2, "SQLite read version is WAL");
    await assert.rejects(() => fixture.db.semanticSql("DELETE FROM memo.statements"), /read-only SELECT/);
    await assert.rejects(
      () => fixture.db.semanticSql("SELECT * FROM sqlite_query('memo', 'DELETE FROM statements RETURNING transaction_id')"),
    );
    const escapedPath = fixture.path.replaceAll("'", "''");
    await assert.rejects(
      () => fixture.db.semanticSql(`SELECT filename FROM read_blob('${escapedPath}')`),
      /external access|disabled/i,
    );
    await assert.rejects(
      () => fixture.db.semanticSql(`SELECT '${"x".repeat(100_000)}'`),
      /exceeds 100000 UTF-8 bytes/,
    );
    assert.equal((await fixture.db.status()).notes, 2);
  } finally {
    await fixture.close();
  }
});

test("DuckDB FTS recalls historical notes and respects as_of", async () => {
  const fixture = await memoryFixture();
  try {
    const first = await fixture.db.note({ text: "Semantic SQL makes memory relations inspectable." });
    const initial = await fixture.db.recall("semantic relations");
    assert.equal(initial.rows.length, 1);
    assert.equal(initial.rows[0]?.transaction_id, first.transactionId);

    await fixture.db.note({ text: "Rbebelm may provide optional parallel embeddings later." });
    const historical = await fixture.db.recall("parallel embeddings", first.transactionId);
    const latest = await fixture.db.recall("parallel embeddings");
    assert.equal(historical.rows.length, 0);
    assert.equal(latest.rows.length, 1);
    assert.match(String(latest.rows[0]?.value), /Rbebelm/);
  } finally {
    await fixture.close();
  }
});

test("summary graph supports bounded wake, recursive walk, invalidation, and historical as_of", async () => {
  const fixture = await memoryFixture();
  try {
    for (let index = 0; index < 8; index++) {
      await fixture.db.note({ text: `Durable memory event ${index}.` });
    }
    const summaryTransactions = await settleAll(fixture.db);
    assert.equal(summaryTransactions.length, 7);
    const settledAt = summaryTransactions.at(-1)!;

    await fixture.db.note({
      text: "invalid",
      subject: "memory:summary/0-8",
      predicate: "memory:status",
      graph: "memory:global",
    });
    await assert.rejects(
      () => fixture.db.note({ text: "invalid", graph: "memory:system" }),
      /reserved/,
    );
    const protectedSummary = await fixture.db.semanticSql(
      "SELECT status FROM as_of_summary WHERE summary = 'memory:summary/0-8'",
    );
    assert.deepEqual(protectedSummary.rows.map((row) => row.status), ["active"]);

    const wake = await fixture.db.wake(settledAt, 1);
    assert.equal(wake.ready, true);
    assert.equal(wake.rows.length, 1);
    assert.equal(wake.rows[0]?.subject, "memory:summary/0-8");

    const zoom = await fixture.db.zoom("memory:summary/0-8");
    assert.deepEqual(zoom.rows.map((row) => row.subject), ["memory:summary/0-4", "memory:summary/4-8"]);

    const walk = await fixture.db.semanticSql(`
      WITH RECURSIVE graph(subject) AS (
        VALUES ('memory:summary/0-8')
        UNION
        SELECT s.object
        FROM as_of_statement s
        JOIN graph g ON s.subject = g.subject
        WHERE s.predicate IN ('memory:left', 'memory:right')
      )
      SELECT subject FROM graph ORDER BY subject
    `);
    assert.deepEqual(walk.rows.map((row) => row.subject), [
      "memory:note/1",
      "memory:note/2",
      "memory:note/3",
      "memory:note/4",
      "memory:note/5",
      "memory:note/6",
      "memory:note/7",
      "memory:note/8",
      "memory:summary/0-2",
      "memory:summary/0-4",
      "memory:summary/0-8",
      "memory:summary/2-4",
      "memory:summary/4-6",
      "memory:summary/4-8",
      "memory:summary/6-8",
    ]);

    const forgotten = await fixture.db.forget("memory:summary/0-2", "bad compression");
    assert.equal(forgotten.invalidated, 3);
    const latest = await fixture.db.wake(undefined, 1);
    const historical = await fixture.db.wake(settledAt, 1);
    assert.equal(latest.ready, false);
    assert.equal(historical.ready, true);
    assert.equal((await fixture.db.status()).pendingSummaries, 3);

    await settleAll(fixture.db);
    assert.equal((await fixture.db.wake(undefined, 1)).ready, true);
  } finally {
    await fixture.close();
  }
});

test("multiple processes initialize and append through SQLite WAL without colliding", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-memory-race-"));
  const databasePath = join(directory, "memory.sqlite");
  try {
    const storeUrl = new URL("./store.js", import.meta.url).href;
    const workers = Array.from({ length: 8 }, (_, index) => runWorker(storeUrl, databasePath, index));
    await Promise.all(workers);

    const db = await MemoryDatabase.open(databasePath, "auditor");
    try {
      const status = await db.status();
      const notes = await db.semanticSql("SELECT note_index, value FROM as_of_note ORDER BY note_index");
      assert.equal(status.notes, 8);
      assert.deepEqual(notes.rows.map((row) => row.note_index), [0, 1, 2, 3, 4, 5, 6, 7]);
      assert.deepEqual(new Set(notes.rows.map((row) => row.value)).size, 8);
      const timeline = await db.semanticSql(
        "SELECT transaction_time FROM memo.transactions ORDER BY transaction_id",
      );
      for (let index = 1; index < timeline.rows.length; index++) {
        assert(
          Date.parse(String(timeline.rows[index]?.transaction_time)) >
            Date.parse(String(timeline.rows[index - 1]?.transaction_time)),
        );
      }
    } finally {
      await db.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("memory policy is stable and projections are append-only across turns, reloads, and branches", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-memory-context-"));
  const databasePath = join(directory, "memory.sqlite");
  try {
    const code = `
      process.env.PI_MEMORY_DB = process.argv[1];
      delete process.env.PI_MEMORY_PROJECT;
      const { default: extension } = await import(${JSON.stringify(new URL("./index.js", import.meta.url).href)});
      const entries = [];
      let branch = () => entries;
      const ctx = {
        sessionManager: { getSessionId() { return 'context-session'; }, getBranch() { return branch(); } },
        cwd: ${JSON.stringify(directory)},
        ui: { setStatus() {}, notify() {} },
      };
      const load = () => {
        const loaded = { handlers: {} };
        extension({
          registerTool(value) { loaded.tool = value; },
          on(name, handler) { loaded.handlers[name] = handler; },
          appendEntry(customType, data) { entries.push({ type: 'custom', customType, data: JSON.parse(JSON.stringify(data)) }); },
        });
        return loaded;
      };
      let { handlers, tool } = load();
      const projectionsOf = (result) => result.messages.filter((message) => message.customType === 'pi-memory-projection');
      const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
      await handlers.session_start({}, ctx);
      await tool.execute('seed', { op: 'note', graph: 'global', text: 'DuckHTS uses public reproducible artifacts.' }, undefined, undefined, ctx);
      const historicalStatus = await tool.execute('old-status', { op: 'status', graph: 'global', as_of: 0 }, undefined, undefined, ctx);
      if (historicalStatus.details.status.transactionId !== 0 || historicalStatus.details.status.notes !== 0) throw new Error('status ignored as_of');
      const promptEvent = { systemPromptOptions: { sections: { other_extension: 'Other policy.' } } };
      if (await handlers.before_agent_start(promptEvent, ctx) !== undefined) throw new Error('the whole system prompt was replaced');
      const sections = promptEvent.systemPromptOptions.sections;
      if (Object.keys(sections).join() !== 'other_extension,permanent_memory') throw new Error('policy is not one named prompt section');
      if (!sections.permanent_memory.startsWith('PERMANENT MEMORY POLICY\\n')) throw new Error('missing stable policy');
      if (sections.permanent_memory.includes('DuckHTS uses public')) throw new Error('dynamic memory leaked into system prompt');

      const messages = [{ role: 'user', content: [{ type: 'text', text: 'inspect DuckHTS artifacts' }], timestamp: 10 }];
      const first = await handlers.context({ messages }, ctx);
      const firstProjection = first.messages[0];
      if (firstProjection.customType !== 'pi-memory-projection') throw new Error('missing projection before current user');
      if (first.messages[1].role !== 'user') throw new Error('projection must precede current user');
      if (!String(firstProjection.content).includes('DuckHTS uses public')) throw new Error('missing task memory');
      if (!String(firstProjection.content).startsWith('<memory_projection>\\nProject: none.\\n')) throw new Error('volatile receipts entered the projection text');
      if (entries.length !== 1 || entries[0].customType !== 'pi-memory-projection-v1') throw new Error('delivered projection was not persisted on the branch');

      await tool.execute('midturn', { op: 'note', graph: 'global', text: 'This mid-turn note belongs to the next user turn.' }, undefined, undefined, ctx);
      const loopMessages = [
        ...first.messages,
        { role: 'assistant', content: [{ type: 'toolCall', id: 'x', name: 'read', arguments: {} }], timestamp: 11 },
        { role: 'toolResult', toolCallId: 'x', toolName: 'read', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: 12 },
      ];
      const second = await handlers.context({ messages: loopMessages }, ctx);
      if (!same(second.messages, loopMessages)) throw new Error('the projection changed or moved during the tool loop');
      if (entries.length !== 1) throw new Error('a tool-loop request delivered a projection');

      const next = await handlers.context({ messages: [...loopMessages, { role: 'user', content: 'next turn', timestamp: 13 }] }, ctx);
      if (!same(next.messages.slice(0, loopMessages.length), loopMessages)) throw new Error('a new turn rewrote an earlier projection');
      const added = projectionsOf(next);
      if (added.length !== 2 || next.messages.at(-2) !== added[1]) throw new Error('the new turn projection must precede the new user message');
      if (!String(added[1].content).includes('mid-turn note')) throw new Error('next turn did not add the new note');
      if (String(added[1].content).includes('DuckHTS uses public')) throw new Error('an already shown record was repeated');

      const stableMessages = [...next.messages, { role: 'assistant', content: [], timestamp: 14 }, { role: 'user', content: 'next turn', timestamp: 15 }];
      const stable = await handlers.context({ messages: stableMessages }, ctx);
      if (!same(stable.messages, stableMessages) || entries.length !== 2) throw new Error('unchanged memory added a projection');

      await handlers.session_shutdown();
      ({ handlers, tool } = load());
      await handlers.session_start({}, ctx);
      const reloaded = await handlers.context({ messages: stableMessages.filter((message) => message.customType !== 'pi-memory-projection') }, ctx);
      if (!same(reloaded.messages, stable.messages)) throw new Error('a reload did not replay delivered projections byte-identically');

      branch = () => entries.slice(0, 1);
      await handlers.session_tree({}, ctx);
      const edited = stableMessages.map((message) => message.role === 'user' && message.timestamp === 13 ? { ...message, content: 'edited branch user' } : message);
      const reanchored = await handlers.context({ messages: edited }, ctx);
      if (projectionsOf(reanchored).length !== 2 || !same(reanchored.messages[0], firstProjection)) throw new Error('an edited branch lost or rewrote its earlier projection');
      if (reanchored.messages.at(-2).customType !== 'pi-memory-projection' || !String(reanchored.messages.at(-2).content).includes('mid-turn note')) throw new Error('an edited anchor kept its projection');
      branch = () => entries.slice(0, 2);
      await handlers.session_tree({}, ctx);
      if (!same((await handlers.context({ messages: stableMessages }, ctx)).messages, stable.messages)) throw new Error('returning to a branch changed its projections');
      const removed = stableMessages.filter((message) => !(message.role === 'user' && message.timestamp === 15));
      if (!same((await handlers.context({ messages: removed }, ctx)).messages, stable.messages.slice(0, -1))) throw new Error('a removed user message changed earlier projections');

      branch = () => entries;
      process.env.PI_MEMORY_PROJECT = 'project-a';
      await tool.execute('a', { op: 'note', text: 'Only project A knows this sentinel.' }, undefined, undefined, ctx);
      const aMessages = [...stable.messages, { role: 'assistant', content: [], timestamp: 16 }, { role: 'user', content: 'project a turn', timestamp: 17 }];
      const a = await handlers.context({ messages: aMessages }, ctx);
      const aProjection = String(a.messages.at(-2).content);
      if (!aProjection.includes('Project: project-a.') || !aProjection.includes('Only project A') || !aProjection.includes('DuckHTS uses public')) throw new Error('a project change did not start a self-contained projection');
      process.env.PI_MEMORY_PROJECT = 'project-b';
      const b = await handlers.context({ messages: [...a.messages, { role: 'assistant', content: [], timestamp: 18 }, { role: 'user', content: 'project b turn', timestamp: 19 }] }, ctx);
      const bProjection = String(b.messages.at(-2).content);
      if (bProjection.includes('Only project A') || !bProjection.includes('DuckHTS uses public')) throw new Error('project B saw project A or lost the global note');
      if (!same(b.messages.slice(0, a.messages.length), a.messages)) throw new Error('a project change rewrote earlier projections');
      const denied = await tool.execute('legacy', { op: 'note', graph: 'legacy', text: 'forbidden' }, undefined, undefined, ctx);
      if (!denied.isError) throw new Error('legacy write was accepted');
      await handlers.session_shutdown();
    `;
    await runNode(code, [databasePath], "memory context lifecycle");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("extension lifecycle serializes open, use, and shutdown", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-memory-lifecycle-"));
  const databasePath = join(directory, "memory.sqlite");
  try {
    const extensionUrl = new URL("./index.js", import.meta.url).href;
    const storeUrl = new URL("./store.js", import.meta.url).href;
    const code = `
      process.env.PI_MEMORY_DB = process.argv[1];
      const { default: extension } = await import(${JSON.stringify(extensionUrl)});
      const { MemoryDatabase } = await import(${JSON.stringify(storeUrl)});
      const handlers = {};
      let tool;
      const pi = {
        registerTool(value) { tool = value; },
        on(name, handler) { handlers[name] = handler; },
      };
      extension(pi);
      const ctx = {
        sessionManager: { getSessionId() { return 'lifecycle-session'; }, getBranch() { return []; } },
        cwd: ${JSON.stringify(directory)},
        ui: { setStatus() {}, notify() {} },
      };
      await Promise.all([
        handlers.session_start({}, ctx),
        handlers.before_agent_start({ systemPromptOptions: { sections: {} } }, ctx),
        tool.execute('call', { op: 'note', graph: 'global', text: 'lifecycle note' }, undefined, undefined, ctx),
        handlers.session_shutdown(),
      ]);
      const db = await MemoryDatabase.open(process.argv[1], 'auditor');
      const status = await db.status(undefined, ${JSON.stringify(GLOBAL_GRAPH)});
      await db.close();
      if (status.notes !== 1) throw new Error('expected one lifecycle note, got ' + status.notes);
    `;
    await runNode(code, [databasePath]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("recursive SQL wake frontier is bounded, ordered, and gap-free", async () => {
  const fixture = await memoryFixture();
  try {
    for (let index = 0; index < 13; index++) {
      await fixture.db.note({ text: `Frontier memory ${index}.` });
    }
    const wake = await fixture.db.wake(undefined, 5);
    assert(wake.rows.length <= 5);
    assert.equal(wake.rows[0]?.rangeStart, 0);
    assert.equal(wake.rows.at(-1)?.rangeEnd, 13);
    for (let index = 1; index < wake.rows.length; index++) {
      assert.equal(wake.rows[index - 1]?.rangeEnd, wake.rows[index]?.rangeStart);
    }
    const sizes = wake.rows.map((row) => row.rangeEnd - row.rangeStart);
    for (let index = 1; index < sizes.length; index++) {
      assert(sizes[index] <= sizes[index - 1]);
    }
  } finally {
    await fixture.close();
  }
});

test("memory text is bounded and one-line", async () => {
  const fixture = await memoryFixture();
  try {
    await assert.rejects(() => fixture.db.note({ text: "two\nlines" }), /one line/);
    await assert.rejects(() => fixture.db.note({ text: "ã".repeat(141) }), /282 bytes/);
  } finally {
    await fixture.close();
  }
});

test("interleaved graph forests, invalidation and legacy snapshots remain isolated", async () => {
  const fixture = await memoryFixture();
  const a = "project:alpha";
  const b = "project:beta";
  try {
    await fixture.db.note({ text: "Legacy alpha observation." });
    await fixture.db.note({ text: "Legacy beta observation." });
    const legacyTx = (await settleAll(fixture.db)).at(-1)!;
    const legacyWake = await fixture.db.wake(legacyTx, 1);
    const legacyRows = await fixture.db.semanticSql("SELECT * FROM memo.statements ORDER BY transaction_id, ordinal", legacyTx);
    for (let index = 0; index < 4; index++) {
      await fixture.db.note({ text: `Alpha compression source ${index}.`, graph: a });
      await fixture.db.note({ text: `Beta compression source ${index}.`, graph: b });
    }
    const taskA = (await fixture.db.summaryTask(a))!;
    const taskB = (await fixture.db.summaryTask(b))!;
    assert.notEqual(taskA.summary, taskB.summary);
    assert.equal(taskA.graph, a);
    assert(taskA.source.every((source) => source.text.includes("Alpha") && !source.text.includes("Beta")));
    assert(taskB.source.every((source) => source.text.includes("Beta") && !source.text.includes("Alpha")));
    await assert.rejects(() => fixture.db.saveSummary({ summary: taskA.summary, sourceHash: taskA.sourceHash, text: "wrong graph", graph: b }), /is not next; next is/);
    await assert.rejects(() => fixture.db.saveSummary({ summary: taskA.summary, sourceHash: "0".repeat(64), text: "wrong hash", graph: a }), /Source .* changed/);
    await fixture.db.saveSummary({ summary: taskA.summary, sourceHash: taskA.sourceHash, text: "Alpha scoped summary.", graph: ` ${a} ` });
    assert.notEqual((await fixture.db.summaryTask(a))?.summary, taskA.summary, "normalized scope must also be persisted on the summary");
    await settleAll(fixture.db, a);
    await settleAll(fixture.db, b);
    const wakeA = await fixture.db.wake(undefined, 1, a);
    const wakeB = await fixture.db.wake(undefined, 1, b);
    assert(wakeA.ready && wakeB.ready);
    assert.match(wakeA.rows[0]!.value!, /Alpha/);
    assert.doesNotMatch(wakeA.rows[0]!.value!, /Beta/);
    assert.doesNotMatch(wakeB.rows[0]!.value!, /Alpha/);
    const children = await fixture.db.zoom(wakeA.rows[0]!.subject!, undefined, a);
    assert.equal(children.rows.length, 2);
    assert(children.rows.every((row) => row.graph === a));
    await assert.rejects(() => fixture.db.zoom(wakeA.rows[0]!.subject!, undefined, b), /Unknown summary block/);
    await assert.rejects(() => fixture.db.forget(wakeA.rows[0]!.subject!, "foreign", b), /No active summary/);
    await fixture.db.forget(children.rows[0]!.subject!, "revise alpha only", a);
    assert.equal((await fixture.db.wake(undefined, 1, a)).ready, false);
    assert.equal((await fixture.db.wake(undefined, 1, b)).ready, true);
    assert.equal((await fixture.db.wake(wakeA.snapshot.transactionId, 1, a)).ready, true);
    assert.deepEqual(await fixture.db.wake(legacyTx, 1), legacyWake);
    const retained = await fixture.db.semanticSql(`SELECT * FROM memo.statements WHERE transaction_id <= ${legacyTx} ORDER BY transaction_id, ordinal`);
    assert.deepEqual(retained.rows, legacyRows.rows, "no legacy statement is rewritten");
    assert.equal((await fixture.db.status()).notes, 2);
    assert.equal((await fixture.db.semanticSql("SELECT count(*) AS n FROM memo.note_statement")).rows[0]?.n, 2, "v1 readers cannot fold scoped notes into old summaries");
    assert.equal((await fixture.db.semanticSql("SELECT count(*) AS n FROM memo.current_summary")).rows[0]?.n, 1);
    await fixture.db.close();
    fixture.db = await MemoryDatabase.open(fixture.path, "reopened");
    assert.deepEqual(await fixture.db.wake(legacyTx, 1), legacyWake);
    assert.equal((await fixture.db.status(undefined, b)).notes, 4);
  } finally { await fixture.close(); }
});

test("scope and current-slot filtering precede FTS limits; applicability is separate from checkout", async () => {
  const fixture = await memoryFixture();
  const a = "project:a";
  const b = "project:b";
  try {
    const first = await fixture.db.note({
      graph: a, subject: "watchdog", predicate: "design:decision", text: "Watchdog old implementation report.",
      evidence: { source: "tests/watchdog", revision: "tested-old", runtime: "loaded-old" },
      recordedIn: { project: "a", revision: "checkout-new", dirty: true },
    });
    await fixture.db.note({ graph: b, subject: "watchdog", predicate: "design:decision", text: "Watchdog watchdog watchdog." });
    await fixture.db.note({ graph: b, subject: "watchdog", predicate: "design:decision", text: "Watchdog watchdog." });
    const second = await fixture.db.note({ graph: a, subject: "watchdog", predicate: "design:decision", text: "Watchdog now runs outside the evaluator; verify the loaded runtime." });
    const recent = await fixture.db.recall("watchdog", undefined, 1, a, true);
    assert.equal(recent.rows.length, 1);
    assert.equal(recent.rows[0]?.stanza, second.stanza);
    assert.equal(recent.truncated, false);
    assert.deepEqual((await fixture.db.current(undefined, 10, b)).rows.map((row) => row.value), ["Watchdog watchdog."]);
    const past = await fixture.db.recall("watchdog", first.transactionId, 1, a, true);
    assert.equal(past.rows[0]?.stanza, first.stanza);
    assert.equal(JSON.parse(String(past.rows[0]?.evidence)).revision, "tested-old");
    assert.equal(JSON.parse(String(past.rows[0]?.recorded_in)).revision, "checkout-new");
    assert.equal((await fixture.db.recall("watchdog", undefined, 10, a)).rows.length, 2);
    assert.equal((await fixture.db.recall("watchdog")).rows.length, 0, "legacy excludes scoped records");
    const current = await fixture.db.semanticSql("SELECT stanza FROM current_note", undefined, 100, a);
    assert.deepEqual(current.rows.map((row) => row.stanza), [second.stanza]);
    const task = (await fixture.db.summaryTask(a))!;
    assert.match(task.source[0]!.text, /tested-old/);
    assert.match(task.source[0]!.text, /checkout-new/);
    const projection = await buildTurnProjection(fixture.db, "watchdog", { id: "a", graph: a, identity: "override", root: fixture.directory });
    assert.match(projection.text, /outside the evaluator/);
    assert.doesNotMatch(projection.text, /old implementation report|Watchdog watchdog/);
    assert.deepEqual(projection.stanzas, [second.stanza]);
    const repeated = await buildTurnProjection(fixture.db, "watchdog", { id: "a", graph: a, identity: "override", root: fixture.directory }, new Set(projection.stanzas));
    assert.deepEqual(repeated.stanzas, []);
    assert.doesNotMatch(repeated.text, /outside the evaluator/);
    const third = await fixture.db.note({ graph: a, subject: "watchdog", predicate: "design:decision", text: "Watchdog moved into a supervisor process." });
    await fixture.db.note({ graph: a, text: "Unrelated newer note one." });
    await fixture.db.note({ graph: a, text: "Unrelated newer note two." });
    const followUp = await buildTurnProjection(fixture.db, "zzz", { id: "a", graph: a, identity: "override", root: fixture.directory }, new Set(projection.stanzas));
    assert.equal(followUp.stanzas[0], third.stanza, "a shown record's replacement leads even without a task match");
    assert.match(followUp.text, /supervisor process/);
  } finally { await fixture.close(); }
});

test("global and active-project projection share one bounded budget without legacy contamination", async () => {
  const fixture = await memoryFixture();
  try {
    await seedLegacyNote(fixture, { text: "Legacy private sentinel.", graph: GLOBAL_GRAPH });
    assert.equal((await fixture.db.current(undefined, 10, GLOBAL_GRAPH)).rows.length, 0, "an old label is not consent to scoped promotion");
    assert.equal((await fixture.db.recall("Legacy")).rows.length, 1);
    const evidence = { source: "é".repeat(250), revision: "r".repeat(500), runtime: "x".repeat(500) };
    await fixture.db.note({ graph: GLOBAL_GRAPH, text: "Shared preference: preserve consequential disagreements.", evidence });
    await fixture.db.note({ graph: GLOBAL_GRAPH, text: "Shared preference: preserve learned counterexamples.", evidence });
    await fixture.db.note({ graph: "project:b", text: "Foreign private sentinel." });
    assert.equal((await fixture.db.status(undefined, GLOBAL_GRAPH)).notes, 2);
    assert((await fixture.db.summaryTask(GLOBAL_GRAPH))!.source.every((row) => !row.text.includes("Legacy private")));
    for (let index = 0; index < 6; index++) {
      await fixture.db.note({ graph: "project:a", text: `${index < 4 ? "Targetmatch" : "Recent"} Alpha applicability ${index}: ${"ã".repeat(115)}`, evidence });
    }
    const a = await buildTurnProjection(fixture.db, "targetmatch", { id: "a", graph: "project:a", identity: "override", root: fixture.directory });
    assert.match(a.text, /Shared preference/);
    assert.match(a.text, /Alpha applicability/);
    assert.doesNotMatch(a.text, /Legacy private sentinel|Foreign private sentinel/);
    assert(Buffer.byteLength(a.text) <= 12 * 1024);
    assert.match(a.text, /records omitted by the projection byte budget/);
    const b = await buildTurnProjection(fixture.db, "alpha", { id: "b", graph: "project:b", identity: "override", root: fixture.directory });
    assert.match(b.text, /Shared preference/);
    assert.match(b.text, /Foreign private sentinel/);
    assert.doesNotMatch(b.text, /Alpha applicability|Legacy private sentinel/);
  } finally { await fixture.close(); }
});

test("legacy and scoped writers cannot supersede each other's current semantic slots", async () => {
  const fixture = await memoryFixture();
  try {
    const subject = "preference:feedback";
    await seedLegacyNote(fixture, { graph: GLOBAL_GRAPH, subject, text: "Old unclassified preference." });
    const scoped = await fixture.db.note({ graph: GLOBAL_GRAPH, subject, text: "Current explicit global preference." });
    assert.deepEqual((await fixture.db.current(undefined, 10)).rows.map((row) => row.value), ["Old unclassified preference."]);
    const later = await seedLegacyNote(fixture, { graph: GLOBAL_GRAPH, subject, text: "Later legacy-only preference." });
    assert.deepEqual((await fixture.db.current(undefined, 10, GLOBAL_GRAPH)).rows.map((row) => row.stanza), [scoped.stanza]);
    assert.deepEqual((await fixture.db.current(undefined, 10)).rows.map((row) => row.stanza), [later.stanza]);
    const validity = await fixture.db.semanticSql("SELECT valid_to_transaction, valid_to_time FROM as_of_statement", undefined, 10, GLOBAL_GRAPH);
    assert.deepEqual(validity.rows, [{ valid_to_transaction: null, valid_to_time: null }]);
  } finally { await fixture.close(); }
});

test("project identity normalizes transports, separates forks, and supports worktrees/non-Git overrides", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-memory-project-"));
  const exec = promisify(execFile);
  const git = (...args: string[]) => exec("git", args);
  const a = join(directory, "a");
  const b = join(directory, "b");
  const wt = join(directory, "worktree");
  // This file's tests run serially in their own Node process. Keep Git from
  // inheriting a person's repository, index, signing, hooks or global config.
  const gitEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("GIT_")));
  for (const key of Object.keys(gitEnvironment)) delete process.env[key];
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  process.env.GIT_CONFIG_GLOBAL = join(directory, "absent-global-config");
  process.env.GIT_TEMPLATE_DIR = join(directory, "empty-template");
  try {
    await mkdir(process.env.GIT_TEMPLATE_DIR);
    const none = await resolveProject(directory);
    assert.equal(none.identity, "none");
    assert.throws(() => selectGraph(undefined, none, "note"), /No project identity/);
    assert.equal(selectGraph("global", none, "note"), GLOBAL_GRAPH);
    assert.equal(selectGraph(" global ", none, "note"), GLOBAL_GRAPH);
    assert.equal(selectGraph(" legacy ", none, "wake"), undefined);
    assert.equal((await resolveProject(directory, "explicit-project")).graph, "project:explicit-project");
    await assert.rejects(() => resolveProject(directory, ""), /PI_MEMORY_PROJECT/);
    await git("init", "-q", a);
    await git("-C", a, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "initial");
    await git("-C", a, "remote", "add", "origin", "https://token:secret@github.com/Team/Repo.git?credential=hidden");
    await git("clone", "-q", "--no-hardlinks", a, b);
    await git("-C", b, "remote", "set-url", "origin", "git@github.com:team/repo.git");
    const first = await resolveProject(a);
    assert.equal(first.graph, (await resolveProject(b)).graph);
    assert.equal(first.identity, "origin");
    assert.doesNotMatch(JSON.stringify(first), /secret|hidden|token/);
    assert.equal(canonicalRemote("ssh://git@github.com:22/team/repo.git"), "github.com/team/repo");
    await git("-C", b, "remote", "set-url", "origin", "git@github.com:fork/repo.git");
    assert.notEqual(first.graph, (await resolveProject(b)).graph);
    await git("-C", a, "remote", "remove", "origin");
    await git("-C", a, "worktree", "add", "--detach", "-q", wt, "HEAD");
    assert.equal((await resolveProject(a)).graph, (await resolveProject(wt)).graph);
    assert.equal((await resolveProject(a)).identity, "local");
    await Promise.all(Array.from({ length: 500 }, (_, index) => writeFile(join(a, `${index}-${"x".repeat(80)}`), "")));
    const noisy = await git("-C", a, "status", "--porcelain", "--untracked-files=normal");
    assert(Buffer.byteLength(noisy.stdout) > 32 * 1024);
    assert.equal((await resolveProject(a)).dirty, true, "partial porcelain output already proves a dirty checkout");
  } finally {
    for (const key of Object.keys(process.env)) if (key.startsWith("GIT_")) delete process.env[key];
    Object.assign(process.env, gitEnvironment);
    await rm(directory, { recursive: true, force: true });
  }
});

async function seedLegacyNote(fixture: { db: MemoryDatabase; path: string }, input: { text: string; graph: string; subject?: string }) {
  const legacy = await fixture.db.note({ text: input.text, subject: input.subject });
  await fixture.db.close();
  // Assemble the exact v1 named-graph form in disposable fixtures. Production
  // scoped writes cannot emit it; this is not a migration or a user-data update.
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  try {
    await connection.run(`LOAD sqlite; ATTACH '${fixture.path.replaceAll("'", "''")}' AS legacy (TYPE SQLITE)`);
    await connection.run("UPDATE legacy.statements SET graph = ? WHERE transaction_id = ?", [input.graph, legacy.transactionId]);
    await connection.run("UPDATE legacy.transactions SET receipt = ? WHERE transaction_id = ?", [JSON.stringify({ graph: input.graph, predicate: "memory:note" }), legacy.transactionId]);
  } finally { connection.closeSync(); instance.closeSync(); }
  fixture.db = await MemoryDatabase.open(fixture.path, "scope-auditor");
  return legacy;
}

async function settleAll(db: MemoryDatabase, graph?: string): Promise<number[]> {
  const transactions: number[] = [];
  for (;;) {
    const task = await db.summaryTask(graph);
    if (!task) return transactions;
    const result = await db.saveSummary({
      summary: task.summary,
      graph,
      sourceHash: task.sourceHash,
      text: summaryText(task),
    });
    transactions.push(result.transactionId);
  }
}

function summaryText(task: SummaryTask): string {
  return `Summary ${task.rangeStart}-${task.rangeEnd - 1}: ${task.source.map((source) => source.text).join(" ")}`.slice(0, 270);
}

async function memoryFixture(): Promise<{
  directory: string;
  path: string;
  db: MemoryDatabase;
  close(): Promise<void>;
}> {
  const directory = await mkdtemp(join(tmpdir(), "pi-memory-test-"));
  const databasePath = join(directory, "memory.sqlite");
  const db = await MemoryDatabase.open(databasePath, "test-session");
  return {
    directory,
    path: databasePath,
    db,
    async close(this: { db: MemoryDatabase }) {
      await this.db.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function runWorker(storeUrl: string, databasePath: string, index: number): Promise<void> {
  const code = `
    const { MemoryDatabase } = await import(${JSON.stringify(storeUrl)});
    const db = await MemoryDatabase.open(process.argv[1], 'worker-' + process.argv[2]);
    await db.note({ text: 'parallel durable note ' + process.argv[2] });
    await db.close();
  `;
  return runNode(code, [databasePath, String(index)], `memory worker ${index}`);
}

function runNode(code: string, args: string[], label = "node subprocess"): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (exitCode) => {
      if (exitCode === 0) resolve();
      else reject(new Error(`${label} exited ${exitCode}: ${stderr}`));
    });
  });
}
