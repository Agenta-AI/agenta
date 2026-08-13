# WP7 tasks — LLM routing and model allowlist

Ordered so each item is one reviewable commit. Depends on merge **M1** — branch from M1, not the
seed commit directly. Run `ruff format` then `ruff check --fix` (from the repo root) before every
commit and fix all errors, per `api/AGENTS.md`.

## Phase 1 — `catalog.py`

- [x] `core/gateways/llms/catalog.py`: implement `standard_llm_endpoint(*, provider_key: str) ->
      Optional[LlmEndpoint]` reading `sdks/python/agenta/sdk/utils/assets.py::supported_llm_models`
      — `namespace=BUILTIN`, `slug=provider_key`, `deployment=DIRECT`, `data.model_slugs` from
      the map, `data.config` at code defaults, no `id`, no `Lifecycle`. Return `None` for a
      provider absent from the map.
- [x] Implement `standard_llm_endpoints() -> List[LlmEndpoint]`: all eleven, calling
      `standard_llm_endpoint` per key in `supported_llm_models`, unfiltered by existence.
- [x] Ruff format + check; run and fix.
- [x] Unit tests: `standard_llm_endpoint("openai")` matches the catalogue's `openai` model list
      exactly; the three `StandardProviderKind` members with no catalogue entry (`anyscale`,
      `alephalpha`, `mistralai`) and an arbitrary unknown string all return `None`;
      `standard_llm_endpoints()` returns exactly eleven entries.
- [x] Commit: "wp7: catalog.py — generated standard endpoints".

## Phase 2 — `registry.py`

- [ ] `core/gateways/llms/registry.py`: `LlmUpstreamRegistry.__init__(self, *, adapters:
      Dict[str, LlmUpstreamInterface])`, `.get(key) -> LlmUpstreamInterface` (raises on a miss —
      define and raise a typed exception, following `ProviderNotFoundError`'s shape from
      `core/gateway/connections/exceptions.py`, but in this domain's own `types.py` — do not
      import the integrations domain's exception), `.keys() -> list[str]`.
- [ ] Implement `select_upstream(provider_key: str, deployment: LlmDeploymentKind) -> str` per
      the classification table in `specs-wp7.md`: `AZURE`/`BEDROCK`/`SAGEMAKER`/`VERTEX` →
      `"translated"`; `CUSTOM` → `"passthrough"`; `DIRECT` split by the six-vs-six provider table.
      Pure function — no DAO, no vault, no I/O.
- [ ] Ruff format + check; run and fix.
- [ ] Unit tests: every `(provider, deployment)` pair in the classification table returns the
      documented key; `.get` on an unregistered key raises; `select_upstream` never imports
      anything beyond `LlmDeploymentKind` (grep-check: no `httpx`/`litellm`/DAO import in
      `registry.py`).
- [ ] Commit: "wp7: registry.py — LlmUpstreamRegistry + select_upstream".

## Phase 3 — `TranslatedLlmAdapter`

- [ ] `core/gateways/llms/providers/translated/__init__.py`.
- [ ] `core/gateways/llms/providers/translated/adapter.py`: `TranslatedLlmAdapter(
      LlmUpstreamInterface)`, implementing `relay_chat_completion` per the exact interface
      signature (same as WP6's `PassthroughLlmAdapter`).
- [ ] Model-string prefixing per `route.deployment`: `"azure/{model}"`, `"bedrock/{model}"`,
      `"sagemaker/{model}"`, `"vertex_ai/{model}"`; `DIRECT` non-OpenAI-shaped providers use
      `route.model` as-is (already prefixed by the catalogue).
- [ ] Credential kwargs: dispatch on `credential.secret.kind`
      (`StandardProviderKind`/`CustomProviderKind`), mirroring
      `sdks/python/agenta/sdk/managers/secrets.py::get_provider_settings` STEP 4 exactly — merge
      `CustomProviderDTO.provider.extras` into the litellm kwargs dict; pull `api_version` from
      `route.api_version` (Azure) and `region` from `route.region` (Bedrock/Vertex), never from
      the secret.
- [ ] Call `litellm.acompletion(model=..., **kwargs, stream=context.stream)`; wrap the response
      (or async stream) into an `AsyncIterator[bytes]` of OpenAI-shaped SSE-framed chunks for
      `LlmRelayResult.body`.
- [ ] Populate `GatewayUsage` from `response.usage` and a cost figure (`litellm.cost_calculator`
      or the response's own hidden cost param) — never leave `cost=None` on a successful call.
- [ ] Catch litellm's exceptions and re-raise `LlmUpstreamError(provider_key=...,
      status_code=<if present>, detail=str(exc))`.
- [ ] Ruff format + check; run and fix.
- [ ] Unit tests, `litellm.acompletion` monkeypatched (no real network): `StandardProviderDTO`
      credential passes `api_key`; `CustomProviderDTO` credential merges `extras`; `AZURE` prefix
      + `api_version` passed; `BEDROCK`/`VERTEX` pass `region`; a raised exception from the mock
      becomes `LlmUpstreamError`; usage/cost populated on a successful mocked response.
- [ ] Commit: "wp7: TranslatedLlmAdapter".

## Phase 4 — Contract test extension

- [ ] Extend WP5's `test_fake_adapters_contract.py` fixture to include `TranslatedLlmAdapter`
      (litellm mocked), asserting `relay_chat_completion` returns `LlmRelayResult`.
- [ ] Ruff format + check; run and fix.
- [ ] Commit: "wp7: translated adapter joins the south-port contract suite".

## Phase 5 — `LlmGatewayService` management surface

- [ ] `core/gateways/llms/service.py`: `LlmGatewayService.__init__(self, *, llm_endpoints_dao,
      policy, resolver, upstream_registry)` — **exactly this, unchanged**. R2 settled the
      vault-access gap by adding `available_provider_keys` to the resolver port instead of a
      dependency here; do not add `vault_service`.
- [ ] Implement `create_endpoint`, `fetch_endpoint`, `edit_endpoint`, `delete_endpoint`,
      `query_endpoints` as thin delegations to `llm_endpoints_dao`.
- [ ] Implement `list_endpoints`: intersect `standard_llm_endpoints()` with
      `await self.resolver.available_provider_keys(scope=scope)` (WP2 implements it; it returns
      names only and never raises for an empty project), plus
      `query_endpoints(project_id=project_id)`'s full result — no duplicates, no `builtin` entry
      for a provider with no key.
- [ ] Ruff format + check; run and fix.
- [ ] Unit tests: `list_endpoints` with a stubbed resolver whose `available_provider_keys`
      returns two provider keys yields exactly those two `builtin` entries plus every custom
      row; an empty set yields custom rows only, with no exception; `create_endpoint`/
      `fetch_endpoint`/`edit_endpoint`/`delete_endpoint`/`query_endpoints` each delegate to the
      stubbed DAO with the arguments unchanged.
- [ ] The resolver test double in this package's tests must implement **both** port methods —
      `resolve` and `available_provider_keys`.
- [ ] Commit: "wp7: LlmGatewayService management surface".

## Phase 5b — `list_models` (R3)

- [ ] Implement `async def list_models(self, *, scope, namespace, name) -> List[str]`:
      `_resolve_target` as the relay does, `policy.authorize` with
      `Permission.USE_LLM_ENDPOINTS`, then return the target's `model_slugs` — the static
      catalogue's for `builtin`, the row's for `custom`.
- [ ] Resolve no credential and call no upstream. It answers from the allowlist, so a harness
      that lists before calling sees exactly what policy will allow.
- [ ] Return `List[str]`; invent no response DTO — WP6's proxy shapes the OpenAI body inline
      because the data plane has no wire models (§6).
- [ ] Unit tests: a `custom` endpoint with `model_slugs: ["a", "b"]` returns exactly those; a
      `builtin` provider returns the catalogue's slugs verbatim (litellm prefixes intact, not
      re-derived); an unknown name raises `LlmEndpointNotFoundError`; a denied decision raises
      `PolicyDeniedError` before any slug is read.
- [ ] Commit: "wp7: LlmGatewayService.list_models".

## Phase 6 — `LlmGatewayService.relay_chat_completion`

- [ ] Implement `_resolve_target`: look up a row via `fetch_endpoint_by_slug` for `CUSTOM`, or
      `catalog.standard_llm_endpoint` for `BUILTIN`; raise `LlmEndpointNotFoundError` when
      neither answers.
- [ ] Implement the allowlist check (`_check_allowlist`): a `CUSTOM` target refuses a `model` not
      in `data.model_slugs` (including the empty-list-refuses-everything case, D20); a `BUILTIN`
      target refuses a `model` not in the catalogue's `model_slugs` for that provider. Raise
      `LlmModelNotAllowedError` before any credential lookup.
- [ ] Implement the ceiling check (`_check_ceilings`): compare the request's
      `max_output_tokens` (if present in the body) against `target.config.max_output_tokens`;
      raise `CeilingExceededError(ceiling="max_output_tokens", requested=..., allowed=...,
      target=...)` on a breach — reject, never clamp (D25).
- [ ] Wire `self.policy.authorize(scope=..., permission=Permission.USE_LLM_ENDPOINTS,
      target=...)`; on `not decision.allowed`, call `self.policy.record(...)` **then** raise
      `PolicyDeniedError` — denial recorded before the exception leaves.
- [ ] Wire `self.resolver.resolve(scope=..., ref=target.credential_ref(),
      mode=CredentialMode.PROJECT_ONLY)`, skipped for `GatewayAuthScheme.NONE` targets (the
      fakes).
- [ ] Wire adapter selection: `self.upstream_registry.get(select_upstream(target.provider_key,
      target.deployment)).relay_chat_completion(...)`.
- [ ] Implement the streaming-aware audit wrapper: wrap a streaming `LlmRelayResult.body` in a
      generator whose `finally` calls `self.policy.record(...)` with the usage read off the
      exhausted adapter result; call `policy.record` directly (not wrapped) for a non-streaming
      result.
- [ ] Ruff format + check; run and fix.
- [ ] Unit tests against stubbed DAO/policy/resolver/registry (no real adapters, no compose):
      allowlist check runs and raises before `resolver.resolve` is called (assert the resolver
      stub's call count is 0 on a rejected model); a policy denial calls `policy.record` exactly
      once before the exception propagates; a ceiling breach names all three values; a
      successful streaming call's `policy.record` fires only once the returned iterator is fully
      consumed (assert via a spy with an interleaved partial read).
- [ ] Commit: "wp7: LlmGatewayService.relay_chat_completion".

## Phase 7 — Wiring

- [ ] `api/entrypoints/routers.py`: construct `llm_gateway_service = LlmGatewayService(...)` per
      the diff in `specs-wp7.md`, with the `upstream_registry` dict entries for `"passthrough"`,
      `"translated"`, `"fake"` — coordinate with WP5's and WP6's import lines landing in the same
      block at the M1→M2 merge.
- [ ] If the litellm-as-direct-dependency question (flagged in "Missing from the design") is
      resolved in favor of adding it: `api/pyproject.toml` gets the `litellm` line, matching the
      SDK's own pin (`litellm>=1,<2`).
- [ ] Ruff format + check; run and fix.
- [ ] Commit: "wp7: wire LlmGatewayService into the entrypoint".

## Phase 8 — Acceptance (post-M2, once WP1/WP5/WP6 are merged)

- [ ] Deploy the local stack with WP1/WP2/WP3/WP5/WP6/WP7 all merged.
- [ ] Seed a custom endpoint with a narrow `model_slugs` list; confirm a request for a model
      outside it is refused `model_not_allowed` with no upstream call made (verifiable against
      WP5's fake — the fake sees no inbound request at all).
- [ ] Confirm every `DIRECT` provider in `supported_llm_models` maps to the documented adapter key
      via `select_upstream` (a scripted check, not a real call — CI has no provider keys).
- [ ] Ruff format + check; fix.
- [ ] Commit: "wp7: acceptance verification".

## Definition of done

Matches `plan.md` WP7 verbatim: *"every provider and deployment pair reachable today is reachable
through the gateway, including the cloud-reseller shapes, and a model outside a custom endpoint's
list is refused."* Concretely: `catalog.py`, `registry.py`, `TranslatedLlmAdapter` and
`LlmGatewayService.relay_chat_completion` all pass their unit and contract tests with nothing
running; `select_upstream` classifies every provider/deployment pair in the design's known set;
and, once WP1/WP5/WP6 are available, a request outside a custom endpoint's `model_slugs` is
refused before any credential is resolved or any upstream call is attempted.
