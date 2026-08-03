#!/usr/bin/env bash
# Build throwaway CODEX_HOMEs + workspaces + scenario JSONs for the derisk probes.
# The real API key is read from the worktree .env and lands ONLY in /tmp auth.json files,
# never in the committed scenario files (scenario env.OPENAI_API_KEY stays "").
set -euo pipefail

WORK=/home/mahmoud/code/agenta/.claude/worktrees/codex-harness
SPIKE=$WORK/docs/design/codex-harness/spike
SCRATCH=/tmp/codex-derisk
KEY=$(grep -m1 '^OPENAI_API_KEY=' "$WORK/.env" | cut -d= -f2-)
[ -n "$KEY" ] || { echo "no OPENAI_API_KEY in $WORK/.env"; exit 1; }

mkdir -p "$SPIKE/scenarios-derisk" "$SPIKE/transcripts" "$SCRATCH"

mk_home() { # name, config-toml-body, [auth: real|placeholder|none]
  local name=$1 config=$2 auth=${3:-real}
  local home=$SCRATCH/home-$name
  rm -rf "$home"; mkdir -p "$home"
  printf '%s\n' "$config" > "$home/config.toml"
  case $auth in
    real)        printf '{"auth_mode":"apikey","OPENAI_API_KEY":"%s"}\n' "$KEY" > "$home/auth.json" ;;
    placeholder) printf '{"auth_mode":"apikey","OPENAI_API_KEY":"dtn_secret_placeholder_abc123"}\n' > "$home/auth.json" ;;
    none)        : ;;
  esac
  rm -rf "$SCRATCH/ws-$name"; mkdir -p "$SCRATCH/ws-$name"
}

MCP=$SPIKE/scripts/mcp-echo-server.mjs

# --- P2: gate texture under danger-full-access ------------------------------
mk_home d1-onrequest-normal 'approval_policy = "on-request"
sandbox_mode = "danger-full-access"'

mk_home d2-onrequest-outside 'approval_policy = "on-request"
sandbox_mode = "danger-full-access"'

mk_home d3-untrusted-normal 'approval_policy = "untrusted"
sandbox_mode = "danger-full-access"'

mk_home d4-onrequest-mcp "approval_policy = \"on-request\"
sandbox_mode = \"danger-full-access\"

[mcp_servers.spike]
command = \"node\"
args = [\"$MCP\"]
env = { SPIKE_MCP_LOG = \"$SCRATCH/mcp-d4.log\" }"

mk_home d5-untrusted-mcp-preallow "approval_policy = \"untrusted\"
sandbox_mode = \"danger-full-access\"

[mcp_servers.spike]
command = \"node\"
args = [\"$MCP\"]
env = { SPIKE_MCP_LOG = \"$SCRATCH/mcp-d5.log\" }
default_tools_approval_mode = \"approve\""

# --- P1: daemon reuse, CODEX_CONFIG fixed at daemon start -------------------
mk_home p1-daemon-reuse 'approval_policy = "never"
sandbox_mode = "danger-full-access"'

# --- P3: placeholder credential to a local listener -------------------------
mk_home p3a-placeholder-authjson 'approval_policy = "never"
sandbox_mode = "danger-full-access"' placeholder

mk_home p3b-placeholder-autologin 'approval_policy = "never"
sandbox_mode = "danger-full-access"' none

rm -f "$SCRATCH"/mcp-*.log
echo "setup done: $SCRATCH"
