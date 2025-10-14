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

# --- install pre-commit globally if missing ---
if ! command -v pre-commit >/dev/null 2>&1; then
  echo "📦 Installing pre-commit..."
  pip3 install pre-commit
fi

# --- install gitleaks globally if missing ---
if ! command -v gitleaks >/dev/null 2>&1; then
  echo "📦 Installing gitleaks..."
  if command -v brew >/dev/null 2>&1; then
    brew install gitleaks
  else
    # fallback: go install (requires Go installed)
    go install github.com/gitleaks/gitleaks/v8@latest
    export PATH="$PATH:$(go env GOPATH)/bin"
  fi
fi

# --- install hooks into .git/hooks/ ---
echo "⚙️  Installing pre-commit hooks..."
pre-commit install --install-hooks
pre-commit install --hook-type pre-push

# --- one-time full scans ---
echo "🔍 Running one-time gitleaks scans..."

gitleaks --config .gitleaks.toml --exit-code 1 --verbose detect --no-git --source . || {
  echo "❌ Gitleaks detected potential secrets in the working directory."
  exit 1
}

echo "✅ Setup complete! Hooks installed and initial scan passed. You are safe to commit."
