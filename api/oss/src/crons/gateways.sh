#!/bin/sh
set -eu

AGENTA_AUTH_KEY="${AGENTA_AUTH_KEY:-replace-me}"

echo "--------------------------------------------------------"
echo "[$(date)] gateways.sh running from cron"

# Delete MCP OAuth authorization attempts nobody came back for. Unlike queries.sh and
# triggers.sh this job has no window to align to — it deletes whatever is already past
# its own `expires_at` — so it passes no trigger interval or datetime.
#
# Make POST request with bounded timeouts; decode curl/HTTP failures instead of
# masking them (mirrors api/ee/src/crons/{meters,events,spans}.sh).
RESPONSE=$(curl \
    --max-time 30 \
    --connect-timeout 10 \
    -s \
    -w "\nHTTP_STATUS:%{http_code}\n" \
    -X POST \
    -H "Authorization: Access ${AGENTA_AUTH_KEY}" \
    "http://api:8000/admin/gateways/mcps/oauth/attempts/sweep" 2>&1) || CURL_EXIT=$?

if [ -n "${CURL_EXIT:-}" ]; then
    echo "❌ CURL failed with exit code: ${CURL_EXIT}"
    case ${CURL_EXIT} in
        6)  echo "   Could not resolve host" ;;
        7)  echo "   Failed to connect to host" ;;
        28) echo "   Operation timeout (exceeded 30s)" ;;
        52) echo "   Empty reply from server" ;;
        56) echo "   Failure in receiving network data" ;;
        *)  echo "   Unknown curl error" ;;
    esac
else
    echo "${RESPONSE}"
    HTTP_CODE=$(echo "${RESPONSE}" | grep "HTTP_STATUS:" | cut -d: -f2)
    if [ "${HTTP_CODE}" = "200" ]; then
        echo "✅ OAuth attempt sweep completed successfully"
    else
        echo "❌ OAuth attempt sweep failed with HTTP ${HTTP_CODE}"
    fi
fi

echo "[$(date)] gateways.sh done"
