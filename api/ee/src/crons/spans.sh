#!/bin/sh
set -eu

AGENTA_AUTH_KEY=$(tr '\0' '\n' < /proc/1/environ | grep ^AGENTA_AUTH_KEY= | cut -d= -f2-)

echo "--------------------------------------------------------"
echo "[$(date)] spans.sh running from cron" >> /proc/1/fd/1

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
    echo "❌ CURL failed with exit code: ${CURL_EXIT}" >> /proc/1/fd/1
    case ${CURL_EXIT} in
        6)  echo "   Could not resolve host" >> /proc/1/fd/1 ;;
        7)  echo "   Failed to connect to host" >> /proc/1/fd/1 ;;
        28) echo "   Operation timeout (exceeded 1800s / 30 minutes)" >> /proc/1/fd/1 ;;
        52) echo "   Empty reply from server" >> /proc/1/fd/1 ;;
        56) echo "   Failure in receiving network data" >> /proc/1/fd/1 ;;
        *)  echo "   Unknown curl error" >> /proc/1/fd/1 ;;
    esac
else
    echo "${RESPONSE}" >> /proc/1/fd/1
    HTTP_CODE=$(echo "${RESPONSE}" | grep "HTTP_STATUS:" | cut -d: -f2)
    if [ "${HTTP_CODE}" = "200" ]; then
        echo "✅ Spans retention completed successfully" >> /proc/1/fd/1
    else
        echo "❌ Spans retention failed with HTTP ${HTTP_CODE}" >> /proc/1/fd/1
    fi
fi

echo "[$(date)] spans.sh done" >> /proc/1/fd/1
