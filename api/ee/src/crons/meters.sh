#!/bin/sh
set -eu

AGENTA_AUTH_KEY=$(tr '\0' '\n' < /proc/1/environ | grep ^AGENTA_AUTH_KEY= | cut -d= -f2- || true)
AGENTA_AUTH_KEY="${AGENTA_AUTH_KEY:-replace-me}"

echo "--------------------------------------------------------"
echo "[$(date)] meters.sh running from cron" >> /proc/1/fd/1

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
    echo "❌ CURL failed with exit code: ${CURL_EXIT}" >> /proc/1/fd/1
    case ${CURL_EXIT} in
        6)  echo "   Could not resolve host" >> /proc/1/fd/1 ;;
        7)  echo "   Failed to connect to host" >> /proc/1/fd/1 ;;
        28) echo "   Operation timeout (exceeded 900s / 15 minutes)" >> /proc/1/fd/1 ;;
        52) echo "   Empty reply from server (server closed connection)" >> /proc/1/fd/1 ;;
        56) echo "   Failure in receiving network data" >> /proc/1/fd/1 ;;
        *)  echo "   Unknown curl error" >> /proc/1/fd/1 ;;
    esac
else
    echo "${RESPONSE}" >> /proc/1/fd/1
    HTTP_CODE=$(echo "${RESPONSE}" | grep "HTTP_STATUS:" | cut -d: -f2)
    if [ "${HTTP_CODE}" = "200" ]; then
        echo "✅ Report completed successfully" >> /proc/1/fd/1
    else
        echo "❌ Report failed with HTTP ${HTTP_CODE}" >> /proc/1/fd/1
    fi
fi

echo "[$(date)] meters.sh done" >> /proc/1/fd/1
