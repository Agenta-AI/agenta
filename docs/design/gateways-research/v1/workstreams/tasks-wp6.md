# WP6 tasks — LLM ingress and relay

Ordered so each item is one reviewable commit. Depends on merge **M1** (WP1 + WP2 + WP3 landed on
the base branch) — branch from M1, not from the seed commit directly, so `LlmGatewayService`'s
constructor and `CredentialResolverInterface` are real rather than raising
`NotImplementedError`. Run `ruff format` then `ruff check --fix` (from the repo root) before every
commit and fix all errors, per `api/AGENTS.md`.

## Phase 1 — `parse_llm_call_context`

- [ ] `apis/fastapi/gateways/llms/utils.py`: implement `parse_llm_call_context(*, body: bytes) ->
      LlmCallContext` — `json.loads(body)`, extract `model`/`stream`, raise `ValueError` when
      `model` is absent. No other parsing, no re-serialization.
- [ ] Ruff format + check; run and fix.
- [ ] Unit tests: representative bodies (streaming, non-streaming, missing model) — the missing-
      model case asserts `ValueError`, not a swallowed default.
- [ ] Commit: "wp6: parse_llm_call_context".

## Phase 2 — `PassthroughLlmAdapter`

- [ ] `core/gateways/llms/providers/passthrough/__init__.py`.
- [ ] `core/gateways/llms/providers/passthrough/adapter.py`: `PassthroughLlmAdapter(
      LlmUpstreamInterface)`, implementing `relay_chat_completion` per `entities.md` §7.1's exact
      signature.
- [ ] Build the outbound URL: `route.base_url` + `/chat/completions`, merging `route.headers`
      (non-secret routing headers) into the outbound header set.
- [ ] Dispatch credential injection on `credential.secret.kind`: `StandardProviderKind` →
      `Authorization: Bearer {credential.secret.data.provider.key}`
      (`core/secrets/dtos.py::StandardProviderDTO`); `CustomProviderKind` → the same header from
      `credential.secret.data.provider.key`, with `provider.extras` merged into outbound headers
      only (never the body) (`CustomProviderDTO`). `credential=None` sends no `Authorization`
      header.
- [ ] Enforce a per-call timeout from `route.config.timeout_seconds`, falling back to this
      package's own default constant (documented inline) when `None`. On timeout, raise
      `LlmUpstreamError(provider_key=route.provider_key, status_code=None, detail="upstream timed
      out")`.
- [ ] Relay `body` untouched — no `json.loads`/`json.dumps` round trip anywhere in this method;
      forward the exact `bytes` object.
- [ ] On any non-timeout transport failure, raise `LlmUpstreamError` carrying the upstream's own
      status code when one was received.
- [ ] Populate `LlmRelayResult.usage` from the upstream's own usage field when present in a
      non-streaming response body, else leave `None` (never guess).
- [ ] Ruff format + check; run and fix.
- [ ] Unit tests against `httpx.MockTransport` (no real socket): auth header injection for both
      secret kinds and for `credential=None`; outbound URL construction; timeout raises
      `LlmUpstreamError`; a non-timeout 5xx raises `LlmUpstreamError` carrying that status code;
      the request body bytes reaching the transport are identical (`==`) to the input `body`.
- [ ] Commit: "wp6: PassthroughLlmAdapter".

## Phase 3 — Contract test extension

- [ ] Extend WP5's `test_fake_adapters_contract.py` fixture (or the equivalent file if WP5 named
      it differently — check before assuming) to include `PassthroughLlmAdapter` against
      `httpx.MockTransport`, asserting `relay_chat_completion` returns `LlmRelayResult` for every
      case exercised in Phase 2.
- [ ] Ruff format + check; run and fix.
- [ ] Commit: "wp6: passthrough adapter joins the south-port contract suite".

## Phase 4 — `LlmGatewayProxy`

- [ ] `apis/fastapi/gateways/llms/proxy.py`: `LlmGatewayProxy.__init__(self, *,
      llm_gateway_service: LlmGatewayService)`, four routes exactly as `entities.md` §9
      (`llm_gateway_chat_completions_builtin`, `..._custom`, `llm_gateway_list_models_builtin`,
      `..._custom`), no wire models.
- [ ] Implement `chat_completions_builtin`/`chat_completions_custom`: `get_auth_scope()`, read
      `await request.body()`, strip inbound authorization headers, call
      `self.service.relay_chat_completion(scope=..., namespace=..., name=..., body=..., headers=...)`.
- [ ] Non-streaming path: `chunk = await anext(result.body)`, return a plain `Response` with
      `result.status_code`/`result.headers`.
- [ ] Streaming path (`context.stream` from `parse_llm_call_context`): `StreamingResponse(
      result.body, status_code=result.status_code, headers=result.headers,
      media_type="text/event-stream")`. Do not wrap this in a local `try/finally` calling into
      policy — confirm `LlmGatewayProxy` never receives a `GatewayPolicyService` reference (only
      `llm_gateway_service`); if WP7's service does not already fire `policy.record` on iterator
      exhaustion internally, that is a WP7 spec bug to raise, not something to patch here.
- [ ] Implement the OpenAI-shaped error envelope (`{"error": {"message", "type", "code"}}`) for
      the domain exceptions already declared in `core/gateways/llms/types.py` and
      `core/gateways/policy/types.py` (seed-owned, real today): `PolicyDeniedError` /
      `EntitlementDeniedError` → 403 `policy_denied`; `LlmModelNotAllowedError` → 403
      `model_not_allowed`; `CeilingExceededError` → 400 `ceiling_exceeded` (body names the
      ceiling, requested, allowed per D25); `CredentialNotFoundError` /
      `LlmEndpointNotFoundError` → 404 `credential_missing` / `endpoint_not_found`;
      `LlmUpstreamError` → 424, or 502 when `status_code >= 500`.
- [ ] `list_models_builtin`/`list_models_custom`: **unblocked (R3)** — call
      `self.service.list_models(scope=..., namespace=..., name=...)`, which returns
      `List[str]`, and shape the OpenAI list body inline (`{"object": "list", "data":
      [{"id": s, "object": "model"} for s in slugs]}`). No wire model — the data plane
      has none (§6). WP7 owns the method; code against its declaration.
- [ ] Ruff format + check; run and fix.
- [ ] Unit tests: `chat_completions_custom` against a stubbed `LlmGatewayService` (a
      `unittest.mock`/hand-written fake service, not WP5's fixture — this is testing the proxy in
      isolation): each domain exception the service might raise maps to the documented status
      code and `code` string; a successful non-streaming call returns the single chunk verbatim;
      a successful streaming call passes `result.body` through `StreamingResponse` untouched.
- [ ] Commit: "wp6: LlmGatewayProxy".

## Phase 5 — Wiring

- [ ] `api/entrypoints/routers.py`: add the `PassthroughLlmAdapter` import, the `LlmGatewayProxy`
      import, construct `llm_gateway_proxy = LlmGatewayProxy(llm_gateway_service=...)`, and mount
      `app.include_router(router=llm_gateway_proxy.router, prefix="/gateways/llms",
      include_in_schema=False)` — per the diff in `specs-wp6.md`. Do not add the
      `upstream_registry` dict entry; that line belongs to WP7's edit of the same construction
      block — coordinate at the merge, do not pre-empt it.
- [ ] Ruff format + check; run and fix.
- [ ] Commit: "wp6: mount the LLM proxy router".

## Phase 6 — Acceptance (post-M2, once WP5/WP7 are merged)

- [ ] Deploy the local stack with WP1/WP2/WP3/WP5/WP7 all merged.
- [ ] Seed (or confirm WP5/WP10 seeded) a custom LLM endpoint pointing at
      `fake-llm-gateway`'s URL.
- [ ] Streamed request round-trips byte for byte (diff the SSE bytes, not a re-decoded
      equivalence).
- [ ] `fake/slow-30` with a short `config.timeout_seconds` returns before 30s elapse.
- [ ] An unauthenticated request never reaches the fake (assert via the fake's own request log
      or absence of any inbound connection).
- [ ] A model outside `model_slugs` is refused with `model_not_allowed` before any credential is
      resolved.
- [ ] Ruff format + check; fix.
- [ ] Commit: "wp6: acceptance verification against the fake".

## Definition of done

Matches `plan.md` WP6 verbatim: *"a streamed response is relayed unmodified and a hung upstream
times out rather than hanging the gateway."* Concretely: `PassthroughLlmAdapter`'s unit and
contract tests pass with nothing running; `LlmGatewayProxy`'s unit tests pass against a stubbed
service; and, once WP5/WP7 are available, a real streamed SSE response from the fake reaches a
`curl` client byte-identical to what the fake sent, and a `fake/slow-N` request beyond the
endpoint's configured timeout returns an error inside that timeout window rather than hanging the
gateway process.
