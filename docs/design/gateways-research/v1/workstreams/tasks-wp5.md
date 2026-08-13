# WP5 tasks — Test doubles

Ordered so each item is one reviewable commit. Depends on nothing — branches from the seed
commit and starts immediately; does not wait on WP1/WP2/WP3. Run `ruff format` then `ruff check
--fix` (from the repo root) before every commit and fix all errors, per `api/AGENTS.md`.

## Phase 1 — `FakeLlmAdapter` (in-process)

- [x] `core/gateways/llms/providers/fake/__init__.py`.
- [x] `core/gateways/llms/providers/fake/adapter.py`: `FakeLlmAdapter(LlmUpstreamInterface)`,
      no constructor arguments, implementing `relay_chat_completion(self, *, route, credential,
      context, body, headers) -> LlmRelayResult` per `entities.md` §7.1 exactly.
- [x] Implement the `fake/echo` default path: build an OpenAI-shaped chat-completion response
      echoing the last message in the parsed request body; non-streaming returns one `body`
      chunk.
- [x] Implement `context.stream=True` for `fake/echo`: yield 2–3 SSE-framed chunks over `body`,
      terminated by `data: [DONE]\n\n`.
- [x] Implement `fake/error`: raise `LlmUpstreamError(provider_key="fake", status_code=500,
      detail="forced by fake/error")` before producing any `body`.
- [x] Implement `fake/slow-{seconds}`: parse the integer suffix, `await asyncio.sleep(seconds)`,
      then return the `fake/echo` response.
- [x] Populate `GatewayUsage` (`calls=1`, `input_tokens`/`output_tokens` from a word-count
      approximation, `cost=0.0`) on `LlmRelayResult.usage`, set once `body` is exhausted per the
      dataclass's own docstring.
- [x] Ruff format + check; run and fix.
- [x] Unit tests (`test_fake_llm_adapter.py`): `fake/echo` returns a well-formed
      `LlmRelayResult`; `fake/error` raises `LlmUpstreamError`; `fake/slow-1` takes ≥1s wall
      clock; streaming yields >1 chunk ending `[DONE]`; `usage` is non-`None` after exhaustion.
- [x] Commit: "wp5: fake LLM adapter (in-process)". — `46f6466ea5`

## Phase 2 — `FakeMcpAdapter` (in-process)

- [x] `core/gateways/mcps/providers/fake/__init__.py`.
- [x] `core/gateways/mcps/providers/fake/adapter.py`: `FakeMcpAdapter(McpUpstreamInterface)`,
      implementing `relay(self, *, route, auth, context, body, headers) -> McpRelayResult` per
      `entities.md` §7.1 exactly.
- [x] Implement `initialize` and `tools/list`, returning the three tools (`echo`, `fail`, `slow`)
      with their input schemas.
- [x] Implement `tools/call` dispatch on `params.name`: `echo` returns `params.arguments` as tool
      result content; `fail` returns a JSON-RPC **result** with `isError: true` (never raises);
      `slow` sleeps `params.arguments.seconds` (default 5) then returns a fixed result.
- [x] Implement the notification path: any `notifications/*` method returns `status_code=202`
      with an empty `body`, matching the runner's internal MCP server's own 202-for-notification
      shape (`services/runner/src/tools/tool-mcp-http.ts`).
- [x] Implement the fallback: any other `method` raises `McpUpstreamError(target=..., status_code=501)`.
- [x] Ruff format + check; run and fix.
- [x] Unit tests (`test_fake_mcp_adapter.py`): `tools/list` returns all three tools; `echo`
      echoes; `fail` returns `isError: true` without raising; `slow` with `seconds=1` takes ≥1s;
      an unknown method raises `McpUpstreamError(status_code=501)`.
- [x] Commit: "wp5: fake MCP adapter (in-process)". — `9064436bcd`

  Judgment call: `tools/call` with a `name` outside the three declared tools returns a JSON-RPC
  result with `isError: true` ("unknown tool: {name}") rather than an unhandled crash — not
  spec'd explicitly, chosen because an unknown tool is a protocol-level failure (D16 pass-through),
  not a transport failure, matching the treatment `fail` already gets.

## Phase 3 — Contract tests

- [x] `api/oss/tests/pytest/unit/gateways/test_fake_adapters_contract.py`: a parametrized
      fixture that both `FakeLlmAdapter` and (via an import guard, skipped until it exists)
      `PassthroughLlmAdapter`/`TranslatedLlmAdapter` must pass — asserts
      `relay_chat_completion` always returns `LlmRelayResult`, never a raw dict, for
      `fake/echo`.
- [x] Same shape for `relay` returning `McpRelayResult` across `{initialize, tools/list,
      tools/call}`.
- [x] Ruff format + check; run and fix.
- [x] Commit: "wp5: adapter interface contract tests". — `83807511c8`

  Also parametrized in `HttpMcpAdapter`/`ComposioMcpAdapter` (skip-until-exists) on the MCP
  side, since the spec text only names the LLM pair explicitly but the MCP plane has the
  same two-real-adapters shape (`http`/`composio`, entities.md §0) — extending the guard to
  both keeps the file from needing an edit when either lands.

## Phase 4 — Deployable fake LLM server

- [x] `core/gateways/llms/providers/fake/app.py`: a FastAPI app, `GET /health` returning 200.
- [x] `POST /v1/chat/completions`: parse the OpenAI-shaped request body, dispatch on `"model"`
      using the identical `fake/echo` / `fake/error` / `fake/slow-{n}` convention as
      `FakeLlmAdapter` — same behavior, standalone process.
- [x] Streaming: `"stream": true` returns `Content-Type: text/event-stream` with real SSE framing
      over the wire.
- [x] Verify by hand (`uvicorn core.gateways.llms.providers.fake.app:app --port 9091` locally,
      `curl`) before wiring into compose — this step needs nothing running beyond the process
      itself, not the stack. Ran locally on port 19091 (avoiding a collision with any deployed
      stack): `/health` 200; `fake/echo` 200 with the echoed content; `fake/error` a real HTTP
      500 with the OpenAI error envelope; `stream:true` produced `Content-Type:
      text/event-stream` with 3 SSE frames ending `data: [DONE]` on the wire; `fake/slow-30`
      with `curl -m 2` cut the connection at 2s (curl exit 28, a genuine socket timeout, not an
      in-process await).
- [x] Ruff format + check; run and fix.
- [x] Commit: "wp5: deployable fake LLM server". — `ab9ecab033`

  Implementation delegates every request to `FakeLlmAdapter` directly (constructs
  `LlmCallContext`/`LlmResolvedRoute`, calls `relay_chat_completion`) rather than
  reimplementing the echo/streaming/error logic a second time — this is what makes "same
  control convention on both tiers" true by construction instead of by discipline.

## Phase 5 — Deployable fake MCP server

- [x] `core/gateways/mcps/providers/fake/app.py`: `GET /health` returning 200.
- [x] `POST /` (root): stateless-JSON-mode MCP Streamable HTTP — one JSON-RPC request in, one
      `application/json` response out, `202` with empty body for a notification, matching
      `tool-mcp-http.ts`'s framing.
- [x] `GET /` and `DELETE /`: `405`.
- [x] Same three tools (`echo`, `fail`, `slow`) as `FakeMcpAdapter`, same dispatch convention.
- [x] Verify by hand (`uvicorn ... --port 9092`, `curl -X POST` with a `tools/list` body) before
      wiring into compose. Ran locally on port 19092: `/health` 200; `tools/list` returned all
      three tools; `tools/call name=echo` echoed `{"a": 1}`; `name=fail` returned `isError:
      true` at HTTP 200 (not an exception); `notifications/initialized` returned 202 with an
      empty body; `GET /` and `DELETE /` both 405; an unrecognized method returned a real HTTP
      501.
- [x] Ruff format + check; run and fix.
- [x] Commit: "wp5: deployable fake MCP server". — `406c0aa6d8`

  Same delegation choice as Phase 4: the app parses only enough of the body to build
  `McpCallContext.method` for the DTO, then hands the raw body to `FakeMcpAdapter.relay`,
  which does the real parsing. `GET`/`DELETE` handlers are explicit rather than relying on
  Starlette's automatic 405-on-path-match-wrong-method behavior, so the 405 is asserted by an
  actual handler rather than a framework default a future refactor could silently change.

## Phase 6 — Compose wiring

- [x] `api/oss/src/utils/env.py`: add `FakeGatewaysConfig` (`llm_url`, `mcp_url`, defaults
      pointing at the compose service names) and register it on `EnvironSettings`, following
      `ComposioConfig`'s shape exactly (lines 685–704).
- [x] `hosting/docker-compose/oss/docker-compose.dev.yml`: add `fake-llm-gateway` and
      `fake-mcp-gateway` services, reusing `agenta-oss-dev-api:latest` with an overridden
      `command`, always-on (no profile gate), healthchecks on `/health`.
- [x] `hosting/docker-compose/ee/docker-compose.dev.yml`: same two services (not a license-gated
      feature).
- [x] Verify the healthcheck config against the existing `ngrok`/`composio` service blocks'
      indentation and section-comment style (`# === ACTIVATION`, `# === IMAGE`, etc.) so the new
      blocks read like the rest of the file.
- [x] Ruff format + check (no Python touched here, but re-run to confirm the phase-4/5 files
      still pass after any last edit); fix.
- [x] Commit: "wp5: wire fakes into the local compose stack".

  Judgment calls: (1) `EnvironSettings.fake_gateways` is the attribute name — the file's own
  convention is strict alphabetical ordering by attribute name (not "next to composio" as the
  spec's prose suggested; that prose predates several intervening alphabetical insertions), so
  it landed between `docker` and `identity`, not next to `composio`. (2) The EE compose block
  uses `agenta-ee-dev-api:latest`, not the `agenta-oss-dev-api:latest` the spec's snippet shows
  literally in both places — EE's own `.api` anchor builds that image, and it already carries
  `api/oss/src` mounted the same way (`api/ee/docker/Dockerfile.dev` copies both `api/ee` and
  `api/oss`), so the fake apps import identically from either image. (3) Compose service
  placement: inserted as an always-on block immediately before the profile-gated `composio`
  block in both files (after `supertokens` in OSS, after `stripe` in EE) — grouped with the
  other unconditional infrastructure rather than alphabetically, matching the file's existing
  service-ordering convention (app layer, then infra, then satellite processes).

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
