#!/usr/bin/env bash
# Pre-commit gate for work on /m (web/mobile). Usage, from the repository root:
#   web/mobile/scripts/gate.sh <base-ref>
# Compares the working tree with <base-ref>, so run it before the commit.
# Fast checks (diff bans) run first. Then types, lint and the unit tests run.
# Exit code 0 only when every check passes.
set -u
BASE=${1:-}
[ -n "$BASE" ] || { echo "usage: gate.sh <base-ref>"; exit 2; }
cd "$(git rev-parse --show-toplevel)" || exit 1
git rev-parse --verify "$BASE" >/dev/null 2>&1 || { echo "unknown ref: $BASE"; exit 2; }
# Compare with the merge base, so changes that landed on <base-ref> after you branched do not count.
BASE=$(git merge-base "$BASE" HEAD) || exit 2

FAIL=0
no() { echo "GATE FAIL: $1"; FAIL=1; }

# Include new, not yet tracked files in the diff, in a copy of the index so the real index stays as it is.
TMP_INDEX=$(mktemp)
trap 'rm -f "$TMP_INDEX"' EXIT
cp "$(git rev-parse --git-path index)" "$TMP_INDEX"
export GIT_INDEX_FILE=$TMP_INDEX
git ls-files -o --exclude-standard -z | xargs -0 -r git add -N -- || exit 1
git diff --check "$BASE" || no "whitespace errors"

# Added lines of source files only, so docs and tooling that name a banned word do not trip the bans.
ADDED=$(git diff "$BASE" -U0 -- 'web/mobile/src/*.ts' 'web/mobile/src/*.tsx' 'web/mobile/tests/*.ts' 'web/mobile/tests/*.tsx' 'web/packages/*.ts' 'web/packages/*.tsx' \
    | grep -E '^\+' | grep -vE '^\+\+\+' || true)
FILES=$(git diff "$BASE" --name-only)

# 1. Banned imports.
# Lexical is banned in mobile source only: the shared composer in @agenta/ui uses it on purpose.
echo "$ADDED" | grep -qE "from ['\"](antd|@ant-design|@/oss|@agenta/oss|@agenta/ee)" \
    && no "banned import (antd, @ant-design, @/oss, @agenta/oss, @agenta/ee)"
git diff "$BASE" -U0 -- 'web/mobile/src/*.ts' 'web/mobile/src/*.tsx' | grep -E '^\+' \
    | grep -qE "from ['\"](lexical|@lexical)" && no "banned import (lexical in mobile source)"

# 2. Suppressions and skipped tests.
echo "$ADDED" | grep -qE "@ts-ignore|@ts-nocheck|@ts-expect-error|eslint-disable|: any\b|as any\b|\.skip(If)?\(" \
    && no "suppression, any, or skipped test"

# 3. Dependency files.
echo "$FILES" | grep -qE "(^|/)package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$" \
    && no "dependency files changed"

# 4. The old /w app. The theme palette in web/oss/src/styles/theme/ is still the source of truth.
echo "$FILES" | grep -vE "^web/oss/src/styles/theme/" | grep -qE "^web/(oss|ee)/" && no "web/oss or web/ee changed"

# 5. Env, CI, hosting.
echo "$FILES" | grep -qE "(^|/)\.env|^\.github/|^hosting/" && no "env, CI, or hosting file changed"

# 6. Deleted tests.
[ -n "$(git diff "$BASE" --diff-filter=D --name-only | grep -E '\.(test|spec)\.' || true)" ] \
    && no "test file deleted"

echo "$FILES" | grep -q . || no "no changes"

# 7. antd reaching /m through a changed file in web/mobile/src or web/packages.
# Checks the added lines of each changed source file. A re-export line added in the file
# ("export * from './x'") is followed one level: the target file is searched whole.
ANTD_RE="from ['\"](antd|@ant-design/)|require\(['\"](antd|@ant-design/)|import\(['\"](antd|@ant-design/)"
while IFS= read -r f; do
    case "$f" in web/mobile/src/*|web/packages/*) ;; *) continue ;; esac
    case "$f" in *.ts|*.tsx|*.js|*.jsx|*.mjs) ;; *) continue ;; esac
    [ -f "$f" ] || continue
    if git diff "$BASE" -U0 -- "$f" | grep -E '^\+' | grep -vE '^\+\+\+' | grep -qE "$ANTD_RE"; then
        no "$f adds an antd import"
        continue
    fi
    dir=$(dirname "$f")
    while IFS= read -r spec; do
        for cand in "$dir/$spec.ts" "$dir/$spec.tsx" "$dir/$spec/index.ts" "$dir/$spec/index.tsx" "$dir/$spec"; do
            if [ -f "$cand" ]; then
                grep -qE "$ANTD_RE" "$cand" && no "$f re-exports $cand, which imports antd"
                break
            fi
        done
    done < <(git diff "$BASE" -U0 -- "$f" | grep -E "^\+" | grep -E "^\+\s*export .* from ['\"]\.{1,2}/" \
        | sed -E "s/.*from ['\"]([^'\"]+)['\"].*/\1/")
done <<< "$FILES"

[ "$FAIL" -eq 0 ] || exit 1

# 8. Types, lint, related tests. Set GATE_HEAVY_RUNNER to a command that takes the repo root and a
# command (for example a script that runs it on another machine) to move the type check off this one.
unset GIT_INDEX_FILE
ROOT=$PWD
heavy() { if [ -n "${GATE_HEAVY_RUNNER:-}" ]; then "$GATE_HEAVY_RUNNER" "$ROOT" "$@"; else "$@"; fi; }
OUT=$(mktemp -d)
cd web || exit 1

heavy pnpm --filter @agenta/mobile types:check >"$OUT/tsc" 2>&1 || { no "types:check"; tail -30 "$OUT/tsc"; exit 1; }
echo "PASS: types:check"
pnpm --filter @agenta/mobile lint >"$OUT/lint" 2>&1 || { no "lint"; tail -30 "$OUT/lint"; exit 1; }
echo "PASS: lint"
# Tests related to the changed files (the full suite takes about 15 minutes; CI runs it).
CHANGED=$(echo "$FILES" | grep -E '^web/(mobile/(src|tests)|packages)/.*\.(ts|tsx)$' | sed -e 's#^web/mobile/##' -e 's#^web/#../#' || true)
# A changed shared package also runs its own tests, with its own Vitest config. Tests in other
# packages that depend on it are left to CI, which runs the full suite.
for PKG in $(echo "$FILES" | grep -E '^web/packages/[^/]+/.*\.(ts|tsx)$' | cut -d/ -f3 | sort -u); do
    [ -f "packages/$PKG/vitest.config.ts" ] || continue
    PKG_FILES=$(echo "$FILES" | grep -E "^web/packages/$PKG/.*\.(ts|tsx)$" | sed "s#^web/packages/$PKG/##")
    # shellcheck disable=SC2086
    pnpm --filter "./packages/$PKG" exec vitest related --run --passWithNoTests --maxWorkers=2 \
        $PKG_FILES >"$OUT/test-$PKG" 2>&1 || { no "unit tests in $PKG"; tail -30 "$OUT/test-$PKG"; exit 1; }
    echo "PASS: unit tests in $PKG"
done
if [ -n "$CHANGED" ]; then
    # shellcheck disable=SC2086
    pnpm --filter @agenta/mobile exec vitest related --run --passWithNoTests --maxWorkers=2 \
        $CHANGED >"$OUT/test" 2>&1 || { no "unit tests"; tail -30 "$OUT/test"; exit 1; }
    tail -10 "$OUT/test"
fi
[ "$FAIL" -eq 0 ] && echo "PASS: gate"
exit $FAIL
