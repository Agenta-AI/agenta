# WP6 — LLM ingress and relay

The OpenAI-compatible north-port surface for the model plane: the proxy router, streaming, the
request body kept byte for byte, and timeouts. This is the **transport** half of the LLM
gateway — the ingress package, per `workstreams/README.md`'s central cut: "on each plane,
transport and domain are different packages... WP6 and WP8 own the HTTP surface, streaming,
timeouts and the byte-for-byte relay. WP7 and WP9 own the service, the registry, the catalogue
and the allowlists." WP6 therefore never decides *which* endpoint a call reaches or *whether* it
is allowed — it parses the caller's request, calls `LLMGatewayService.relay_chat_completion`
(WP7's method, called through the seed-frozen signature), and relays the answer back exactly as
it arrived.

**Explicitly not built here, and who owns it instead:**
- Endpoint resolution, the allowlist check, the ceiling check, policy authorization, secret
  resolution, and the choice of south-port adapter (`select_upstream`) — all inside
  `LLMGatewayService.relay_chat_completion`, owned by **WP7**.
- The adapter that translates through the routing library for non-OpenAI-shaped upstreams
  (Anthropic direct, Azure, Bedrock, SageMaker, Vertex) — `providers/translated/adapter.py`,
  **WP7**.
- The mock upstream this package's own acceptance tests reach — **WP5**.
- The shared exception→HTTP-status mapping, `handle_gateway_exceptions()` — **WP10**
  (`apis/fastapi/gateways/exceptions.py`); WP6 consumes it, does not define it.
- The management CRUD for LLM endpoints (`router.py`, `models.py`) — **WP10**.

## Files

New:
- `apis/fastapi/gateways/llms/proxy.py` — `LLMGatewayProxy`
- `apis/fastapi/gateways/llms/utils.py` — `parse_llm_call_context`
- `core/gateways/llms/providers/passthrough/adapter.py` — `PassthroughLLMAdapter`
- `core/gateways/llms/providers/passthrough/__init__.py`

Edited: `api/entrypoints/routers.py` — proxy router mount + `PassthroughLLMAdapter` import and
registry entry (diff below). No other file; WP6 does not touch `core/gateways/llms/service.py`,
`registry.py`, or `catalog.py` (all WP7).

## Interfaces

Reproduced verbatim from `entities.md` §7.1 and §9. Do not rename, do not add parameters not
listed here.

### The south port this package implements

```python
# core/gateways/llms/interfaces.py (seed-owned)

@dataclass
class LLMRelayResult:
    status_code: int
    headers: Dict[str, str]
    body: AsyncIterator[bytes]
    usage: Optional[GatewayUsage] = None

class LLMUpstreamInterface(ABC):
    @abstractmethod
    async def relay_chat_completion(
        self, *, route: LLMResolvedRoute, secret: Optional[ResolvedSecret],
        context: LLMCallContext, body: bytes, headers: Dict[str, str],
    ) -> LLMRelayResult:
        """Relay one completion call. `body` is the caller's payload untouched;
        `headers` are the caller's headers already stripped of authorization.
        `secret` is None only for targets whose auth scheme is NONE (the
        mocks). Raises LLMUpstreamError on upstream failure."""
```

```python
# core/gateways/llms/providers/passthrough/adapter.py

class PassthroughLLMAdapter(LLMUpstreamInterface):
    async def relay_chat_completion(
        self, *, route, secret, context, body, headers,
    ) -> LLMRelayResult: ...
```

Which providers land here versus `translated` is `select_upstream`'s decision (WP7,
`core/gateways/llms/registry.py`) — per §7.1: "**passthrough** for upstreams that speak the
caller's protocol (OpenAI-compatible: `deployment=custom`, and direct providers whose API is
OpenAI-shaped)." WP6 builds an adapter correct for that whole class, without needing the
provider list itself.

### `LLMResolvedRoute` (input, seed-owned, `core/gateways/llms/dtos.py` §4.3)

```python
class LLMResolvedRoute(BaseModel):
    provider_key: str
    deployment_kind: LLMDeploymentKind
    model: str
    base_url: Optional[str] = None
    api_version: Optional[str] = None
    region: Optional[str] = None
    headers: Optional[Dict[str, str]] = None
    settings: LLMEndpointSettings = Field(default_factory=LLMEndpointSettings)
```

`settings.timeout_seconds` (inherited from `GatewayEndpointSettings`, §4.1) is the per-call timeout;
`None` on every generated endpoint (§2.4: "generated endpoints take the code defaults") — this
package supplies that default, since timeouts are WP6's stated scope in `plan.md`.

### `ResolvedSecret` and its two relevant secret shapes

`ResolvedSecret.secret: SecretResponseDTO`, kind-dispatched by the adapter (§4.2: "the
adapter, not the resolver, knows which fields its upstream needs"). Real field shapes, read from
`api/oss/src/core/secrets/dtos.py` (not paraphrased):

```python
# lines 20–26
class StandardProviderSettingsDTO(BaseModel):
    key: str

class StandardProviderDTO(BaseModel):
    kind: StandardProviderKind
    provider: StandardProviderSettingsDTO

# lines 29–48
class CustomProviderSettingsDTO(BaseModel):
    url: Optional[str] = None
    version: Optional[str] = None
    key: Optional[str] = None
    extras: Optional[dict] = None

class CustomProviderDTO(BaseModel):
    kind: CustomProviderKind
    provider: CustomProviderSettingsDTO
    models: List[CustomModelSettingsDTO]
    provider_slug: Optional[str] = None
    model_keys: Optional[List[str]] = None
```

`secret.secret.data` is one of these (a `SecretDTO` union member, §4.5). For a `provider_key`
secret (`StandardProviderDTO`), inject `Authorization: Bearer {provider.key}`. For a
`custom_provider` secret (`CustomProviderDTO`), inject `provider.key` the same way and merge
`provider.extras` into the outbound request's non-body configuration (headers only — never the
JSON body, which stays byte for byte). This mirrors the SDK's own dispatch in
`get_provider_settings`/`get_provider_settings_from_workflow`
(`sdks/python/agenta/sdk/managers/secrets.py` lines 228–255 and 372–399, read in full): both copies
branch on `secret.get("kind") == "provider_key"` vs `"custom_provider"` identically — the same
branch this adapter needs, moved behind the gateway.

**`secret` is `None` for the mocks** (`GatewayAuthScheme`-equivalent NONE targets, §2 —
"an endpoint with no secret is legitimate — the mock (D23)"): no `Authorization` header is
sent at all.

### `apis/fastapi/gateways/llms/utils.py`

```python
def parse_llm_call_context(*, body: bytes) -> LLMCallContext:
    """Extract model and stream from the JSON body without materializing a
    parsed copy for relay — the body itself stays byte-for-byte (§7.1).
    Raises ValueError when the body names no model; the proxy translates that
    into the surface's own invalid-request error shape."""
```

`LLMCallContext` (seed-owned, §4.3): `model: str`, `stream: bool = False`. This function reads
just enough of the body (`json.loads`, two keys) to route and to pick a timeout; it must not
construct a new serialized body anywhere in the relay path — `body: bytes` stays the same object
handed to the adapter.

### `apis/fastapi/gateways/llms/proxy.py`

Route declarations verbatim from `entities.md` §9:

```python
class LLMGatewayProxy:
    def __init__(self, *, llm_gateway_service: LLMGatewayService):
        self.service = llm_gateway_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/builtin/{provider}/v1/chat/completions",
            self.chat_completions_builtin, methods=["POST"],
            operation_id="llm_gateway_chat_completions_builtin",
        )
        self.router.add_api_route(
            "/custom/{slug}/v1/chat/completions",
            self.chat_completions_custom, methods=["POST"],
            operation_id="llm_gateway_chat_completions_custom",
        )
        self.router.add_api_route(
            "/builtin/{provider}/v1/models",
            self.list_models_builtin, methods=["GET"],
            operation_id="llm_gateway_list_models_builtin",
        )
        self.router.add_api_route(
            "/custom/{slug}/v1/models",
            self.list_models_custom, methods=["GET"],
            operation_id="llm_gateway_list_models_custom",
        )
```

No wire models (§6): these handlers take the raw `Request`, never a Pydantic request body — that
is the whole reason the body stays byte for byte.

`chat_completions_builtin` / `chat_completions_custom` bodies:

```python
scope = get_auth_scope()                       # AuthScope, never request.state (§9)
raw_body = await request.body()                 # bytes, untouched
caller_headers = {k: v for k, v in request.headers.items()
                  if k.lower() not in {"authorization", "secret", ...}}  # strip inbound auth
result = await self.service.relay_chat_completion(
    scope=scope,
    namespace=GatewayEndpointNamespace.BUILTIN,  # or CUSTOM
    name=provider,                               # or slug
    body=raw_body,
    headers=caller_headers,
)
if context.stream:  # from parse_llm_call_context(body=raw_body)
    return StreamingResponse(result.body, status_code=result.status_code,
                             headers=result.headers, media_type="text/event-stream")
chunk = await anext(result.body)                # exactly one chunk (interface docstring)
return Response(content=chunk, status_code=result.status_code, headers=result.headers)
```

`list_models_builtin` / `list_models_custom`: answer from the endpoint's allowlist — "the static
catalogue for builtin, the allowlist for custom" (§9's comment on the route declarations). **R3
named the backing method at kickoff**: `await self.service.list_models(scope=..., namespace=...,
name=...) -> List[str]`, owned by WP7. It authorizes and resolves the target itself; this handler
shapes the OpenAI list body inline —

```python
slugs = await self.service.list_models(scope=scope, namespace="builtin", name=provider)
return {"object": "list", "data": [{"id": s, "object": "model"} for s in slugs]}
```

— because the data plane has no wire models (§6).

**Audit timing is not this package's problem.** §9: "Streaming rides `StreamingResponse` over
`LLMRelayResult.body`, with the audit record written in the handler's finally after the iterator
is exhausted (§8)." Read together with §8's own note — "for a streamed body the outcome's usage
is read off the `LLMRelayResult` after exhaustion... the surface drains, the service records in a
finally" — the wrapping that fires `policy.record(...)` on exhaustion is `LLMGatewayService`'s own
`finally` around the iterator it returns (WP7's job). WP6's handler only has to drain
`result.body` through `StreamingResponse`; it must **not** add its own `try/finally` calling into
policy, because `LLMGatewayProxy` never holds a `GatewayPolicyService` reference (its constructor
takes only `llm_gateway_service`) — if this reading is wrong, it is a WP7 spec bug, not a WP6 one.

### Error shape

Denials wear the surface's own error shape (§9): `{"error": {"message", "type", "code"}}`, `code`
carrying a stable cause — `policy_denied`, `model_not_allowed`, `ceiling_exceeded`,
`secret_missing` are the four `entities.md` names explicitly. The mapping from domain
exception to HTTP status is `handle_gateway_exceptions()` (WP10, not yet built when WP6 starts
per the wave-1 fan-out — both run against M1 in parallel). Until that merge, `proxy.py` catches
the domain exceptions it can already type against (everything in `core/gateways/llms/types.py`
and `core/gateways/policy/types.py`, all seed-owned) directly and renders the OpenAI body itself;
reconcile with WP10's shared decorator at the M2 merge rather than blocking on it — this is a
merge-point conversation per `workstreams/README.md` rule 1, not a WP6 commit that waits.

What must never happen: leaking the house envelope (`count`, entity-wrapped) onto this surface,
or rewriting the upstream's own error body once a call reaches `PassthroughLLMAdapter` — a
`LLMUpstreamError` raised there passes its `detail` through untouched (D16's pass-through rule,
`api/AGENTS.md`'s error-envelope scope).

## `api/entrypoints/routers.py` diff

```diff
+from oss.src.core.gateways.llms.providers.passthrough.adapter import PassthroughLLMAdapter
+from oss.src.apis.fastapi.gateways.llms.proxy import LLMGatewayProxy
...
+llm_gateway_proxy = LLMGatewayProxy(llm_gateway_service=llm_gateway_service)
...
 app.include_router(router=llm_gateway.router,  prefix="/gateways/llms", tags=["Gateway: LLM"])
+app.include_router(router=llm_gateway_proxy.router, prefix="/gateways/llms", include_in_schema=False)
```

The `upstream_registry=LLMUpstreamRegistry(adapters={"passthrough": PassthroughLLMAdapter(), ...})`
dict entry is WP7's edit inside its own service-construction block (`entities.md` §9's wiring
snippet) — WP6 contributes the import and the proxy mount only.

## Contracts this package must honour

- **Byte-for-byte, no exceptions inside this adapter's reach.** `scope-checklist.md`: "Body
  byte-for-byte, **both gateways**... on the model side it is what keeps prompt caching working."
  `PassthroughLLMAdapter` never deserializes and re-serializes `body`; it forwards the exact bytes
  it received, adding only transport-level auth (a header, never a body mutation).
- **The proxy carries no wire models** (§6) — house-style `models.py` request/response classes
  never appear on `proxy.py`'s routes.
- **`AuthScope` via `get_auth_scope()`, never `request.state`** (§9) — the design's explicit
  correction of the existing gateway/tools/triggers habit.
- **Timeout is enforced here, not assumed away.** `plan.md` WP6's own done condition: "a hung
  upstream times out rather than hanging the gateway." `PassthroughLLMAdapter` wraps its upstream
  call in `asyncio.wait_for`/an `httpx` client timeout keyed on `route.config.timeout_seconds`
  (falling back to this package's own default when `None`), and on expiry raises
  `LLMUpstreamError(provider_key=route.provider_key, status_code=None, detail="upstream timed
  out")` — never lets the coroutine hang the request indefinitely.
- **Streaming preserves ordering and framing.** SSE chunk boundaries from the upstream are not
  recombined or re-chunked; `StreamingResponse` receives the adapter's `AsyncIterator[bytes]`
  directly.
- **No secret ever appears in a log or an exception message.** `secret.secret` never
  crosses into `LLMUpstreamError.detail` or any log line this package writes.

## Tests

Unit — nothing running:
- `parse_llm_call_context`: extracts `model`/`stream` from representative bodies; raises
  `ValueError` when `model` is absent; does not mutate or copy the input bytes object
  observably (assert the returned context, not a re-encoded body).
- `PassthroughLLMAdapter.relay_chat_completion` against a stubbed `httpx` transport
  (`httpx.MockTransport`, no real socket): a `StandardProviderDTO` secret produces a
  `Authorization: Bearer {key}` header; a `CustomProviderDTO` secret produces the same header
  from `provider.key`; `secret=None` sends no `Authorization` header at all.
- The same stub, but the transport raises/times out: `relay_chat_completion` raises
  `LLMUpstreamError`, never lets the exception surface as something else.
- The outbound URL is `route.base_url` + `/chat/completions` with `route.headers` merged in
  (non-secret routing headers) — assert against `httpx.MockTransport`'s captured request, not by
  reading the module's internals.

Contract — reuses WP5's fixture (`test_mock_adapters_contract.py`, extended once this adapter
exists): `PassthroughLLMAdapter` is added to the parametrized fixture asserting
`relay_chat_completion` returns `LLMRelayResult` for every input. Still nothing running (the
`httpx.MockTransport` stub, not a real mock).

Acceptance — needs the compose stack, WP5's `mock-llm-gateway` reachable, and WP7's service/
catalog/registry wired (i.e., this suite only runs post-M2, at Checkpoint A):
- A seeded custom endpoint pointing at `mock-llm-gateway`'s URL: `POST
  /gateways/llms/custom/{slug}/v1/chat/completions` with `"model": "mock/echo", "stream": true`
  streams back the exact SSE bytes the mock produced — byte comparison, not a re-decoded
  equivalence check.
- The same endpoint with `"model": "mock/slow-30"` and the endpoint's `config.timeout_seconds`
  set below 30: the gateway responds with a timeout error inside that window, not after 30s —
  the gateway's own request does not hang even though the upstream does.
- An unauthenticated request (no `Secret <token>`) is refused before reaching WP5's mock at all.
- A request naming a model outside the endpoint's allowlist is refused with `model_not_allowed`
  — proves WP7's allowlist check runs before WP6's relay is ever invoked.

## Done test

```bash
bash hosting/docker-compose/run.sh --oss --dev --build
curl -N -X POST http://localhost/api/gateways/llms/custom/<seeded-mock-slug>/v1/chat/completions \
  -H "Authorization: ApiKey <key>" -H "Content-Type: application/json" \
  -d '{"model": "mock/echo", "stream": true, "messages": [{"role":"user","content":"hi"}]}'
# observe SSE frames arriving unmodified, terminated by data: [DONE]

curl -m 5 -X POST http://localhost/api/gateways/llms/custom/<seeded-mock-slug>/v1/chat/completions \
  -H "Authorization: ApiKey <key>" -H "Content-Type: application/json" \
  -d '{"model": "mock/slow-30", "messages": [{"role":"user","content":"hi"}]}'
# curl's own 5s timeout is irrelevant; the assertion is that the GATEWAY returns before 30s
```

Matches `plan.md` WP6 verbatim: *"a streamed response is relayed unmodified and a hung upstream
times out rather than hanging the gateway."*

## Out of scope

- `core/gateways/llms/service.py`, `registry.py`, `catalog.py`, `providers/translated/` — WP7.
- `apis/fastapi/gateways/llms/router.py`, `models.py` (management CRUD) — WP10.
- `apis/fastapi/gateways/exceptions.py` — **the seed** (R1). Already on the branch when this
  package starts; import `handle_gateway_exceptions()`, never write a local copy.
- Anything on the MCP plane — WP8/WP9.
- Audit event emission itself (`publish_gateway_call`) — wave 2, WP4; WP6 must not add a second
  recording path even provisionally.

## Settled at kickoff — was "needs a ruling"

- **`GET /v1/models` has no backing service method → `LLMGatewayService.list_models`, R3.** It
  resolves one target by `(namespace, name)`, authorizes with `USE_LLM_ENDPOINTS`, and returns
  the allowlist as `List[str]`. WP7 owns it, this package calls it. The alternative considered
  and rejected — filtering `list_endpoints` client-side — pulls full entities for a listing use
  case on every models request, and re-derives a static catalogue each time for `builtin`.
- **`apis/fastapi/gateways/exceptions.py` → the seed, R1.** Already on the branch when this
  package forks; import the decorator.

## Missing from the design, needs a ruling

- **The default request timeout constant.** No document states a value. WP6 must pick one (a
  defensible number, e.g. 60s, is fine) and record it in code with a comment — flagged here so a
  reviewer knows it is this package's own call, not a transcribed design number.
