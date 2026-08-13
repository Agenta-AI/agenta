#!/bin/bash
set -euo pipefail

# Acceptance verification for the WP5 fake upstreams (fake-llm-gateway, fake-mcp-gateway).
#
# WP5's own contract (workstreams/specs-wp5.md "Tests: Acceptance" and "Done test"): the fakes
# must run as compose services and be drivable to fail/hang on demand, from a REAL HTTP client
# outside the process — not a mocked one. Neither service is published to the host by default
# (workstreams/specs-wp5.md), so every check below runs from inside the compose network via
# `docker compose exec api ...`, the same shape the spec's own "Done test" section uses.
#
# NEEDS THE STACK UP. This script is not run as part of WP5's own commit — a package that needs
# the compose stack running is integration/acceptance, not unit (api/AGENTS.md, the test-layer
# rule); someone deploys, then runs this.
#
# Usage:
#   hosting/docker-compose/verify-fake-gateways.sh                      # oss / dev
#   LICENSE=ee PROJECT=agenta-ee-dev-instance2 \
#     hosting/docker-compose/verify-fake-gateways.sh
#
# Env knobs (all optional; defaults match the documented dev stack):
#   LICENSE  oss|ee                  (default: oss)
#   STAGE    dev|gh|...              (default: dev)
#   PROJECT  compose project name    (default: agenta-<license>-<stage>)

LICENSE="${LICENSE:-oss}"
STAGE="${STAGE:-dev}"
PROJECT="${PROJECT:-agenta-${LICENSE}-${STAGE}}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/${LICENSE}/docker-compose.${STAGE}.yml"

if [[ ! -f "$COMPOSE_FILE" ]]; then
    echo "Error: compose file not found: $COMPOSE_FILE" >&2
    exit 1
fi

compose() {
    docker compose -p "$PROJECT" -f "$COMPOSE_FILE" "$@"
}

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

echo "== health =="
compose exec -T api curl -sf http://fake-llm-gateway:9091/health >/dev/null \
    || fail "fake-llm-gateway:9091/health did not return 200"
compose exec -T api curl -sf http://fake-mcp-gateway:9092/health >/dev/null \
    || fail "fake-mcp-gateway:9092/health did not return 200"
echo "ok: both healthchecks green"

echo "== LLM: forced failure (fake/error -> 500) =="
compose exec -T api python -c "
import asyncio, httpx

async def main():
    async with httpx.AsyncClient(base_url='http://fake-llm-gateway:9091') as c:
        r = await c.post('/v1/chat/completions', json={'model': 'fake/error', 'messages': []})
        assert r.status_code == 500, r.status_code

asyncio.run(main())
" || fail "fake/error did not return HTTP 500"
echo "ok: fake/error returns 500"

echo "== LLM: streaming (fake/echo, stream=true -> multiple SSE frames) =="
compose exec -T api python -c "
import asyncio, httpx

async def main():
    async with httpx.AsyncClient(base_url='http://fake-llm-gateway:9091') as c:
        async with c.stream(
            'POST', '/v1/chat/completions',
            json={'model': 'fake/echo', 'stream': True, 'messages': [{'role': 'user', 'content': 'hi'}]},
        ) as r:
            assert r.headers['content-type'].startswith('text/event-stream'), r.headers
            frames = [line async for line in r.aiter_lines() if line.startswith('data:')]
            assert len(frames) > 1, frames
            assert frames[-1] == 'data: [DONE]', frames[-1]

asyncio.run(main())
" || fail "fake/echo streaming did not produce multiple SSE frames ending [DONE]"
echo "ok: streaming produces multiple SSE frames ending data: [DONE]"

echo "== LLM: genuine hang (fake/slow-30, 2s client timeout -> connection cut) =="
compose exec -T api python -c "
import asyncio, httpx

async def main():
    async with httpx.AsyncClient(base_url='http://fake-llm-gateway:9091', timeout=2.0) as c:
        try:
            await c.post('/v1/chat/completions', json={'model': 'fake/slow-30', 'messages': []})
        except httpx.TimeoutException:
            return
        raise AssertionError('expected a timeout, request completed instead')

asyncio.run(main())
" || fail "fake/slow-30 did not hang past a 2s client timeout"
echo "ok: fake/slow-30 hangs past a short client timeout (a real socket, not a mocked await)"

echo "== MCP: tools/list over real Streamable HTTP =="
compose exec -T api python -c "
import asyncio, httpx

async def main():
    async with httpx.AsyncClient(base_url='http://fake-mcp-gateway:9092') as c:
        r = await c.post('/', json={'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list'})
        assert r.status_code == 200, r.status_code
        names = {t['name'] for t in r.json()['result']['tools']}
        assert names == {'echo', 'fail', 'slow'}, names

        get = await c.get('/')
        assert get.status_code == 405, get.status_code
        delete = await c.delete('/')
        assert delete.status_code == 405, delete.status_code

asyncio.run(main())
" || fail "MCP tools/list or GET/DELETE 405 check failed"
echo "ok: tools/list returns the three tools; GET/DELETE both 405"

echo "== MCP: forced tool failure (fail -> isError: true, not a transport error) =="
compose exec -T api python -c "
import asyncio, httpx

async def main():
    async with httpx.AsyncClient(base_url='http://fake-mcp-gateway:9092') as c:
        r = await c.post(
            '/',
            json={'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': 'fail'}},
        )
        assert r.status_code == 200, r.status_code
        assert r.json()['result']['isError'] is True, r.json()

asyncio.run(main())
" || fail "MCP tools/call name=fail did not return isError: true at HTTP 200"
echo "ok: tools/call name=fail returns a JSON-RPC result with isError: true"

echo
echo "All fake-gateway acceptance checks passed."
