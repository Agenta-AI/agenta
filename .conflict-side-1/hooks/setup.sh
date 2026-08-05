#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Setting up Git hooks with pre-commit + gitleaks..."

# --- check dependencies ---
if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ Python3 is required but not installed."
  exit 1
fi
if ! command -v pip3 >/dev/null 2>&1; then
  echo "❌ pip3 is required but not installed."
  exit 1
fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo "❌ pnpm is required but not installed."
  exit 1
fi

# --- install pre-commit globally if missing ---
if ! command -v pre-commit >/dev/null 2>&1; then
  echo "📦 Installing pre-commit..."
  pip3 install pre-commit
fi

# --- install ruff globally if missing ---
if ! command -v ruff >/dev/null 2>&1; then
  echo "📦 Installing ruff..."
  pip3 install ruff
fi

# --- install gitleaks globally if missing ---
if ! command -v gitleaks >/dev/null 2>&1; then
  echo "📦 Installing gitleaks..."
  if command -v brew >/dev/null 2>&1; then
    brew install gitleaks
  else
    # fallback: go install (requires Go installed)
    go install github.com/zricethezav/gitleaks/v8@latest
    export PATH="$PATH:$(go env GOPATH)/bin"
    echo "----------------------------------------------------------------------"
    echo "⚠️⚠️ PLEASE ADD $(go env GOPATH)/bin TO YOUR PATH IN YOUR .bashrc OR .zshrc ⚠️⚠️"
    echo "----------------------------------------------------------------------"
  fi
fi

# --- install turbo globally if missing ---
if ! command -v turbo >/dev/null 2>&1; then
  echo "📦 Installing turbo globally..."
  pnpm add -g turbo
fi

# --- install web workspace dependencies (prettier, eslint, etc.) ---
echo "📦 Installing web workspace dependencies..."
(cd web && pnpm install)

# --- install hooks into .git/hooks/ ---
echo "⚙️  Installing pre-commit hooks..."
pre-commit install --install-hooks
pre-commit install --hook-type pre-push

# --- verify all hooks pass ---
echo "🔍 Running all pre-commit hooks to verify setup..."
pre-commit run --all-files || {
  echo "❌ Some hooks failed. Please fix the issues above and re-run."
  exit 1
}

echo "✅ Setup complete! Hooks installed and all checks passed. You are safe to commit."
