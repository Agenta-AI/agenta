#!/bin/sh
set -eu

AGENTA_AUTH_KEY=$(tr '\0' '\n' < /proc/1/environ | grep ^AGENTA_AUTH_KEY= | cut -d= -f2-)
TRIGGER_INTERVAL=$(awk 'NR==2 {split($1, a, "/"); print (a[2] ? a[2] : 1)}' /etc/cron.d/queries-cron)
NOW_UTC=$(date -u "+%Y-%m-%dT%H:%M:00Z")
MINUTE=$(date -u "+%M" | sed 's/^0*//')
ROUNDED_MINUTE=$(( (MINUTE / TRIGGER_INTERVAL) * TRIGGER_INTERVAL ))
TRIGGER_DATETIME=$(date -u "+%Y-%m-%dT%H")
TRIGGER_DATETIME="${TRIGGER_DATETIME}:$(printf "%02d" $ROUNDED_MINUTE):00Z"


echo "--------------------------------------------------------"
echo "[$(date)] queries.sh running from cron" >> /proc/1/fd/1

# Make POST request, show status and response
curl \
    -s \
    -w "\nHTTP_STATUS:%{http_code}\n" \
    -X POST \
    -H "Authorization: Access ${AGENTA_AUTH_KEY}" \
    "http://api:8000/admin/evaluations/runs/refresh?trigger_interval=${TRIGGER_INTERVAL}&trigger_datetime=${TRIGGER_DATETIME}" || echo "❌ CURL failed"

echo "[$(date)] queries.sh done" >> /proc/1/fd/1