#!/bin/sh
set -eu

AGENTA_AUTH_KEY="${AGENTA_AUTH_KEY:-replace-me}"

echo "--------------------------------------------------------"
echo "[$(date)] spans.sh running from cron"

# Make POST request with 30 minute timeout (retention can be slow)
RESPONSE=$(curl \
    --max-time 1800 \
    --connect-timeout 10 \
    -s \
    -w "\nHTTP_STATUS:%{http_code}\n" \
    -X POST \
    -H "Authorization: Access ${AGENTA_AUTH_KEY}" \
    "http://api:8000/admin/billing/usage/flush" 2>&1) || CURL_EXIT=$?

if [ -n "${CURL_EXIT:-}" ]; then
    echo "❌ CURL failed with exit code: ${CURL_EXIT}"
    case ${CURL_EXIT} in
        6)  echo "   Could not resolve host" ;;
        7)  echo "   Failed to connect to host" ;;
        28) echo "   Operation timeout (exceeded 1800s / 30 minutes)" ;;
        52) echo "   Empty reply from server" ;;
        56) echo "   Failure in receiving network data" ;;
        *)  echo "   Unknown curl error" ;;
    esac
else
    echo "${RESPONSE}"
    HTTP_CODE=$(echo "${RESPONSE}" | grep "HTTP_STATUS:" | cut -d: -f2)
    if [ "${HTTP_CODE}" = "200" ]; then
        echo "✅ Spans retention completed successfully"
    else
        echo "❌ Spans retention failed with HTTP ${HTTP_CODE}"
    fi
fi

echo "[$(date)] spans.sh done"
