#!/usr/bin/env bash
# Post-deploy smoke test for a deployed website URL (preview or production).
#
# Checks the things a build cannot: that the edge worker in front of the assets
# binding is actually doing its job, and that the static behaviors it must NOT
# break (the _redirects 308s, the trailing-slash normalization, asset caching)
# still work. Run as: scripts/verify-deployment.sh https://example.workers.dev
set -uo pipefail

BASE="${1:?usage: verify-deployment.sh <base-url>}"
BASE="${BASE%/}"
failures=0

fail() {
  echo "::error::$1"
  failures=$((failures + 1))
}

check() { # check <description> <expected> <actual>
  if [ "$2" = "$3" ]; then
    echo "  ok   $1 ($3)"
  else
    fail "$1 — expected '$2', got '$3'"
  fi
}

contains() { # contains <description> <needle> <haystack>
  case "$3" in
    *"$2"*) echo "  ok   $1" ;;
    *) fail "$1 — '$2' not found in: $(printf '%s' "$3" | head -c 200)" ;;
  esac
}

# Wait for the deployment to answer at all before asserting on it.
for _ in 1 2 3 4 5; do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")" = "200" ] && break
  sleep 5
done

echo "Verifying $BASE"

echo "- the site itself"
check "homepage is 200" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")"
check "unknown path is 404" 404 \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/some-path-that-does-not-exist")"
contains "browsers keep the HTML 404" "text/html" \
  "$(curl -s -o /dev/null -w '%{content_type}' -H 'Accept: text/html' "$BASE/nope")"

echo "- static behavior the worker must not break"
check "_redirects still redirect" 308 \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/terms")"
check "trailing slash still normalizes" 307 \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/pricing/")"

echo "- markdown content negotiation (acceptmarkdown.com)"
md_headers=$(curl -sI -H 'Accept: text/markdown' "$BASE/")
contains "serves text/markdown" "text/markdown" "$md_headers"
contains "sets Vary: Accept" "Accept" "$(printf '%s' "$md_headers" | grep -i '^vary:')"
check "honors q-values (markdown wins)" "text/markdown; charset=utf-8" \
  "$(curl -s -o /dev/null -w '%{content_type}' \
    -H 'Accept: text/markdown;q=0.9, text/html;q=0.8' "$BASE/pricing")"
contains "honors q-values (html wins)" "text/html" \
  "$(curl -s -o /dev/null -w '%{content_type}' \
    -H 'Accept: text/markdown;q=0.8, text/html;q=0.9' "$BASE/pricing")"
check "rejects unsupported types with 406" 406 \
  "$(curl -s -o /dev/null -w '%{http_code}' -H 'Accept: image/webp' "$BASE/pricing")"
check "never 406s a browser" 200 \
  "$(curl -s -o /dev/null -w '%{http_code}' \
    -H 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' "$BASE/")"

echo "- the twins are alternates, not indexable pages"
contains "direct .md fetch is noindex" "noindex" \
  "$(curl -sI "$BASE/pricing.md" | grep -i '^x-robots-tag:')"
# Cloudflare stamps X-Robots-Tag: noindex on every *.workers.dev response, so
# this half of the check is only meaningful on a real domain.
case "$BASE" in
  *.workers.dev)
    echo "  skip the HTML page is still indexable (workers.dev is noindex by default)" ;;
  *)
    check "the HTML page is still indexable" "" \
      "$(curl -sI "$BASE/pricing" | grep -i '^x-robots-tag:')" ;;
esac

echo "- the API entry point and agent guidance"
check "the /api page is served" 200 \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api")"
contains "the homepage links to it" 'href="/api"' "$(curl -s "$BASE/")"
contains "llms.txt says when to use Agenta" "## When to use Agenta" \
  "$(curl -s "$BASE/llms.txt")"
contains "llms.txt says how to call it" "Authorization: ApiKey" \
  "$(curl -s "$BASE/llms.txt")"

echo "- agent-facing errors and specs"
contains "JSON 404 carries an error code" '"code": "not_found"' \
  "$(curl -s -H 'Accept: application/json' "$BASE/nope")"
contains "markdown 404 points at the sitemap" "sitemap-index.xml" \
  "$(curl -s -H 'Accept: text/markdown' "$BASE/nope")"
check "OpenAPI spec is published" 200 \
  "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/openapi.json")"
contains "llms.txt advertises the spec" "openapi.json" "$(curl -s "$BASE/llms.txt")"

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed."
  exit 1
fi
echo "All agent-readiness checks passed."
