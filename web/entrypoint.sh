#!/bin/sh

if [ "$AGENTA_LICENSE" != "ee" ]; then
  AGENTA_LICENSE="oss"
fi

cat <<EOF > /app/${AGENTA_LICENSE}/public/__env.js
window.__env = {
  NEXT_PUBLIC_AGENTA_LICENSE: "${AGENTA_LICENSE:-oss}",
  NEXT_PUBLIC_AGENTA_WEB_URL: "${WEBSITE_DOMAIN_NAME:-${DOMAIN_NAME:-http://localhost}}",
  NEXT_PUBLIC_AGENTA_API_URL: "${DOMAIN_NAME:-http://localhost}${AGENTA_PORT:+:$AGENTA_PORT}",
  NEXT_PUBLIC_POSTHOG_API_KEY: "${POSTHOG_API_KEY}",
  NEXT_PUBLIC_CRISP_WEBSITE_ID: "${CRISP_WEBSITE_ID}",
};
EOF

exec "$@"
