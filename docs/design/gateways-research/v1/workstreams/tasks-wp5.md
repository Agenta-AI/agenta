# WP5 tasks — Test doubles

Ordered so each item is one reviewable commit. Depends on nothing — branches from the seed
commit and starts immediately; does not wait on WP1/WP2/WP3. Run `ruff format` then `ruff check
--fix` (from the repo root) before every commit and fix all errors, per `api/AGENTS.md`.

## Phase 1 — `MockLlmAdapter` (in-process)

- [x] `core/gateways/llms/providers/mock/__init__.py`.
- [x] `core/gateways/llms/providers/mock/adapter.py`: `MockLlmAdapter(LlmUpstreamInterface)`,
      no constructor arguments, implementing `relay_chat_completion(self, *, route, credential,
      context, body, headers) -> LlmRelayResult` per `entities.md` §7.1 exactly.
- [x] Implement the `mock/echo` default path: build an OpenAI-shaped chat-completion response
      echoing the last message in the parsed request body; non-streaming returns one `body`
      chunk.
- [x] Implement `context.stream=True` for `mock/echo`: yield 2–3 SSE-framed chunks over `body`,
      terminated by `data: [DONE]\n\n`.
- [x] Implement `mock/error`: raise `LlmUpstreamError(provider_key="mock", status_code=500,
      detail="forced by mock/error")` before producing any `body`.
- [x] Implement `mock/slow-{seconds}`: parse the integer suffix, `await asyncio.sleep(seconds)`,
      then return the `mock/echo` response.
- [x] Populate `GatewayUsage` (`calls=1`, `input_tokens`/`output_tokens` from a word-count
      approximation, `cost=0.0`) on `LlmRelayResult.usage`, set once `body` is exhausted per the
      dataclass's own docstring.
- [x] Ruff format + check; run and fix.
- [x] Unit tests (`test_mock_llm_adapter.py`): `mock/echo` returns a well-formed
      `LlmRelayResult`; `mock/error` raises `LlmUpstreamError`; `mock/slow-1` takes ≥1s wall
      clock; streaming yields >1 chunk ending `[DONE]`; `usage` is non-`None` after exhaustion.
- [x] Commit: "wp5: mock LLM adapter (in-process)". — `46f6466ea5`

## Phase 2 — `MockMcpAdapter` (in-process)

- [x] `core/gateways/mcps/providers/mock/__init__.py`.
- [x] `core/gateways/mcps/providers/mock/adapter.py`: `MockMcpAdapter(McpUpstreamInterface)`,
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
- [x] Unit tests (`test_mock_mcp_adapter.py`): `tools/list` returns all three tools; `echo`
      echoes; `fail` returns `isError: true` without raising; `slow` with `seconds=1` takes ≥1s;
      an unknown method raises `McpUpstreamError(status_code=501)`.
- [x] Commit: "wp5: mock MCP adapter (in-process)". — `9064436bcd`

  Judgment call: `tools/call` with a `name` outside the three declared tools returns a JSON-RPC
  result with `isError: true` ("unknown tool: {name}") rather than an unhandled crash — not
  spec'd explicitly, chosen because an unknown tool is a protocol-level failure (D16 pass-through),
  not a transport failure, matching the treatment `fail` already gets.

## Phase 3 — Contract tests

- [x] `api/oss/tests/pytest/unit/gateways/test_mock_adapters_contract.py`: a parametrized
      fixture that both `MockLlmAdapter` and (via an import guard, skipped until it exists)
      `PassthroughLlmAdapter`/`TranslatedLlmAdapter` must pass — asserts
      `relay_chat_completion` always returns `LlmRelayResult`, never a raw dict, for
      `mock/echo`.
- [x] Same shape for `relay` returning `McpRelayResult` across `{initialize, tools/list,
      tools/call}`.
- [x] Ruff format + check; run and fix.
- [x] Commit: "wp5: adapter interface contract tests". — `83807511c8`

  Also parametrized in `HttpMcpAdapter`/`ComposioMcpAdapter` (skip-until-exists) on the MCP
  side, since the spec text only names the LLM pair explicitly but the MCP plane has the
  same two-real-adapters shape (`http`/`composio`, entities.md §0) — extending the guard to
  both keeps the file from needing an edit when either lands.

## Phase 4 — Deployable mock LLM server

- [x] `core/gateways/llms/providers/mock/app.py`: a FastAPI app, `GET /health` returning 200.
- [x] `POST /v1/chat/completions`: parse the OpenAI-shaped request body, dispatch on `"model"`
      using the identical `mock/echo` / `mock/error` / `mock/slow-{n}` convention as
      `MockLlmAdapter` — same behavior, standalone process.
- [x] Streaming: `"stream": true` returns `Content-Type: text/event-stream` with real SSE framing
      over the wire.
- [x] Verify by hand (`uvicorn core.gateways.llms.providers.mock.app:app --port 9091` locally,
      `curl`) before wiring into compose — this step needs nothing running beyond the process
      itself, not the stack. Ran locally on port 19091 (avoiding a collision with any deployed
      stack): `/health` 200; `mock/echo` 200 with the echoed content; `mock/error` a real HTTP
      500 with the OpenAI error envelope; `stream:true` produced `Content-Type:
      text/event-stream` with 3 SSE frames ending `data: [DONE]` on the wire; `mock/slow-30`
      with `curl -m 2` cut the connection at 2s (curl exit 28, a genuine socket timeout, not an
      in-process await).
- [x] Ruff format + check; run and fix.
- [x] Commit: "wp5: deployable mock LLM server". — `ab9ecab033`

  Implementation delegates every request to `MockLlmAdapter` directly (constructs
  `LlmCallContext`/`LlmResolvedRoute`, calls `relay_chat_completion`) rather than
  reimplementing the echo/streaming/error logic a second time — this is what makes "same
  control convention on both tiers" true by construction instead of by discipline.

## Phase 5 — Deployable mock MCP server

- [x] `core/gateways/mcps/providers/mock/app.py`: `GET /health` returning 200.
- [x] `POST /` (root): stateless-JSON-mode MCP Streamable HTTP — one JSON-RPC request in, one
      `application/json` response out, `202` with empty body for a notification, matching
      `tool-mcp-http.ts`'s framing.
- [x] `GET /` and `DELETE /`: `405`.
- [x] Same three tools (`echo`, `fail`, `slow`) as `MockMcpAdapter`, same dispatch convention.
- [x] Verify by hand (`uvicorn ... --port 9092`, `curl -X POST` with a `tools/list` body) before
      wiring into compose. Ran locally on port 19092: `/health` 200; `tools/list` returned all
      three tools; `tools/call name=echo` echoed `{"a": 1}`; `name=fail` returned `isError:
      true` at HTTP 200 (not an exception); `notifications/initialized` returned 202 with an
      empty body; `GET /` and `DELETE /` both 405; an unrecognized method returned a real HTTP
      501.
- [x] Ruff format + check; run and fix.
- [x] Commit: "wp5: deployable mock MCP server". — `406c0aa6d8`

  Same delegation choice as Phase 4: the app parses only enough of the body to build
  `McpCallContext.method` for the DTO, then hands the raw body to `MockMcpAdapter.relay`,
  which does the real parsing. `GET`/`DELETE` handlers are explicit rather than relying on
  Starlette's automatic 405-on-path-match-wrong-method behavior, so the 405 is asserted by an
  actual handler rather than a framework default a future refactor could silently change.

## Phase 6 — Compose wiring

- [x] `api/oss/src/utils/env.py`: add `MockGatewaysConfig` (`llm_url`, `mcp_url`, defaults
      pointing at the compose service names) and register it on `EnvironSettings`, following
      `ComposioConfig`'s shape exactly (lines 685–704).
- [x] `hosting/docker-compose/oss/docker-compose.dev.yml`: add `mock-llm-gateway` and
      `mock-mcp-gateway` services, reusing `agenta-oss-dev-api:latest` with an overridden
      `command`, always-on (no profile gate), healthchecks on `/health`.
- [x] `hosting/docker-compose/ee/docker-compose.dev.yml`: same two services (not a license-gated
      feature).
- [x] Verify the healthcheck config against the existing profile-gated service blocks'
      indentation and section-comment style (`# === ACTIVATION`, `# === IMAGE`, etc.) so the new
      blocks read like the rest of the file.
- [x] Ruff format + check (no Python touched here, but re-run to confirm the phase-4/5 files
      still pass after any last edit); fix.
- [x] Commit: "wp5: wire mocks into the local compose stack".

  Judgment calls: (1) `EnvironSettings.mock_gateways` is the attribute name — the file's own
  convention is strict alphabetical ordering by attribute name (not "next to composio" as the
  spec's prose suggested; that prose predates several intervening alphabetical insertions), so
  it landed between `docker` and `identity`, not next to `composio`. (2) The EE compose block
  uses `agenta-ee-dev-api:latest`, not the `agenta-oss-dev-api:latest` the spec's snippet shows
  literally in both places — EE's own `.api` anchor builds that image, and it already carries
  `api/oss/src` mounted the same way (`api/ee/docker/Dockerfile.dev` copies both `api/ee` and
  `api/oss`), so the mock apps import identically from either image. (3) Compose service
  placement: inserted as an always-on block immediately before the profile-gated `composio`
  block in both files (after `supertokens` in OSS, after `stripe` in EE) — grouped with the
  other unconditional infrastructure rather than alphabetically, matching the file's existing
  service-ordering convention (app layer, then infra, then satellite processes).

## Phase 7 — `routers.py` diff and acceptance verification

- [x] `api/entrypoints/routers.py` is owned by nobody (cross-package operating rule: every WP5–
      WP9 worktree lands here, so no single package edits it directly to avoid five worktrees
      fighting over one file). **Not edited.** The two import lines are recorded below as the
      diff for whoever performs the M1 merge to apply, alongside WP7's/WP9's own registry-dict
      edits in the same wiring block:

      ```diff
      +from oss.src.core.gateways.llms.providers.mock.adapter import MockLlmAdapter
      +from oss.src.core.gateways.mcps.providers.mock.adapter import MockMcpAdapter
      ```

      Landing spot: alongside the other gateway-adapter imports at the block currently reading
      (as of this branch):

      ```python
      # GATEWAYS: core/gateways/ (entities.md). DAOs, services and routers land with
      # their owning work packages (WP1 dbs; WP6/WP7 llms; WP8/WP9 mcps).
      # from oss.src.dbs.postgres.gateways.llms.dao import LlmEndpointsDAO
      # from oss.src.dbs.postgres.gateways.mcps.dao import McpEndpointsDAO, McpGrantsDAO
      # from oss.src.core.gateways.policy.resolution import CredentialResolver
      # from oss.src.core.gateways.policy.service import GatewayPolicyService
      # from oss.src.core.gateways.llms.service import LlmGatewayService
      # from oss.src.core.gateways.mcps.service import McpGatewayService
      # from oss.src.apis.fastapi.gateways.llms.router import LlmGatewayRouter   # WP10
      # from oss.src.apis.fastapi.gateways.llms.proxy import LlmGatewayProxy     # WP6
      # from oss.src.apis.fastapi.gateways.mcps.router import McpGatewayRouter   # WP10
      ```

      The two new `MockLlmAdapter`/`MockMcpAdapter` import lines are additive to this comment
      block (uncommented, live imports), not a replacement of it — the rest stays commented
      until its owning package lands.
- [x] Acceptance verification: needs the compose stack up, so **written, not run** here
      (api/AGENTS.md test-layer rule — a check that needs the stack running is
      integration/acceptance, not unit). `oss/tests/pytest/integration/gateways/test_mock_upstreams.py`
      covers every item below; it addresses both mocks by compose service name, so it runs
      inside the network (neither mock is published to the host):
      - [x] Deploy the local stack and confirm both new services report healthy —
            `test_both_healthchecks_answer`.
      - [x] `mock-llm-gateway:9091/health` and `mock-mcp-gateway:9092/health` from inside
            the compose network; both 200 — same test.
      - [x] Forced failure end to end: `POST mock-llm-gateway:9091/v1/chat/completions` with
            `"model": "mock/error"` returns 500; `POST mock-mcp-gateway:9092/` with a
            `tools/call` body naming `fail` returns a JSON-RPC result with `isError: true` —
            `test_error_model_returns_500` and `test_failing_tool_returns_is_error_at_http_200`.
      - [x] Slow path with a short client timeout, confirming the connection is genuinely cut,
            not just an in-process `await` — `test_slow_model_hangs_past_a_short_client_timeout`
            (`httpx` timeout, asserts `httpx.TimeoutException`).
      - [x] Bonus, not in the original checklist but in specs-wp5.md's acceptance list:
            streaming produces multiple real SSE frames ending `data: [DONE]`, and MCP
            `GET`/`DELETE` both 405 — `test_echo_model_streams_sse_frames_ending_done` and
            `test_tools_list_returns_three_tools_and_get_delete_are_405`.
- [x] Ruff format + check; fix. (No Python touched in this phase — `routers.py` was not
      edited; re-ran to confirm the tree is still clean.)
- [x] Commit: "wp5: acceptance verification tests + routers.py diff recorded (not applied)".

## Definition of done

Matches `plan.md` WP5 verbatim: *"both mocks run in the local stack and can be driven to fail on
demand."* Concretely: `MockLlmAdapter`/`MockMcpAdapter` pass their unit and contract tests with
nothing running; `mock-llm-gateway`/`mock-mcp-gateway` are healthy in the local docker-compose
stack; each can be made to return a 500 (LLM) / `isError: true` (MCP) and to hang past a short
client timeout, on demand, from outside the process (a real HTTP client, not a mocked one).
