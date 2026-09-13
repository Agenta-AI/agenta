#!/usr/bin/env bash
set -uo pipefail

failures=0

check_redirect() { # check_redirect <source> <expected-location>
  source_url=$1
  expected_location=$2
  headers=$(curl -sS -I --max-time 20 "$source_url")
  status=$(printf '%s' "$headers" | awk 'toupper($1) ~ /^HTTP\// { code=$2 } END { print code }')
  location=$(printf '%s' "$headers" | awk 'BEGIN { IGNORECASE=1 } /^location:/ { sub(/^[^:]+:[[:space:]]*/, ""); sub(/\r$/, ""); print; exit }')

  if [ "$status" = "308" ] && [ "$location" = "$expected_location" ]; then
    echo "  ok   $source_url -> $location (308)"
  else
    echo "::error::$source_url expected 308 to '$expected_location', got '$status' to '$location'"
    failures=$((failures + 1))
  fi
}

echo "Verifying canonical host and protocol redirects"
check_redirect "http://agenta.ai/" "https://agenta.ai/"
check_redirect "https://www.agenta.ai/pricing" "https://agenta.ai/pricing"
check_redirect "http://www.agenta.ai/blog/prompt-versioning-guide?utm_source=canonical-test" \
  "https://agenta.ai/blog/prompt-versioning-guide?utm_source=canonical-test"
check_redirect "http://agenta.ai/favicon.svg" "https://agenta.ai/favicon.svg"
check_redirect "https://www.agenta.ai/docs/observability/overview" \
  "https://agenta.ai/docs/observability/overview"

if [ "$failures" -gt 0 ]; then
  echo "$failures canonical redirect check(s) failed."
  exit 1
fi
echo "All canonical redirect checks passed."
