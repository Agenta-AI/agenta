#!/bin/sh
set -eu

AGENTA_AUTH_KEY="${AGENTA_AUTH_KEY:-replace-me}"

echo "--------------------------------------------------------"
echo "[$(date)] meters.sh running from cron"

# Make POST request with 15 minute timeout
RESPONSE=$(curl \
    --max-time 900 \
    --connect-timeout 10 \
    -s \
    -w "\nHTTP_STATUS:%{http_code}\n" \
    -X POST \
    -H "Authorization: Access ${AGENTA_AUTH_KEY}" \
    "http://api:8000/admin/billing/usage/report" 2>&1) || CURL_EXIT=$?

if [ -n "${CURL_EXIT:-}" ]; then
    echo "❌ CURL failed with exit code: ${CURL_EXIT}"
    case ${CURL_EXIT} in
        6)  echo "   Could not resolve host" ;;
        7)  echo "   Failed to connect to host" ;;
        28) echo "   Operation timeout (exceeded 900s / 15 minutes)" ;;
        52) echo "   Empty reply from server (server closed connection)" ;;
        56) echo "   Failure in receiving network data" ;;
        *)  echo "   Unknown curl error" ;;
    esac
else
    echo "${RESPONSE}"
    HTTP_CODE=$(echo "${RESPONSE}" | grep "HTTP_STATUS:" | cut -d: -f2)
    if [ "${HTTP_CODE}" = "200" ]; then
        echo "✅ Report completed successfully"
    else
        echo "❌ Report failed with HTTP ${HTTP_CODE}"
    fi
fi

echo "[$(date)] meters.sh done"
