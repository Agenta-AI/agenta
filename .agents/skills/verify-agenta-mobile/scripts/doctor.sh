#!/usr/bin/env bash
# Read-only. Answers "is this instance worth driving?" Exits non-zero on the first hard failure.
set -u
PG=${AGENTA_PG_CONTAINER:-agenta-ee-dev-postgres-1}
API=${AGENTA_API_CONTAINER:-agenta-ee-dev-api-1}
DB=${AGENTA_DB:-agenta_ee_core}
fail=0

web=$(curl -s -m 8 -o /dev/null -w '%{http_code}' http://localhost:3000/m)
echo "web  http://localhost:3000/m -> $web"
[ "$web" = 200 ] || [ "$web" = 307 ] || fail=1

api=$(curl -s -m 5 -o /dev/null -w '%{http_code}' http://localhost/api/health)
echo "api  http://localhost/api/health -> $api"
[ "$api" = 200 ] || fail=1

pid=$(lsof -tiTCP:3000 -sTCP:LISTEN -n -P 2>/dev/null | head -1)
if [ -n "$pid" ]; then
    echo "web cwd: $(lsof -a -p "$pid" -d cwd -Fn | tail -1 | cut -c2-)"
fi

denied=$(docker logs --since 2m "$API" 2>&1 | grep -c 'stage=membership')
echo "membership 401s in the last 2 minutes: $denied"
[ "$denied" = 0 ] || echo "  The browser user is not a member of the project in the URL. Run pick-fixture.sh."

docker exec "$PG" psql -U username -d "$DB" -At -c 'select 1' >/dev/null 2>&1 || {
    echo "postgres: not reachable in $PG"
    fail=1
}
exit $fail
