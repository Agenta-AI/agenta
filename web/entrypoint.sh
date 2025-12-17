#!/bin/sh

set -e

if [ "$AGENTA_LICENSE" != "ee" ]; then
  AGENTA_LICENSE="oss"
fi

if [ "$ENTRYPOINT_DIR" != "." ]; then
  ENTRYPOINT_DIR="/app"
fi

cat <<EOF > ${ENTRYPOINT_DIR}/${AGENTA_LICENSE}/public/__env.js

window.__env = {
  NEXT_PUBLIC_AGENTA_LICENSE: "${AGENTA_LICENSE:-oss}",
  NEXT_PUBLIC_AGENTA_API_URL: "${AGENTA_API_URL:-${DOMAIN_NAME:-http://localhost}${AGENTA_PORT:+:$AGENTA_PORT}/api}",
  NEXT_PUBLIC_AGENTA_WEB_URL: "${AGENTA_WEB_URL:-${WEBSITE_DOMAIN_NAME:-${DOMAIN_NAME:-http://localhost}}}",
  NEXT_PUBLIC_POSTHOG_API_KEY: "${POSTHOG_API_KEY}",
  NEXT_PUBLIC_CRISP_WEBSITE_ID: "${CRISP_WEBSITE_ID}",
};
EOF

exec "$@"
