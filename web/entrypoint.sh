#!/bin/sh

if [ "$FEATURE_FLAG" = "cloud-dev" ] || [ "$FEATURE_FLAG" = "cloud" ] || [ "$FEATURE_FLAG" = "ee" ]; then
  TARGET_DIR="ee"
else
  TARGET_DIR="$FEATURE_FLAG"
fi

cat <<EOF > /app/${TARGET_DIR}/public/__env.js
window.__env = {
  NEXT_PUBLIC_AGENTA_API_URL: "${DOMAIN_NAME:-http://localhost}${AGENTA_PORT:+:$AGENTA_PORT}",
  NEXT_PUBLIC_FF: "${FEATURE_FLAG:-oss}",
  NEXT_PUBLIC_TELEMETRY_TRACKING_ENABLED: "${TELEMETRY_ENABLED:-true}",
  NEXT_PUBLIC_POSTHOG_API_KEY: "${POSTHOG_API_KEY:-phc_hmVSxIjTW1REBHXgj2aw4HW9X6CXb6FzerBgP9XenC7}",
  NEXT_PUBLIC_WEBSITE_URL: "${WEBSITE_DOMAIN_NAME:-${DOMAIN_NAME:-http://localhost}}",
};
EOF

exec "$@"
