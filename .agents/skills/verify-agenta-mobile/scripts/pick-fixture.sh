#!/usr/bin/env bash
# Read-only. Usage: pick-fixture.sh <user-email>
# Prints the user's projects, then each agent in them with two or more open sessions.
set -eu
EMAIL=${1:?usage: pick-fixture.sh <user-email>}
PG=${AGENTA_PG_CONTAINER:-agenta-ee-dev-postgres-1}
DB=${AGENTA_DB:-agenta_ee_core}
q() { docker exec "$PG" psql -U username -d "$DB" -At -F ' | ' -c "$1"; }

q "select p.id, p.project_name from projects p
   join project_members pm on pm.project_id = p.id
   join users u on u.id = pm.user_id
   where u.email = '$EMAIL'"
echo '--- agent | name | open sessions | newest two session ids'
q "with rows as (
     select r->>'id' as agent, s.session_id, s.created_at
     from session_streams s
     join project_members pm on pm.project_id = s.project_id
     join users u on u.id = pm.user_id,
     jsonb_array_elements(s.\"references\") r
     where u.email = '$EMAIL' and r->>'key' = 'workflow'
       and s.archived_at is null and s.deleted_at is null
   )
   select a.id, a.name, count(*),
          (array_agg(rows.session_id order by rows.created_at desc))[1:2]
   from rows join workflow_artifacts a on a.id::text = rows.agent
   group by 1, 2 having count(*) >= 2
   order by max(rows.created_at) desc limit 8"
