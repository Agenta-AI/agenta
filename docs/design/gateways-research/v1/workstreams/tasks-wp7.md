# WP7 tasks — LLM routing and model allowlist

Ordered so each item is one reviewable commit. Depends on merge **M1** — branch from M1, not the
seed commit directly. Run `ruff format` then `ruff check --fix` (from the repo root) before every
commit and fix all errors, per `api/AGENTS.md`.

## Phase 1 — `catalog.py`

- [x] `core/gateways/llms/catalog.py`: implement `standard_llm_endpoint(*, provider_key: str) ->
      Optional[LLMEndpoint]` reading `sdks/python/agenta/sdk/utils/assets.py::supported_llm_models`
      — `namespace=BUILTIN`, `slug=provider_key`, `deployment=DIRECT`, `data.models.allowlist` from
      the map, `data.config` at code defaults, no `id`, no `Lifecycle`. Return `None` for a
      provider absent from the map.
- [x] Implement `standard_llm_endpoints() -> List[LLMEndpoint]`: all eleven, calling
      `standard_llm_endpoint` per key in `supported_llm_models`, unfiltered by existence.
- [x] Ruff format + check; run and fix.
- [x] Unit tests: `standard_llm_endpoint("openai")` matches the catalogue's `openai` model list
      exactly; the three `StandardProviderKind` members with no catalogue entry (`anyscale`,
      `alephalpha`, `mistralai`) and an arbitrary unknown string all return `None`;
      `standard_llm_endpoints()` returns exactly eleven entries.
- [x] Commit: "wp7: catalog.py — generated standard endpoints".

## Phase 2 — `registry.py`

- [x] `core/gateways/llms/registry.py`: `LLMUpstreamRegistry.__init__(self, *, adapters:
      Dict[str, LLMUpstreamInterface])`, `.get(key) -> LLMUpstreamInterface` (raises on a miss —
      define and raise a typed exception, following `ProviderNotFoundError`'s shape from
      `core/gateway/connections/exceptions.py`, but in this domain's own `types.py` — do not
      import the integrations domain's exception), `.keys() -> list[str]`.
- [x] Implement `select_upstream(provider_key: str, deployment: LLMDeploymentKind) -> str` per
      the classification table in `specs-wp7.md`: `AZURE`/`BEDROCK`/`SAGEMAKER`/`VERTEX` →
      `"translated"`; `CUSTOM` → `"passthrough"`; `DIRECT` split by the six-vs-six provider table.
      Pure function — no DAO, no vault, no I/O.
- [x] Ruff format + check; run and fix.
- [x] Unit tests: every `(provider, deployment)` pair in the classification table returns the
      documented key; `.get` on an unregistered key raises; `select_upstream` never imports
      anything beyond `LLMDeploymentKind` (grep-check: no `httpx`/`litellm`/DAO import in
      `registry.py`).
- [x] Commit: "wp7: registry.py — LLMUpstreamRegistry + select_upstream".

**Deviation, disclosed:** `select_upstream` also special-cases `provider_key == "mock"` →
`"mock"`, ahead of the deployment split. Neither `specs-wp7.md`'s table nor this phase's own
bullets state that branch; it was added mid-implementation after the coordinator flagged that
WP5's `MockLLMAdapter` import is WP7's to uncomment and register at the composition root (see the
Phase 7 diff below) — without it, nothing in the documented `select_upstream` table ever routes to
the `"mock"` registry key, which would make the mocks unreachable through the relay path in every
environment, not just contradict "registered always; reachable only via a seeded endpoint" from
`entities.md` §9's wiring comment. `core/gateways/llms/types.py` also gained one new exception,
`LLMAdapterNotFoundError` (`registry.get`'s miss) — additive only, but it is a `types.py` edit,
which rule 1 of the top-level brief lists as off-limits; this phase's own bullet explicitly
directs adding it there ("but in this domain's own `types.py`"), so the more specific instruction
was followed and the tension is flagged here rather than resolved silently.

## Phase 3 — `TranslatedLLMAdapter`

- [x] `core/gateways/llms/providers/translated/__init__.py`.
- [x] `core/gateways/llms/providers/translated/adapter.py`: `TranslatedLLMAdapter(
      LLMUpstreamInterface)`, implementing `relay_chat_completion` per the exact interface
      signature (same as WP6's `PassthroughLLMAdapter`).
- [x] Model-string prefixing per `route.deployment`: `"azure/{model}"`, `"bedrock/{model}"`,
      `"sagemaker/{model}"`, `"vertex_ai/{model}"`; `DIRECT` non-OpenAI-shaped providers use
      `route.model` as-is (already prefixed by the catalogue).
- [x] Secret kwargs: dispatch on `secret.secret.kind`
      (`StandardProviderKind`/`CustomProviderKind`), mirroring
      `sdks/python/agenta/sdk/managers/secrets.py::get_provider_settings` STEP 4 exactly — merge
      `CustomProviderDTO.provider.extras` into the litellm kwargs dict; pull `api_version` from
      `route.api_version` (Azure) and `region` from `route.region` (Bedrock/Vertex), never from
      the secret.
- [x] Call `litellm.acompletion(model=..., **kwargs, stream=context.stream)`; wrap the response
      (or async stream) into an `AsyncIterator[bytes]` of OpenAI-shaped SSE-framed chunks for
      `LLMRelayResult.body`.
- [x] Populate `GatewayUsage` from `response.usage` and a cost figure (`litellm.cost_calculator`
      or the response's own hidden cost param) — never leave `cost=None` on a successful call.
- [x] Catch litellm's exceptions and re-raise `LLMUpstreamError(provider_key=...,
      status_code=<if present>, detail=str(exc))`.
- [x] Ruff format + check; run and fix.
- [x] Unit tests, `litellm.acompletion` monkeypatched (no real network): `StandardProviderDTO`
      secret passes `api_key`; `CustomProviderDTO` secret merges `extras`; `AZURE` prefix
      + `api_version` passed; `BEDROCK`/`VERTEX` pass `region`; a raised exception from the mock
      becomes `LLMUpstreamError`; usage/cost populated on a successful mocked response.
- [x] Commit: "wp7: TranslatedLLMAdapter".

**Judgment calls:** litellm kwarg names for region are not specified anywhere in the design set —
used `aws_region_name` (Bedrock) and `vertex_location` (Vertex), litellm's own parameter names.
Streaming usage is requested via `stream_options={"include_usage": True}` (not mentioned in the
spec) because without it litellm reports no usage at all on a streamed call, which would leave
`GatewayUsage` permanently empty for every streaming call through this adapter — the interface
docstring's "the translated adapter reports the library's count" only holds with this kwarg set.

## Phase 4 — Contract test extension

- [x] Extend WP5's `test_mock_adapters_contract.py` fixture to include `TranslatedLLMAdapter`
      (litellm mocked), asserting `relay_chat_completion` returns `LLMRelayResult`.
- [x] Ruff format + check; run and fix.
- [x] Commit: "wp7: translated adapter joins the south-port contract suite".

**Note:** the fixture already parametrized `TranslatedLLMAdapter` in via `_optional_instance`
(WP5 wrote it that way so this package's landing needs no edit to the parametrize list itself).
The only gap was that the shared `test_relay_chat_completion_returns_llm_relay_result` body calls
`relay_chat_completion` unconditionally for every adapter in the list, and once
`providers/translated/adapter.py` existed that meant a real `litellm.acompletion` call with
`secret=None` unless mocked — added one `autouse` fixture that monkeypatches
`litellm.acompletion` at `translated.adapter`'s own import site (a no-op for every other adapter
since none of them import litellm).

## Phase 5 — `LLMGatewayService` management surface

- [x] `core/gateways/llms/service.py`: `LLMGatewayService.__init__(self, *, llm_endpoints_dao,
      policy, resolver, upstream_registry)` — **exactly this, unchanged**. R2 settled the
      vault-access gap by adding `available_provider_keys` to the resolver port instead of a
      dependency here; do not add `vault_service`.
- [x] Implement `create_endpoint`, `fetch_endpoint`, `edit_endpoint`, `delete_endpoint`,
      `query_endpoints` as thin delegations to `llm_endpoints_dao`.
- [x] Implement `list_endpoints`: intersect `standard_llm_endpoints()` with
      `await self.resolver.available_provider_keys(scope=scope)` (WP2 implements it; it returns
      names only and never raises for an empty project), plus
      `query_endpoints(project_id=project_id)`'s full result — no duplicates, no `builtin` entry
      for a provider with no key.
- [x] Ruff format + check; run and fix.
- [x] Unit tests: `list_endpoints` with a stubbed resolver whose `available_provider_keys`
      returns two provider keys yields exactly those two `builtin` entries plus every custom
      row; an empty set yields custom rows only, with no exception; `create_endpoint`/
      `fetch_endpoint`/`edit_endpoint`/`delete_endpoint`/`query_endpoints` each delegate to the
      stubbed DAO with the arguments unchanged.
- [x] The resolver test double in this package's tests must implement **both** port methods —
      `resolve` and `available_provider_keys`.
- [x] Commit: "wp7: LLMGatewayService management surface".

**Judgment call — `list_endpoints`'s missing scope.** `available_provider_keys(*, scope:
AuthScope)` needs a full `AuthScope` (org/workspace/project/user, all required, frozen), but
`list_endpoints(self, *, project_id)`'s signature — fixed verbatim by both `entities.md` §8 and
this spec — carries only `project_id`. `policy/resolution.py`'s implementation reads only
`scope.project_id`, so `list_endpoints` builds a placeholder `AuthScope` with a nil UUID
(`UUID(int=0)`) for `organization_id`/`workspace_id`/`user_id`, documented inline. This is a real
gap in both design documents, not invented behavior; flagging it rather than silently widening the
signature to add `scope`, which the checklist's own "exactly this, unchanged" line forbids.

## Phase 5b — `list_models` (R3)

- [x] Implement `async def list_models(self, *, scope, namespace, name) -> List[str]`:
      `_resolve_target` as the relay does, `policy.authorize` with
      `Permission.USE_LLM_ENDPOINTS`, then return the target's allowlist — the static
      catalogue's for `builtin`, the row's for `custom`.
- [x] Resolve no secret and call no upstream. It answers from the allowlist, so a harness
      that lists before calling sees exactly what policy will allow.
- [x] Return `List[str]`; invent no response DTO — WP6's proxy shapes the OpenAI body inline
      because the data plane has no wire models (§6).
- [x] Unit tests: a `custom` endpoint with `models.allowlist: ["a", "b"]` returns exactly those; a
      `builtin` provider returns the catalogue's slugs verbatim (litellm prefixes intact, not
      re-derived); an unknown name raises `LLMEndpointNotFoundError`; a denied decision raises
      `PolicyDeniedError` before any slug is read.
- [x] Commit: "wp7: LLMGatewayService.list_models".

## Phase 6 — `LLMGatewayService.relay_chat_completion`

- [x] Implement `_resolve_target`: look up a row via `fetch_endpoint_by_slug` for `CUSTOM`, or
      `catalog.standard_llm_endpoint` for `BUILTIN`; raise `LLMEndpointNotFoundError` when
      neither answers.
- [x] Implement the allowlist check (`_check_allowlist`): a `CUSTOM` target refuses a `model` not
      in `data.models.allowlist` (including the explicit-empty-list-refuses case, D20); a `BUILTIN`
      target refuses a `model` not in the catalogue's allowlist for that provider. Raise
      `LLMModelNotAllowedError` before any secret lookup.
- [x] Implement the ceiling check (`_check_ceilings`): compare the request's
      `max_output_tokens` (if present in the body) against `target.config.max_output_tokens`;
      raise `CeilingExceededError(ceiling="max_output_tokens", requested=..., allowed=...,
      target=...)` on a breach — reject, never clamp (D25).
- [x] Wire `self.policy.authorize(scope=..., permission=Permission.USE_LLM_ENDPOINTS,
      target=...)`; on `not decision.allowed`, call `self.policy.record(...)` **then** raise
      `PolicyDeniedError` — denial recorded before the exception leaves.
- [x] Wire `self.resolver.resolve(scope=..., ref=target.secret_ref(),
      mode=SecretMode.PROJECT_ONLY)`, skipped for `GatewayAuthScheme.NONE` targets (the
      mocks).
- [x] Wire adapter selection: `self.upstream_registry.get(select_upstream(target.provider_key,
      target.deployment)).relay_chat_completion(...)`.
- [x] Implement the streaming-aware audit wrapper: wrap a streaming `LLMRelayResult.body` in a
      generator whose `finally` calls `self.policy.record(...)` with the usage read off the
      exhausted adapter result; call `policy.record` directly (not wrapped) for a non-streaming
      result.
- [x] Ruff format + check; run and fix.
- [x] Unit tests against stubbed DAO/policy/resolver/registry (no real adapters, no compose):
      allowlist check runs and raises before `resolver.resolve` is called (assert the resolver
      stub's call count is 0 on a rejected model); a policy denial calls `policy.record` exactly
      once before the exception propagates; a ceiling breach names all three values; a
      successful streaming call's `policy.record` fires only once the returned iterator is fully
      consumed (assert via a spy with an interleaved partial read).
- [x] Commit: "wp7: LLMGatewayService.relay_chat_completion".

**Consolidation, disclosed.** Phases 5, 5b and 6 landed as **one commit** covering the whole of
`service.py` plus one test file (`test_gateways_llm_service.py`) exercising all three surfaces,
rather than three. The three phases build one class with shared private helpers
(`_resolve_target`, the `_ResolvedLlmTarget` dataclass) that `list_models` and
`relay_chat_completion` both depend on; writing genuine `NotImplementedError` stubs for two of the
three phases and filling them in across two more commits would have meant re-touching the same
file three times with no independent reviewable state in between (a partially-stubbed
`service.py` is not runnable on its own). Each phase's checklist items above are still checked off
individually so the mapping from item to code is traceable in one diff.

**Two more judgment calls, in `relay_chat_completion`:**
- `_check_ceilings` reads `body: bytes` directly (via a private `json.loads`), not `context:
  LLMCallContext` as `entities.md`'s illustrative pseudocode signature shows — `LLMCallContext`
  only carries `model`/`stream` (§4.3), so there is no way to read `max_output_tokens` off it. This
  package's own task bullet above already says "compare the request's `max_output_tokens` (if
  present in **the body**)", which only body access satisfies; treated as the more specific,
  correct instruction over the pseudocode's compressed argument list.
- The pseudocode's `context = parse_call_context(body)` line names WP6's
  `apis/fastapi/gateways/llms/utils.py::parse_llm_call_context` — a file this package must not
  write (WP6 owns it) and, more fundamentally, one `core/` must not import (`api/AGENTS.md`'s
  layering rule: core does not import the api layer). `service.py` instead carries a private
  `_parse_call_context`, doing the same two-field extraction, so WP6's proxy and this service each
  own their own copy rather than one importing the other's file.

## Phase 7 — Wiring

- [x] `api/entrypoints/routers.py`: construct `llm_gateway_service = LLMGatewayService(...)` per
      the diff in `specs-wp7.md`, with the `upstream_registry` dict entries for `"passthrough"`,
      `"translated"`, `"mock"` — coordinate with WP5's and WP6's import lines landing in the same
      block at the M1→M2 merge.
- [x] If the litellm-as-direct-dependency question (flagged in "Missing from the design") is
      resolved in favor of adding it: `api/pyproject.toml` gets the `litellm` line, matching the
      SDK's own pin (`litellm>=1,<2`).
- [x] Ruff format + check; run and fix.
- [x] Commit: "wp7: wire LLMGatewayService into the entrypoint".

**`api/pyproject.toml` — already done, no action needed (R9).** `litellm>=1.92,<2` is already a
direct dependency on this branch (line 38) — someone resolved the "missing from the design"
question before this package started. Confirmed importable (`litellm.acompletion` used directly
by `providers/translated/adapter.py` since Phase 3).

**`api/entrypoints/routers.py` — diff only, not applied here.** Per rule 6 of the top-level brief,
this file is nobody's to edit directly mid-wave; the diff below is what should land at the
M1→M2 merge, once WP6's `PassthroughLLMAdapter` exists on the integration branch (it does not
exist on this worktree, so applying this diff here would break the import). Two things beyond
`specs-wp7.md`'s own diff, both flagged by the coordinator mid-task: the `MockLLMAdapter` import
uncomments (WP5 left it commented, deliberately, for whichever of WP7/WP9 builds the first plane
registry — that is WP7 here), and it is registered under `"mock"`, the key `select_upstream`
returns for `provider_key == "mock"` (see Phase 2's disclosed deviation above) — without both
halves the mocks are unreachable through the relay path in every environment, including the local
compose stack, since nothing in the documented classification table itself ever selects `"mock"`.

```diff
--- a/api/entrypoints/routers.py
+++ b/api/entrypoints/routers.py
@@
 from oss.src.dbs.postgres.gateways.llms.dao import LLMEndpointsDAO
 from oss.src.dbs.postgres.gateways.mcps.dao import MCPEndpointsDAO
 from oss.src.core.gateways.policy.resolution import SecretsResolver
 from oss.src.core.gateways.policy.service import GatewayPolicyService

-# The mock adapters (WP5) are registered into the plane registries, which WP7 and WP9
-# own and which do not exist yet — so their imports land with those, not here.
-# from oss.src.core.gateways.llms.providers.mock.adapter import MockLLMAdapter
+from oss.src.core.gateways.llms.providers.mock.adapter import MockLLMAdapter
+from oss.src.core.gateways.llms.providers.translated.adapter import TranslatedLLMAdapter
+from oss.src.core.gateways.llms.registry import LLMUpstreamRegistry
+from oss.src.core.gateways.llms.service import LLMGatewayService
+# from oss.src.core.gateways.llms.providers.passthrough.adapter import PassthroughLLMAdapter  # WP6
 # from oss.src.core.gateways.mcps.providers.mock.adapter import MockMCPAdapter
-# from oss.src.core.gateways.llms.service import LLMGatewayService
 # from oss.src.core.gateways.mcps.service import MCPGatewayService
 # from oss.src.apis.fastapi.gateways.llms.router import LLMGatewayRouter   # WP10
 # from oss.src.apis.fastapi.gateways.llms.proxy import LLMGatewayProxy     # WP6
 # from oss.src.apis.fastapi.gateways.mcps.router import MCPGatewayRouter   # WP10
 # from oss.src.apis.fastapi.gateways.mcps.proxy import MCPGatewayProxy     # WP8
@@
 gateway_policy_service = GatewayPolicyService(resolver=secret_resolver)

+llm_gateway_service = LLMGatewayService(
+    llm_endpoints_dao=llm_endpoints_dao,
+    policy=gateway_policy_service,
+    resolver=secret_resolver,
+    upstream_registry=LLMUpstreamRegistry(
+        adapters={
+            "passthrough": PassthroughLLMAdapter(),  # WP6's import, added at that merge
+            "translated": TranslatedLLMAdapter(),
+            "mock": MockLLMAdapter(),
+        }
+    ),
+)
+
 simple_traces = SimpleTracesRouter(
     simple_traces_service=simple_traces_service,
 )
```

The `# from ... import PassthroughLLMAdapter  # WP6` line stays commented in this diff — WP6
uncomments it (and drops the comment marker) at the same merge, per `specs-wp7.md`'s own note
that "WP6 contributes the import and the proxy mount only." Until then this diff, applied alone,
does not import-error: the construction block references `PassthroughLLMAdapter` by name, so it
must land together with WP6's uncomment, not before — same ordering constraint the seed's own
comment block already documented for `MockLLMAdapter`.

## Phase 8 — Acceptance (post-M2, once WP1/WP5/WP6 are merged)

- [ ] Deploy the local stack with WP1/WP2/WP3/WP5/WP6/WP7 all merged. **Not done here** — this
      worktree has no compose deployment and only WP1/WP2/WP3/WP5 are merged onto this branch
      (no WP6); per the top-level brief's rule 5, integration/acceptance needing a deployment are
      written, not run, by this package.
- [ ] Seed a custom endpoint with a narrow `models.allowlist`; confirm a request for a model
      outside it is refused `model_not_allowed` with no upstream call made (verifiable against
      WP5's mock — the mock sees no inbound request at all). **Not run** — needs the deployment
      above. The `curl` procedure in `specs-wp7.md`'s "Done test" section is the script to run
      once WP6 is merged and the stack is up; nothing further to add here.
- [x] Confirm every `DIRECT` provider in `supported_llm_models` maps to the documented adapter key
      via `select_upstream` (a scripted check, not a real call — CI has no provider keys). **Run,
      passing**: `test_every_catalogued_direct_provider_maps_to_the_documented_adapter_key` in
      `test_gateways_llm_registry.py` — needs nothing running, so it landed as a real unit test
      rather than a manual script. Checks a subset, not equality: `mistralai` is in the
      classification table but not in `supported_llm_models` (see the test's own docstring).
- [x] Ruff format + check; fix.
- [x] Commit: "wp7: acceptance verification".

## Definition of done

Matches `plan.md` WP7 verbatim: *"every provider and deployment pair reachable today is reachable
through the gateway, including the cloud-reseller shapes, and a model outside a custom endpoint's
list is refused."* Concretely: `catalog.py`, `registry.py`, `TranslatedLLMAdapter` and
`LLMGatewayService.relay_chat_completion` all pass their unit and contract tests with nothing
running; `select_upstream` classifies every provider/deployment pair in the design's known set;
and, once WP1/WP5/WP6 are available, a request outside a custom endpoint's allowlist is
refused before any secret is resolved or any upstream call is attempted.
