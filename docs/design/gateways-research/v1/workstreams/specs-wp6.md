# WP6 — LLM ingress and relay

The OpenAI-compatible north-port surface for the model plane: the proxy router, streaming, the
request body kept byte for byte, and timeouts. This is the **transport** half of the LLM
gateway — the ingress package, per `workstreams/README.md`'s central cut: "on each plane,
transport and domain are different packages... WP6 and WP8 own the HTTP surface, streaming,
timeouts and the byte-for-byte relay. WP7 and WP9 own the service, the registry, the catalogue
and the allowlists." WP6 therefore never decides *which* endpoint a call reaches or *whether* it
is allowed — it parses the caller's request, calls `LlmGatewayService.relay_chat_completion`
(WP7's method, called through the seed-frozen signature), and relays the answer back exactly as
it arrived.

**Explicitly not built here, and who owns it instead:**
- Endpoint resolution, the allowlist check, the ceiling check, policy authorization, credential
  resolution, and the choice of south-port adapter (`select_upstream`) — all inside
  `LlmGatewayService.relay_chat_completion`, owned by **WP7**.
- The adapter that translates through the routing library for non-OpenAI-shaped upstreams
  (Anthropic direct, Azure, Bedrock, SageMaker, Vertex) — `providers/translated/adapter.py`,
  **WP7**.
- The fake upstream this package's own acceptance tests reach — **WP5**.
- The shared exception→HTTP-status mapping, `handle_gateway_exceptions()` — **WP10**
  (`apis/fastapi/gateways/exceptions.py`); WP6 consumes it, does not define it.
- The management CRUD for LLM endpoints (`router.py`, `models.py`) — **WP10**.

## Files

New:
- `apis/fastapi/gateways/llms/proxy.py` — `LlmGatewayProxy`
- `apis/fastapi/gateways/llms/utils.py` — `parse_llm_call_context`
- `core/gateways/llms/providers/passthrough/adapter.py` — `PassthroughLlmAdapter`
- `core/gateways/llms/providers/passthrough/__init__.py`

Edited: `api/entrypoints/routers.py` — proxy router mount + `PassthroughLlmAdapter` import and
registry entry (diff below). No other file; WP6 does not touch `core/gateways/llms/service.py`,
`registry.py`, or `catalog.py` (all WP7).

## Interfaces

Reproduced verbatim from `entities.md` §7.1 and §9. Do not rename, do not add parameters not
listed here.

### The south port this package implements

```python
# core/gateways/llms/interfaces.py (seed-owned)

@dataclass
class LlmRelayResult:
    status_code: int
    headers: Dict[str, str]
    body: AsyncIterator[bytes]
    usage: Optional[GatewayUsage] = None

class LlmUpstreamInterface(ABC):
    @abstractmethod
    async def relay_chat_completion(
        self, *, route: LlmResolvedRoute, credential: Optional[ResolvedCredential],
        context: LlmCallContext, body: bytes, headers: Dict[str, str],
    ) -> LlmRelayResult:
        """Relay one completion call. `body` is the caller's payload untouched;
        `headers` are the caller's headers already stripped of authorization.
        `credential` is None only for targets whose auth scheme is NONE (the
        fakes). Raises LlmUpstreamError on upstream failure."""
```

```python
# core/gateways/llms/providers/passthrough/adapter.py

class PassthroughLlmAdapter(LlmUpstreamInterface):
    async def relay_chat_completion(
        self, *, route, credential, context, body, headers,
    ) -> LlmRelayResult: ...
```

Which providers land here versus `translated` is `select_upstream`'s decision (WP7,
`core/gateways/llms/registry.py`) — per §7.1: "**passthrough** for upstreams that speak the
caller's protocol (OpenAI-compatible: `deployment=custom`, and direct providers whose API is
OpenAI-shaped)." WP6 builds an adapter correct for that whole class, without needing the
provider list itself.

### `LlmResolvedRoute` (input, seed-owned, `core/gateways/llms/dtos.py` §4.3)

```python
class LlmResolvedRoute(BaseModel):
    provider_key: str
    deployment: LlmDeploymentKind
    model: str
    base_url: Optional[str] = None
    api_version: Optional[str] = None
    region: Optional[str] = None
    headers: Optional[Dict[str, str]] = None
    config: LlmEndpointConfig = Field(default_factory=LlmEndpointConfig)
```

`config.timeout_seconds` (inherited from `GatewayEndpointConfig`, §4.1) is the per-call timeout;
`None` on every generated endpoint (§2.4: "generated endpoints take the code defaults") — this
package supplies that default, since timeouts are WP6's stated scope in `plan.md`.

### `ResolvedCredential` and its two relevant secret shapes

`ResolvedCredential.secret: SecretResponseDTO`, kind-dispatched by the adapter (§4.2: "the
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

`credential.secret.data` is one of these (a `SecretDTO` union member, §4.5). For a `provider_key`
secret (`StandardProviderDTO`), inject `Authorization: Bearer {provider.key}`. For a
`custom_provider` secret (`CustomProviderDTO`), inject `provider.key` the same way and merge
`provider.extras` into the outbound request's non-body configuration (headers only — never the
JSON body, which stays byte for byte). This mirrors the SDK's own dispatch in
`get_provider_settings`/`get_provider_settings_from_workflow`
(`sdks/python/agenta/sdk/managers/secrets.py` lines 228–255 and 372–399, read in full): both copies
branch on `secret.get("kind") == "provider_key"` vs `"custom_provider"` identically — the same
branch this adapter needs, moved behind the gateway.

**`credential` is `None` for the fakes** (`GatewayAuthScheme`-equivalent NONE targets, §2 —
"an endpoint with no credential is legitimate — the fake (D23)"): no `Authorization` header is
sent at all.

### `apis/fastapi/gateways/llms/utils.py`

```python
def parse_llm_call_context(*, body: bytes) -> LlmCallContext:
    """Extract model and stream from the JSON body without materializing a
    parsed copy for relay — the body itself stays byte-for-byte (§7.1).
    Raises ValueError when the body names no model; the proxy translates that
    into the surface's own invalid-request error shape."""
```

`LlmCallContext` (seed-owned, §4.3): `model: str`, `stream: bool = False`. This function reads
just enough of the body (`json.loads`, two keys) to route and to pick a timeout; it must not
construct a new serialized body anywhere in the relay path — `body: bytes` stays the same object
handed to the adapter.

### `apis/fastapi/gateways/llms/proxy.py`

Route declarations verbatim from `entities.md` §9:

```python
class LlmGatewayProxy:
    def __init__(self, *, llm_gateway_service: LlmGatewayService):
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
catalogue for builtin, `model_slugs` for custom" (§9's comment on the route declarations) — see
**Missing from the design** below; the service method this needs is not in the frozen §8 surface.

**Audit timing is not this package's problem.** §9: "Streaming rides `StreamingResponse` over
`LlmRelayResult.body`, with the audit record written in the handler's finally after the iterator
is exhausted (§8)." Read together with §8's own note — "for a streamed body the outcome's usage
is read off the `LlmRelayResult` after exhaustion... the surface drains, the service records in a
finally" — the wrapping that fires `policy.record(...)` on exhaustion is `LlmGatewayService`'s own
`finally` around the iterator it returns (WP7's job). WP6's handler only has to drain
`result.body` through `StreamingResponse`; it must **not** add its own `try/finally` calling into
policy, because `LlmGatewayProxy` never holds a `GatewayPolicyService` reference (its constructor
takes only `llm_gateway_service`) — if this reading is wrong, it is a WP7 spec bug, not a WP6 one.

### Error shape

Denials wear the surface's own error shape (§9): `{"error": {"message", "type", "code"}}`, `code`
carrying a stable cause — `policy_denied`, `model_not_allowed`, `ceiling_exceeded`,
`credential_missing` are the four `entities.md` names explicitly. The mapping from domain
exception to HTTP status is `handle_gateway_exceptions()` (WP10, not yet built when WP6 starts
per the wave-1 fan-out — both run against M1 in parallel). Until that merge, `proxy.py` catches
the domain exceptions it can already type against (everything in `core/gateways/llms/types.py`
and `core/gateways/policy/types.py`, all seed-owned) directly and renders the OpenAI body itself;
reconcile with WP10's shared decorator at the M2 merge rather than blocking on it — this is a
merge-point conversation per `workstreams/README.md` rule 1, not a WP6 commit that waits.

What must never happen: leaking the house envelope (`count`, entity-wrapped) onto this surface,
or rewriting the upstream's own error body once a call reaches `PassthroughLlmAdapter` — a
`LlmUpstreamError` raised there passes its `detail` through untouched (D16's pass-through rule,
`api/AGENTS.md`'s error-envelope scope).

## `api/entrypoints/routers.py` diff

```diff
+from oss.src.core.gateways.llms.providers.passthrough.adapter import PassthroughLlmAdapter
+from oss.src.apis.fastapi.gateways.llms.proxy import LlmGatewayProxy
...
+llm_gateway_proxy = LlmGatewayProxy(llm_gateway_service=llm_gateway_service)
...
 app.include_router(router=llm_gateway.router,  prefix="/gateways/llms", tags=["Gateway: LLM"])
+app.include_router(router=llm_gateway_proxy.router, prefix="/gateways/llms", include_in_schema=False)
```

The `upstream_registry=LlmUpstreamRegistry(adapters={"passthrough": PassthroughLlmAdapter(), ...})`
dict entry is WP7's edit inside its own service-construction block (`entities.md` §9's wiring
snippet) — WP6 contributes the import and the proxy mount only.

## Contracts this package must honour

- **Byte-for-byte, no exceptions inside this adapter's reach.** `scope-checklist.md`: "Body
  byte-for-byte, **both gateways**... on the model side it is what keeps prompt caching working."
  `PassthroughLlmAdapter` never deserializes and re-serializes `body`; it forwards the exact bytes
  it received, adding only transport-level auth (a header, never a body mutation).
- **The proxy carries no wire models** (§6) — house-style `models.py` request/response classes
  never appear on `proxy.py`'s routes.
- **`AuthScope` via `get_auth_scope()`, never `request.state`** (§9) — the design's explicit
  correction of the existing gateway/tools/triggers habit.
- **Timeout is enforced here, not assumed away.** `plan.md` WP6's own done condition: "a hung
  upstream times out rather than hanging the gateway." `PassthroughLlmAdapter` wraps its upstream
  call in `asyncio.wait_for`/an `httpx` client timeout keyed on `route.config.timeout_seconds`
  (falling back to this package's own default when `None`), and on expiry raises
  `LlmUpstreamError(provider_key=route.provider_key, status_code=None, detail="upstream timed
  out")` — never lets the coroutine hang the request indefinitely.
- **Streaming preserves ordering and framing.** SSE chunk boundaries from the upstream are not
  recombined or re-chunked; `StreamingResponse` receives the adapter's `AsyncIterator[bytes]`
  directly.
- **No credential ever appears in a log or an exception message.** `credential.secret` never
  crosses into `LlmUpstreamError.detail` or any log line this package writes.

## Tests

Unit — nothing running:
- `parse_llm_call_context`: extracts `model`/`stream` from representative bodies; raises
  `ValueError` when `model` is absent; does not mutate or copy the input bytes object
  observably (assert the returned context, not a re-encoded body).
- `PassthroughLlmAdapter.relay_chat_completion` against a stubbed `httpx` transport
  (`httpx.MockTransport`, no real socket): a `StandardProviderDTO` credential produces a
  `Authorization: Bearer {key}` header; a `CustomProviderDTO` credential produces the same header
  from `provider.key`; `credential=None` sends no `Authorization` header at all.
- The same stub, but the transport raises/times out: `relay_chat_completion` raises
  `LlmUpstreamError`, never lets the exception surface as something else.
- The outbound URL is `route.base_url` + `/chat/completions` with `route.headers` merged in
  (non-secret routing headers) — assert against `httpx.MockTransport`'s captured request, not by
  reading the module's internals.

Contract — reuses WP5's fixture (`test_fake_adapters_contract.py`, extended once this adapter
exists): `PassthroughLlmAdapter` is added to the parametrized fixture asserting
`relay_chat_completion` returns `LlmRelayResult` for every input. Still nothing running (the
`httpx.MockTransport` stub, not a real fake).

Acceptance — needs the compose stack, WP5's `fake-llm-gateway` reachable, and WP7's service/
catalog/registry wired (i.e., this suite only runs post-M2, at Checkpoint A):
- A seeded custom endpoint pointing at `fake-llm-gateway`'s URL: `POST
  /gateways/llms/custom/{slug}/v1/chat/completions` with `"model": "fake/echo", "stream": true`
  streams back the exact SSE bytes the fake produced — byte comparison, not a re-decoded
  equivalence check.
- The same endpoint with `"model": "fake/slow-30"` and the endpoint's `config.timeout_seconds`
  set below 30: the gateway responds with a timeout error inside that window, not after 30s —
  the gateway's own request does not hang even though the upstream does.
- An unauthenticated request (no `Secret <token>`) is refused before reaching WP5's fake at all.
- A request naming a model outside the endpoint's `model_slugs` is refused with `model_not_allowed`
  — proves WP7's allowlist check runs before WP6's relay is ever invoked.

## Done test

```bash
bash hosting/docker-compose/run.sh --oss --dev --build
curl -N -X POST http://localhost/api/gateways/llms/custom/<seeded-fake-slug>/v1/chat/completions \
  -H "Authorization: ApiKey <key>" -H "Content-Type: application/json" \
  -d '{"model": "fake/echo", "stream": true, "messages": [{"role":"user","content":"hi"}]}'
# observe SSE frames arriving unmodified, terminated by data: [DONE]

curl -m 5 -X POST http://localhost/api/gateways/llms/custom/<seeded-fake-slug>/v1/chat/completions \
  -H "Authorization: ApiKey <key>" -H "Content-Type: application/json" \
  -d '{"model": "fake/slow-30", "messages": [{"role":"user","content":"hi"}]}'
# curl's own 5s timeout is irrelevant; the assertion is that the GATEWAY returns before 30s
```

Matches `plan.md` WP6 verbatim: *"a streamed response is relayed unmodified and a hung upstream
times out rather than hanging the gateway."*

## Out of scope

- `core/gateways/llms/service.py`, `registry.py`, `catalog.py`, `providers/translated/` — WP7.
- `apis/fastapi/gateways/llms/router.py`, `models.py` (management CRUD) — WP10.
- `apis/fastapi/gateways/exceptions.py` — WP10.
- Anything on the MCP plane — WP8/WP9.
- Audit event emission itself (`publish_gateway_call`) — wave 2, WP4; WP6 must not add a second
  recording path even provisionally.

## Missing from the design, needs a ruling

- **`GET /v1/models` has no backing service method.** `entities.md` §9 describes the *behavior*
  ("`/v1/models` answers from the allowlist — the static catalogue for builtin, `model_slugs` for
  custom") but §8's frozen `LlmGatewayService` surface has no method that returns one endpoint's
  model list by `(namespace, name)` — only `list_endpoints` (every namespace, full entities) and
  the private `_resolve_target` (service-internal, not exported). WP6 cannot call a name that
  does not exist and does not own `service.py` to add one. Raise at the M1→M2 merge: either WP7
  adds a public method (e.g. resolving one target and returning just `data.model_slugs`), or WP6
  is told to filter `list_endpoints`'s result client-side (works for `custom` since `slug` is
  unique, but `list_endpoints` returns full `LlmEndpoint` objects for a listing use case, not a
  models-endpoint use case, and doing this per request is wasteful for `builtin` where the
  catalogue is static). Do not implement either option without WP7 confirming which.
- **The default request timeout constant.** No document states a value. WP6 must pick one (a
  defensible number, e.g. 60s, is fine) and record it in code with a comment — flagged here so a
  reviewer knows it is this package's own call, not a transcribed design number.
