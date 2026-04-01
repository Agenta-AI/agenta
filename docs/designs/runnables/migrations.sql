-- Coverage Baseline

SELECT COUNT(*) AS total_rows
FROM workflow_revisions;
-- 137474

SELECT COUNT(*) AS total_non_null_data_rows
FROM workflow_revisions
WHERE data IS NOT NULL;
-- 96858

SELECT COUNT(*) AS total_classifiable_rows
FROM workflow_revisions
WHERE data IS NOT NULL;
-- 96858


-- Row 1: Current URI = agenta:builtin:chat:v0

SELECT COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' = 'agenta:builtin:chat:v0';
-- 12745

SELECT *
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' = 'agenta:builtin:chat:v0'
ORDER BY created_at DESC
LIMIT 10;
--

  
-- Row 2: Current URI = agenta:builtin:completion:v0

SELECT COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' = 'agenta:builtin:completion:v0';
-- 34314

SELECT *
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' = 'agenta:builtin:completion:v0'
ORDER BY created_at DESC
LIMIT 10;
--


-- Row 3: Current URI = agenta:builtin:code:v0

SELECT COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' = 'agenta:builtin:code:v0';
-- 12

SELECT *
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' = 'agenta:builtin:code:v0'
ORDER BY created_at DESC
LIMIT 10;
--


-- Row 4: Current URI = agenta:builtin:hook:v0

SELECT COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' = 'agenta:builtin:hook:v0';
-- 1459
  
SELECT *
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' = 'agenta:builtin:hook:v0'
ORDER BY created_at DESC
LIMIT 10;
--


-- Row 5: No URI, URL present, custom non-evaluator

SELECT COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND data::jsonb ->> 'url' IS NOT NULL
  AND flags->>'is_custom' = 'true'
  AND flags->>'is_evaluator' = 'false';
-- 19
  
SELECT *
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND data::jsonb ->> 'url' IS NOT NULL
  AND flags->>'is_custom' = 'true'
  AND flags->>'is_evaluator' = 'false'
ORDER BY created_at DESC
LIMIT 10;
--

SELECT
  data::jsonb ->> 'url' AS url,
  COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND data::jsonb ->> 'url' IS NOT NULL
  AND flags->>'is_custom' = 'true'
  AND flags->>'is_evaluator' = 'false'
GROUP BY data::jsonb ->> 'url'
ORDER BY count DESC, url;
--


-- Row 6: No URI, no URL, human non-custom evaluator

SELECT COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND (
    NOT (data::jsonb ? 'url')
    OR data::jsonb ->> 'url' IS NULL
  )
  AND flags = '{"is_chat": false, "is_human": true, "is_custom": false, "is_evaluator": true}'::jsonb;
-- 1789

SELECT *
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND (
    NOT (data::jsonb ? 'url')
    OR data::jsonb ->> 'url' IS NULL
  )
  AND flags = '{"is_chat": false, "is_human": true, "is_custom": false, "is_evaluator": true}'::jsonb
ORDER BY created_at DESC
LIMIT 10;
--


-- Row 7: No URI, no URL, non-human custom evaluator

SELECT COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND (
    NOT (data::jsonb ? 'url')
    OR data::jsonb ->> 'url' IS NULL
  )
  AND flags = '{"is_chat": false, "is_human": false, "is_custom": true, "is_evaluator": true}'::jsonb;
-- 32
  
SELECT *
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND (
    NOT (data::jsonb ? 'url')
    OR data::jsonb ->> 'url' IS NULL
  )
  AND flags = '{"is_chat": false, "is_human": false, "is_custom": true, "is_evaluator": true}'::jsonb
ORDER BY created_at DESC
LIMIT 10;
--


-- Row 8: Hook-variant builtin evaluator URI

SELECT
  data::jsonb ->> 'uri' AS uri,
  COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' IN (
    'agenta:builtin:auto_webhook_test:v0'
  )
GROUP BY data::jsonb ->> 'uri'
ORDER BY count DESC;
-- "agenta:builtin:auto_webhook_test:v0"	22

SELECT *
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' IN (
    'agenta:builtin:auto_webhook_test:v0'
  )
ORDER BY created_at DESC
LIMIT 10;
--


-- Row 9: Code-variant builtin evaluator URI

SELECT
  data::jsonb ->> 'uri' AS uri,
  COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' IN (
    'agenta:builtin:auto_custom_code_run:v0'
  )
GROUP BY data::jsonb ->> 'uri'
ORDER BY count DESC;
-- "agenta:builtin:auto_custom_code_run:v0"	428

SELECT *
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' IN (
    'agenta:builtin:auto_custom_code_run:v0'
  )
ORDER BY created_at DESC
LIMIT 10;
--


-- Row 10: Other builtin evaluator URI

SELECT
  data::jsonb ->> 'uri' AS uri,
  COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' LIKE 'agenta:builtin:%'
  AND data::jsonb ->> 'uri' NOT IN (
    'agenta:builtin:chat:v0',
    'agenta:builtin:completion:v0',
    'agenta:builtin:code:v0',
    'agenta:builtin:hook:v0',
    'agenta:builtin:auto_webhook_test:v0',
    'agenta:builtin:auto_custom_code_run:v0'
  )
  AND flags->>'is_evaluator' = 'true'
GROUP BY data::jsonb ->> 'uri'
ORDER BY count DESC, uri;
-- "agenta:builtin:auto_exact_match:v0"	20121
-- "agenta:builtin:auto_contains_json:v0"	18349
-- "agenta:builtin:auto_ai_critique:v0"	1411
-- "agenta:builtin:auto_semantic_similarity:v0"	431
-- "agenta:builtin:auto_similarity_match:v0"	346
-- "agenta:builtin:field_match_test:v0"	205
-- "agenta:builtin:auto_json_diff:v0"	111
-- "agenta:builtin:auto_contains:v0"	42
-- "agenta:builtin:auto_regex_test:v0"	35
-- "agenta:builtin:json_multi_field_match:v0"	27
-- "agenta:builtin:auto_levenshtein_distance:v0"	24
-- "agenta:builtin:auto_contains_any:v0"	13
-- "agenta:builtin:auto_starts_with:v0"	13
-- "agenta:builtin:auto_contains_all:v0"	11
-- "agenta:builtin:rag_faithfulness:v0"	10
-- "agenta:builtin:rag_context_relevancy:v0"	4
-- "agenta:builtin:auto_human:v0"	2
-- "agenta:builtin:auto_ends_with:v0"	1

SELECT *
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' LIKE 'agenta:builtin:%'
  AND data::jsonb ->> 'uri' NOT IN (
    'agenta:builtin:chat:v0',
    'agenta:builtin:completion:v0',
    'agenta:builtin:code:v0',
    'agenta:builtin:hook:v0',
    'agenta:builtin:auto_webhook_test:v0',
    'agenta:builtin:auto_custom_code_run:v0'
  )
  AND flags->>'is_evaluator' = 'true'
ORDER BY created_at DESC
LIMIT 10;
--


-- Row 11: No URI, no URL, chat fallback

SELECT COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND (
    NOT (data::jsonb ? 'url')
    OR data::jsonb ->> 'url' IS NULL
  )
  AND flags->>'is_chat' = 'true'
  AND flags->>'is_evaluator' = 'false';
-- 74

SELECT *
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND (
    NOT (data::jsonb ? 'url')
    OR data::jsonb ->> 'url' IS NULL
  )
  AND flags->>'is_chat' = 'true'
  AND flags->>'is_evaluator' = 'false'
ORDER BY created_at DESC
LIMIT 10;
-- 


-- Row 12: No URI, no URL, completion fallback

SELECT COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND (
    NOT (data::jsonb ? 'url')
    OR data::jsonb ->> 'url' IS NULL
  )
  AND flags->>'is_chat' = 'false'
  AND flags->>'is_evaluator' = 'false'
  AND flags->>'is_custom' = 'false';
-- 472

SELECT *
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND (
    NOT (data::jsonb ? 'url')
    OR data::jsonb ->> 'url' IS NULL
  )
  AND flags->>'is_chat' = 'false'
  AND flags->>'is_evaluator' = 'false'
  AND flags->>'is_custom' = 'false'
ORDER BY created_at DESC
LIMIT 10;
--

-- Row 13: No URI, no URL, custom non-evaluator local exception

SELECT COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND (
    NOT (data::jsonb ? 'url')
    OR data::jsonb ->> 'url' IS NULL
  )
  AND flags->>'is_chat' = 'false'
  AND flags->>'is_custom' = 'true'
  AND flags->>'is_evaluator' = 'false'
  AND (
    NOT (data::jsonb ? 'schemas')
    OR jsonb_typeof(data::jsonb -> 'schemas') = 'null'
  );
-- 2

SELECT *
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND (
    NOT (data::jsonb ? 'url')
    OR data::jsonb ->> 'url' IS NULL
  )
  AND flags->>'is_chat' = 'false'
  AND flags->>'is_custom' = 'true'
  AND flags->>'is_evaluator' = 'false'
  AND (
    NOT (data::jsonb ? 'schemas')
    OR jsonb_typeof(data::jsonb -> 'schemas') = 'null'
  )
ORDER BY created_at DESC
LIMIT 10;
--


-- Row 14: user:custom URI (all)

SELECT COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' LIKE 'user:custom:%';
-- 1222

SELECT
  data::jsonb ->> 'uri' AS uri,
  flags->>'is_evaluator' AS is_evaluator,
  COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' LIKE 'user:custom:%'
GROUP BY data::jsonb ->> 'uri', flags->>'is_evaluator'
ORDER BY count DESC;
--


-- Row 15: No URI, Agenta service URL, chat

SELECT COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND data::jsonb ->> 'url' IS NOT NULL
  AND flags->>'is_chat' = 'true'
  AND flags->>'is_custom' = 'false'
  AND flags->>'is_evaluator' = 'false';
-- 1114

SELECT
  data::jsonb ->> 'url' AS url,
  COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND data::jsonb ->> 'url' IS NOT NULL
  AND flags->>'is_chat' = 'true'
  AND flags->>'is_custom' = 'false'
  AND flags->>'is_evaluator' = 'false'
GROUP BY data::jsonb ->> 'url'
ORDER BY count DESC;
-- "https://eu.cloud.agenta.ai/services/chat"	1060
-- "https://cloud.agenta.ai/services/chat"	54


-- Row 16: No URI, Agenta service URL, completion

SELECT COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND data::jsonb ->> 'url' IS NOT NULL
  AND flags->>'is_chat' = 'false'
  AND flags->>'is_custom' = 'false'
  AND flags->>'is_evaluator' = 'false';
-- 1998
  
SELECT
  data::jsonb ->> 'url' AS url,
  COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND data::jsonb ->> 'url' IS NOT NULL
  AND flags->>'is_chat' = 'false'
  AND flags->>'is_custom' = 'false'
  AND flags->>'is_evaluator' = 'false'
GROUP BY data::jsonb ->> 'url'
ORDER BY count DESC;
-- "https://eu.cloud.agenta.ai/services/completion"	1673
-- "https://cloud.agenta.ai/services/completion"	325


-- Partition Coverage Check

WITH classified AS (
  SELECT
    id,
    CASE
      WHEN data IS NULL THEN 'unclassified:null-data'
      WHEN data::jsonb ->> 'uri' = 'agenta:builtin:chat:v0' THEN 'row-1'
      WHEN data::jsonb ->> 'uri' = 'agenta:builtin:completion:v0' THEN 'row-2'
      WHEN data::jsonb ->> 'uri' = 'agenta:builtin:code:v0' THEN 'row-3'
      WHEN data::jsonb ->> 'uri' = 'agenta:builtin:hook:v0' THEN 'row-4'
      WHEN (
        NOT (data::jsonb ? 'uri')
        OR data::jsonb ->> 'uri' IS NULL
      ) AND data::jsonb ->> 'url' IS NOT NULL AND flags->>'is_custom' = 'true' AND flags->>'is_evaluator' = 'false' THEN 'row-5'
      WHEN (
        NOT (data::jsonb ? 'uri')
        OR data::jsonb ->> 'uri' IS NULL
      ) AND (
        NOT (data::jsonb ? 'url')
        OR data::jsonb ->> 'url' IS NULL
      ) AND flags = '{"is_chat": false, "is_human": true, "is_custom": false, "is_evaluator": true}'::jsonb THEN 'row-6'
      WHEN (
        NOT (data::jsonb ? 'uri')
        OR data::jsonb ->> 'uri' IS NULL
      ) AND (
        NOT (data::jsonb ? 'url')
        OR data::jsonb ->> 'url' IS NULL
      ) AND flags = '{"is_chat": false, "is_human": false, "is_custom": true, "is_evaluator": true}'::jsonb THEN 'row-7'
      WHEN data::jsonb ->> 'uri' IN ('agenta:builtin:auto_webhook_test:v0') THEN 'row-8'
      WHEN data::jsonb ->> 'uri' IN ('agenta:builtin:auto_custom_code_run:v0') THEN 'row-9'
      WHEN data::jsonb ->> 'uri' LIKE 'agenta:builtin:%' AND flags->>'is_evaluator' = 'true' THEN 'row-10'
      WHEN (
        NOT (data::jsonb ? 'uri')
        OR data::jsonb ->> 'uri' IS NULL
      ) AND (
        NOT (data::jsonb ? 'url')
        OR data::jsonb ->> 'url' IS NULL
      ) AND flags->>'is_chat' = 'true' AND flags->>'is_evaluator' = 'false' THEN 'row-11'
      WHEN (
        NOT (data::jsonb ? 'uri')
        OR data::jsonb ->> 'uri' IS NULL
      ) AND (
        NOT (data::jsonb ? 'url')
        OR data::jsonb ->> 'url' IS NULL
      ) AND flags->>'is_chat' = 'false' AND flags->>'is_evaluator' = 'false' AND flags->>'is_custom' = 'false' THEN 'row-12'
      WHEN (
        NOT (data::jsonb ? 'uri')
        OR data::jsonb ->> 'uri' IS NULL
      ) AND (
        NOT (data::jsonb ? 'url')
        OR data::jsonb ->> 'url' IS NULL
      ) AND flags->>'is_chat' = 'false' AND flags->>'is_custom' = 'true' AND flags->>'is_evaluator' = 'false' THEN 'row-13'
      WHEN data::jsonb ->> 'uri' LIKE 'user:custom:%' THEN 'row-14'
      WHEN (
        NOT (data::jsonb ? 'uri')
        OR data::jsonb ->> 'uri' IS NULL
      ) AND data::jsonb ->> 'url' IS NOT NULL
        AND flags->>'is_chat' = 'true'
        AND flags->>'is_custom' = 'false'
        AND flags->>'is_evaluator' = 'false' THEN 'row-15'
      WHEN (
        NOT (data::jsonb ? 'uri')
        OR data::jsonb ->> 'uri' IS NULL
      ) AND data::jsonb ->> 'url' IS NOT NULL
        AND flags->>'is_chat' = 'false'
        AND flags->>'is_custom' = 'false'
        AND flags->>'is_evaluator' = 'false' THEN 'row-16'
      ELSE 'unclassified'
    END AS bucket
  FROM workflow_revisions
)
SELECT bucket, COUNT(*) AS count
FROM classified
GROUP BY bucket
ORDER BY bucket;


-- ============================================================
-- MIGRATION PHASE 1: No-URI rows — backfill URI (target v0)
-- ============================================================
-- Rows: 5, 6, 7, 11, 12, 13, 15, 16
--
-- Convention:
--   data column is json; cast to jsonb for mutation, back to json for storage.
--   flags column is jsonb; REPLACED entirely (not merged).
--     Only user-defined role flags are persisted: is_evaluator, is_application, is_snippet.
--     All other flags (is_managed, is_custom, is_llm, is_hook, is_code, is_match,
--     is_human, is_chat, has_url, has_script, has_handler) are inferred at
--     commit/read time by infer_flags_from_data().
--   '-' removes a key (safe if absent).
--   '||' merges/overwrites at top level.
--   Legacy 'service' and 'configuration' are dropped (not retained).
--   Legacy script dict {"runtime","content"} is flattened to top-level runtime + string script.
--   runtime is to script what headers is to url — same persist/drop policy.
--   schemas.outputs backfill where noted is deferred to application layer.


-- Row 5: No URI + URL + custom non-evaluator → hook:v0
-- Expected: 19 rows
BEGIN;

UPDATE workflow_revisions
SET
  data = (
    (data::jsonb - 'script' - 'runtime' - 'service' - 'configuration')
    || '{"uri": "agenta:builtin:hook:v0"}'::jsonb
  )::json,
  flags = '{"is_evaluator": false, "is_application": true, "is_snippet": false}'::jsonb
WHERE data IS NOT NULL
  AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
  AND data::jsonb ->> 'url' IS NOT NULL
  AND flags->>'is_custom' = 'true'
  AND flags->>'is_evaluator' = 'false';

-- Check: original condition returns 0
SELECT COUNT(*) AS remaining FROM workflow_revisions
WHERE data IS NOT NULL
  AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
  AND data::jsonb ->> 'url' IS NOT NULL
  AND flags->>'is_custom' = 'true'
  AND flags->>'is_evaluator' = 'false';

-- COMMIT;
-- ROLLBACK;


-- Row 6: No URI + no URL + human non-custom evaluator → feedback:v0
-- Expected: 1789 rows
-- NOTE: schemas.outputs backfill deferred
BEGIN;

UPDATE workflow_revisions
SET
  data = (
    (data::jsonb - 'script' - 'runtime' - 'parameters' - 'service' - 'configuration')
    || '{"uri": "agenta:custom:feedback:v0"}'::jsonb
  )::json,
  flags = '{"is_evaluator": true, "is_application": false, "is_snippet": false}'::jsonb
WHERE data IS NOT NULL
  AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
  AND (NOT (data::jsonb ? 'url') OR data::jsonb ->> 'url' IS NULL)
  AND flags = '{"is_chat": false, "is_human": true, "is_custom": false, "is_evaluator": true}'::jsonb;

-- Check: original condition returns 0
SELECT COUNT(*) AS remaining FROM workflow_revisions
WHERE data IS NOT NULL
  AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
  AND (NOT (data::jsonb ? 'url') OR data::jsonb ->> 'url' IS NULL)
  AND flags = '{"is_chat": false, "is_human": true, "is_custom": false, "is_evaluator": true}'::jsonb;

-- COMMIT;
-- ROLLBACK;


-- Row 7: No URI + no URL + non-human custom evaluator → feedback:v0
-- Expected: 32 rows
BEGIN;

UPDATE workflow_revisions
SET
  data = (
    (data::jsonb - 'script' - 'runtime' - 'parameters' - 'service' - 'configuration')
    || '{"uri": "agenta:custom:feedback:v0"}'::jsonb
  )::json,
  flags = '{"is_evaluator": true, "is_application": false, "is_snippet": false}'::jsonb
WHERE data IS NOT NULL
  AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
  AND (NOT (data::jsonb ? 'url') OR data::jsonb ->> 'url' IS NULL)
  AND flags = '{"is_chat": false, "is_human": false, "is_custom": true, "is_evaluator": true}'::jsonb;

-- Check: original condition returns 0
SELECT COUNT(*) AS remaining FROM workflow_revisions
WHERE data IS NOT NULL
  AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
  AND (NOT (data::jsonb ? 'url') OR data::jsonb ->> 'url' IS NULL)
  AND flags = '{"is_chat": false, "is_human": false, "is_custom": true, "is_evaluator": true}'::jsonb;

-- COMMIT;
-- ROLLBACK;


-- Row 11: No URI + no URL + chat fallback → chat:v0
-- Expected: 74 rows
BEGIN;

UPDATE workflow_revisions
SET
  data = (
    (data::jsonb - 'script' - 'runtime' - 'url' - 'headers' - 'service' - 'configuration')
    || '{"uri": "agenta:builtin:chat:v0"}'::jsonb
  )::json,
  flags = '{"is_evaluator": false, "is_application": true, "is_snippet": false}'::jsonb
WHERE data IS NOT NULL
  AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
  AND (NOT (data::jsonb ? 'url') OR data::jsonb ->> 'url' IS NULL)
  AND flags->>'is_chat' = 'true'
  AND flags->>'is_evaluator' = 'false';

-- Check: original condition returns 0
SELECT COUNT(*) AS remaining FROM workflow_revisions
WHERE data IS NOT NULL
  AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
  AND (NOT (data::jsonb ? 'url') OR data::jsonb ->> 'url' IS NULL)
  AND flags->>'is_chat' = 'true'
  AND flags->>'is_evaluator' = 'false';

-- COMMIT;
-- ROLLBACK;


-- Row 12: No URI + no URL + completion fallback → completion:v0
-- Expected: 472 rows
BEGIN;

UPDATE workflow_revisions
SET
  data = (
    (data::jsonb - 'script' - 'runtime' - 'url' - 'headers' - 'service' - 'configuration')
    || '{"uri": "agenta:builtin:completion:v0"}'::jsonb
  )::json,
  flags = '{"is_evaluator": false, "is_application": true, "is_snippet": false}'::jsonb
WHERE data IS NOT NULL
  AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
  AND (NOT (data::jsonb ? 'url') OR data::jsonb ->> 'url' IS NULL)
  AND flags->>'is_chat' = 'false'
  AND flags->>'is_evaluator' = 'false'
  AND flags->>'is_custom' = 'false';

-- Check: original condition returns 0
SELECT COUNT(*) AS remaining FROM workflow_revisions
WHERE data IS NOT NULL
  AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
  AND (NOT (data::jsonb ? 'url') OR data::jsonb ->> 'url' IS NULL)
  AND flags->>'is_chat' = 'false'
  AND flags->>'is_evaluator' = 'false'
  AND flags->>'is_custom' = 'false';

-- COMMIT;
-- ROLLBACK;


-- Row 13: No URI + no URL + custom non-evaluator local exception → user:custom:local:latest
-- Expected: 2 rows
-- NOTE: flatten script dict if present
BEGIN;

UPDATE workflow_revisions
SET
  data = (
    (data::jsonb - 'script' - 'service' - 'configuration')
    || '{"uri": "user:custom:local:latest"}'::jsonb
    || CASE
         WHEN jsonb_typeof(data::jsonb -> 'script') = 'object' THEN
           jsonb_build_object(
             'runtime', data::jsonb -> 'script' -> 'runtime',
             'script',  data::jsonb -> 'script' -> 'content'
           )
         WHEN data::jsonb -> 'script' IS NOT NULL THEN
           jsonb_build_object('script', data::jsonb -> 'script')
         ELSE '{}'::jsonb
       END
  )::json,
  flags = '{"is_evaluator": false, "is_application": true, "is_snippet": false}'::jsonb
WHERE data IS NOT NULL
  AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
  AND (NOT (data::jsonb ? 'url') OR data::jsonb ->> 'url' IS NULL)
  AND flags->>'is_chat' = 'false'
  AND flags->>'is_custom' = 'true'
  AND flags->>'is_evaluator' = 'false'
  AND (NOT (data::jsonb ? 'schemas') OR jsonb_typeof(data::jsonb -> 'schemas') = 'null');

-- Check: original condition returns 0
SELECT COUNT(*) AS remaining FROM workflow_revisions
WHERE data IS NOT NULL
  AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
  AND (NOT (data::jsonb ? 'url') OR data::jsonb ->> 'url' IS NULL)
  AND flags->>'is_chat' = 'false'
  AND flags->>'is_custom' = 'true'
  AND flags->>'is_evaluator' = 'false'
  AND (NOT (data::jsonb ? 'schemas') OR jsonb_typeof(data::jsonb -> 'schemas') = 'null');

-- COMMIT;
-- ROLLBACK;


-- Row 15: No URI + Agenta service URL + chat → chat:v0
-- Expected: 1114 rows
BEGIN;

UPDATE workflow_revisions
SET
  data = (
    (data::jsonb - 'script' - 'runtime' - 'url' - 'headers' - 'service' - 'configuration')
    || '{"uri": "agenta:builtin:chat:v0"}'::jsonb
  )::json,
  flags = '{"is_evaluator": false, "is_application": true, "is_snippet": false}'::jsonb
WHERE data IS NOT NULL
  AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
  AND data::jsonb ->> 'url' IS NOT NULL
  AND flags->>'is_chat' = 'true'
  AND flags->>'is_custom' = 'false'
  AND flags->>'is_evaluator' = 'false';

-- Check: original condition returns 0
SELECT COUNT(*) AS remaining FROM workflow_revisions
WHERE data IS NOT NULL
  AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
  AND data::jsonb ->> 'url' IS NOT NULL
  AND flags->>'is_chat' = 'true'
  AND flags->>'is_custom' = 'false'
  AND flags->>'is_evaluator' = 'false';

-- COMMIT;
-- ROLLBACK;


-- Row 16: No URI + Agenta service URL + completion → completion:v0
-- Expected: 1998 rows
BEGIN;

UPDATE workflow_revisions
SET
  data = (
    (data::jsonb - 'script' - 'runtime' - 'url' - 'headers' - 'service' - 'configuration')
    || '{"uri": "agenta:builtin:completion:v0"}'::jsonb
  )::json,
  flags = '{"is_evaluator": false, "is_application": true, "is_snippet": false}'::jsonb
WHERE data IS NOT NULL
  AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
  AND data::jsonb ->> 'url' IS NOT NULL
  AND flags->>'is_chat' = 'false'
  AND flags->>'is_custom' = 'false'
  AND flags->>'is_evaluator' = 'false';

-- Check: original condition returns 0
SELECT COUNT(*) AS remaining FROM workflow_revisions
WHERE data IS NOT NULL
  AND (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
  AND data::jsonb ->> 'url' IS NOT NULL
  AND flags->>'is_chat' = 'false'
  AND flags->>'is_custom' = 'false'
  AND flags->>'is_evaluator' = 'false';

-- COMMIT;
-- ROLLBACK;


-- ============================================================
-- MIGRATION PHASE 2: Existing v0 URI rows — normalize fields
-- ============================================================
-- Rows: 1, 2, 3, 4, 8, 9, 10, 14
--
-- Existing legacy evaluator URIs (rows 8, 9, 10) stay as-is.
-- Rows 1, 2, 3 keep v0 URI; field/flag normalization only.
-- Row 4 keeps hook:v0 URI; field normalization only.
-- Row 14 (user:custom) preserves is_evaluator per-row, derives is_application.
--
-- Check strategy for Phase 2: URI doesn't change for most rows,
-- so verify legacy fields (service, configuration) are absent after migration.


-- Row 14: user:custom — replace flags, flatten script dict if present
-- Expected: 1222 rows
BEGIN;

UPDATE workflow_revisions
SET
  data = (
    (data::jsonb - 'script' - 'service' - 'configuration')
    || CASE
         WHEN jsonb_typeof(data::jsonb -> 'script') = 'object' THEN
           jsonb_build_object(
             'runtime', data::jsonb -> 'script' -> 'runtime',
             'script',  data::jsonb -> 'script' -> 'content'
           )
         WHEN data::jsonb -> 'script' IS NOT NULL THEN
           jsonb_build_object('script', data::jsonb -> 'script')
         ELSE '{}'::jsonb
       END
  )::json,
  flags = jsonb_build_object(
    'is_evaluator', COALESCE((flags->>'is_evaluator')::boolean, false),
    'is_application', NOT COALESCE((flags->>'is_evaluator')::boolean, false),
    'is_snippet', false
  )
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' LIKE 'user:custom:%';

-- Check: no user:custom rows with legacy service/configuration remaining
SELECT COUNT(*) AS remaining FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' LIKE 'user:custom:%'
  AND (data::jsonb ? 'service' OR data::jsonb ? 'configuration');

-- COMMIT;
-- ROLLBACK;


-- Row 8: auto_webhook_test:v0 — normalize fields
-- Expected: 22 rows
-- NOTE: schemas.outputs backfill deferred
BEGIN;

UPDATE workflow_revisions
SET
  data = (data::jsonb - 'script' - 'runtime' - 'service' - 'configuration')::json,
  flags = '{"is_evaluator": true, "is_application": false, "is_snippet": false}'::jsonb
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' = 'agenta:builtin:auto_webhook_test:v0';

-- Check: no rows with legacy fields remaining
SELECT COUNT(*) AS remaining FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' = 'agenta:builtin:auto_webhook_test:v0'
  AND (data::jsonb ? 'service' OR data::jsonb ? 'configuration');

-- COMMIT;
-- ROLLBACK;


-- Row 9: auto_custom_code_run:v0 — normalize fields, flatten script dict
-- Expected: 428 rows
-- NOTE: schemas.outputs backfill deferred
BEGIN;

UPDATE workflow_revisions
SET
  data = (
    (data::jsonb - 'url' - 'headers' - 'script' - 'service' - 'configuration')
    || CASE
         WHEN jsonb_typeof(data::jsonb -> 'script') = 'object' THEN
           jsonb_build_object(
             'runtime', data::jsonb -> 'script' -> 'runtime',
             'script',  data::jsonb -> 'script' -> 'content'
           )
         WHEN data::jsonb -> 'script' IS NOT NULL THEN
           jsonb_build_object('script', data::jsonb -> 'script')
         ELSE '{}'::jsonb
       END
  )::json,
  flags = '{"is_evaluator": true, "is_application": false, "is_snippet": false}'::jsonb
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' = 'agenta:builtin:auto_custom_code_run:v0';

-- Check: no rows with legacy fields remaining
SELECT COUNT(*) AS remaining FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' = 'agenta:builtin:auto_custom_code_run:v0'
  AND (data::jsonb ? 'service' OR data::jsonb ? 'configuration');

-- COMMIT;
-- ROLLBACK;


-- Row 10: Other builtin evaluator URI — normalize fields
-- Expected: ~41156 rows
-- NOTE: schemas.outputs backfill deferred
BEGIN;

UPDATE workflow_revisions
SET
  data = (data::jsonb - 'url' - 'headers' - 'script' - 'runtime' - 'service' - 'configuration')::json,
  flags = '{"is_evaluator": true, "is_application": false, "is_snippet": false}'::jsonb
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' LIKE 'agenta:builtin:%'
  AND data::jsonb ->> 'uri' NOT IN (
    'agenta:builtin:chat:v0',
    'agenta:builtin:completion:v0',
    'agenta:builtin:code:v0',
    'agenta:builtin:hook:v0',
    'agenta:builtin:auto_webhook_test:v0',
    'agenta:builtin:auto_custom_code_run:v0'
  )
  AND flags->>'is_evaluator' = 'true';

-- Check: no rows with legacy fields remaining
SELECT COUNT(*) AS remaining FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' LIKE 'agenta:builtin:%'
  AND data::jsonb ->> 'uri' NOT IN (
    'agenta:builtin:chat:v0',
    'agenta:builtin:completion:v0',
    'agenta:builtin:code:v0',
    'agenta:builtin:hook:v0',
    'agenta:builtin:auto_webhook_test:v0',
    'agenta:builtin:auto_custom_code_run:v0'
  )
  AND flags->>'is_evaluator' = 'true'
  AND (data::jsonb ? 'service' OR data::jsonb ? 'configuration');

-- COMMIT;
-- ROLLBACK;


-- Row 4: hook:v0 — normalize fields (keep URI)
-- Expected: 1459 rows
BEGIN;

UPDATE workflow_revisions
SET
  data = (data::jsonb - 'script' - 'runtime' - 'service' - 'configuration')::json,
  flags = '{"is_evaluator": false, "is_application": true, "is_snippet": false}'::jsonb
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' = 'agenta:builtin:hook:v0';

-- Check: no rows with legacy fields remaining
SELECT COUNT(*) AS remaining FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' = 'agenta:builtin:hook:v0'
  AND (data::jsonb ? 'service' OR data::jsonb ? 'configuration');

-- COMMIT;
-- ROLLBACK;


-- Row 3: code:v0 — normalize fields, flatten script dict
-- Expected: 12 rows
BEGIN;

UPDATE workflow_revisions
SET
  data = (
    (data::jsonb - 'url' - 'headers' - 'script' - 'service' - 'configuration')
    || CASE
         WHEN jsonb_typeof(data::jsonb -> 'script') = 'object' THEN
           jsonb_build_object(
             'runtime', data::jsonb -> 'script' -> 'runtime',
             'script',  data::jsonb -> 'script' -> 'content'
           )
         WHEN data::jsonb -> 'script' IS NOT NULL THEN
           jsonb_build_object('script', data::jsonb -> 'script')
         ELSE '{}'::jsonb
       END
  )::json,
  flags = '{"is_evaluator": false, "is_application": true, "is_snippet": false}'::jsonb
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' = 'agenta:builtin:code:v0';

-- Check: no rows with legacy fields remaining
SELECT COUNT(*) AS remaining FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' = 'agenta:builtin:code:v0'
  AND (data::jsonb ? 'service' OR data::jsonb ? 'configuration');

-- COMMIT;
-- ROLLBACK;


-- Row 1: chat:v0 — normalize fields
-- Expected: 12745 rows
BEGIN;

UPDATE workflow_revisions
SET
  data = (data::jsonb - 'script' - 'runtime' - 'url' - 'headers' - 'service' - 'configuration')::json,
  flags = '{"is_evaluator": false, "is_application": true, "is_snippet": false}'::jsonb
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' = 'agenta:builtin:chat:v0';

-- Check: no rows with legacy fields remaining
SELECT COUNT(*) AS remaining FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' = 'agenta:builtin:chat:v0'
  AND (data::jsonb ? 'service' OR data::jsonb ? 'configuration');

-- COMMIT;
-- ROLLBACK;


-- Row 2: completion:v0 — normalize fields
-- Expected: 34314 rows
BEGIN;

UPDATE workflow_revisions
SET
  data = (data::jsonb - 'script' - 'runtime' - 'url' - 'headers' - 'service' - 'configuration')::json,
  flags = '{"is_evaluator": false, "is_application": true, "is_snippet": false}'::jsonb
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' = 'agenta:builtin:completion:v0';

-- Check: no rows with legacy fields remaining
SELECT COUNT(*) AS remaining FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' = 'agenta:builtin:completion:v0'
  AND (data::jsonb ? 'service' OR data::jsonb ? 'configuration');

-- COMMIT;
-- ROLLBACK;