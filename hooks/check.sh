#!/usr/bin/env bash

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

require_command() {
  local command_name="$1"
  local install_hint="$2"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name not found. $install_hint"
    exit 1
  fi
}

staged_files="$(git diff --cached --name-only --diff-filter=ACMR)"

if [ -z "$staged_files" ]; then
  exit 0
fi

should_run_styling_checks=false

while IFS= read -r file_path; do
  case "$file_path" in
    api/*|sdk/*|web/*|.github/workflows/11-check-code-styling.yml)
      should_run_styling_checks=true
      break
      ;;
  esac
done <<EOF
$staged_files
EOF

if [ "$should_run_styling_checks" = false ]; then
  exit 0
fi

require_command "ruff" "Install it with \`pip install ruff==0.14.0\`."
require_command "pnpm" "Install it with Corepack or from https://pnpm.io/installation."

ruff format --check
ruff check

(
  cd web
  pnpm i
  pnpm run format
  pnpm run lint
)
