#!/usr/bin/env bash
# Fails when a tracked file outside the allowlist names the removed desktop web app.
# Allowlist and rules: openspec/changes/remove-desktop-web-app/design.md (D11).
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"

# agenta-web is the desktop image (also agenta-web-ee, internal-ee-agenta-web).
# The trailing class skips agenta-web-mobile, agenta-website, agenta-webhook and agenta-web-tests.
pattern='web/(oss|ee)([^a-zA-Z0-9_-]|$)|@agenta/(oss|ee)([^a-zA-Z0-9_-]|$)|agenta-web(-ee)?([^a-zA-Z0-9_-]|$)'

allowed() {
    case "$1" in
        docs/design/testing/*) return 1 ;;
        docs/design/*) return 0 ;;
        openspec/changes/archive/* | openspec/changes/remove-desktop-web-app/*) return 0 ;;
        docs/versioned_docs/*) return 0 ;;
        .gitleaksignore | web/website/src/components/workspace-demo/fixtures.js) return 0 ;;
        scripts/check-no-desktop-app-refs.sh) return 0 ;;
        # The upgrade notes must name the image a release removed.
        docs/docs/self-host/upgrade-and-migrate/01-upgrading.mdx) return 0 ;;
        # Asserts the chart still accepts and ignores the old `web` values key (design.md D8).
        hosting/kubernetes/helm/tests/test_web_mobile.py) return 0 ;;
    esac
    return 1
}

# git grep exits 1 when nothing matches; anything above 1 is a real error.
status=0
matches=$(git -c core.quotePath=false grep -nIE "$pattern") || status=$?
if [ "$status" -gt 1 ]; then
    echo "git grep failed with status $status" >&2
    exit 2
fi

hits=0
while IFS= read -r line; do
    [ -n "$line" ] || continue
    file=${line%%:*}
    allowed "$file" && continue
    # The pnpm workspace root is named agenta-web; that name is not the desktop image.
    [[ $line == 'web/package.json:'*':    "name": "agenta-web",' ]] && continue
    printf '%s\n' "$line"
    hits=$((hits + 1))
done <<<"$matches"

if [ "$hits" -gt 0 ]; then
    printf '\n%d mention(s) of the removed desktop app (web/oss, web/ee, @agenta/oss, @agenta/ee, agenta-web).\n' "$hits" >&2
    printf 'Point at web/mobile or web/packages instead. Dated history belongs under docs/design.\n' >&2
    exit 1
fi
echo "No desktop app mentions outside the allowlist."
