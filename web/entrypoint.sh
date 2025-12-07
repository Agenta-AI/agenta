#!/bin/sh

set -e

echo "[entrypoint.sh] Starting entrypoint script..." >&2
echo "[entrypoint.sh] Current working directory: $(pwd)" >&2
echo "[entrypoint.sh] Initial AGENTA_LICENSE: $AGENTA_LICENSE" >&2

if [ "$AGENTA_LICENSE" != "ee" ]; then
  AGENTA_LICENSE="oss"
fi

if [ "$ENTRYPOINT_DIR" != "." ]; then
  ENTRYPOINT_DIR="/app"
fi

# Infer AGENTA_SENDGRID_ENABLED from SENDGRID_API_KEY
if [ -n "$SENDGRID_API_KEY" ]; then
  export AGENTA_SENDGRID_ENABLED="true"
else
  export AGENTA_SENDGRID_ENABLED="false"
fi

echo "[entrypoint.sh] Using AGENTA_LICENSE: $AGENTA_LICENSE" >&2
echo "[entrypoint.sh] AGENTA_SENDGRID_ENABLED: $AGENTA_SENDGRID_ENABLED" >&2
echo "[entrypoint.sh] Creating ${AGENTA_LICENSE}/public/__env.js with the following content:" >&2

mkdir -p "${ENTRYPOINT_DIR}/${AGENTA_LICENSE}/public"

cat > "${ENTRYPOINT_DIR}/${AGENTA_LICENSE}/public/__env.js" <<EOF
window.__env = {
  NEXT_PUBLIC_AGENTA_LICENSE: "${AGENTA_LICENSE:-oss}",
  NEXT_PUBLIC_AGENTA_API_URL: "${AGENTA_API_URL:-${DOMAIN_NAME:-http://localhost}${AGENTA_PORT:+:$AGENTA_PORT}/api}",
  NEXT_PUBLIC_AGENTA_WEB_URL: "${AGENTA_WEB_URL:-${WEBSITE_DOMAIN_NAME:-${DOMAIN_NAME:-http://localhost}}}",
  NEXT_PUBLIC_POSTHOG_API_KEY: "${POSTHOG_API_KEY}",
  NEXT_PUBLIC_CRISP_WEBSITE_ID: "${CRISP_WEBSITE_ID}",
  NEXT_PUBLIC_AGENTA_AUTHN_EMAIL: "${AGENTA_AUTHN_EMAIL}",
  NEXT_PUBLIC_AGENTA_AUTH_GOOGLE_OAUTH_CLIENT_ID: "${GOOGLE_OAUTH_CLIENT_ID}",
  NEXT_PUBLIC_AGENTA_AUTH_GITHUB_OAUTH_CLIENT_ID: "${GITHUB_OAUTH_CLIENT_ID}",
  NEXT_PUBLIC_AGENTA_SENDGRID_ENABLED: "${AGENTA_SENDGRID_ENABLED}",
};
EOF

echo "[entrypoint.sh] Finished writing env file." >&2
echo "[entrypoint.sh] Contents of __env.js:" >&2
cat "${ENTRYPOINT_DIR}/${AGENTA_LICENSE}/public/__env.js" >&2
echo "[entrypoint.sh] Executing: $@" >&2

exec "$@"
