-- Per-process query context. Updating this one row changes every as_of view
-- atomically for the next bounded tool query; durable memory remains untouched.
CREATE TEMP TABLE memory_query_context (
    as_of_transaction INTEGER NOT NULL,
    line_budget INTEGER NOT NULL
);
INSERT INTO memory_query_context VALUES (0, 80);

CREATE TEMP VIEW as_of_statement AS
SELECT h.*
FROM memo.statement_history h
CROSS JOIN memory_query_context q
WHERE h.valid_from_transaction <= q.as_of_transaction
  AND (
    h.valid_to_transaction IS NULL
    OR h.valid_to_transaction > q.as_of_transaction
  );

CREATE TEMP VIEW node_to_node_statement AS
SELECT * FROM as_of_statement WHERE object IS NOT NULL;

CREATE TEMP VIEW node_to_value_statement AS
SELECT * FROM as_of_statement WHERE value IS NOT NULL;

CREATE TEMP VIEW as_of_note AS
SELECT n.*
FROM memo.note_statement n
CROSS JOIN memory_query_context q
WHERE n.transaction_id <= q.as_of_transaction;

CREATE TEMP VIEW as_of_summary AS
SELECT
    subjects.summary,
    CAST(rs.value AS INTEGER) AS range_start,
    CAST(re.value AS INTEGER) AS range_end,
    l.object AS left_summary,
    r.object AS right_summary,
    txt.value AS summary_text,
    hash.value AS source_hash,
    status.value AS status,
    txt.valid_from_transaction AS summary_transaction
FROM (
    SELECT DISTINCT subject AS summary
    FROM as_of_statement
    WHERE stanza LIKE 'memory:summary/%'
      AND graph = 'memory:system'
      AND subject = stanza
) subjects
JOIN as_of_statement rs
  ON rs.subject = subjects.summary AND rs.stanza = subjects.summary
 AND rs.graph = 'memory:system' AND rs.predicate = 'memory:rangeStart'
JOIN as_of_statement re
  ON re.subject = subjects.summary AND re.stanza = subjects.summary
 AND re.graph = 'memory:system' AND re.predicate = 'memory:rangeEnd'
JOIN as_of_statement txt
  ON txt.subject = subjects.summary AND txt.stanza = subjects.summary
 AND txt.graph = 'memory:system' AND txt.predicate = 'memory:summary'
JOIN as_of_statement hash
  ON hash.subject = subjects.summary AND hash.stanza = subjects.summary
 AND hash.graph = 'memory:system' AND hash.predicate = 'memory:sourceHash'
JOIN as_of_statement status
  ON status.subject = subjects.summary AND status.stanza = subjects.summary
 AND status.graph = 'memory:system' AND status.predicate = 'memory:status'
LEFT JOIN as_of_statement l
  ON l.subject = subjects.summary AND l.stanza = subjects.summary
 AND l.graph = 'memory:system' AND l.predicate = 'memory:left'
LEFT JOIN as_of_statement r
  ON r.subject = subjects.summary AND r.stanza = subjects.summary
 AND r.graph = 'memory:system' AND r.predicate = 'memory:right'
WHERE status.value = 'active';

-- Every complete aligned power-of-two range in the as_of note stream.
CREATE TEMP VIEW memory_block AS
WITH RECURSIVE
note_stats(note_count) AS (
    SELECT count(*) FROM as_of_note
),
levels(block_size) AS (
    VALUES (2::BIGINT)
    UNION ALL
    SELECT block_size * 2
    FROM levels, note_stats
    WHERE block_size * 2 <= note_count
)
SELECT
    'memory:summary/' || CAST(i * block_size AS VARCHAR) || '-' ||
      CAST((i + 1) * block_size AS VARCHAR) AS summary,
    i * block_size AS range_start,
    (i + 1) * block_size AS range_end,
    block_size,
    CASE
      WHEN block_size = 2 THEN (
        SELECT stanza FROM as_of_note WHERE note_index = i * block_size
      )
      ELSE
        'memory:summary/' || CAST(i * block_size AS VARCHAR) || '-' ||
          CAST(CAST(i * block_size + block_size / 2 AS BIGINT) AS VARCHAR)
    END AS left_summary,
    CASE
      WHEN block_size = 2 THEN (
        SELECT stanza FROM as_of_note WHERE note_index = i * block_size + 1
      )
      ELSE
        'memory:summary/' || CAST(CAST(i * block_size + block_size / 2 AS BIGINT) AS VARCHAR) || '-' ||
          CAST((i + 1) * block_size AS VARCHAR)
    END AS right_summary
FROM levels, note_stats,
     range(0, CAST(floor(note_count / block_size) AS BIGINT)) blocks(i);

CREATE TEMP VIEW pending_summary AS
SELECT b.*
FROM memory_block b
LEFT JOIN as_of_summary s USING (summary)
WHERE s.summary IS NULL;

CREATE TEMP VIEW next_pending_summary AS
SELECT *
FROM pending_summary
ORDER BY block_size, range_start
LIMIT 1;

CREATE TEMP VIEW next_summary_source AS
SELECT
    n.note_index AS source_order,
    n.stanza AS source,
    n.value AS source_text,
    n.transaction_id AS source_transaction,
    NULL::VARCHAR AS source_hash
FROM next_pending_summary p
JOIN as_of_note n
  ON p.block_size <= 16
 AND n.note_index >= p.range_start
 AND n.note_index < p.range_end
UNION ALL
SELECT
    s.range_start AS source_order,
    s.summary AS source,
    s.summary_text AS source_text,
    s.summary_transaction AS source_transaction,
    s.source_hash
FROM next_pending_summary p
JOIN as_of_summary s
  ON p.block_size > 16
 AND s.summary IN (p.left_summary, p.right_summary);

CREATE TEMP VIEW next_summary_task AS
SELECT
    p.*,
    sha256(string_agg(
      src.source || chr(31) || src.source_text || chr(31) ||
      CAST(src.source_transaction AS VARCHAR) || chr(31) || coalesce(src.source_hash, ''),
      chr(30) ORDER BY src.source_order
    )) AS source_hash,
    count(src.source) AS source_count,
    (SELECT count(*) FROM pending_summary) AS remaining
FROM next_pending_summary p
JOIN next_summary_source src ON true
GROUP BY ALL;

-- A bounded, gap-free binary frontier. Slots are allocated recursively with
-- a bias toward the newer (right) half, so detail increases toward the
-- present while old ranges collapse into summary statements.
CREATE TEMP VIEW wake_frontier AS
WITH RECURSIVE
stats AS (
    SELECT count(*)::BIGINT AS note_count,
           max(q.line_budget)::BIGINT AS line_budget
    FROM as_of_note, memory_query_context q
),
roots(block_size) AS (
    VALUES (1::BIGINT)
    UNION ALL
    SELECT block_size * 2
    FROM roots, stats
    WHERE block_size < note_count
),
walk(range_start, range_end, slots, note_count) AS (
    SELECT 0::BIGINT, max(block_size), stats.line_budget, stats.note_count
    FROM roots, stats
    GROUP BY stats.line_budget, stats.note_count
    UNION ALL
    SELECT
      CASE child.side WHEN 0 THEN w.range_start ELSE (w.range_start + w.range_end) / 2 END,
      CASE child.side WHEN 0 THEN (w.range_start + w.range_end) / 2 ELSE w.range_end END,
      CASE
        WHEN child.side = 0 AND w.note_count <= (w.range_start + w.range_end) / 2 THEN w.slots
        WHEN child.side = 0 THEN greatest(1, floor(w.slots / 3))
        WHEN w.slots > 1 THEN greatest(1, w.slots - greatest(1, floor(w.slots / 3)))
        ELSE 1
      END,
      w.note_count
    FROM walk w, range(0, 2) child(side)
    WHERE w.range_end - w.range_start > 1
      AND (
        w.range_end > w.note_count
        OR w.slots > 1
      )
      AND CASE child.side
            WHEN 0 THEN w.range_start
            ELSE (w.range_start + w.range_end) / 2
          END < w.note_count
)
SELECT range_start, range_end
FROM walk
WHERE range_start < note_count
  AND (
    range_end - range_start = 1
    OR (range_end <= note_count AND slots <= 1)
  );

CREATE TEMP VIEW wake AS
SELECT
    f.range_start,
    f.range_end,
    CASE WHEN f.range_end - f.range_start = 1 THEN n.stanza ELSE s.summary END AS subject,
    CASE WHEN f.range_end - f.range_start = 1 THEN 'note' ELSE 'summary' END AS kind,
    CASE WHEN f.range_end - f.range_start = 1 THEN n.value ELSE s.summary_text END AS value,
    CASE WHEN f.range_end - f.range_start = 1 THEN n.transaction_time ELSE NULL END AS transaction_time,
    CASE WHEN f.range_end - f.range_start = 1 THEN n.graph ELSE NULL END AS graph,
    CASE
      WHEN f.range_end - f.range_start = 1 THEN true
      ELSE s.summary IS NOT NULL
    END AS ready
FROM wake_frontier f
LEFT JOIN as_of_note n
  ON f.range_end - f.range_start = 1
 AND n.note_index = f.range_start
LEFT JOIN as_of_summary s
  ON f.range_end - f.range_start > 1
 AND s.range_start = f.range_start
 AND s.range_end = f.range_end
ORDER BY f.range_start;
