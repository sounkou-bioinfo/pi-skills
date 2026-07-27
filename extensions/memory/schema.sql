-- Pi permanent memory: a small Semantic-SQL-style authority.
-- Physical state is deliberately limited to transactions, statements, and a
-- mechanical transaction counter. Every semantic relation below is a view.

CREATE TABLE IF NOT EXISTS memo.memory_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memo.memory_counter (
    name TEXT PRIMARY KEY,
    value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memo.transactions (
    transaction_id INTEGER PRIMARY KEY,
    transaction_time TEXT NOT NULL,
    operation TEXT NOT NULL,
    session_id TEXT,
    receipt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memo.statements (
    transaction_id INTEGER NOT NULL,
    ordinal INTEGER NOT NULL,
    stanza TEXT NOT NULL,
    subject TEXT NOT NULL,
    predicate TEXT NOT NULL,
    object TEXT,
    value TEXT,
    datatype TEXT,
    language TEXT,
    graph TEXT NOT NULL,
    PRIMARY KEY (transaction_id, ordinal)
);

CREATE INDEX IF NOT EXISTS statements_spog
    ON memo.main.statements (subject, predicate, object, graph);
CREATE INDEX IF NOT EXISTS statements_value
    ON memo.main.statements (predicate, value, graph);
CREATE INDEX IF NOT EXISTS statements_stanza
    ON memo.main.statements (stanza, predicate, transaction_id);
CREATE INDEX IF NOT EXISTS transactions_time
    ON memo.main.transactions (transaction_time, transaction_id);

CREATE VIEW IF NOT EXISTS memo.node_to_node_statement AS
SELECT * FROM statements WHERE object IS NOT NULL;

CREATE VIEW IF NOT EXISTS memo.node_to_value_statement AS
SELECT * FROM statements WHERE value IS NOT NULL;

CREATE VIEW IF NOT EXISTS memo.note_statement AS
SELECT
    row_number() OVER (ORDER BY s.transaction_id, s.ordinal) - 1 AS note_index,
    s.*,
    t.transaction_time
FROM statements s
JOIN transactions t USING (transaction_id)
WHERE substr(s.stanza, 1, 12) = 'memory:note/';

CREATE VIEW IF NOT EXISTS memo.summary_property_statement AS
SELECT s.*, t.transaction_time
FROM statements s
JOIN transactions t USING (transaction_id)
WHERE substr(s.stanza, 1, 15) = 'memory:summary/'
  AND s.graph = 'memory:system'
  AND s.subject = s.stanza;

-- A subject/predicate in one graph is a semantic slot. Appending a new
-- statement to that slot supersedes the old value without rewriting it.
CREATE VIEW IF NOT EXISTS memo.statement_history AS
SELECT
    s.*,
    t.transaction_time AS valid_from_time,
    s.transaction_id AS valid_from_transaction,
    lead(s.transaction_id) OVER (
        PARTITION BY s.graph, s.subject, s.predicate
        ORDER BY s.transaction_id, s.ordinal
    ) AS valid_to_transaction,
    lead(t.transaction_time) OVER (
        PARTITION BY s.graph, s.subject, s.predicate
        ORDER BY s.transaction_id, s.ordinal
    ) AS valid_to_time
FROM statements s
JOIN transactions t USING (transaction_id);

CREATE VIEW IF NOT EXISTS memo.current_statement AS
SELECT *
FROM statement_history
WHERE valid_to_transaction IS NULL;

CREATE VIEW IF NOT EXISTS memo.current_summary AS
SELECT
    h.summary,
    CAST(rs.value AS INTEGER) AS range_start,
    CAST(re.value AS INTEGER) AS range_end,
    l.object AS left_summary,
    r.object AS right_summary,
    txt.value AS summary_text,
    hash.value AS source_hash,
    status.value AS status
FROM (SELECT DISTINCT stanza AS summary FROM summary_property_statement) h
JOIN current_statement rs
  ON rs.subject = h.summary AND rs.stanza = h.summary
 AND rs.graph = 'memory:system' AND rs.predicate = 'memory:rangeStart'
JOIN current_statement re
  ON re.subject = h.summary AND re.stanza = h.summary
 AND re.graph = 'memory:system' AND re.predicate = 'memory:rangeEnd'
JOIN current_statement txt
  ON txt.subject = h.summary AND txt.stanza = h.summary
 AND txt.graph = 'memory:system' AND txt.predicate = 'memory:summary'
JOIN current_statement hash
  ON hash.subject = h.summary AND hash.stanza = h.summary
 AND hash.graph = 'memory:system' AND hash.predicate = 'memory:sourceHash'
JOIN current_statement status
  ON status.subject = h.summary AND status.stanza = h.summary
 AND status.graph = 'memory:system' AND status.predicate = 'memory:status'
LEFT JOIN current_statement l
  ON l.subject = h.summary AND l.stanza = h.summary
 AND l.graph = 'memory:system' AND l.predicate = 'memory:left'
LEFT JOIN current_statement r
  ON r.subject = h.summary AND r.stanza = h.summary
 AND r.graph = 'memory:system' AND r.predicate = 'memory:right'
WHERE status.value = 'active';
