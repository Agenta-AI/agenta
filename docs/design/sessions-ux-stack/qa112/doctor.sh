#!/bin/bash
# doctor.sh — check everything a capture depends on, BEFORE you trust a run.
#
# Every line here exists because something silently produced a wrong finding instead of an error:
# a wedged API rendered whole rows missing, a migration-behind stack made a session list read
# empty, a DPR-1 tab made every strip garbage, and a no-op tab switch shot one environment twice.
# None of those look like failures in a screenshot.
source "$(dirname "$0")/env.sh"
ok() { printf '  \033[32mok\033[0m   %s\n' "$1"; }
bad() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; }
warn() { printf '  \033[33mwarn\033[0m %s\n' "$1"; }

echo "== toolchain =="
[ -x "$B" ] && ok "browse cli" || bad "browse cli missing at $B"
"$PY" -c "import numpy,PIL" 2>/dev/null && ok "venv (numpy + Pillow)" \
  || bad "venv missing — python3 -m venv venv && ./venv/bin/pip install numpy Pillow"

echo "== browse daemon =="
# Do NOT call `$B status` blind. `status` and `tabs` AUTO-SPAWN a headless daemon when none is
# running — this script did exactly that on its first run and created the stray it warns about.
# Read the state file and check the pid instead; only talk to the daemon once we know one is up.
DAEMON_PID=$("$PY" -c "
import json,sys
try: print(json.load(open('$BROWSE_STATE_FILE')).get('pid',''))
except Exception: print('')" 2>/dev/null)
if [ -n "$DAEMON_PID" ] && kill -0 "$DAEMON_PID" 2>/dev/null; then
  ST=$(timeout 45 "$B" status 2>&1)
  case "$ST" in
    *healthy*) ok "daemon healthy (pid $DAEMON_PID)" ;;
    *"not responding"*) warn "daemon busy ('running but not responding') — usually TRANSIENT (seen recovering after ~7min), wait and re-run before relaunching" ;;
    *) bad "daemon: $(printf '%s' "$ST" | head -1)" ;;
  esac
  MODE=$(printf '%s' "$ST" | grep -i '^Mode' | head -1)
  case "$MODE" in
    *headed*) ok "$MODE" ;;
    "") warn "no Mode line" ;;
    *) warn "$MODE — a headless 'Mode: launched' on about:blank is a stray; \`$B stop\` it and let Arda relaunch the headed browser" ;;
  esac
  DAEMON_UP=1
else
  bad "no browse daemon (Arda launches the headed browser — ask, don't spawn one)"
  DAEMON_UP=0
fi

echo "== dev server (local) =="
# Probe the BASE, not "/". The mobile app serves under basePath /m and answers 404 at the root,
# so probing "/" reported the dev server as down while it was serving the app perfectly well.
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$LOCAL_BASE/apps" 2>/dev/null)
case "$CODE" in
  2*|3*) ok "${LOCAL_BASE%%/w/*} -> HTTP $CODE" ;;
  *) bad "localhost:3000 unreachable (HTTP ${CODE:-none}) — Arda starts the dev server; ask, don't start it" ;;
esac

echo "== local stack =="
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q agenta-ee-dev-api; then
  ok "agenta-ee-dev-api up"
  DB=$(docker exec agenta-ee-dev-postgres-1 psql -U username -d agenta_ee_core -tAc \
        "select version_num from alembic_version_oss" 2>/dev/null | tr -d ' ')
  [ -n "$DB" ] && ok "alembic_version_oss = $DB" || warn "could not read alembic_version_oss"
  # The migration that broke session_streams writes for two whole sessions (D-08). Its absence
  # makes every session-backed surface read empty and looks exactly like a frontend regression.
  COL=$(docker exec agenta-ee-dev-postgres-1 psql -U username -d agenta_ee_core -tAc \
        "select 1 from information_schema.columns where table_name='session_streams' and column_name='references'" 2>/dev/null | tr -d ' ')
  [ "$COL" = "1" ] && ok "session_streams.references present" \
    || bad "session_streams.references MISSING — sessions/query + streams/heartbeat will 500 and every session surface reads empty"
else
  bad "local docker stack down — Arda deploys it; ask, don't deploy it"
fi

echo "== tabs and DPR =="
[ "$DAEMON_UP" = "1" ] || warn "skipped — no daemon (checking would spawn a stray one)"
[ "$DAEMON_UP" = "1" ] && for E in local prod; do
  T=$(resolve_tab "$E")
  if [ -z "$T" ]; then bad "$E: no tab open"; continue; fi
  D=$(dpr_of "$T")
  if [ "$D" = "$WANT_DPR" ]; then ok "$E: tab $T at DPR $D"
  else bad "$E: tab $T at DPR $D (want $WANT_DPR) — run pin_tab $E, or captures will not be comparable"; fi
done

echo "== base URLs still resolve =="
# A rebuilt stack or recreated project changes LOCAL_BASE's workspace/project ids, and a wrong
# base renders an empty app that looks like a pile of 'missing element' findings.
[ "$DAEMON_UP" = "1" ] || warn "skipped — no daemon"
[ "$DAEMON_UP" = "1" ] && for E in local prod; do
  if use_tab "$E"; then
    $B js "setTimeout(function(){location.href='$(base_for "$E")/apps'},0);'nav'" >/dev/null 2>&1
    sleep 6
    GOT=$($B js 'location.pathname' 2>/dev/null | tail -1 | tr -d '"')
    # The path alone is NOT proof. Next serves its 404 AT the requested path, so a dev server
    # that no longer owns this route passed this check while rendering "This page could not be
    # found" (observed live when the desktop app was stopped and only /m was up).
    TITLE=$($B js 'document.title' 2>/dev/null | tail -1 | tr -d '"')
    case "$TITLE" in *404*|*"could not be found"*) GOT="404:$GOT" ;; esac
    case "$GOT" in
      */apps) ok "$E base resolves ($GOT)" ;;
      404:*) bad "$E base path matched but the app rendered a 404 — wrong dev server for this base" ;;
      *) bad "$E base did NOT land on /apps (got '$GOT') — update $( [ "$E" = local ] && echo LOCAL_BASE || echo PROD_BASE ) in env.sh" ;;
    esac
  else
    warn "$E: could not switch tab, base not checked"
  fi
done

echo
echo "Reminders: Arda runs the dev server AND the browser — ask before starting, restarting or"
echo "killing either. Never 'browse closetab'. Check localStorage for a persisted *-columns key"
echo "before filing any 'the column set differs'."
