# WP6 tasks — LLM ingress and relay

Ordered so each item is one reviewable commit. Depends on merge **M1** (WP1 + WP2 + WP3 landed on
the base branch) — branch from M1, not from the seed commit directly, so `LLMGatewayService`'s
constructor and `SecretsResolverInterface` are real rather than raising
`NotImplementedError`. Run `ruff format` then `ruff check --fix` (from the repo root) before every
commit and fix all errors, per `api/AGENTS.md`.

## Phase 1 — `parse_llm_call_context`

- [x] `apis/fastapi/gateways/llms/utils.py`: implement `parse_llm_call_context(*, body: bytes) ->
      LLMCallContext` — `json.loads(body)`, extract `model`/`stream`, raise `ValueError` when
      `model` is absent. No other parsing, no re-serialization.
- [x] Ruff format + check; run and fix.
- [x] Unit tests: representative bodies (streaming, non-streaming, missing model) — the missing-
      model case asserts `ValueError`, not a swallowed default. Also: malformed JSON (asserts
      `ValueError`, free — `json.JSONDecodeError` subclasses it) and a bytes-identity check that
      parsing does not mutate or re-wrap the input.
- [x] Commit: "wp6: parse_llm_call_context" (b4b91acb98).

## Phase 2 — `PassthroughLLMAdapter`

- [x] `core/gateways/llms/providers/passthrough/__init__.py`.
- [x] `core/gateways/llms/providers/passthrough/adapter.py`: `PassthroughLLMAdapter(
      LLMUpstreamInterface)`, implementing `relay_chat_completion` per `entities.md` §7.1's exact
      signature.
- [x] Build the outbound URL: `route.base_url` + `/chat/completions`, merging `route.headers`
      (non-secret routing headers) into the outbound header set.
- [x] Dispatch secret injection on `secret.secret.kind`: `SecretKind.PROVIDER_KEY` →
      `Authorization: Bearer {secret.secret.data.provider.key}`
      (`core/secrets/dtos.py::StandardProviderDTO`); `SecretKind.CUSTOM_PROVIDER` → the same header
      from `secret.secret.data.provider.key`, with `provider.extras` merged into outbound
      headers only (never the body) (`CustomProviderDTO`). `secret=None` sends no
      `Authorization` header. (The checklist named the dispatch `StandardProviderKind` /
      `CustomProviderKind` — those are the inner *provider-family* enums, e.g. `openai`; the
      outer dispatch that actually selects which `SecretDTO` union member is present is
      `SecretResponseDTO.kind: SecretKind`, so the code branches on `SecretKind.PROVIDER_KEY` /
      `SecretKind.CUSTOM_PROVIDER` — same two cases the checklist meant, precise names.)
- [x] Enforce a per-call timeout from `route.config.timeout_seconds`, falling back to this
      package's own default constant (documented inline) when `None`. On timeout, raise
      `LLMUpstreamError(provider_key=route.provider_key, status_code=None, detail="upstream timed
      out")`.
- [x] Relay `body` untouched — no `json.loads`/`json.dumps` round trip anywhere in this method;
      forward the exact `bytes` object. (The upstream *response* body is separately parsed once,
      read-only, to lift `usage` for the audit record — the bytes handed back to the caller are
      never reconstructed from that parse; see the `usage` bullet below.)
- [x] On any non-timeout transport failure, raise `LLMUpstreamError` carrying the upstream's own
      status code when one was received. Extended one step further than the checklist's literal
      wording: a *received* 5xx response (not just a transport-level failure) also raises
      `LLMUpstreamError` carrying that status code — matching the Tests bullet below ("a
      non-timeout 5xx raises `LLMUpstreamError`") and the 424/502 split
      `apis/fastapi/gateways/exceptions.py` already encodes. 2xx/3xx/4xx respond as an ordinary
      `LLMRelayResult`, passed through untouched (the upstream's own client-error body is not our
      failure to report).
- [x] Populate `LLMRelayResult.usage` from the upstream's own usage field when present in a
      non-streaming response body, else leave `None` (never guess). Streaming responses always
      leave `usage=None` here too — the trailing SSE usage frame is not reassembled — per §7.1's
      "usage is populated ... once `body` is exhausted", which the streaming leg does not do.
- [x] Ruff format + check; run and fix.
- [x] Unit tests against `httpx.MockTransport` (no real socket): auth header injection for both
      secret kinds and for `secret=None`; outbound URL construction; timeout raises
      `LLMUpstreamError`; a non-timeout 5xx raises `LLMUpstreamError` carrying that status code;
      the request body bytes reaching the transport are identical (`==`) to the input `body`. Also:
      inbound `Authorization` is not forwarded; a connection failure (not just a timeout) also
      raises `LLMUpstreamError`; a 4xx passes through untouched as a normal result; route headers
      merge into the outbound set; a missing `route.base_url` raises `LLMUpstreamError` rather than
      crashing on `None + str`; the configured timeout (and the default, when unset) reach the
      built `httpx.Request`'s extensions. 16 tests, all passing.
- [x] Commit: "wp6: PassthroughLLMAdapter" (94eab6baa8).

## Phase 3 — Contract test extension

- [x] Extend WP5's `test_mock_adapters_contract.py` fixture to include `PassthroughLLMAdapter`
      against `httpx.MockTransport`, asserting `relay_chat_completion` returns `LLMRelayResult` for
      every case exercised in Phase 2. The adapter needs real network I/O, so — unlike the file's
      generic `_optional_instance()` no-arg construction — it is built through a dedicated
      `_passthrough_llm_adapter()` helper that wires an `httpx.MockTransport`-backed client;
      `test_relay_chat_completion_returns_llm_relay_result`'s shared `route` fixture gained a
      `base_url` (inert for `MockLLMAdapter`, required for `PassthroughLLMAdapter`'s URL builder).
- [x] Ruff format + check; run and fix.
- [x] Commit: "wp6: passthrough adapter joins the south-port contract suite" (6760fc5949).

## Phase 4 — `LLMGatewayProxy`

- [x] `apis/fastapi/gateways/llms/proxy.py`: `LLMGatewayProxy.__init__(self, *,
      llm_gateway_service: LLMGatewayService)`, four routes exactly as `entities.md` §9
      (`llm_gateway_chat_completions_builtin`, `..._custom`, `llm_gateway_list_models_builtin`,
      `..._custom`), no wire models. `LLMGatewayService` itself is WP7's and does not exist on this
      branch yet, so the parameter is typed against a `TYPE_CHECKING`-only import — real at type-
      check time once WP7 lands, harmless (never executed) until then.
- [x] Implement `chat_completions_builtin`/`chat_completions_custom`: `get_auth_scope()`, read
      `await request.body()`, strip inbound authorization headers, call
      `self.service.relay_chat_completion(scope=..., namespace=..., name=..., body=..., headers=...)`.
- [x] Non-streaming path: `chunk = await anext(result.body)`, return a plain `Response` with
      `result.status_code`/`result.headers`.
- [x] Streaming path (`context.stream` from `parse_llm_call_context`): `StreamingResponse(
      result.body, status_code=result.status_code, headers=result.headers,
      media_type="text/event-stream")`. No local `try/finally` calling into policy —
      `LLMGatewayProxy` holds only `llm_gateway_service`, confirmed by its constructor signature.
- [x] Implement the OpenAI-shaped error envelope (`{"error": {"message", "type", "code"}}`) for
      the domain exceptions already declared in `core/gateways/llms/types.py` and
      `core/gateways/policy/types.py` (seed-owned, real today): `PolicyDeniedError` /
      `EntitlementDeniedError` → 403 `policy_denied`; `LLMModelNotAllowedError` → 403
      `model_not_allowed`; `CeilingExceededError` → 400 `ceiling_exceeded` (body names the
      ceiling, requested, allowed per D25); `SecretNotFoundError` /
      `LLMEndpointNotFoundError` → 404 `secret_missing` / `endpoint_not_found`;
      `LLMUpstreamError` → 424, or 502 when `status_code >= 500`. Built as this file's own mapping
      function (`_map_domain_exception`), NOT via the seed's `handle_gateway_exceptions()` —
      that decorator collapses causes sharing one HTTP status into a bare `detail` string (e.g.
      `LLMEndpointNotFoundError` and `SecretNotFoundError` both land on 404), which cannot
      reproduce the two distinct `code` values this surface's contract requires. Judgment call;
      flagged in the package report. Also added: `ValueError` from `parse_llm_call_context`
      (missing/invalid model) → 400 `invalid_request` (the utils.py docstring's "surface's own
      invalid-request error shape", not itself one of the four named codes but required to keep
      that promise); and a response-header filter (`_response_headers`) stripping
      `content-length`/`content-encoding`/`transfer-encoding`/`connection`/`keep-alive` from the
      upstream's headers before they reach our own `Response`/`StreamingResponse` — ASGI computes
      its own framing headers, and forwarding the upstream's stale `content-length` verbatim (wrong
      once httpx has decoded the body) would corrupt the response. Not in the original checklist;
      added because it is required for HTTP correctness, flagged in the package report.
- [x] `list_models_builtin`/`list_models_custom`: **unblocked (R3)** — call
      `self.service.list_models(scope=..., namespace=..., name=...)`, which returns
      `List[str]`, and shape the OpenAI list body inline (`{"object": "list", "data":
      [{"id": s, "object": "model"} for s in slugs]}`). No wire model — the data plane
      has none (§6). WP7 owns the method; code against its declaration.
- [x] Ruff format + check; run and fix.
- [x] Unit tests: `chat_completions_custom`/`_builtin` and `list_models_*` against a hand-written
      mock `LLMGatewayService` (not WP5's fixture — this is testing the proxy in isolation), driven
      through a `starlette.requests.Request` built from a raw ASGI scope (no HTTP server): every
      documented domain exception maps to its status code and `code` string (parametrized, 9
      cases incl. both 5xx→502/4xx-and-None→424 `LLMUpstreamError` splits); a successful
      non-streaming call returns the single chunk verbatim; a successful streaming call passes
      `result.body` through `StreamingResponse` untouched; namespace/name routing per route;
      inbound `Authorization` never reaches the service; the missing-model `ValueError` path never
      calls the service at all; the response-header filter drops a stale upstream `content-length`.
      20 tests, all passing.
- [x] Commit: "wp6: LLMGatewayProxy" (0b507d58e9).

## Phase 5 — Wiring

**Not applied by this package.** The orchestrating brief for this worktree overrides this
phase's original instruction to edit the file directly: *"`api/entrypoints/routers.py` is
owned by nobody... Write your additions as a diff inside `tasks-wp6.md`; do NOT edit that
file."* That instruction is also the only workable one here — `llm_gateway_service` does
not exist as a variable in `routers.py` yet (WP7's `core/gateways/llms/service.py` is not
on this branch), so `LLMGatewayProxy(llm_gateway_service=llm_gateway_service)` cannot
actually be constructed today. The diff below is this package's contribution to the M2
merge, to be applied once WP7's service lands (by WP7, or whoever resolves the merge) —
not a commit made in this worktree.

- [x] Diff drafted and recorded below (this file). Not applied to `api/entrypoints/routers.py`.
- [x] Nothing to ruff/commit for this phase — no source file changed.

```diff
--- a/api/entrypoints/routers.py
+++ b/api/entrypoints/routers.py
@@ -166,7 +166,8 @@
 # GATEWAYS: core/gateways/ (entities.md). The planes' services and routers land with
 # their owning work packages (WP6/WP7 llms; WP8/WP9 mcps; WP10 CRUD).
 from oss.src.dbs.postgres.gateways.llms.dao import LLMEndpointsDAO
 from oss.src.dbs.postgres.gateways.mcps.dao import MCPEndpointsDAO
 from oss.src.core.gateways.policy.resolution import SecretsResolver
 from oss.src.core.gateways.policy.service import GatewayPolicyService
+from oss.src.core.gateways.llms.providers.passthrough.adapter import PassthroughLLMAdapter

 # The mock adapters (WP5) are registered into the plane registries, which WP7 and WP9
 # own and which do not exist yet — so their imports land with those, not here.
 # from oss.src.core.gateways.llms.providers.mock.adapter import MockLLMAdapter
 # from oss.src.core.gateways.mcps.providers.mock.adapter import MockMCPAdapter
-# from oss.src.core.gateways.llms.service import LLMGatewayService
+from oss.src.core.gateways.llms.service import LLMGatewayService              # WP7
 # from oss.src.core.gateways.mcps.service import MCPGatewayService
 # from oss.src.apis.fastapi.gateways.llms.router import LLMGatewayRouter   # WP10
-# from oss.src.apis.fastapi.gateways.llms.proxy import LLMGatewayProxy     # WP6
+from oss.src.apis.fastapi.gateways.llms.proxy import LLMGatewayProxy          # WP6
 # from oss.src.apis.fastapi.gateways.mcps.router import MCPGatewayRouter   # WP10
 # from oss.src.apis.fastapi.gateways.mcps.proxy import MCPGatewayProxy     # WP8
@@ -1085,6 +1087,14 @@
 gateway_policy_service = GatewayPolicyService(resolver=secret_resolver)

+# WP7's construction line (shown for context — not this package's edit):
+# llm_gateway_service = LLMGatewayService(
+#     endpoints_dao=llm_endpoints_dao,
+#     resolver=secret_resolver,
+#     policy=gateway_policy_service,
+#     upstream_registry=LLMUpstreamRegistry(adapters={"passthrough": PassthroughLLMAdapter(), ...}),
+# )
+llm_gateway_proxy = LLMGatewayProxy(llm_gateway_service=llm_gateway_service)
+
 simple_traces = SimpleTracesRouter(
     simple_traces_service=simple_traces_service,
 )
@@ -1514,7 +1524,7 @@
 # GATEWAYS: nothing mounted yet — each line lands with its owning package
 # (entities.md §9 "Wiring"). Two router OBJECTS per plane, not one with two
 # attributes: management CRUD and the data plane are separate (§1).
 # app.include_router(router=llm_gateway.router, prefix="/gateways/llms", tags=["Gateway: LLM"])
-# app.include_router(router=llm_gateway.proxy,  prefix="/gateways/llms", include_in_schema=False)
+app.include_router(router=llm_gateway_proxy.router, prefix="/gateways/llms", include_in_schema=False)
 # app.include_router(router=mcp_gateway.router, prefix="/gateways/mcps", tags=["Gateway: MCP"])
 # app.include_router(router=mcp_gateway.proxy,  prefix="/gateways/mcps", include_in_schema=False)
```

Notes for whoever applies this at the merge:
- The `upstream_registry=LLMUpstreamRegistry(adapters={"passthrough": PassthroughLLMAdapter(), ...})`
  entry is WP7's edit inside its own `LLMGatewayService(...)` construction call, shown above only
  as context (commented) — WP6 contributes the `PassthroughLLMAdapter` import and the registry
  *value*, not the line that constructs the registry or the service.
- `llm_gateway_proxy.router` replaces the placeholder `llm_gateway.proxy` name from the original
  comment — `entities.md` §9's own snippet names the combined object `llm_gateway` with `.router`/
  `.proxy` attributes; this package's actual classes are two separate objects
  (`LLMGatewayRouter`/`LLMGatewayProxy`, per the "two router OBJECTS per plane, not one with two
  attributes" comment already in the file), so the mount line uses `llm_gateway_proxy.router`.
  WP10's `LLMGatewayRouter` mount is a separate, WP10-owned line, not part of this diff.

## Phase 6 — Acceptance (post-M2, once WP5/WP7 are merged)

Per this worktree's own task brief, rule 5: acceptance tests need a running deployment, which
this worktree does not have — write them, do not run them. `oss/tests/pytest/acceptance/gateways/
test_llm_gateway_proxy_acceptance.py` written accordingly (collection verified locally; execution
needs the full M2 deployment WP7/WP10 complete):

- [x] Deploy the local stack with WP1/WP2/WP3/WP5/WP7 all merged — documented in the test
      module's docstring as the manual run instructions; not performed by this package.
- [x] Seed a custom LLM endpoint pointing at `mock-llm-gateway`'s URL — `mock_llm_endpoint`
      fixture (class-scoped), POSTing `LLMEndpointCreateRequest`'s wire shape (§6) at
      `POST /gateways/llms/endpoints/` (WP10's route, not yet built either — written against its
      declared shape).
- [x] Streamed request round-trips byte for byte (diff the SSE bytes, not a re-decoded
      equivalence) — `test_streaming_round_trips_sse_bytes_unmodified`, asserting on
      `response.content` directly (the raw bytes), not a JSON-decoded reconstruction.
- [x] `mock/slow-30` with a short `config.timeout_seconds` returns before 30s elapse —
      `test_slow_upstream_times_out_inside_the_configured_window_not_at_30s`, timed with
      `time.monotonic()`, asserting `elapsed < 30` and an `upstream_error` response rather than a
      hang.
- [x] An unauthenticated request never reaches the mock — `test_unauthenticated_request_never_reaches_the_mock`,
      asserting the auth middleware's 401 (D13: rejected before any router runs); this suite has
      no direct handle on the mock's own request log, so it asserts the platform boundary instead,
      noted inline as the precision this test can actually offer.
- [x] A model outside the allowlist is refused with `model_not_allowed` before any secret is
      resolved — `test_model_outside_allowlist_is_refused_with_model_not_allowed`. (Secret-
      resolution-order is WP7's `relay_chat_completion` body, §8 — not independently observable
      from this HTTP-only suite; the test asserts the outcome the ordering guarantees.)
- [x] Extra, beyond the checklist: `test_non_streaming_call_returns_the_mocks_completion_body`
      (the non-streaming leg) and `test_list_models_answers_the_endpoints_allowlist` (`GET
      .../v1/models`, R3) — both named in specs-wp6.md's contract but not called out as separate
      Phase 6 bullets.
- [x] Ruff format + check; fix.
- [x] Commit: "wp6: write acceptance tests against the mock (not run)".

## Definition of done

Matches `plan.md` WP6 verbatim: *"a streamed response is relayed unmodified and a hung upstream
times out rather than hanging the gateway."* Concretely: `PassthroughLLMAdapter`'s unit and
contract tests pass with nothing running (16 + 1 tests); `LLMGatewayProxy`'s unit tests pass
against a stubbed service (20 tests); and, once WP5/WP7/WP10 are merged and deployed, the written
(not yet run) acceptance suite exercises a real streamed SSE response from the mock reaching a
client byte-identical to what the mock sent, and a `mock/slow-N` request beyond the endpoint's
configured timeout returning an error inside that timeout window rather than hanging the gateway
process.
