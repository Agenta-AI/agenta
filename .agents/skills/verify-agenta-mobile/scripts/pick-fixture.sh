#!/usr/bin/env bash
# Read-only. Usage: pick-fixture.sh <user-email>
# Prints the user's projects, then each agent in them with two or more sessions the user can open.
set -eu
EMAIL=${1:?usage: pick-fixture.sh <user-email>}
PG=${AGENTA_PG_CONTAINER:-agenta-ee-dev-postgres-1}
DB=${AGENTA_DB:-agenta_ee_core}

docker exec -i "$PG" psql -U username -d "$DB" -At -F ' | ' -v email="$EMAIL" <<'SQL'
set default_transaction_read_only = on;

select p.id, p.project_name
from projects p
join project_members pm on pm.project_id = p.id
join users u on u.id = pm.user_id
where u.email = :'email';

\echo --- project | agent | name | open sessions | newest two session ids
with rows as (
    select s.project_id, r->>'id' as agent, s.session_id, s.created_at
    from session_streams s
    join project_members pm on pm.project_id = s.project_id
    join users u on u.id = pm.user_id,
    jsonb_array_elements(s."references") r
    where u.email = :'email' and r->>'key' = 'workflow'
      and s.archived_at is null and s.deleted_at is null
      and (s.visibility is distinct from 'private' or s.owner_user_id = u.id)
)
select rows.project_id, a.id, a.name, count(*),
       (array_agg(rows.session_id order by rows.created_at desc))[1:2]
from rows
join workflow_artifacts a on a.id::text = rows.agent and a.project_id = rows.project_id
group by 1, 2, 3
having count(*) >= 2
order by max(rows.created_at) desc
limit 8;
SQL
