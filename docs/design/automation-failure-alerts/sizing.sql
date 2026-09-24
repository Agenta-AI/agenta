-- Automation failure sizing queries. Read-only. Tested on local EE dev (agenta_ee_core / agenta_ee_tracing) on 2026-09-24.
-- Step 1: run in the CORE DB.
-- Q1: automation inventory
SELECT 'schedules' AS kind,
       count(*) FILTER (WHERE deleted_at IS NULL) AS total,
       count(*) FILTER (WHERE deleted_at IS NULL AND (flags->>'is_active')::bool) AS active,
       count(DISTINCT project_id) FILTER (WHERE deleted_at IS NULL AND (flags->>'is_active')::bool) AS projects
FROM trigger_schedules
UNION ALL
SELECT 'subscriptions',
       count(*) FILTER (WHERE deleted_at IS NULL),
       count(*) FILTER (WHERE deleted_at IS NULL AND (flags->>'is_active')::bool
                        AND (flags->>'is_valid')::bool AND NOT coalesce((flags->>'is_test')::bool,false)),
       count(DISTINCT project_id) FILTER (WHERE deleted_at IS NULL AND (flags->>'is_active')::bool)
FROM trigger_subscriptions;

-- Q2: runs per day, by kind and delivery status (last 30 days, test captures excluded)
SELECT date_trunc('day', created_at)::date AS day,
       CASE WHEN schedule_id IS NOT NULL THEN 'schedule' ELSE 'subscription' END AS kind,
       status->>'code' AS code,
       count(*) AS runs
FROM trigger_deliveries
WHERE created_at > now() - interval '30 days'
  AND NOT coalesce((data->>'is_test')::bool, false)
GROUP BY 1, 2, 3
ORDER BY 1 DESC, 2, 3;

-- Q3: pre-start failures by error text (400/409/500), top 20
SELECT status->>'code' AS code, left(data->>'error', 120) AS error, count(*) AS n
FROM trigger_deliveries
WHERE created_at > now() - interval '30 days' AND status->>'code' IN ('400','409','500')
GROUP BY 1, 2 ORDER BY n DESC LIMIT 20;

-- Step 2: run in the CORE DB with the psql client. \copy writes /tmp/auto_turns.csv on the
-- client machine, so run step 3 from the same machine (the tracing DB session reads that file).
-- Q4a (core DB): export dispatched automation turns. run_id IS the runner turn_id.
\copy (SELECT id AS delivery_id, project_id, created_at, coalesce(schedule_id, subscription_id) AS automation_id, CASE WHEN schedule_id IS NOT NULL THEN 'schedule' ELSE 'subscription' END AS kind, data->>'session_id' AS session_id, data->'result'->>'run_id' AS turn_id FROM trigger_deliveries WHERE status->>'code' = '202' AND created_at > now() - interval '7 days' AND data->'result'->>'run_id' IS NOT NULL) TO '/tmp/auto_turns.csv' CSV HEADER

-- Step 3: run in the TRACING DB, same psql client machine. 7-day window because free-plan records expire after 7 days.
-- Q4b (tracing DB): outcome of each automation turn
CREATE TEMP TABLE auto_turns (delivery_id uuid, project_id uuid, created_at timestamptz,
  automation_id uuid, kind text, session_id text, turn_id text);
\copy auto_turns FROM '/tmp/auto_turns.csv' CSV HEADER

CREATE TEMP TABLE auto_outcomes AS
SELECT t.*,
       count(r.*) AS records,
       bool_or(r.record_type = 'error') AS has_error,
       max(r.attributes->>'code') FILTER (WHERE r.record_type = 'error') AS error_code,
       bool_or(r.record_type = 'done') AS has_done,
       max(r.attributes->>'stopReason') FILTER (WHERE r.record_type = 'done') AS stop_reason,
       bool_or(r.record_type = 'message') AS has_message
FROM auto_turns t
LEFT JOIN records r
  ON r.project_id = t.project_id AND r.session_id = t.session_id
 AND r.turn_id = t.turn_id AND r.quarantined_at IS NULL
GROUP BY t.delivery_id, t.project_id, t.created_at, t.automation_id, t.kind, t.session_id, t.turn_id;

-- Q5: outcome split
SELECT CASE
         WHEN records = 0 THEN 'no records (lost, expired, or id mismatch)'
         WHEN has_error OR stop_reason = 'error' THEN 'failed'
         WHEN stop_reason = 'paused' THEN 'needs approval'
         WHEN stop_reason = 'cancelled' THEN 'cancelled'
         WHEN has_done AND NOT has_message THEN 'done, no message (empty?)'
         WHEN has_done THEN 'success'
         ELSE 'no terminal record (running or stuck)'
       END AS outcome, kind, count(*) AS runs
FROM auto_outcomes GROUP BY 1, 2 ORDER BY 3 DESC;

-- Q6: top error codes
SELECT coalesce(error_code, '(no code)') AS error_code, count(*) AS runs, count(DISTINCT automation_id) AS automations
FROM auto_outcomes WHERE has_error OR stop_reason = 'error'
GROUP BY 1 ORDER BY 2 DESC LIMIT 20;

-- Q7: storm sizing: worst hour, globally and for one automation
SELECT 'global' AS scope, max(n) AS max_failures_per_hour FROM (
  SELECT date_trunc('hour', created_at), count(*) n FROM auto_outcomes
  WHERE has_error OR stop_reason = 'error' GROUP BY 1) g
UNION ALL
SELECT 'per automation', max(n) FROM (
  SELECT automation_id, date_trunc('hour', created_at), count(*) n FROM auto_outcomes
  WHERE has_error OR stop_reason = 'error' GROUP BY 1, 2) a;
