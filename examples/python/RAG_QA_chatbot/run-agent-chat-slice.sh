#!/usr/bin/env bash
#
# Orchestrate the agent-chat slice: the REAL agent backend + the web dev server.
#
#   ./examples/python/RAG_QA_chatbot/run-agent-chat-slice.sh
#
# Brings up:
#   1. The real agent backend (FastAPI) on :8000 — POST /api/agent/chat[-agenta], v6 UI
#      Message Stream, real LLM + Qdrant retrieval + Agenta trace.
#   2. The web app (Next dev) with the slice flag on.
#
# Then visit:  http://localhost:3000/w/<workspace>/p/<project>/apps/<app_id>/agent-chat
# Flip the A · UIMessage parts / B · Agenta {role,content} toggle on the page.
#
# REQUIRES credentials: a populated .env (OPENAI_API_KEY + QDRANT_URL/KEY + AGENTA_*) and
# the docs ingested into Qdrant. Ctrl-C tears both down.

set -euo pipefail

# --- config (override via env) ---------------------------------------------
BACKEND_PORT="${BACKEND_PORT:-8000}"
AGENT_CHAT_TRACK="${AGENT_CHAT_TRACK:-}"   # "agenta" => default the page to Track B; empty => Track A
APP="${APP:-ee}"                           # which web app shell to serve: "ee" (default) or "oss"

case "$APP" in
  ee)  APP_FILTER="@agenta/ee" ;;
  oss) APP_FILTER="@agenta/oss" ;;
  *)   echo "!! APP must be 'ee' or 'oss', got '$APP'" >&2; exit 1 ;;
esac

# --- paths -----------------------------------------------------------------
REPO_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
EXAMPLE_DIR="$REPO_ROOT/examples/python/RAG_QA_chatbot"
WEB_DIR="$REPO_ROOT/web"
VENV="$EXAMPLE_DIR/.venv"

cd "$REPO_ROOT"

# Credentials are required — there is no credential-free mock.
if [ ! -f "$EXAMPLE_DIR/.env" ]; then
  echo "!! Missing $EXAMPLE_DIR/.env" >&2
  echo "   Copy env.example → .env and set OPENAI_API_KEY + QDRANT_URL/KEY + AGENTA_*," >&2
  echo "   then ingest the docs (see below). The agent backend needs real credentials." >&2
  exit 1
fi

# --- teardown --------------------------------------------------------------
BACKEND_PID=""
cleanup() {
  echo ""
  echo "==> Shutting down…"
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# --- 1. backend ------------------------------------------------------------
if [ ! -d "$VENV" ]; then
  echo "==> Installing example deps (first run only)…"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet -e "$EXAMPLE_DIR"
fi

echo "==> Starting agent backend (backend.main:app) on :$BACKEND_PORT …"
echo "    (real LLM + Qdrant retrieval + Agenta trace; reads $EXAMPLE_DIR/.env)"
echo "    Docs must be ingested into Qdrant first, e.g.:"
echo "      $VENV/bin/python -m ingest.run --source ../../../docs/docs \\"
echo "        --base-url https://docs.agenta.ai --recreate"
APP_MODULE="backend.main:app"
# --reload so backend edits (agent_loop.py, contract_stream.py, …) hot-reload without a
# manual restart while iterating.
( cd "$EXAMPLE_DIR" && exec "$VENV/bin/uvicorn" "$APP_MODULE" --port "$BACKEND_PORT" --reload ) &
BACKEND_PID=$!

# wait for /health
echo -n "==> Waiting for backend"
for _ in $(seq 1 30); do
  if curl -fsS "http://localhost:$BACKEND_PORT/health" >/dev/null 2>&1; then
    echo " — up."
    break
  fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo ""
    echo "!! Backend exited before becoming healthy. See output above." >&2
    exit 1
  fi
  echo -n "."
  sleep 1
done

# --- 2. web dev server (foreground) ----------------------------------------
echo "==> Starting web dev server: $APP_FILTER (slice flag on)…"
echo ""
echo "    App:    $APP_FILTER   (override with APP=oss)"
echo "    Visit:  http://localhost:3000/w/<workspace>/p/<project>/apps/<app_id>/agent-chat"
echo "    Mock:   http://localhost:$BACKEND_PORT/api/agent/chat"
[ -n "$AGENT_CHAT_TRACK" ] && echo "    Track:  defaulting to '$AGENT_CHAT_TRACK' (page toggle still works)"
echo ""
echo "    NOTE: reaching the /w/../p/../apps/<app_id>/agent-chat route needs your authenticated dev"
echo "          stack (backend + DB + auth) already running — this script only starts"
echo "          the agent backend and the web app."
echo ""

cd "$WEB_DIR"
NEXT_PUBLIC_AGENT_CHAT_SLICE=true \
  ${AGENT_CHAT_TRACK:+NEXT_PUBLIC_AGENT_CHAT_TRACK="$AGENT_CHAT_TRACK"} \
  pnpm --filter "$APP_FILTER" dev
