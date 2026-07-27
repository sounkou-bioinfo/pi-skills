import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MemoryDatabase, type SummaryTask } from "./store.js";

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
        sessionManager: { getSessionId() { return 'lifecycle-session'; } },
        ui: { setStatus() {}, notify() {} },
      };
      await Promise.all([
        handlers.session_start({}, ctx),
        handlers.before_agent_start({ systemPrompt: 'base' }, ctx),
        tool.execute('call', { op: 'note', text: 'lifecycle note' }, undefined, undefined, ctx),
        handlers.session_shutdown(),
      ]);
      const db = await MemoryDatabase.open(process.argv[1], 'auditor');
      const status = await db.status();
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

async function settleAll(db: MemoryDatabase): Promise<number[]> {
  const transactions: number[] = [];
  for (;;) {
    const task = await db.summaryTask();
    if (!task) return transactions;
    const result = await db.saveSummary({
      summary: task.summary,
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
    async close() {
      await db.close();
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
