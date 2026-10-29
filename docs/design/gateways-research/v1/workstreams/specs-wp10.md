# WP10 — Endpoint CRUD API

Delivers the management CRUD surface for both gateways: `LLMGatewayRouter`,
`MCPGatewayRouter`, their request/response models, and the one shared
exception-mapping decorator both these routers and the two data-plane
proxies (WP6, WP8) use. **Creation and deletion only** — per-endpoint
configuration (timeouts, ceilings, extra headers, D21) is WP21, scheduled
after C3, not this package.

## Files

New:
- `api/oss/src/apis/fastapi/gateways/exceptions.py` — `handle_gateway_exceptions()` (§9).
- `api/oss/src/apis/fastapi/gateways/llms/router.py` — `LLMGatewayRouter` (§9).
- `api/oss/src/apis/fastapi/gateways/llms/models.py` — the LLM management wire models (§6).
- `api/oss/src/apis/fastapi/gateways/mcps/router.py` — `MCPGatewayRouter` (§9).
- `api/oss/src/apis/fastapi/gateways/mcps/models.py` — the MCP management wire models (§6).

Edited: none. `core/gateways/{llms,mcps}/service.py` are WP7's and WP9's,
already landed by IM1 (this package depends on IM1 and WP1, per `plan.md`).

## Interfaces

Reproduced verbatim from `entities.md` §6 and §9. Do not rename, do not add
routes, fields or parameters not listed here.

### Wire models (§6) — the house triple, plus connect

```python
# apis/fastapi/gateways/llms/models.py

class LLMEndpointCreateRequest(BaseModel):
    endpoint: LLMEndpointCreate

class LLMEndpointEditRequest(BaseModel):
    endpoint: LLMEndpointEdit

class LLMEndpointQueryRequest(BaseModel):
    endpoint: Optional[LLMEndpointQuery] = None
    windowing: Optional[Windowing] = None

class LLMEndpointResponse(BaseModel):
    count: int = 0
    endpoint: Optional[LLMEndpoint] = None

class LLMEndpointsResponse(BaseModel):
    count: int = 0
    endpoints: List[LLMEndpoint] = Field(default_factory=list)


# apis/fastapi/gateways/mcps/models.py

class MCPEndpointCreateRequest(BaseModel):
    endpoint: MCPEndpointCreate

class MCPEndpointEditRequest(BaseModel):
    endpoint: MCPEndpointEdit

class MCPEndpointQueryRequest(BaseModel):
    endpoint: Optional[MCPEndpointQuery] = None
    windowing: Optional[Windowing] = None

class MCPEndpointResponse(BaseModel):
    count: int = 0
    endpoint: Optional[MCPEndpoint] = None

class MCPEndpointsResponse(BaseModel):
    count: int = 0
    endpoints: List[MCPEndpoint] = Field(default_factory=list)

class MCPConnectRequest(BaseModel):
    """Begin the consent flow on one endpoint (WP18). Scopes are SELECTED, not
    inherited from everything the server advertises (D17)."""
    scopes: List[str] = Field(default_factory=list)

class MCPConnectResponse(BaseModel):
    count: int = 0
    redirect_url: Optional[str] = None
```

This is the same house triple `triggers/models.py` and `tools/models.py`
ship (read and confirmed — `TriggerSubscriptionCreateRequest` wraps
`subscription: TriggerSubscriptionCreate`, `TriggerSubscriptionResponse` is
`count: int = 0` plus `subscription: Optional[...]`, `TriggerSubscriptionsResponse`
is `count` plus `List[...]`). Use `Field(default_factory=list)` for list
defaults, not bare `[]`, matching `triggers/models.py`'s convention (not
`tools/models.py`'s, which uses bare `[]` — pick the newer, safer one since
a bare mutable default is a latent bug even though Pydantic normally copies
it; `triggers/models.py` is the more recently written file of the two).

**`MCPConnectRequest`/`MCPConnectResponse` are declared in `models.py` but
their route is not wired by this package** — see "Out of scope" below.

### `handle_gateway_exceptions()` (§9) — **seed-owned, read only**

**R1 moved this file to the seed.** It is already on the branch when this package
starts; import the decorator, do not write it. It is reproduced here because this
package's routers are its principal consumer and the mapping is what their behaviour
is specified against.

```python
# apis/fastapi/gateways/exceptions.py

def handle_gateway_exceptions():
    """Mapping, exactly as entities.md §9 states it:
    - *NotFoundError                     -> 404
    - PolicyDeniedError / EntitlementDeniedError -> 403
    - *NotAllowedError                   -> 403
    - CeilingExceededError               -> 400, body naming the ceiling,
                                             the requested and the allowed
                                             values (D25)
    - MCPAuthRequiredError               -> 409, carrying the
                                             GatewayConnectionRequirement
                                             (an interaction, not a
                                             failure — D17)
    - *UpstreamError                     -> 424, or 502 when the upstream
                                             answered >= 500 (the 424/502
                                             split tools and triggers
                                             already use)
    """
```

Modeled on `apis/fastapi/tools/router.py::handle_adapter_exceptions()` and
`apis/fastapi/triggers/router.py::handle_adapter_exceptions()` — both read
and confirmed structurally identical (`@wraps`-decorated closure catching
domain exceptions, re-raising as `HTTPException`, splitting 424 vs 502 on
whether `cause.response.status_code >= 500`). `entities.md` explicitly
says this decorator is "written once ... not duplicated per router" —
those two domains each duplicate their own copy verbatim; the gateways
domain does not repeat that mistake, and this file is the one place it
lives (§9). Both the CRUD routers (this package) and the two data-plane
proxies (WP6, WP8) import it from there — three consumers, which is
precisely why R1 put it in the seed rather than in any one package.

### The SSRF gate at registration (D28) — this package owns the save-time half

A `custom` MCP endpoint's URL arrives in a create or edit request body typed by a user,
and the gateway will later connect to it. WP8 guards the relay; this package guards the
save, and both are needed: a gate only at relay time accepts and stores a plainly-bad URL
and fails later at a confusing moment, while a gate only at save time leaves the window in
which a hostname's DNS answer changes after the row lands.

**Write no new guard, and use the no-DNS variant here:**

```python
from oss.src.core.webhooks.utils import validate_url_format_and_literal_ip
```

It checks scheme, host, absence of embedded credentials, and blocks a literal IP in a
private / loopback / link-local / reserved / multicast / unspecified range — **without a
DNS lookup**. The docstring states why the resolving variant is wrong at save time: it
would reject a hostname that happens to be momentarily unresolvable. The precedent to copy
is exact — `api/oss/src/core/secrets/dtos.py:140` gates `custom_provider.url` this way, on
the same kind of user-typed upstream URL, and re-raises with the field name in the message.

Applies to `custom` MCP endpoint create and edit only. `agenta` and `builtin` URLs are not
user-supplied — `agenta` is ours and `builtin` is the broker's — and neither is stored as a
row this router writes. The LLM plane's `custom` endpoints get the same gate if and when
they carry a base URL field; check the DTO before adding the call, and do not add it
speculatively.

A rejection is a 400 through the domain-exception path (`api/AGENTS.md`), never a leaked
`ValueError`. The message says which field was rejected and why.

**The flag makes the guard inert by default.** `AGENTA_INSECURE_EGRESS_ALLOWED` defaults to
`true` (`api/oss/src/utils/env.py`), so a unit test that does not set it `false` passes
while proving nothing. Set it explicitly in the test.

### `LLMGatewayRouter` (§9), in full

```python
class LLMGatewayRouter:
    def __init__(self, *, llm_gateway_service: LLMGatewayService):
        self.service = llm_gateway_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/endpoints/", self.create_endpoint, methods=["POST"],
            operation_id="create_llm_endpoint",
            response_model=LLMEndpointResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/endpoints/", self.list_endpoints, methods=["GET"],
            operation_id="list_llm_endpoints",
            response_model=LLMEndpointsResponse,
            response_model_exclude_none=True,
        )
        # GET /endpoints/ is the merged listing — generated + custom (§8);
        # POST /endpoints/query filters rows only, because generated endpoints
        # have nothing to filter on but the provider, which GET already shows.
        self.router.add_api_route(
            "/endpoints/query", self.query_endpoints, methods=["POST"],
            operation_id="query_llm_endpoints",
            response_model=LLMEndpointsResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/endpoints/{endpoint_id}", self.fetch_endpoint, methods=["GET"],
            operation_id="fetch_llm_endpoint",
            response_model=LLMEndpointResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/endpoints/{endpoint_id}", self.edit_endpoint, methods=["PUT"],
            operation_id="edit_llm_endpoint",
            response_model=LLMEndpointResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/endpoints/{endpoint_id}", self.delete_endpoint, methods=["DELETE"],
            operation_id="delete_llm_endpoint",
        )
```

One handler in full, the house body (§9) — decorators, scope, permission,
service, envelope:

```python
@intercept_exceptions()
@handle_gateway_exceptions()
async def create_endpoint(
    self,
    request: Request,
    *,
    body: LLMEndpointCreateRequest,
) -> LLMEndpointResponse:
    scope = get_auth_scope()
    await self._check(scope, Permission.EDIT_LLM_ENDPOINTS)

    endpoint = await self.service.create_endpoint(
        project_id=scope.project_id,
        user_id=scope.user_id,
        #
        endpoint=body.endpoint,
    )

    return LLMEndpointResponse(count=1 if endpoint else 0, endpoint=endpoint)
```

The other four LLM handlers (`list_endpoints`, `query_endpoints`,
`fetch_endpoint`, `edit_endpoint`, `delete_endpoint`) follow the same
shape: `get_auth_scope()`, one `self._check(scope, Permission.*)` call
(`VIEW_LLM_ENDPOINTS` for reads, `EDIT_LLM_ENDPOINTS` for writes), one
service call, one envelope. `fetch_endpoint`/`edit_endpoint`/`delete_endpoint`
404 (raise the domain `LLMEndpointNotFoundError`, mapped by
`handle_gateway_exceptions`) when the service returns `None`/`False` — the
service already returns `None` for "no such row" per §7's disambiguation
table (`edit_endpoint` → "the row does not exist" → "404 at the boundary").

### `MCPGatewayRouter` — same seven shapes (§9)

```python
# --- MCP management (MCPGatewayRouter) — same shapes ---
#   POST/GET   /endpoints/                 create_mcp_endpoint / list_mcp_endpoints
#   POST       /endpoints/query            query_mcp_endpoints
#   GET/PUT    /endpoints/{endpoint_id}    fetch_mcp_endpoint / edit_mcp_endpoint
#   DELETE     /endpoints/{endpoint_id}    delete_mcp_endpoint
#   POST       /endpoints/{endpoint_id}/connect   connect_mcp_endpoint  (WP18)
#   GET        /connect/callback                  mcp_connect_callback  (WP18)
```

**This package wires every route in that table except the two tagged
`(WP18)`.** `entities.md` tags `connect_mcp_endpoint` and
`mcp_connect_callback` explicitly with the package that owns them — this
package declares neither route, matching "Out of scope" below.

Permission checks: `VIEW_MCP_ENDPOINTS` for `list_endpoints`,
`query_endpoints`, `fetch_endpoint`; `EDIT_MCP_ENDPOINTS`
for `create_endpoint`, `edit_endpoint`, `delete_endpoint`.

### The permission-check helper — factored, following `triggers/router.py`

`entities.md`'s own `create_endpoint` example (§9, reproduced above) already
writes `await self._check(scope, Permission.EDIT_LLM_ENDPOINTS)` — a
one-line factored call, not an inlined `check_action_access(...)` /
`if not has_permission: raise FORBIDDEN_EXCEPTION` block repeated per
handler. Two existing precedents disagree on this, and this package must
pick one:

- `apis/fastapi/tools/router.py` **inlines** the check in every handler
  (read and confirmed: `list_providers`, `get_provider`,
  `create_connection`, `call_tool` etc. each repeat the same four-line
  `has_permission = await check_action_access(...); if not has_permission:
  raise FORBIDDEN_EXCEPTION` block, reading `request.state.user_id` /
  `request.state.project_id` as strings).
- `apis/fastapi/triggers/router.py` **factors** it into
  `async def _check(self, request: Request, permission) -> None`, called
  as `await self._check(request, Permission.EDIT_TRIGGERS)` — used
  throughout the subscriptions, schedules and deliveries sections (its
  catalog and connections sections still inline the check, an
  inconsistency within that same file, not a second convention to copy).

**This package uses the factored form**, adapted to take `scope: AuthScope`
rather than `request: Request` — because `entities.md`'s own worked example
already writes the call this way, and because `AuthScope` (not
`request.state`) is the explicit house rule for new gateway code (§9: "the
existing gateway, tools and triggers routers read `request.state.project_id`
/ `request.state.user_id` as raw strings and re-wrap them in `UUID(...)`
per call site; the design's principal claims (D2) rest on `AuthScope`").
The helper:

```python
async def _check(self, scope: AuthScope, permission: Permission) -> None:
    has_permission = await check_action_access(
        user_uid=str(scope.user_id),
        project_id=str(scope.project_id),
        permission=permission,
    )
    if not has_permission:
        raise FORBIDDEN_EXCEPTION
```

One `_check` per router class (`LLMGatewayRouter._check`,
`MCPGatewayRouter._check`), not shared across the two — matching
`TriggersRouter._check`'s scope (one router, one helper), and keeping each
router's file self-contained per `workstreams/README.md`'s one-owner-per-file
rule.

## Contracts this package must honour

- **Collection routes keep their trailing slash** (§9, `api/AGENTS.md`).
  `/endpoints/`, not `/endpoints`.
- **Every route sets `operation_id` and `response_model_exclude_none=True`**
  (§9) — matches the house convention `api/AGENTS.md` states generally
  ("Request/response conventions: ... Set explicit `operation_id` on
  routes").
- **`AuthScope` over `request.state`**, unconditionally, in every new
  handler (§9, D2).
- **Edits are full PUTs.** `LLMEndpointEdit`/`MCPEndpointEdit` require
  `data`/`flags` (no partial patch semantics) — the channels-design rule
  `entities.md` §4.3/§4.4 already encodes into the DTOs themselves; this
  package does not add partial-update logic on top.
- **A standard/builtin endpoint is structurally unreachable through this
  router.** Generated entries carry no `id` (§8: "no id and no lifecycle —
  it is not a row"); the path parameter `{endpoint_id}` is a UUID. There is
  no way to construct a `PUT /endpoints/{endpoint_id}` request that
  addresses a builtin entry — this is what "a standard one cannot be
  edited" (the stated done test) means concretely: not a permission check
  that blocks it, but the absence of an address.
- **`SecretSafeRoute` (`apis/fastapi/vault/router.py`) is deliberately NOT
  applied to these routers.** Read and confirmed: it exists because the
  vault's create/update payloads carry raw secret material, and a
  validation error otherwise echoes the submitted value back
  (`RequestValidationError`'s `input` field). The gateway CRUD payloads
  never carry secret material directly — `secret_id` is a UUID pointer
  (§4.4: "the id is a pointer; reading the material it points at still
  takes `VIEW_SECRET` through the vault") and `MCPEndpointData.headers` is
  explicitly documented as "non-secret routing headers only" (§4.4). A
  validation error on these routes has nothing sensitive to leak, so the
  extra route class is not warranted here — noted as a deliberate
  omission, not an oversight.

## Settled at kickoff — was "needs a ruling"

- **`apis/fastapi/gateways/exceptions.py` → the seed (R1).** Three packages need
  `handle_gateway_exceptions()` — this one and both proxies (WP6, WP8) — and
  `plan.md`'s dependency graph listed the three as siblings depending only on IM1,
  so no one of them could own it without inventing a dependency. It is now written
  once in the seed, before any worktree forks, and all three import it.
- **The SSRF gate at registration → this package (R7, D28).** Section above.

## Test layer

- Wire model instantiation (the C0-style check the channels template
  applies) — **unit**. Every model in `models.py` constructs with
  representative values.
- `handle_gateway_exceptions()`'s mapping — **unit**. For each domain
  exception in the table, raise it from a dummy decorated function and
  assert the resulting `HTTPException`'s status code and body shape (the
  `CeilingExceededError` case additionally asserts the body names the
  ceiling, requested and allowed values; the `MCPAuthRequiredError` case
  asserts the body carries the `GatewayConnectionRequirement`).
- Router wiring (which handler each route reaches, the `_check` calls) —
  **unit**, via `TestClient` against a bare `APIRouter` mounted with a mock
  `LLMGatewayService`/`MCPGatewayService` and a mockd `get_auth_scope()` /
  `check_action_access()`. Assert: each route's operation_id, method and
  path match the table above; a denied `_check` short-circuits before the
  service is called (assert the mock service's call count is zero); a
  `None` return from `fetch_endpoint`/`edit_endpoint` maps to 404;
  `delete_endpoint` on a `False` return maps to 404.
- The "standard endpoint cannot be edited" claim — **unit** is enough to
  prove the structural part (there is no way to type a builtin entry's
  identity into `{endpoint_id}: UUID`), but the full round trip (create a
  custom endpoint, confirm the builtin catalogue entries are absent from
  `/endpoints/{id}` addressability) is **integration**, needing WP1's real
  DAO and WP9's real `list_endpoints` merge behind a real Postgres.
- CRUD round trip (create → fetch → edit → delete, and query filtering) —
  **integration**, needs Postgres (WP1's tables) and the real
  `LLMGatewayService`/`MCPGatewayService` (WP7/WP9).

## Executable done test

Plan.md's stated done condition, verbatim: *"a custom endpoint can be
created and deleted, and a standard one cannot be edited."* Concretely:

```text
POST /gateways/mcps/endpoints/  {endpoint: {slug: "acme-notion", auth_mode: "none", data: {url: "https://..."}}}
  -> 200, endpoint.id is a UUID

DELETE /gateways/mcps/endpoints/{that id}
  -> 204 (or 200 per the delete shape already in use elsewhere), row gone

GET /gateways/mcps/endpoints/{a builtin entry's synthetic identity, if one
    could even be constructed — it cannot, because builtin entries carry no
    id}
  -> there is no request that reaches a builtin entry through this router;
     PUT against any UUID not present in mcps_endpoints returns 404
```

## Out of scope

- `POST /endpoints/{endpoint_id}/connect` (`connect_mcp_endpoint`) and
  `GET /connect/callback` (`mcp_connect_callback`) — explicitly tagged
  `(WP18)` in `entities.md` §9. Do not wire these routes; they arrive with
  wave 3's consent flow.
- Per-endpoint configuration (timeouts, ceilings, extra headers) — **WP21**,
  after C3 (D21, `plan.md`).
- The data-plane proxies (`apis/fastapi/gateways/{llms,mcps}/proxy.py`) and
  their `utils.py` — **WP6** (LLM), **WP8** (MCP).
- `core/gateways/{llms,mcps}/service.py` and everything behind it (target
  resolution, secret resolution, the namespace merges) — **WP7**
  (LLM), **WP9** (MCP).
- `core/access/permissions/types.py`'s six new members — **WP3**, already
  landed by IM1.

## Checkpoint

Feeds **C1**, together with WP6, WP7, WP8, WP9 at the IM2 merge.

## `api/entrypoints/routers.py` diff

This file is never owned by a package. WP10 contributes the two CRUD
router constructions and mounts, applied together with WP6's and WP8's
proxy mounts (and WP7's/WP9's service-construction fragments, which these
constructors depend on) at the IM2 merge:

```diff
+from oss.src.apis.fastapi.gateways.llms.router import LLMGatewayRouter
+from oss.src.apis.fastapi.gateways.mcps.router import MCPGatewayRouter
+
+llm_gateway_router = LLMGatewayRouter(llm_gateway_service=llm_gateway_service)
+mcp_gateway_router = MCPGatewayRouter(mcp_gateway_service=mcp_gateway_service)
```

```diff
+app.include_router(
+    router=llm_gateway_router.router,
+    prefix="/gateways/llms",
+    tags=["Gateway: LLM"],
+)
+app.include_router(
+    router=mcp_gateway_router.router,
+    prefix="/gateways/mcps",
+    tags=["Gateway: MCP"],
+)
```

(`llm_gateway_service` and `mcp_gateway_service` are the shared instances
WP7 and WP9 construct — this fragment attaches to theirs, exactly the
pattern `workstreams/README.md` describes: "the plane's `service.py`
belongs to the domain package ... the ingress calls it through the
declaration the seed froze." The local variable names are wiring
convenience; the class names, constructor keyword, `prefix` and `tags`
values are load-bearing, taken verbatim from §9.)
