-- name: latest_transaction
SELECT coalesce(max(transaction_id), 0) AS transaction_id
FROM memo.transactions;

-- name: transaction_at_time
SELECT coalesce(max(transaction_id), 0) AS transaction_id
FROM memo.transactions
WHERE transaction_time <= ?;

-- name: transaction_receipt
SELECT transaction_id, transaction_time, operation, session_id, receipt
FROM memo.transactions
WHERE transaction_id = ?;

-- name: set_query_context
UPDATE memory_query_context
SET as_of_transaction = ?, line_budget = ?;

-- name: status
SELECT
    q.as_of_transaction,
    (SELECT transaction_time FROM memo.transactions WHERE transaction_id = q.as_of_transaction) AS as_of_time,
    (SELECT count(*) FROM as_of_note) AS notes,
    (SELECT count(*) FROM as_of_summary) AS summaries,
    (SELECT count(*) FROM pending_summary) AS pending_summaries,
    (SELECT count(*) FROM as_of_statement) AS current_statements
FROM memory_query_context q;

-- name: wake
SELECT * FROM wake ORDER BY range_start;

-- name: next_summary_task
SELECT * FROM next_summary_task;

-- name: next_summary_source
SELECT * FROM next_summary_source ORDER BY source_order;

-- name: zoom
WITH target AS (
    SELECT * FROM memory_block WHERE summary = ?
),
children AS (
    SELECT t.range_start AS child_start,
           t.range_start + t.block_size / 2 AS child_end
    FROM target t
    UNION ALL
    SELECT t.range_start + t.block_size / 2,
           t.range_end
    FROM target t
)
SELECT
    c.child_start AS range_start,
    c.child_end AS range_end,
    CASE WHEN c.child_end - c.child_start = 1 THEN n.stanza ELSE s.summary END AS subject,
    CASE WHEN c.child_end - c.child_start = 1 THEN 'note' ELSE 'summary' END AS kind,
    CASE WHEN c.child_end - c.child_start = 1 THEN n.value ELSE s.summary_text END AS value,
    CASE WHEN c.child_end - c.child_start = 1 THEN n.transaction_time ELSE NULL END AS transaction_time,
    CASE WHEN c.child_end - c.child_start = 1 THEN n.graph ELSE NULL END AS graph,
    CASE WHEN c.child_end - c.child_start = 1 THEN true ELSE s.summary IS NOT NULL END AS ready
FROM children c
LEFT JOIN as_of_note n
  ON c.child_end - c.child_start = 1
 AND n.note_index = c.child_start
LEFT JOIN as_of_summary s
  ON c.child_end - c.child_start > 1
 AND s.range_start = c.child_start
 AND s.range_end = c.child_end
ORDER BY c.child_start;

-- name: summary_target
SELECT * FROM as_of_summary WHERE summary = ?;

-- name: summary_ancestors
WITH target AS (
    SELECT * FROM as_of_summary WHERE summary = ?
)
SELECT s.*
FROM as_of_summary s, target t
WHERE s.range_start <= t.range_start
  AND s.range_end >= t.range_end
ORDER BY s.range_end - s.range_start;

-- name: allocate_transaction
UPDATE memo.memory_counter
SET value = value + 1
WHERE name = 'transaction';

-- name: allocated_transaction
SELECT value AS transaction_id
FROM memo.memory_counter
WHERE name = 'transaction';

-- name: latest_transaction_time
SELECT max(transaction_time) AS transaction_time
FROM memo.transactions;

-- name: insert_transaction
INSERT INTO memo.transactions
    (transaction_id, transaction_time, operation, session_id, receipt)
VALUES (?, ?, ?, ?, ?);

-- name: insert_statement
INSERT INTO memo.statements
    (transaction_id, ordinal, stanza, subject, predicate, object, value, datatype, language, graph)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);

-- name: fts_watermark
SELECT coalesce(max(transaction_id), 0) AS transaction_id
FROM memo.note_statement
WHERE transaction_id <= ?;

-- name: fts_documents
SELECT
    CAST(transaction_id AS VARCHAR) || ':' || CAST(ordinal AS VARCHAR) AS document_id,
    note_index,
    transaction_id,
    ordinal,
    stanza,
    subject,
    predicate,
    value,
    graph
FROM memo.note_statement
WHERE transaction_id <= ?;

-- name: fts_recall
SELECT *
FROM (
    SELECT d.*,
           fts_main_memory_fts_document.match_bm25(
             document_id,
             ?,
             fields := 'value,subject,predicate,graph'
           ) AS score
    FROM memory_fts_document d
) ranked
WHERE score IS NOT NULL
ORDER BY score DESC, note_index DESC
LIMIT ?;
