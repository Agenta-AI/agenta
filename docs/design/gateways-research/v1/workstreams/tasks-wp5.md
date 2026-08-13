# WP5 tasks — Test doubles

Ordered so each item is one reviewable commit. Depends on nothing — branches from the seed
commit and starts immediately; does not wait on WP1/WP2/WP3. Run `ruff format` then `ruff check
--fix` (from the repo root) before every commit and fix all errors, per `api/AGENTS.md`.

## Phase 1 — `FakeLlmAdapter` (in-process)

- [ ] `core/gateways/llms/providers/fake/__init__.py`.
- [ ] `core/gateways/llms/providers/fake/adapter.py`: `FakeLlmAdapter(LlmUpstreamInterface)`,
      no constructor arguments, implementing `relay_chat_completion(self, *, route, credential,
      context, body, headers) -> LlmRelayResult` per `entities.md` §7.1 exactly.
- [ ] Implement the `fake/echo` default path: build an OpenAI-shaped chat-completion response
      echoing the last message in the parsed request body; non-streaming returns one `body`
      chunk.
- [ ] Implement `context.stream=True` for `fake/echo`: yield 2–3 SSE-framed chunks over `body`,
      terminated by `data: [DONE]\n\n`.
- [ ] Implement `fake/error`: raise `LlmUpstreamError(provider_key="fake", status_code=500,
      detail="forced by fake/error")` before producing any `body`.
- [ ] Implement `fake/slow-{seconds}`: parse the integer suffix, `await asyncio.sleep(seconds)`,
      then return the `fake/echo` response.
- [ ] Populate `GatewayUsage` (`calls=1`, `input_tokens`/`output_tokens` from a word-count
      approximation, `cost=0.0`) on `LlmRelayResult.usage`, set once `body` is exhausted per the
      dataclass's own docstring.
- [ ] Ruff format + check; run and fix.
- [ ] Unit tests (`test_fake_llm_adapter.py`): `fake/echo` returns a well-formed
      `LlmRelayResult`; `fake/error` raises `LlmUpstreamError`; `fake/slow-1` takes ≥1s wall
      clock; streaming yields >1 chunk ending `[DONE]`; `usage` is non-`None` after exhaustion.
- [ ] Commit: "wp5: fake LLM adapter (in-process)".

## Phase 2 — `FakeMcpAdapter` (in-process)

- [ ] `core/gateways/mcps/providers/fake/__init__.py`.
- [ ] `core/gateways/mcps/providers/fake/adapter.py`: `FakeMcpAdapter(McpUpstreamInterface)`,
      implementing `relay(self, *, route, auth, context, body, headers) -> McpRelayResult` per
      `entities.md` §7.1 exactly.
- [ ] Implement `initialize` and `tools/list`, returning the three tools (`echo`, `fail`, `slow`)
      with their input schemas.
- [ ] Implement `tools/call` dispatch on `params.name`: `echo` returns `params.arguments` as tool
      result content; `fail` returns a JSON-RPC **result** with `isError: true` (never raises);
      `slow` sleeps `params.arguments.seconds` (default 5) then returns a fixed result.
- [ ] Implement the notification path: any `notifications/*` method returns `status_code=202`
      with an empty `body`, matching the runner's internal MCP server's own 202-for-notification
      shape (`services/runner/src/tools/tool-mcp-http.ts`).
- [ ] Implement the fallback: any other `method` raises `McpUpstreamError(target=..., status_code=501)`.
- [ ] Ruff format + check; run and fix.
- [ ] Unit tests (`test_fake_mcp_adapter.py`): `tools/list` returns all three tools; `echo`
      echoes; `fail` returns `isError: true` without raising; `slow` with `seconds=1` takes ≥1s;
      an unknown method raises `McpUpstreamError(status_code=501)`.
- [ ] Commit: "wp5: fake MCP adapter (in-process)".

## Phase 3 — Contract tests

- [ ] `api/oss/tests/pytest/unit/gateways/test_fake_adapters_contract.py`: a parametrized
      fixture that both `FakeLlmAdapter` and (via an import guard, skipped until it exists)
      `PassthroughLlmAdapter`/`TranslatedLlmAdapter` must pass — asserts
      `relay_chat_completion` always returns `LlmRelayResult`, never a raw dict, for
      `fake/echo`.
- [ ] Same shape for `relay` returning `McpRelayResult` across `{initialize, tools/list,
      tools/call}`.
- [ ] Ruff format + check; run and fix.
- [ ] Commit: "wp5: adapter interface contract tests".

## Phase 4 — Deployable fake LLM server

- [ ] `core/gateways/llms/providers/fake/app.py`: a FastAPI app, `GET /health` returning 200.
- [ ] `POST /v1/chat/completions`: parse the OpenAI-shaped request body, dispatch on `"model"`
      using the identical `fake/echo` / `fake/error` / `fake/slow-{n}` convention as
      `FakeLlmAdapter` — same behavior, standalone process.
- [ ] Streaming: `"stream": true` returns `Content-Type: text/event-stream` with real SSE framing
      over the wire.
- [ ] Verify by hand (`uvicorn core.gateways.llms.providers.fake.app:app --port 9091` locally,
      `curl`) before wiring into compose — this step needs nothing running beyond the process
      itself, not the stack.
- [ ] Ruff format + check; run and fix.
- [ ] Commit: "wp5: deployable fake LLM server".

## Phase 5 — Deployable fake MCP server

- [ ] `core/gateways/mcps/providers/fake/app.py`: `GET /health` returning 200.
- [ ] `POST /` (root): stateless-JSON-mode MCP Streamable HTTP — one JSON-RPC request in, one
      `application/json` response out, `202` with empty body for a notification, matching
      `tool-mcp-http.ts`'s framing.
- [ ] `GET /` and `DELETE /`: `405`.
- [ ] Same three tools (`echo`, `fail`, `slow`) as `FakeMcpAdapter`, same dispatch convention.
- [ ] Verify by hand (`uvicorn ... --port 9092`, `curl -X POST` with a `tools/list` body) before
      wiring into compose.
- [ ] Ruff format + check; run and fix.
- [ ] Commit: "wp5: deployable fake MCP server".

## Phase 6 — Compose wiring

- [ ] `api/oss/src/utils/env.py`: add `FakeGatewaysConfig` (`llm_url`, `mcp_url`, defaults
      pointing at the compose service names) and register it on `EnvironSettings`, following
      `ComposioConfig`'s shape exactly (lines 685–704).
- [ ] `hosting/docker-compose/oss/docker-compose.dev.yml`: add `fake-llm-gateway` and
      `fake-mcp-gateway` services, reusing `agenta-oss-dev-api:latest` with an overridden
      `command`, always-on (no profile gate), healthchecks on `/health`.
- [ ] `hosting/docker-compose/ee/docker-compose.dev.yml`: same two services (not a license-gated
      feature).
- [ ] Verify the healthcheck config against the existing profile-gated service blocks'
      indentation and section-comment style (`# === ACTIVATION`, `# === IMAGE`, etc.) so the new
      blocks read like the rest of the file.
- [ ] Ruff format + check (no Python touched here, but re-run to confirm the phase-4/5 files
      still pass after any last edit); fix.
- [ ] Commit: "wp5: wire fakes into the local compose stack".

## Phase 7 — `routers.py` diff and acceptance verification

- [ ] `api/entrypoints/routers.py`: add the two import lines only (`FakeLlmAdapter`,
      `FakeMcpAdapter`) near the existing Composio adapter imports (lines 142–150) — do not add
      registry dict entries; that is WP7/WP9's edit at the M1 merge.
- [ ] Deploy the local stack (`bash hosting/docker-compose/run.sh --oss --dev --build`) and
      confirm both new services report healthy.
- [ ] From inside the compose network, `curl` `fake-llm-gateway:9091/health` and
      `fake-mcp-gateway:9092/health`; both 200.
- [ ] Drive a forced failure end to end: `POST fake-llm-gateway:9091/v1/chat/completions` with
      `"model": "fake/error"` returns 500; `POST fake-mcp-gateway:9092/` with a `tools/call`
      body naming `fail` returns a JSON-RPC result with `isError: true`.
- [ ] Drive the slow path with a short client timeout and confirm the connection is genuinely
      cut, not just an in-process `await`.
- [ ] Ruff format + check; fix.
- [ ] Commit: "wp5: routers.py import diff + acceptance verification".

## Definition of done

Matches `plan.md` WP5 verbatim: *"both fakes run in the local stack and can be driven to fail on
demand."* Concretely: `FakeLlmAdapter`/`FakeMcpAdapter` pass their unit and contract tests with
nothing running; `fake-llm-gateway`/`fake-mcp-gateway` are healthy in the local docker-compose
stack; each can be made to return a 500 (LLM) / `isError: true` (MCP) and to hang past a short
client timeout, on demand, from outside the process (a real HTTP client, not a mocked one).
