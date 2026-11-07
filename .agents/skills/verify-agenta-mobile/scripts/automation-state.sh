#!/bin/bash
# Read-only. Usage: automation-state.sh <project-id> [rows]
set -euo pipefail
project="${1:?project id}"
rows="${2:-8}"
docker exec agenta-ee-dev-postgres-1 psql -U username -d agenta_ee_core \
  -c "select to_char(d.created_at,'HH24:MI:SS') at, left(coalesce(d.schedule_id,d.subscription_id)::text,13) automation, d.status->>'code' code, d.data->>'outcome' outcome, d.data->>'reason_code' reason, e.terminal_outcome from trigger_deliveries d left join session_executions e on e.project_id=d.project_id and e.session_id=d.data->>'session_id' and e.execution_id=d.data#>>'{result,run_id}' where d.project_id='${project}' order by d.created_at desc limit ${rows}" \
  -c "select to_char(n.created_at,'HH24:MI:SS') at, n.state, left(n.data->>'automation_name',28) name, n.data->>'reason_code' reason, (select string_agg(nd.state||':'||nd.attempt_count,',') from notification_deliveries nd where nd.project_id=n.project_id and nd.notification_id=n.id) deliveries from notifications n where n.project_id='${project}' order by n.created_at desc limit ${rows}"
