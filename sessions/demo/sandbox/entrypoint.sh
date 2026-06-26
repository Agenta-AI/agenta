#!/usr/bin/env bash
set -e

# Codex's ACP adapter authenticates from ~/.codex/auth.json (API-key mode),
# not just OPENAI_API_KEY in env. Seed it so codex sessions don't require login.
if [ -n "${OPENAI_API_KEY:-}" ]; then
  mkdir -p "$HOME/.codex"
  printf '{"OPENAI_API_KEY":"%s"}' "$OPENAI_API_KEY" > "$HOME/.codex/auth.json"
fi

# pi: trust projects by default so non-interactive RPC sessions don't block on a prompt.
mkdir -p "$HOME/.config/pi"
printf '{"defaultProjectTrust":"trusted"}' > "$HOME/.config/pi/settings.json" 2>/dev/null || true

exec sandbox-agent server --no-token --host 0.0.0.0 --port 2468
