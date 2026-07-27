import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";

const SCHEMA_VERSION = "1";
const DEFAULT_LINE_BUDGET = 80;
const MAX_MEMORY_BYTES = 280;
const MAX_SQL_BYTES = 100_000;
const SEMANTIC_SQL_TIMEOUT_MS = 10_000;
const SQLITE_BUSY_TIMEOUT_MS = 15_000;
const MAX_ROWS = 200;

const sqlDirectory = process.env.PI_MEMORY_SQL_DIR
  ? path.resolve(process.env.PI_MEMORY_SQL_DIR)
  : path.dirname(fileURLToPath(import.meta.url));
const schemaSql = fs.readFileSync(path.join(sqlDirectory, "schema.sql"), "utf8");
const sessionSql = fs.readFileSync(path.join(sqlDirectory, "session.sql"), "utf8");
const operations = loadNamedSql(fs.readFileSync(path.join(sqlDirectory, "operations.sql"), "utf8"));

type Row = Record<string, unknown>;

export type MemoryStatement = {
  stanza: string;
  subject: string;
  predicate: string;
  object?: string;
  value?: string;
  datatype?: string;
  language?: string;
  graph?: string;
};

export type MemorySnapshot = {
  transactionId: number;
  transactionTime?: string;
};

export type MemoryStatus = MemorySnapshot & {
  databasePath: string;
  journalMode: "WAL";
  notes: number;
  summaries: number;
  pendingSummaries: number;
  currentStatements: number;
};

export type SummaryTask = {
  summary: string;
  rangeStart: number;
  rangeEnd: number;
  blockSize: number;
  leftSummary?: string;
  rightSummary?: string;
  sourceHash: string;
  sourceCount: number;
  remaining: number;
  source: Array<{ source: string; text: string }>;
};

export type WakeRow = {
  rangeStart: number;
  rangeEnd: number;
  subject?: string;
  kind: "note" | "summary";
  value?: string;
  transactionTime?: string;
  graph?: string;
  ready: boolean;
};

export class MemoryDatabase {
  readonly databasePath: string;
  private readonly sessionId?: string;
  private readonly instance: DuckDBInstance;
  private readonly connection: DuckDBConnection;
  private tail: Promise<void> = Promise.resolve();
  private closed = false;
  private ftsLoaded = false;
  private ftsWatermark?: number;

  private constructor(databasePath: string, sessionId: string | undefined, instance: DuckDBInstance, connection: DuckDBConnection) {
    this.databasePath = databasePath;
    this.sessionId = sessionId;
    this.instance = instance;
    this.connection = connection;
  }

  static async open(databasePath = defaultMemoryPath(), sessionId?: string): Promise<MemoryDatabase> {
    const absolute = path.resolve(databasePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    const configureWal = !fs.existsSync(absolute);
    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    try {
      await attachSqlite(connection, absolute, false, configureWal);
      const version = await retrySqliteBusy(async () => {
        const schemaExists = await one(
          connection,
          `SELECT 1 AS present
           FROM duckdb_tables()
           WHERE database_name = 'memo' AND table_name = 'memory_meta'`,
        );
        const existingVersion = schemaExists
          ? await one(connection, "SELECT value FROM memo.memory_meta WHERE key = 'schema_version'")
          : undefined;
        if (!existingVersion) await connection.run(schemaSql);
        await connection.run(
          `INSERT INTO memo.memory_counter
           SELECT 'transaction', 0
           WHERE NOT EXISTS (
             SELECT 1 FROM memo.memory_counter WHERE name = 'transaction'
           )`,
        );
        await connection.run(
          `INSERT INTO memo.memory_meta
           SELECT 'schema_version', ?
           WHERE NOT EXISTS (
             SELECT 1 FROM memo.memory_meta WHERE key = 'schema_version'
           )`,
          [SCHEMA_VERSION],
        );
        return one(connection, "SELECT value FROM memo.memory_meta WHERE key = 'schema_version'");
      });
      if (!version || String(version.value) !== SCHEMA_VERSION) {
        throw new Error(`Unsupported memory schema version ${String(version?.value)}; expected ${SCHEMA_VERSION}`);
      }
      await connection.run(sessionSql);
      const database = new MemoryDatabase(absolute, sessionId, instance, connection);
      await database.setContextOn(connection, undefined, DEFAULT_LINE_BUDGET);
      return database;
    } catch (error) {
      connection.closeSync();
      instance.closeSync();
      throw error;
    }
  }

  async close(): Promise<void> {
    const result = this.tail.then(() => {
      if (this.closed) return;
      this.closed = true;
      this.connection.closeSync();
      this.instance.closeSync();
    });
    this.tail = result.then(() => undefined, () => undefined);
    await result;
  }

  async note(input: {
    text: string;
    subject?: string;
    predicate?: string;
    graph?: string;
    datatype?: string;
    language?: string;
  }): Promise<{ transactionId: number; stanza: string; task?: SummaryTask }> {
    const text = oneLine(input.text, "memory");
    const graph = label(input.graph ?? "memory:global", "graph", 200);
    if (graph === "memory:system") throw new Error("memory:system is reserved for derived summary statements");
    const predicate = label(input.predicate ?? "memory:note", "predicate", 200);
    return this.serial(async () => {
      let stanza = "";
      const transactionId = await this.append("note", { graph, predicate }, async (tx) => {
        stanza = `memory:note/${tx}`;
        return [{
          stanza,
          subject: label(input.subject ?? stanza, "subject", 300),
          predicate,
          value: text,
          datatype: input.datatype ? label(input.datatype, "datatype", 100) : "xsd:string",
          language: input.language ? label(input.language, "language", 30) : undefined,
          graph,
        }];
      });
      await this.setContextOn(this.connection, undefined, DEFAULT_LINE_BUDGET);
      return { transactionId, stanza, task: await this.summaryTaskOn(this.connection) };
    });
  }

  async wake(asOf?: string | number, lineBudget = DEFAULT_LINE_BUDGET): Promise<{ snapshot: MemorySnapshot; rows: WakeRow[]; ready: boolean }> {
    return this.serial(async () => {
      const snapshot = await this.setContextOn(this.connection, asOf, boundedInteger(lineBudget, 1, 500, "line budget"));
      const result = (await rows(this.connection, operations.wake)).map(toWakeRow);
      return { snapshot, rows: result, ready: result.every((row) => row.ready) };
    });
  }

  async status(asOf?: string | number): Promise<MemoryStatus> {
    return this.serial(async () => {
      const snapshot = await this.setContextOn(this.connection, asOf, DEFAULT_LINE_BUDGET);
      const result = await one(this.connection, operations.status);
      if (!result) throw new Error("Memory status query returned no row");
      return {
        ...snapshot,
        databasePath: this.databasePath,
        journalMode: "WAL",
        notes: integer(result.notes),
        summaries: integer(result.summaries),
        pendingSummaries: integer(result.pending_summaries),
        currentStatements: integer(result.current_statements),
      };
    });
  }

  async summaryTask(): Promise<SummaryTask | undefined> {
    return this.serial(async () => {
      await this.setContextOn(this.connection, undefined, DEFAULT_LINE_BUDGET);
      return this.summaryTaskOn(this.connection);
    });
  }

  async saveSummary(input: { summary: string; text: string; sourceHash: string }): Promise<{ transactionId: number; remaining: number }> {
    const text = oneLine(input.text, "summary");
    const summary = label(input.summary, "summary subject", 300);
    const sourceHash = input.sourceHash.trim();
    if (!/^[a-f0-9]{64}$/.test(sourceHash)) throw new Error("source_hash must be the hash returned by memory nap");

    return this.serial(async () => {
      const transactionId = await this.append("summary", { summary, source_hash: sourceHash }, async () => {
        await this.setContextOn(this.connection, undefined, DEFAULT_LINE_BUDGET);
        const task = await this.summaryTaskOn(this.connection);
        if (!task) throw new Error("Nothing is pending compression");
        if (task.summary !== summary) throw new Error(`${summary} is not next; next is ${task.summary}`);
        if (task.sourceHash !== sourceHash) throw new Error(`Source for ${summary} changed; request memory nap again`);
        const statement = (predicate: string, value?: string, object?: string, datatype?: string): MemoryStatement => ({
          stanza: summary,
          subject: summary,
          predicate,
          value,
          object,
          datatype,
          graph: "memory:system",
        });
        const result = [
          statement("memory:rangeStart", String(task.rangeStart), undefined, "xsd:integer"),
          statement("memory:rangeEnd", String(task.rangeEnd), undefined, "xsd:integer"),
          statement("memory:summary", text, undefined, "xsd:string"),
          statement("memory:sourceHash", sourceHash, undefined, "xsd:string"),
          statement("memory:status", "active", undefined, "xsd:string"),
        ];
        if (task.leftSummary) result.push(statement("memory:left", undefined, task.leftSummary));
        if (task.rightSummary) result.push(statement("memory:right", undefined, task.rightSummary));
        return result;
      });
      await this.setContextOn(this.connection, undefined, DEFAULT_LINE_BUDGET);
      const task = await this.summaryTaskOn(this.connection);
      return { transactionId, remaining: task?.remaining ?? 0 };
    });
  }

  async forget(summary: string, reason = "summary rejected"): Promise<{ transactionId: number; invalidated: number }> {
    const subject = label(summary, "summary subject", 300);
    const cleanReason = oneLine(reason, "reason");
    return this.serial(async () => {
      let invalidated = 0;
      const transactionId = await this.append("forget", { summary: subject, reason: cleanReason }, async () => {
        await this.setContextOn(this.connection, undefined, DEFAULT_LINE_BUDGET);
        const target = await one(this.connection, operations.summary_target, [subject]);
        if (!target) throw new Error(`No active summary ${subject}`);
        const ancestors = await rows(this.connection, operations.summary_ancestors, [subject]);
        invalidated = ancestors.length;
        return ancestors.map((ancestor) => ({
          stanza: String(ancestor.summary),
          subject: String(ancestor.summary),
          predicate: "memory:status",
          value: "invalid",
          datatype: "xsd:string",
          graph: "memory:system",
        }));
      });
      await this.setContextOn(this.connection, undefined, DEFAULT_LINE_BUDGET);
      return { transactionId, invalidated };
    });
  }

  async zoom(summary: string, asOf?: string | number): Promise<{ snapshot: MemorySnapshot; rows: WakeRow[] }> {
    const subject = label(summary, "summary subject", 300);
    return this.serial(async () => {
      const snapshot = await this.setContextOn(this.connection, asOf, DEFAULT_LINE_BUDGET);
      const result = (await rows(this.connection, operations.zoom, [subject])).map(toWakeRow);
      if (result.length === 0) throw new Error(`Unknown summary block ${subject} at transaction ${snapshot.transactionId}`);
      return { snapshot, rows: result };
    });
  }

  async recall(query: string, asOf?: string | number, limit = 30): Promise<{ snapshot: MemorySnapshot; rows: Row[]; truncated: boolean }> {
    const search = query.trim();
    if (!search) throw new Error("recall query must not be empty");
    const rowLimit = boundedInteger(limit, 1, MAX_ROWS, "recall limit");
    return this.serial(async () => {
      const snapshot = await this.setContextOn(this.connection, asOf, DEFAULT_LINE_BUDGET);
      const watermarkRow = await one(this.connection, operations.fts_watermark, [snapshot.transactionId]);
      const watermark = integer(watermarkRow?.transaction_id ?? 0);
      if (watermark === 0) return { snapshot, rows: [], truncated: false };
      await this.refreshFts(watermark, snapshot.transactionId);
      const result = (await rows(this.connection, operations.fts_recall, [search, rowLimit + 1])).map(jsonSafeRow);
      return { snapshot, rows: result.slice(0, rowLimit), truncated: result.length > rowLimit };
    });
  }

  async semanticSql(query: string, asOf?: string | number, limit = 100): Promise<{ snapshot: MemorySnapshot; rows: Row[]; truncated: boolean }> {
    const sql = query.trim().replace(/;\s*$/, "");
    if (!/^(select|with)\b/i.test(sql)) throw new Error("memory SQL must be a read-only SELECT or WITH query");
    if (Buffer.byteLength(sql, "utf8") > MAX_SQL_BYTES) throw new Error(`memory SQL exceeds ${MAX_SQL_BYTES} UTF-8 bytes`);
    const rowLimit = boundedInteger(limit, 1, MAX_ROWS, "SQL row limit");
    return this.serial(async () => {
      const instance = await DuckDBInstance.create(":memory:");
      const connection = await instance.connect();
      try {
        await attachSqlite(connection, this.databasePath, true);
        await connection.run(sessionSql);
        await connection.run("SET enable_external_access = false");
        await connection.run("SET disabled_filesystems = 'LocalFileSystem'");
        await connection.run("SET threads = 1");
        await connection.run("SET memory_limit = '256MB'");
        await connection.run("SET lock_configuration = true");
        const snapshot = await this.setContextOn(connection, asOf, DEFAULT_LINE_BUDGET);
        const timer = setTimeout(() => connection.interrupt(), SEMANTIC_SQL_TIMEOUT_MS);
        timer.unref();
        try {
          const result = (await rows(connection, `SELECT * FROM (${sql}) memory_user_query LIMIT ${rowLimit + 1}`)).map(jsonSafeRow);
          return { snapshot, rows: result.slice(0, rowLimit), truncated: result.length > rowLimit };
        } finally {
          clearTimeout(timer);
        }
      } finally {
        connection.closeSync();
        instance.closeSync();
      }
    });
  }

  private async summaryTaskOn(connection: DuckDBConnection): Promise<SummaryTask | undefined> {
    const task = await one(connection, operations.next_summary_task);
    if (!task) return undefined;
    const source = await rows(connection, operations.next_summary_source);
    return {
      summary: String(task.summary),
      rangeStart: integer(task.range_start),
      rangeEnd: integer(task.range_end),
      blockSize: integer(task.block_size),
      leftSummary: optionalString(task.left_summary),
      rightSummary: optionalString(task.right_summary),
      sourceHash: String(task.source_hash),
      sourceCount: integer(task.source_count),
      remaining: integer(task.remaining),
      source: source.map((row) => ({ source: String(row.source), text: String(row.source_text) })),
    };
  }

  private async append(
    operation: string,
    receipt: Row,
    build: (transactionId: number) => Promise<MemoryStatement[]>,
  ): Promise<number> {
    const deadline = Date.now() + 30_000;
    let attempt = 0;
    for (;;) {
      try {
        return await this.appendOnce(operation, receipt, build);
      } catch (error) {
        if (!isSqliteBusy(error) || Date.now() >= deadline) throw error;
        const ceiling = Math.min(1000, 20 * (2 ** Math.min(attempt++, 6)));
        await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * ceiling) + 10));
      }
    }
  }

  private async appendOnce(
    operation: string,
    receipt: Row,
    build: (transactionId: number) => Promise<MemoryStatement[]>,
  ): Promise<number> {
    await this.connection.run("BEGIN TRANSACTION");
    try {
      await this.connection.run(operations.allocate_transaction);
      const allocated = await one(this.connection, operations.allocated_transaction);
      const transactionId = integer(allocated?.transaction_id);
      const statements = await build(transactionId);
      if (statements.length === 0) throw new Error(`${operation} produced no statements`);
      const previousTime = await one(this.connection, operations.latest_transaction_time);
      const transactionTime = monotonicTimestamp(optionalString(previousTime?.transaction_time));
      await this.connection.run(operations.insert_transaction, [
        transactionId,
        transactionTime,
        operation,
        this.sessionId ?? null,
        JSON.stringify(receipt),
      ]);
      for (let ordinal = 0; ordinal < statements.length; ordinal++) {
        const statement = statements[ordinal];
        validateStatement(statement);
        await this.connection.run(operations.insert_statement, [
          transactionId,
          ordinal,
          statement.stanza,
          statement.subject,
          statement.predicate,
          statement.object ?? null,
          statement.value ?? null,
          statement.datatype ?? null,
          statement.language ?? null,
          statement.graph ?? "memory:global",
        ]);
      }
      await this.connection.run("COMMIT");
      return transactionId;
    } catch (error) {
      try {
        await this.connection.run("ROLLBACK");
      } catch {
        // Preserve the original error.
      }
      throw error;
    }
  }

  private async setContextOn(connection: DuckDBConnection, asOf?: string | number, lineBudget = DEFAULT_LINE_BUDGET): Promise<MemorySnapshot> {
    const latestRow = await one(connection, operations.latest_transaction);
    const latest = integer(latestRow?.transaction_id ?? 0);
    let transactionId: number;
    if (asOf === undefined || asOf === "latest") {
      transactionId = latest;
    } else if (typeof asOf === "number" || /^\d+$/.test(asOf)) {
      transactionId = typeof asOf === "number" ? asOf : Number(asOf);
      if (!Number.isSafeInteger(transactionId) || transactionId < 0 || transactionId > latest) {
        throw new Error(`as_of transaction must be between 0 and ${latest}`);
      }
    } else {
      const timestamp = new Date(asOf);
      if (Number.isNaN(timestamp.valueOf())) throw new Error(`Invalid as_of timestamp '${asOf}'`);
      const row = await one(connection, operations.transaction_at_time, [timestamp.toISOString()]);
      transactionId = integer(row?.transaction_id ?? 0);
    }
    await connection.run(operations.set_query_context, [transactionId, lineBudget]);
    if (transactionId === 0) return { transactionId: 0 };
    const receipt = await one(connection, operations.transaction_receipt, [transactionId]);
    return { transactionId, transactionTime: receipt ? String(receipt.transaction_time) : undefined };
  }

  private async refreshFts(watermark: number, asOfTransaction: number): Promise<void> {
    if (this.ftsWatermark === watermark) return;
    if (!this.ftsLoaded) {
      await this.connection.run("INSTALL fts; LOAD fts");
      this.ftsLoaded = true;
    }
    if (this.ftsWatermark !== undefined) {
      await this.connection.run("PRAGMA drop_fts_index('memory_fts_document')");
      await this.connection.run("DROP TABLE memory_fts_document");
    }
    await this.connection.run(`CREATE TABLE memory_fts_document AS ${operations.fts_documents}`, [asOfTransaction]);
    await this.connection.run(
      `PRAGMA create_fts_index(
         'memory_fts_document', 'document_id',
         'value', 'subject', 'predicate', 'graph',
         stemmer = 'porter', stopwords = 'english', overwrite = 1
       )`,
    );
    this.ftsWatermark = watermark;
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(() => {
      if (this.closed) throw new Error("Memory database is closed");
      return work();
    });
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export function defaultMemoryPath(): string {
  return path.resolve(process.env.PI_MEMORY_DB ?? path.join(os.homedir(), ".pi", "agent", "memory.sqlite"));
}

function loadNamedSql(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  const marker = /^-- name: ([a-z][a-z0-9_]*)\s*$/gm;
  const matches = Array.from(source.matchAll(marker));
  for (let index = 0; index < matches.length; index++) {
    const name = matches[index][1];
    const start = (matches[index].index ?? 0) + matches[index][0].length;
    const end = matches[index + 1]?.index ?? source.length;
    result[name] = source.slice(start, end).trim().replace(/;\s*$/, "");
  }
  return result;
}

async function attachSqlite(
  connection: DuckDBConnection,
  databasePath: string,
  readOnly: boolean,
  configureWal = false,
): Promise<void> {
  const escaped = databasePath.replaceAll("'", "''");
  const options = readOnly
    ? `TYPE SQLITE, READ_ONLY, BUSY_TIMEOUT ${SQLITE_BUSY_TIMEOUT_MS}`
    : `TYPE SQLITE, ${configureWal ? "JOURNAL_MODE 'WAL', " : ""}BUSY_TIMEOUT ${SQLITE_BUSY_TIMEOUT_MS}`;
  await connection.run(`ATTACH '${escaped}' AS memo (${options})`);
}

async function rows(connection: DuckDBConnection, sql: string, values: unknown[] = []): Promise<Row[]> {
  const reader = await connection.runAndReadAll(sql, values as never[]);
  return reader.getRowObjects() as Row[];
}

async function one(connection: DuckDBConnection, sql: string, values: unknown[] = []): Promise<Row | undefined> {
  return (await rows(connection, sql, values))[0];
}

function validateStatement(statement: MemoryStatement): void {
  label(statement.stanza, "stanza", 300);
  label(statement.subject, "subject", 300);
  label(statement.predicate, "predicate", 200);
  label(statement.graph ?? "memory:global", "graph", 200);
  if ((statement.object === undefined) === (statement.value === undefined)) {
    throw new Error("A memory statement must have exactly one of object or value");
  }
  if (statement.object !== undefined) label(statement.object, "object", 500);
  if (statement.value !== undefined && /[\r\n]/.test(statement.value)) throw new Error("statement value must be one line");
}

function oneLine(value: string, name: string): string {
  const clean = value.trim();
  if (!clean) throw new Error(`${name} must not be empty`);
  if (/[\r\n]/.test(clean)) throw new Error(`${name} must be one line`);
  const bytes = Buffer.byteLength(clean);
  if (bytes > MAX_MEMORY_BYTES) throw new Error(`${name} is ${bytes} bytes; limit is ${MAX_MEMORY_BYTES}`);
  return clean;
}

function label(value: string, name: string, maxBytes: number): string {
  const clean = value.trim();
  if (!clean || /[\r\n]/.test(clean) || Buffer.byteLength(clean) > maxBytes) {
    throw new Error(`${name} must be one line of at most ${maxBytes} bytes`);
  }
  return clean;
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

async function retrySqliteBusy<T>(work: () => Promise<T>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  for (;;) {
    try {
      return await work();
    } catch (error) {
      if (!isSqliteBusy(error) || Date.now() >= deadline) throw error;
      const ceiling = Math.min(1000, 20 * (2 ** Math.min(attempt++, 6)));
      await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * ceiling) + 10));
    }
  }
}

function isSqliteBusy(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /database(?: table)? is locked|SQLITE_BUSY/i.test(message);
}

function integer(value: unknown): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(`Expected a safe integer, received ${String(value)}`);
  return result;
}

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function monotonicTimestamp(previous?: string): string {
  const now = Date.now();
  if (!previous) return new Date(now).toISOString();
  const previousMillis = Date.parse(previous);
  if (!Number.isFinite(previousMillis)) throw new Error(`Invalid stored transaction_time '${previous}'`);
  return new Date(Math.max(now, previousMillis + 1)).toISOString();
}

function toWakeRow(row: Row): WakeRow {
  return {
    rangeStart: integer(row.range_start),
    rangeEnd: integer(row.range_end),
    subject: optionalString(row.subject),
    kind: String(row.kind) as "note" | "summary",
    value: optionalString(row.value),
    transactionTime: optionalString(row.transaction_time),
    graph: optionalString(row.graph),
    ready: Boolean(row.ready),
  };
}

function jsonSafeRow(row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, jsonSafe(value)]));
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : value.toString();
  }
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object" && "items" in value) {
    const items = (value as { items?: unknown[] }).items;
    if (Array.isArray(items)) return items.map(jsonSafe);
  }
  return value;
}
