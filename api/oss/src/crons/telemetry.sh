#!/bin/sh
set -eu

AGENTA_AUTH_KEY="${AGENTA_AUTH_KEY:-replace-me}"

echo "--------------------------------------------------------"
echo "[$(date)] telemetry.sh running from cron"

# Ask the API for the telemetry heartbeat. The API sends it only when 12 hours have
# passed and telemetry is on, so an hourly call retries a failed send within the hour.
#
# Make POST request with bounded timeouts; decode curl/HTTP failures instead of
# masking them (mirrors api/ee/src/crons/{meters,events,spans}.sh).
RESPONSE=$(curl \
    --max-time 60 \
    --connect-timeout 10 \
    -s \
    -w "\nHTTP_STATUS:%{http_code}\n" \
    -X POST \
    -H "Authorization: Access ${AGENTA_AUTH_KEY}" \
    "http://api:8000/admin/telemetry/heartbeat" 2>&1) || CURL_EXIT=$?

if [ -n "${CURL_EXIT:-}" ]; then
    echo "❌ CURL failed with exit code: ${CURL_EXIT}"
    case ${CURL_EXIT} in
        6)  echo "   Could not resolve host" ;;
        7)  echo "   Failed to connect to host" ;;
        28) echo "   Operation timeout (exceeded 60s)" ;;
        52) echo "   Empty reply from server" ;;
        56) echo "   Failure in receiving network data" ;;
        *)  echo "   Unknown curl error" ;;
    esac
else
    echo "${RESPONSE}"
    HTTP_CODE=$(echo "${RESPONSE}" | grep "HTTP_STATUS:" | cut -d: -f2)
    if [ "${HTTP_CODE}" = "200" ]; then
        echo "✅ Telemetry heartbeat check completed successfully"
    else
        echo "❌ Telemetry heartbeat check failed with HTTP ${HTTP_CODE}"
    fi
fi

echo "[$(date)] telemetry.sh done"
