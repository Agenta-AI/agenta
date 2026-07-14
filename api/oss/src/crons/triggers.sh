#!/bin/sh
set -eu

AGENTA_AUTH_KEY="${AGENTA_AUTH_KEY:-replace-me}"
TRIGGER_INTERVAL=$(awk '/triggers\.sh/ {split($1, a, "/"); print (a[2] ? a[2] : 1); exit}' /app/crontab)
NOW_UTC=$(date -u "+%Y-%m-%dT%H:%M:00Z")
MINUTE=$(date -u "+%M" | sed 's/^0*//')
MINUTE="${MINUTE:-0}"
ROUNDED_MINUTE=$(( (MINUTE / TRIGGER_INTERVAL) * TRIGGER_INTERVAL ))
TRIGGER_DATETIME=$(date -u "+%Y-%m-%dT%H")
TRIGGER_DATETIME="${TRIGGER_DATETIME}:$(printf "%02d" $ROUNDED_MINUTE):00Z"


echo "--------------------------------------------------------"
echo "[$(date)] triggers.sh running from cron"

# Make POST request with bounded timeouts; decode curl/HTTP failures instead of
# masking them (mirrors api/ee/src/crons/{meters,events,spans}.sh).
RESPONSE=$(curl \
    --max-time 30 \
    --connect-timeout 10 \
    -s \
    -w "\nHTTP_STATUS:%{http_code}\n" \
    -X POST \
    -H "Authorization: Access ${AGENTA_AUTH_KEY}" \
    "http://api:8000/admin/triggers/schedules/refresh?trigger_interval=${TRIGGER_INTERVAL}&trigger_datetime=${TRIGGER_DATETIME}" 2>&1) || CURL_EXIT=$?

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
        echo "✅ Schedule refresh completed successfully"
    else
        echo "❌ Schedule refresh failed with HTTP ${HTTP_CODE}"
    fi
fi

echo "[$(date)] triggers.sh done"
