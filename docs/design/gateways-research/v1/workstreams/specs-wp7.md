# WP7 — LLM routing and model allowlist

The **domain** half of the LLM gateway (`workstreams/README.md`'s cut: "WP7 and WP9 own the
service, the registry, the catalogue and the allowlists"). Owns `LLMGatewayService` in full —
management CRUD orchestration, the generated-endpoint catalogue, the relay's policy/allowlist/
ceiling/secret/adapter-selection pipeline — and the `translated` south-port adapter that puts
the routing library (litellm, `sdks/python/pyproject.toml` line 31: `"litellm>=1,<2"`) in-process
for every upstream whose wire is not OpenAI-shaped.

**Explicitly not built here, and who owns it instead:**
- The HTTP surface, streaming, timeouts, and the `passthrough` adapter — **WP6**.
- The management router and its wire models (`router.py`, `models.py`) — **WP10**; WP7 exposes
  the service methods those routes call, it does not declare the routes.
- The DAO and storage for custom endpoint rows — **WP1**; WP7 depends on
  `LLMEndpointsDAOInterface`, never a concrete DAO.
- Secret resolution itself — **WP2**; WP7 calls `SecretsResolverInterface.resolve`, never
  reimplements the mode logic.
- Policy authorization and audit — **WP3**/**WP4**; WP7 calls `GatewayPolicyService.authorize`/
  `.record`, never reimplements permission or entitlement checks.
- The mock adapter — **WP5**; WP7 registers it under the `"mock"` key but does not write it.

## Files

New:
- `core/gateways/llms/service.py` — `LLMGatewayService`
- `core/gateways/llms/registry.py` — `LLMUpstreamRegistry`, `select_upstream`
- `core/gateways/llms/catalog.py` — `standard_llm_endpoint`, `standard_llm_endpoints`
- `core/gateways/llms/providers/translated/adapter.py` — `TranslatedLLMAdapter`
- `core/gateways/llms/providers/translated/__init__.py`

Edited: `api/entrypoints/routers.py` — service/registry construction (diff below). Also, if
litellm is added as a direct API dependency rather than relied on transitively through the
`agenta` SDK package (see "Missing from the design" below): `api/pyproject.toml`.

## Interfaces

Reproduced verbatim from `entities.md` §8. Do not rename, do not add parameters not listed here.

### Constructor

```python
class LLMGatewayService:
    def __init__(
        self,
        *,
        llm_endpoints_dao: LLMEndpointsDAOInterface,
        policy: GatewayPolicyService,
        resolver: SecretsResolverInterface,
        upstream_registry: LLMUpstreamRegistry,
    ) -> None: ...
```

### Management surface — thin over the DAO, plus the generated merge

```python
async def create_endpoint(self, *, project_id, user_id, endpoint) -> Optional[LLMEndpoint]: ...
async def fetch_endpoint(self, *, project_id, endpoint_id) -> Optional[LLMEndpoint]: ...
async def edit_endpoint(self, *, project_id, user_id, endpoint) -> Optional[LLMEndpoint]: ...
async def delete_endpoint(self, *, project_id, endpoint_id) -> bool: ...
async def query_endpoints(self, *, project_id, endpoint=None, windowing=None) -> List[LLMEndpoint]: ...
async def list_endpoints(self, *, project_id) -> List[LLMEndpoint]: ...
```

`list_endpoints` is the merge: generated builtin endpoints (`catalog.py`, existing *iff* a
`provider_key` secret exists for the provider — D20) plus the custom rows; `agenta` joins when it
has members (D27, currently none on the LLM plane). This is the **only** read that spans
namespaces — `query_endpoints` filters rows only, per §9's router comment: "generated endpoints
have nothing to filter on but the provider, which GET already shows."

To compute "existing iff a `provider_key` secret exists," `list_endpoints` needs the project's
provider keys. **R2 settled this at kickoff: the resolver port gained one method, and the
constructor above is unchanged.**

```python
keys = await self.resolver.available_provider_keys(scope=scope)   # Set[str], names only
```

Intersect `standard_llm_endpoints()` with that set. The port answers because existence of a
secret is a secret-layer question; handing this service a `VaultService` would give it two
secret seams and defeat the port, and calling `resolve()` once per provider to catch
`SecretNotFoundError` is control flow by exception plus eleven vault reads per list. The method
returns the empty set for a project with no keys — that is an ordinary state, not an error, so
there is nothing to catch here.

WP2 implements it; this package calls it. A test double for the resolver in this package's unit
tests must implement it too.

### `catalog.py` — two pure functions over the SDK's static map

```python
def standard_llm_endpoint(*, provider_key: str) -> Optional[LLMEndpoint]:
    """The generated endpoint for one provider: namespace=BUILTIN, slug=provider_key,
    deployment_kind=DIRECT, models.allowlist from the map, settings at code defaults, no id and
    no lifecycle — it is not a row. None for an unknown provider. Keeps the secrets
    domain's *standard* vocabulary; the namespace it stamps says builtin (D27, §2.3)."""

def standard_llm_endpoints() -> List[LLMEndpoint]:
    """All eleven, existence-unfiltered. The service intersects with the vault's
    provider keys, because existence is a fact about the project, not the catalogue (D20)."""
```

Source map: `sdks/python/agenta/sdk/utils/assets.py::supported_llm_models` — eleven providers
today (`anthropic`, `cohere`, `deepinfra`, `gemini`, `groq`, `mistral`, `openai`, `openrouter`,
`perplexityai`, `together_ai`, `minimax`; read in full, lines 6–201), imported the way
`core/workflows/static_catalog.py` already imports the SDK for a static catalogue (§1). Every
model id in the map is **already litellm-prefixed except the `openai` family**
(`"anthropic/claude-..."`, `"gemini/gemini-..."`, `"gpt-5.5"` bare) — `standard_llm_endpoint`
stores these ids verbatim in `LLMEndpointData.models.allowlist`; nothing here re-derives or strips a
prefix.

`provider_key` here is the secrets-domain `StandardProviderKind` value (`core/secrets/enums.py`
lines 17–31) — fourteen members exist there against eleven in `supported_llm_models` (`anyscale`,
`alephalpha`, `mistralai` have no catalogue entry); `standard_llm_endpoint` returns `None` for
those three, consistent with its own docstring ("None for an unknown provider").

### `registry.py` — the adapter registry and the routing split

```python
class LLMUpstreamRegistry:
    def __init__(self, *, adapters: Dict[str, LLMUpstreamInterface]): ...
    def get(self, key: str) -> LLMUpstreamInterface: ...   # raises on a miss
    def keys(self) -> list[str]: ...
```

Copied verbatim from `entities.md` §7.1's registry shape — the same structure as
`ConnectionsGatewayRegistry` (`core/gateway/connections/registry.py`, read in full: `get`/`keys`/
`items`, dict lookup, `ProviderNotFoundError` on a miss — WP7's `.get` raises the LLM-plane
equivalent).

`select_upstream(provider_key: str, deployment: LLMDeploymentKind) -> str` — a pure function,
`entities.md` §7.1: *"picks the adapter key; the mocks register under a third key."* The split
this package must implement, stated qualitatively in §7.1 (*"passthrough for upstreams that speak
the caller's protocol... translated for providers whose wire differs and for cloud resellers
whose auth is request signing"*) and made concrete here against the real endpoint map
(`sdks/python/agenta/sdk/agents/connections/endpoints.py::_DIRECT_ENDPOINTS`, lines 11–21, read
in full):

| `deployment_kind` | Adapter | Why |
|---|---|---|
| `AZURE`, `BEDROCK`, `SAGEMAKER`, `VERTEX` | `translated` | Cloud-reseller auth is request signing, not a bearer header — never byte-for-byte by construction (§7.1) |
| `CUSTOM` | `passthrough` | A `custom_provider` row is OpenAI-compatible by definition (D19/§2.4: "self-hosted server or third party") |
| `DIRECT`, provider ∈ `{openai, groq, together_ai, openrouter, mistral, mistralai}` | `passthrough` | `_DIRECT_ENDPOINTS`' own base URLs say so: `groq` is literally `.../openai/v1`; Together, OpenRouter and Mistral's chat-completions wire is OpenAI-shaped |
| `DIRECT`, provider ∈ `{anthropic, gemini, cohere, deepinfra, perplexityai, minimax}` | `translated` | Native wire differs from OpenAI's (Anthropic's Messages API and Gemini's `generateContent` are the clearest cases); litellm already knows each shape |

This table is this package's own classification, not a transcription — `entities.md` states the
rule, not the per-provider table. Verify each `DIRECT` provider against litellm's own adapter
registry before shipping (a provider litellm added OpenAI-compatible support for after this
document was written should move rows, not require an entities.md change — this table lives in
code, not in the design set).

### `providers/translated/adapter.py`

```python
class TranslatedLLMAdapter(LLMUpstreamInterface):
    async def relay_chat_completion(
        self, *, route, secret, context, body, headers,
    ) -> LLMRelayResult: ...
```

Same interface WP6's `PassthroughLLMAdapter` implements (`entities.md` §7.1) — the two share a
south port and nothing else. Internally: `json.loads(body)` to get parseable parameters (this
adapter alone is exempt from byte-for-byte, per §7.1's own resolution: *"the library takes parsed
parameters and re-serializes, which is not byte-for-byte... only there [passthrough] is the
constraint honest"*), call `litellm.acompletion(model=..., **kwargs)` with:

- `model` prefixed per `route.deployment` (`"azure/{model}"`, `"bedrock/{model}"`,
  `"sagemaker/{model}"`, `"vertex_ai/{model}"`; for `DIRECT` non-OpenAI-shaped providers, the
  model id already carries its litellm prefix from the catalogue, e.g. `"anthropic/claude-..."`).
- secret kwargs assembled by the **same branch** the SDK's settings builder already runs —
  `sdks/python/agenta/sdk/managers/secrets.py::get_provider_settings` /
  `get_provider_settings_from_workflow` (both copies read in full, lines 172–260 and 308–404):
  STEP 4 there merges `secret_provider_extras` (`CustomProviderDTO.provider.extras`) straight into
  the kwargs dict passed to litellm — this adapter performs the identical merge, moved behind the
  gateway, against `secret.secret.data` (`StandardProviderDTO`/`CustomProviderDTO`,
  `core/secrets/dtos.py` lines 20–48). `api_version` (Azure) and `region` (Bedrock/Vertex) come
  from `route.api_version`/`route.region`, not from the secret.
- streaming: `stream=context.stream`; litellm's async generator is wrapped into an
  `AsyncIterator[bytes]` re-serialized as OpenAI-shaped SSE chunks (litellm already emits
  OpenAI-shaped `ChatCompletionChunk` objects for every provider it translates — this is the
  library doing the normalization work D9 assigns it).
- `GatewayUsage` populated from litellm's own `response.usage` (input/output tokens) and
  `response._hidden_params["response_cost"]` or `litellm.cost_calculator.cost_per_token` (already
  used elsewhere in this codebase for cost math, `sdks/python/agenta/sdk/utils/assets.py`
  lines 206–230 and `api/oss/src/core/tracing/utils/trees.py`) — a real cost figure, not `None`,
  for every successful call, unlike `PassthroughLLMAdapter`'s "usage only when the upstream
  volunteers it."
- litellm exceptions (`litellm.exceptions.*`, all subclass `openai.OpenAIError` in recent litellm
  versions) are caught and re-raised as `LLMUpstreamError(provider_key=route.provider_key,
  status_code=<litellm's own status_code attribute when present>, detail=str(exc))`.

### `service.py` — the relay path

Reproduced from `entities.md` §8, the six-step body both planes share (D7 made concrete) — the
LLM instance of it, which this package owns in full:

```python
async def relay_chat_completion(self, *, scope, namespace, name, body, headers):
    target = await self._resolve_target(project_id=scope.project_id,
                                        namespace=namespace, name=name)
    # generated (catalog.py) or row (llm_endpoints_dao); LLMEndpointNotFoundError

    context = parse_call_context(body)             # WP6's parse_llm_call_context
    self._check_allowlist(target, context)          # LLMModelNotAllowedError — before
                                                     # any secret is touched
    self._check_ceilings(target, context)            # CeilingExceededError: reject,
                                                     # never clamp (D25)

    decision = await self.policy.authorize(
        scope=scope, permission=Permission.USE_LLM_ENDPOINTS,
        target=target.as_policy_target(context),
    )
    if not decision.allowed:
        await self.policy.record(scope=scope, target=..., decision=decision,
                                 outcome=GatewayOutcome(status_code=403))
        raise PolicyDeniedError(...)

    secret = await self.resolver.resolve(
        scope=scope, ref=target.secret_ref(), mode=SecretMode.PROJECT_ONLY,
    )   # NONE-scheme targets (the mocks) skip this step

    result = await self.upstream_registry.get(
        select_upstream(target.provider_key, target.deployment_kind)
    ).relay_chat_completion(route=target.route(context), secret=secret,
                            context=context, body=body, headers=headers)

    await self.policy.record(scope=scope, target=..., decision=decision,
                             outcome=outcome_from(result, secret))
    return result
```

`target` (the resolved generated-or-row value plus which namespace answered) is
**service-internal** — it never crosses a layer, so it is not one of §4's DTOs and this package
is free to shape it (a small dataclass, not a Pydantic model, matching the south-port result
types' own reasoning in §7.1: "lives for one call... never validated, stored or serialized").

**The LLM plane resolves with `SecretMode.PROJECT_ONLY`** (§7.2: "the LLM plane resolves with
PROJECT_ONLY, the MCP plane with USER_OPTIONAL — the deliberate asymmetry... one billing identity
for models, personal authority for tools"). This is not a parameter WP7 exposes; it is hardcoded
at this call site, per §7.2's own note that the mode is "an argument at the call site," not the
resolver's default.

**Streaming and audit.** For a streamed `LLMRelayResult`, `result.body` has not been drained when
this method returns — WP6's proxy drains it via `StreamingResponse` afterward. §8's own note:
*"Usage is recorded even when the stream broke... for a streamed body the outcome's usage is read
off the LLMRelayResult after exhaustion... the surface drains, the service records in a
finally."* Concretely, this package must wrap `result.body` in a generator that runs
`self.policy.record(...)` in its own `finally` (catching a mid-stream break too, recording
`usage=None` if the crash happened before the adapter populated it) — **not** call
`policy.record` unconditionally before returning, or the non-streaming ordering shown in the
pseudocode above (record-after-relay) silently becomes record-before-drain for every streaming
call, which breaks WP6's stated assumption that it owns nothing audit-related.

### `list_models` — the backing method for `GET /v1/models` (R3, added at kickoff)

```python
async def list_models(self, *, scope, namespace, name) -> List[str]: ...
```

The route existed in `entities.md` §9 with no service method behind it; R3 named one. It is per
endpoint, not global — the routes are `/builtin/{provider}/v1/models` and
`/custom/{slug}/v1/models` — and it answers **from the allowlist**, so a harness that lists
before calling sees exactly what policy will allow: the catalogue's allowlist for a generated
`builtin` endpoint, the row's own allowlist for a `custom` one.

Body: `_resolve_target` exactly as the relay does, then `policy.authorize` with
`Permission.USE_LLM_ENDPOINTS` — it is a data-plane read that reveals configuration, so it is
authorized like one — then return the slugs. No secret is resolved and no upstream is called.

**No new DTO.** It returns `List[str]`, and WP6's proxy shapes the OpenAI list body inline; the
data plane has no wire models (§6). Inventing a response DTO here would break the "do not invent
names" rule for no gain.

### The three orderings, restated as this package's obligations

- **Allowlist before secret** (`_check_allowlist` before `self.resolver.resolve`) — a refused
  model must not cost a vault read.
- **The denial is recorded before the exception leaves** — `policy.record` runs inside the
  `if not decision.allowed` branch, before `raise PolicyDeniedError`.
- **Usage is recorded even when the stream broke** — the `finally`-wrapped generator above.

## Contracts this package must honour

- **An explicit empty allowlist refuses; an absent one does not** (§4.4's LLM-plane echo):
  `models: {"allowlist": []}` means no model may be called, while `models: {}` constrains
  nothing — the list was never written. Standard endpoints
  expose their provider's whole catalogue — the static map **is** the allowlist for `builtin`.
- **A model outside the allowlist never reaches `select_upstream`.** `_check_allowlist` runs
  before adapter selection; `LLMModelNotAllowedError` carries `model`, `namespace`, `name`
  (`entities.md` §5) — do not collapse this into a generic 400.
- **`CeilingExceededError` names all three numbers** (D25): `ceiling`, `requested`, `allowed`,
  `target`. Guards **our** ceilings (`LLMEndpointSettings.max_output_tokens`) only — never
  second-guesses a model's own context window, which the upstream clamps or refuses in its own
  shape.
- **Generated endpoints take code defaults, never a stored row** (D20). `standard_llm_endpoint`
  must not query `llm_endpoints_dao` for anything; existence is answered by a vault provider-key
  check, never by a table read.
- **`select_upstream` is pure** — no I/O, no DAO, no vault — callable in a unit test with a bare
  `(provider_key, deployment)` pair.
- **Registration under `"mock"` is unconditional** (D23): `LLMUpstreamRegistry(adapters={
  "passthrough": ..., "translated": ..., "mock": MockLLMAdapter()})` in every environment; only
  reachability (a seeded endpoint pointing at it) is environment-specific, and that is WP1/WP10's
  concern, not this package's registration decision.

## `api/entrypoints/routers.py` diff

```diff
+from oss.src.core.gateways.llms.service import LLMGatewayService
+from oss.src.core.gateways.llms.registry import LLMUpstreamRegistry
+from oss.src.core.gateways.llms.providers.translated.adapter import TranslatedLLMAdapter
...
 llm_gateway_service = LLMGatewayService(
     llm_endpoints_dao=llm_endpoints_dao,
     policy=gateway_policy_service,
     resolver=secret_resolver,
     upstream_registry=LLMUpstreamRegistry(adapters={
-        "passthrough": PassthroughLLMAdapter(),  # WP6's import, added at that merge
-        "translated": TranslatedLLMAdapter(),
-        "mock": MockLLMAdapter(),                 # WP5's import, added at that merge
+        "passthrough": PassthroughLLMAdapter(),
+        "translated": TranslatedLLMAdapter(),
+        "mock": MockLLMAdapter(),
     }),
 )
```

This whole block is where WP5, WP6 and WP7's imports converge — per `workstreams/README.md`,
"Four packages need a line in it... the merge applies them together as one edit." WP7 authors the
`LLMGatewayService(...)` construction itself (it owns `service.py`) and the dict literal's shape;
the three adapter imports arrive from their respective packages at the same merge.

## Tests

Unit — nothing running:
- `standard_llm_endpoint(provider_key="openai")` returns an `LLMEndpoint` with
  `namespace=BUILTIN`, `slug="openai"`, `deployment=DIRECT`, `models.allowlist` matching
  `supported_llm_models["openai"]` exactly; an unknown provider (`"not-a-provider"`) and the
  three `StandardProviderKind` members absent from the catalogue (`anyscale`, `alephalpha`,
  `mistralai`) all return `None`.
- `standard_llm_endpoints()` returns exactly eleven entries.
- `select_upstream` returns `"translated"` for every `(provider, AZURE/BEDROCK/SAGEMAKER/VERTEX)`
  pair regardless of provider; `"passthrough"` for `(any, CUSTOM)`; the `DIRECT` split matches the
  table above exactly, provider by provider.
- `LLMGatewayService.relay_chat_completion` against stubbed DAO/policy/resolver/registry
  (no real adapters): a refused permission raises `PolicyDeniedError` and calls
  `policy.record` exactly once, before the exception propagates; a disallowed model raises
  `LLMModelNotAllowedError` **without** calling `resolver.resolve` (assert the stub was never
  invoked); a ceiling breach raises `CeilingExceededError` naming all three values; a successful
  streaming call's `policy.record` fires only after the returned iterator is exhausted (assert
  ordering with a spy).
- `TranslatedLLMAdapter` against a stubbed `litellm.acompletion` (monkeypatched, not a real call):
  `StandardProviderDTO` secret passes `api_key=...`; `CustomProviderDTO` secret merges
  `provider.extras` into the call kwargs; `route.deployment=AZURE` prefixes the model
  `"azure/..."` and passes `api_version`; `BEDROCK`/`VERTEX` pass `region`; a raised litellm
  exception becomes `LLMUpstreamError`.
- `list_endpoints`: with two provider-key secrets present, the merged list contains exactly those
  two generated `builtin` entries plus every custom row for the project — no duplicates, no
  entries for providers with no key.

Contract — extends WP5's fixture (`test_mock_adapters_contract.py`): `TranslatedLLMAdapter`
against the same `relay_chat_completion` → `LLMRelayResult` assertion, litellm mocked out. Nothing
running.

Acceptance — needs the compose stack, real provider secrets are **not** available in CI, so
this suite runs against WP5's mocks for the relay-path shape and is otherwise a manual /
staging-only check against real providers:
- Every `DIRECT` provider in `supported_llm_models` reachable via `builtin/{provider}` returns a
  200 for a trivial prompt (staging only — needs real keys; document as manual, not automated in
  CI).
- A custom endpoint with `deployment=BEDROCK`, real AWS keys in a `custom_provider` secret,
  reaches Bedrock through `TranslatedLLMAdapter` (staging only).
- A custom endpoint with `models.allowlist=["gpt-4o"]` refuses a request for `"gpt-4o-mini"` with
  `model_not_allowed`, verifiable against WP5's mocks alone (no real provider needed — the refusal
  happens before any upstream call).

## Done test

```bash
cd api && uv sync --locked && uv run --no-sync python run-tests.py  # unit + contract, no deploy
```

Plus, once the compose stack and WP5/WP1 are up:

```bash
curl -X POST http://localhost/api/gateways/llms/custom/<endpoint-with-narrow-allowlist>/v1/chat/completions \
  -H "Authorization: ApiKey <key>" -d '{"model": "not-in-allowlist", "messages": []}'
# expect 403 {"error": {"code": "model_not_allowed", ...}}
```

Matches `plan.md` WP7 verbatim: *"every provider and deployment pair reachable today is reachable
through the gateway, including the cloud-reseller shapes, and a model outside a custom endpoint's
list is refused."*

## Out of scope

- `apis/fastapi/gateways/llms/{proxy,utils}.py`, `providers/passthrough/` — WP6.
- `apis/fastapi/gateways/llms/{router,models}.py` — WP10.
- `core/gateways/llms/{dtos,types,interfaces}.py` — seed; WP7 imports, does not edit.
- `dbs/postgres/gateways/llms/` — WP1.
- `core/gateways/policy/{resolution,service}.py` — WP2, WP3.
- Embeddings (`relay_embedding`) — deferred with the evaluator path (D15); the seam is declared
  in `LLMUpstreamInterface` as a comment, not implemented.

## Settled at kickoff — was "needs a ruling"

- **`list_endpoints`'s constructor cannot reach the vault → option (b), R2.** The resolver port
  gains `available_provider_keys(*, scope) -> Set[str]`; the constructor is untouched. Option (a)
  would have given this service two secret seams, and (c) breaks §8's own DI rule for this
  very service. The seed carries the new method, so nothing here is a mid-wave signature change.
- **`GET /v1/models` has no backing method → `list_models`, R3.** Owned here, called by WP6.
  Section above.

## Missing from the design, needs a ruling

- **litellm as a direct API dependency.** `api/pyproject.toml` does not list `litellm` — it
  reaches the API today only transitively through the `agenta` SDK package (confirmed: `grep
  litellm api/pyproject.toml` finds nothing; `core/tracing/utils/trees.py` already imports
  `litellm.cost_calculator` on the strength of that transitive dependency). `TranslatedLLMAdapter`
  needs `litellm.acompletion`, a heavier surface than one function. Whether to add `litellm` as an
  explicit `api/pyproject.toml` dependency (recommended — transitive reliance on another
  package's dependency is fragile) is not decided in any `v1/` document; raise it, do not decide
  it silently in a commit.
