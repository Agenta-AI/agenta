#!/bin/sh

AGENTA_AUTH_KEY=$(tr '\0' '\n' < /proc/1/environ | grep ^AGENTA_AUTH_KEY= | cut -d= -f2-)

echo "--------------------------------------------------------"
echo "[$(date)] meters.sh running from cron" >> /proc/1/fd/1

# Make POST request, show status and response
curl \
    -s \
    -w "\nHTTP_STATUS:%{http_code}\n" \
    -X POST \
    -H "Authorization: Access ${AGENTA_AUTH_KEY}" \
    "http://api:8000/admin/billing/usage/report" || echo "❌ Curl failed"

echo "[$(date)] meters.sh done" >> /proc/1/fd/1