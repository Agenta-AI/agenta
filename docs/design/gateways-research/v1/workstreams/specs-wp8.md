# WP8 — MCP ingress and proxy

Delivers the MCP gateway's data-plane HTTP surface: one router class,
`McpGatewayProxy`, declaring the three namespaced relay routes over the
route grammar D27 settles, plus the one south-port adapter that turns a
resolved route and a resolved credential into a real Streamable HTTP call
against a `custom` server. Owns the transport and the byte-for-byte relay;
does **not** own routing decisions, allowlist enforcement, credential
resolution or the builtin/agenta merge — those are `McpGatewayService`
(WP9). This is the cut `workstreams/README.md` names: "on each plane,
transport and domain are different packages."

## Files

New:
- `api/oss/src/apis/fastapi/gateways/mcps/proxy.py` — `McpGatewayProxy`
  (§9): three POST routes plus the shared 405 handler for the stream
  verbs.
- `api/oss/src/apis/fastapi/gateways/mcps/utils.py` — `parse_mcp_call_context`
  (§9): the one pure function that reads the caller's request for routing.
- `api/oss/src/core/gateways/mcps/providers/http/adapter.py` — `HttpMcpAdapter`,
  the `McpUpstreamInterface` implementation for remote Streamable HTTP
  servers (`custom`, per the wiring block in §9: registered under the
  `"http"` key).

Edited: none. `core/gateways/mcps/{dtos,types,interfaces}.py` are seed-owned
and frozen; `core/gateways/mcps/service.py` and `registry.py` are WP9's.

## Interfaces

Reproduced verbatim from `entities.md` §7.1 and §9. Do not rename, do not
add routes or parameters not listed here.

### The route grammar — three shapes, three different arities (D27, §2.3)

```text
/gateways/mcps/agenta/{slug}                                  agenta/tools
/gateways/mcps/builtin/{provider}/{integration}/{connection}  builtin/composio/notion/my-notion
/gateways/mcps/custom/{slug}                                  custom/acme-notion
```

- **`agenta/{slug:path}`** — a **catch-all path parameter**, not a single
  component. An `agenta` identifier is a slug this codebase owns and may
  carry `/` separators (`agenta/tools/search` is one endpoint whose slug is
  `tools/search`, §2.3), so the route parameter must accept `/` inside it.
  FastAPI's `{slug:path}` converter is the mechanism; a plain `{slug}`
  component would 404 on the first nested identifier.
- **`builtin/{provider}/{integration}/{connection}`** — **three fixed path
  components**, one per segment of the brokered connection's own unique key
  minus the project (`gateway_connections`'s `(project_id, provider_key,
  integration_key, slug)`, §2.3). No catch-all: none of the three segments
  is ever nested.
- **`custom/{slug}`** — **one fixed path component**. The slug is unique
  per project (`uq_mcp_gateway_endpoints_project_slug`), never nested.

The three routes cannot collide with the CRUD router's paths sharing the
same `/gateways/mcps` prefix (`router.py`, WP10) because the CRUD paths
start with `endpoints` or `grants`, and none of `agenta | builtin | custom`
can spell either (§9).

### `McpGatewayProxy` (§9)

```python
class McpGatewayProxy:
    def __init__(self, *, mcp_gateway_service: McpGatewayService):
        self.service = mcp_gateway_service
        self.router = APIRouter()

        # One URL per server (D16). Streamable HTTP, stateless JSON mode:
        # POST carries JSON-RPC; GET/DELETE answer 405, as the runner's
        # internal tool server already does. No version segment: the MCP
        # protocol is a POST to the endpoint URL itself, revision negotiated
        # in a header (§2.3). One route per namespace, per the grammar —
        # agenta takes a catch-all because its slug may be nested; builtin
        # takes the three fixed components of the connection's unique key.
        self.router.add_api_route(
            "/agenta/{slug:path}", self.relay_agenta, methods=["POST"],
            operation_id="mcp_gateway_relay_agenta",
        )
        self.router.add_api_route(
            "/builtin/{provider}/{integration}/{connection}",
            self.relay_builtin, methods=["POST"],
            operation_id="mcp_gateway_relay_builtin",
        )
        self.router.add_api_route(
            "/custom/{slug}", self.relay_custom, methods=["POST"],
            operation_id="mcp_gateway_relay_custom",
        )
        # the same three paths answer GET/DELETE with 405 via
        # self.reject_stream_verbs, include_in_schema=False — elided
```

The three handlers "are thin ... they exist because the routes carry
different path parameters, not because the behaviour differs" (§9): each
parses headers via `parse_mcp_call_context`, reads `get_auth_scope()`, and
delegates to `self.service.relay(...)` with its own namespace and path
segments. `relay_builtin` passes `provider`/`integration` in addition to
`name` (the `connection` segment); `relay_agenta` and `relay_custom` pass
only `name` (the slug).

`reject_stream_verbs` answers GET and DELETE on the same three paths with
405, `include_in_schema=False` — the shape the runner's own internal MCP
server already uses for the Streamable-HTTP stream-management verbs it does
not implement (`services/runner/src/tools/tool-mcp-http.ts`, lines 367–371:
`if (req.method !== "POST") { res.writeHead(405, ...) }`).

### `parse_mcp_call_context` (§9)

```python
# apis/fastapi/gateways/mcps/utils.py
def parse_mcp_call_context(*, headers: Dict[str, str]) -> McpCallContext:
    """Read the protocol's method and target headers (`mcp.md`, header-based
    routing) — the body is never parsed for routing. Header names are pinned
    against the 2026-07-28 revision at implementation time, in this one file."""
```

`McpCallContext` (seed, `core/gateways/mcps/dtos.py`, §4.4):

```python
class McpCallContext(BaseModel):
    method: str
    target: Optional[str] = None
```

The exact header names are **not** given in `entities.md` — the docstring
above says so explicitly ("pinned ... at implementation time, in this one
file"), so this is deferred implementation work, not a design gap. `mcp.md`
only establishes that the revision moved method and target routing onto
required HTTP headers (§"Three changes that are explicitly about
intermediaries" — "Header-based routing").

### The south port: `McpUpstreamInterface` and `HttpMcpAdapter` (§7.1)

```python
# core/gateways/mcps/interfaces.py (seed, frozen — read only)

@dataclass
class McpRelayResult:
    """A single JSON answer. The gateway targets the stateless revision in JSON
    mode — one request, one `application/json` response, 202 for notifications
    (`mcp.md`; the in-tree precedent is the runner's internal tool server,
    services/runner/src/tools/tool-mcp-http.ts). No SSE leg to carry."""
    status_code: int
    headers: Dict[str, str]
    body: bytes


class McpUpstreamInterface(ABC):
    @abstractmethod
    async def relay(
        self,
        *,
        route: McpResolvedRoute,
        auth: McpRelayAuth,
        #
        context: McpCallContext,
        body: bytes,
        headers: Dict[str, str],
    ) -> McpRelayResult:
        """Transparent per-server relay (D16): same method, same body, same
        response, with only the route and the authorization changed. `auth` is
        the discriminated union from §4.4 — McpDirectAuth for agenta and custom,
        McpBrokeredAuth for builtin — so the two credential mechanisms cannot be
        conflated by an adapter (D27). Raises McpUpstreamError on transport
        failure; protocol-level errors from the server are NOT exceptions — they
        are the response body, relayed, because the server's own failure reason
        is what lets the model correct itself (the pass-through rule in
        api/AGENTS.md's error-envelope scope)."""
        ...
```

`McpResolvedRoute` (seed, §4.4):

```python
class McpResolvedRoute(BaseModel):
    url: str
    headers: Dict[str, str] = Field(default_factory=dict)
    config: McpEndpointConfig = Field(default_factory=McpEndpointConfig)
```

`McpDirectAuth` / `McpRelayAuth` (seed, §4.4 — reproduced so the adapter's
input shape is unambiguous):

```python
class McpDirectAuth(BaseModel):
    """agenta + custom: the credential is ours to present — an oauth_grant
    resolved from the vault (§7.2), or nothing for a NONE-scheme target."""
    credential: Optional[ResolvedCredential] = None

class McpBrokeredAuth(BaseModel):
    """builtin: the integrations domain brokered the authorization and holds the
    credential upstream; what we carry is its connection row."""
    connection: Connection

McpRelayAuth = Union[McpDirectAuth, McpBrokeredAuth]
```

`HttpMcpAdapter(McpUpstreamInterface)` implements `relay()` against
`McpDirectAuth` only — it is registered under the `"http"` key and is only
ever reached via the `custom` namespace (§4.4: "builtin and custom are two
credential mechanisms ... the fork is real behaviour ... at the south
port"). It never receives `McpBrokeredAuth`; that arm is `ComposioMcpAdapter`
(a separate provider, out of this package's ownership per
`workstreams/README.md`'s file table, and out of scope entirely — no work
package in wave 1 owns it, since `builtin` MCP servers are not called in
Checkpoint A under D23).

Body: POST `body` verbatim to `route.url`, with `route.headers` (the
endpoint's own non-secret configured headers, §2.4) merged under the
caller's forwarded `headers` (already stripped of Agenta's own
authorization, §7.1's LLM-side analog), plus one derived header when
`auth.credential` is present. The exact translation from a `ResolvedCredential`
into a wire header depends on which secret kind backs it —
`OAuthGrantSettingsDTO.access_token` / `.token_type` (`entities.md` §4.5) is
the only populated shape reachable in this wave, and it maps to
`Authorization: {token_type} {access_token}`. **In Checkpoint A this branch
is unreachable in practice**: D23 restricts wave 1's reachable MCP targets
to unauthenticated servers (`auth_mode = NONE`) and the fakes, and OAuth
grants do not exist until WP16/WP17 (wave 3). Implement the credential
branch so the type-checks against `entities.md`'s frozen shapes, but do not
build integration tests that depend on a real grant existing — there is
nothing to grant yet.

No JSON-RPC parsing happens in the adapter. `McpRelayResult` carries
whatever `status_code`, `headers` and `body` the upstream returned,
untouched — the pass-through discipline in `api/AGENTS.md`'s error-envelope
scope ("the gateway and workflow-tool arms carry their upstream's shape").
Any tool-list filtering by policy happens one layer up, in
`McpGatewayService.relay` (WP9) — that requires inspecting the JSON body,
which is a service-level concern, not this adapter's.

## Contracts this package must honour

- **Transparent per server (D16).** Tool names, schemas, error bodies pass
  through byte for byte. The proxy must never rewrite a name; the slug-grammar
  precedent for why is already in the tree
  (`apis/fastapi/tools/utils.py::parse_tool_slug`, cited in `entities.md`
  §2.3).
- **No wire models on the proxy** (§6). The data plane has no
  `models.py` entry — request and response bodies are relayed as bytes.
- **`AuthScope` over `request.state`** (§9, D2). Handlers call
  `get_auth_scope()`, never `request.state.project_id` /
  `request.state.user_id`.
- **Exceptions are mapped once, not duplicated.** `handle_gateway_exceptions()`
  lives in `apis/fastapi/gateways/exceptions.py`, owned by **WP10**, not this
  package. WP8's proxy handlers use `@intercept_exceptions()` and
  `@handle_gateway_exceptions()` exactly as `router.py` does (§9) — this is a
  real cross-package dependency the plan does not name explicitly (see
  "Missing / contradictory" below); code `proxy.py` against the decorator's
  documented mapping (§9's table) and coordinate the import at the M2 merge.
- **`McpAuthRequiredError` maps to 409, carrying `GatewayConnectionRequirement`**
  — an interaction, not a failure (D17). Unreachable in wave 1 (no OAuth
  targets exist yet), but the mapping must exist so nothing breaks when
  wave 3 lands.
- **Streaming is not this plane's concern.** Unlike the LLM proxy
  (`StreamingResponse` over an `AsyncIterator[bytes]`), `McpRelayResult.body`
  is `bytes` — one JSON answer, no SSE leg (§7.1). Do not adapt LLM-plane
  streaming code into this adapter.
- **The allowlist check happens before credential resolution, in the
  service, not here** (§8: "Allowlist before credential. A refused model or
  tool must not cost a vault read"). WP8's adapter must not be the place
  that decides whether a tool is allowed — it relays whatever
  `McpGatewayService.relay` hands it after that decision already passed.

## Missing from the design, needs a ruling

- **No SSRF guard is assigned to the gateway's own outbound relay to
  `custom` MCP server URLs.** The runner has one for its own outbound calls
  to user-declared HTTP MCP servers
  (`services/runner/src/engines/sandbox_agent/mcp.ts::validateUserMcpUrl`,
  backed by `tools/ssrf-guard.ts`: blocks loopback, link-local — including
  the `169.254.169.254` cloud metadata host — private and IPv4-mapped
  ranges, DNS-resolved). The gateway now makes the equivalent outbound call
  on behalf of every project once `custom` MCP endpoints exist, and
  `entities.md`/`decisions.md`/`scope-checklist.md` do not assign this
  responsibility to either WP8 (relay time) or WP10 (creation time). Not
  invented here — flagged for a ruling.
- **Exact HTTP header names for MCP routing are undecided by design**
  (noted above; `entities.md` explicitly defers this to implementation
  time, so it is not treated as a gap needing a ruling, only as
  implementation work this package must do first).

## Test layer

Per the house rule: unit tests import freely and need nothing running;
anything needing Postgres, Redis or the API is integration or acceptance.

- `parse_mcp_call_context` — **unit**. Pure function; feed representative
  header dicts (both routing headers present, one missing, malformed
  values) and assert the parsed `McpCallContext` or the raised error.
- `HttpMcpAdapter.relay()` — **unit**. Run against an in-process fake HTTP
  server (or an `httpx` mock transport) standing in for the upstream — no
  real network, no real MCP server. Assert: body passed through
  byte-for-byte; `route.headers` merged under caller headers; no
  `Authorization` header added when `auth.credential is None`; the derived
  `Authorization` header is correct when a credential is present; a
  connection failure raises `McpUpstreamError`; a non-2xx JSON-RPC error
  body from the fake upstream is returned as `McpRelayResult`, not raised.
- `McpGatewayProxy` routing (which handler each path reaches, the 405s) —
  **unit**. Mount the router in a bare `FastAPI()` app with `TestClient`,
  a fake `McpGatewayService` (a stub whose `relay()` returns a canned
  `McpRelayResult` and records its call arguments), and a fake
  `get_auth_scope()`. Assert: `POST /agenta/tools/search` reaches
  `relay_agenta` with `name="tools/search"` (proving the catch-all nests
  correctly); `POST /builtin/composio/notion/my-notion` reaches
  `relay_builtin` with `provider="composio", integration="notion",
  name="my-notion"`; `POST /custom/acme-notion` reaches `relay_custom` with
  `name="acme-notion"`; `GET`/`DELETE` on any of the three return 405. No
  Postgres, no real service — this is in-process ASGI against a fake,
  which the house rule's "nothing running" test still passes (no
  external process, no network).
- Byte-for-byte relay end to end, and the tool-outside-allowlist refusal —
  **acceptance**, part of Checkpoint A. Needs the deployed stack: real
  Postgres (WP1's tables), the fake MCP server running as a compose
  service (WP5, D23), and WP9's real `McpGatewayService`. WP8 does not own
  writing this test alone — it is the shared Checkpoint A suite
  (`plan.md`) — but WP8's own "done" claim rests on it passing.

## Executable done test

Plan.md's stated done condition for WP8: *"list and call both relay
unchanged and a tool outside the allowlist is refused."* Concretely, once
WP8 and WP9 are both merged at M2 and the stack is deployed:

```text
POST /gateways/mcps/agenta/<fake-slug>   {"method":"tools/list", ...}
  -> 200, body identical to the fake server's own tools/list response

POST /gateways/mcps/agenta/<fake-slug>   {"method":"tools/call","tool":"<in-policy>", ...}
  -> 200, body identical to the fake server's own tool result

POST /gateways/mcps/agenta/<fake-slug>   {"method":"tools/call","tool":"<not-in-policy>", ...}
  -> 403, McpToolNotAllowedError mapped through handle_gateway_exceptions
```

## Out of scope

- Everything in `core/gateways/mcps/service.py` and `registry.py` — target
  resolution, the allowlist check, credential resolution, the
  three-namespace `list_endpoints` merge, tool-list filtering by policy —
  **WP9**.
- `ComposioMcpAdapter` (the `builtin` south-port adapter) and anything
  touching `McpBrokeredAuth` — not owned by any wave-1 package; `builtin`
  MCP servers are not reachable under D23 in Checkpoint A.
- The management CRUD router (`apis/fastapi/gateways/mcps/{router,models}.py`)
  and `apis/fastapi/gateways/exceptions.py` — **WP10**.
- OAuth, grants, step-up — wave 3 (WP16–WP20). `McpAuthRequiredError`'s 409
  mapping must exist (it is part of the frozen exceptions table) but is
  unreachable until then.
- Endpoint configuration (timeouts, ceilings, extra headers) — WP21, after
  checkpoint C.

## `api/entrypoints/routers.py` diff

This file is never owned by a package (`workstreams/README.md`). WP8
contributes two fragments, applied together with WP6's, WP7's, WP9's and
WP10's fragments at the M2 merge (the merge that follows wave 1's second
fan-out, per `plan.md`).

Adapter registration (into the `McpUpstreamRegistry` construction WP9
owns — see `specs-wp9.md`'s diff for the surrounding block; this package
contributes only the `"http"` entry):

```diff
     upstream_registry=McpUpstreamRegistry(adapters={
-        # WP9 constructs this dict; WP8, WP5 and (later) the Composio
-        # adapter each contribute one entry, combined at the M2 merge.
+        "http": HttpMcpAdapter(),          # custom: McpDirectAuth
     }),
```

Proxy construction and mount:

```diff
+from oss.src.apis.fastapi.gateways.mcps.proxy import McpGatewayProxy
+
+mcp_gateway_proxy = McpGatewayProxy(mcp_gateway_service=mcp_gateway_service)
```

```diff
+app.include_router(
+    router=mcp_gateway_proxy.router,
+    prefix="/gateways/mcps",
+    include_in_schema=False,
+)
```

(`mcp_gateway_service` here is the shared instance WP9 constructs; the
exact local variable names above are wiring convenience, not symbols
`entities.md` names — the class name `McpGatewayProxy`, its constructor
signature, and the mount's `prefix`/`include_in_schema` kwargs are the load-
bearing parts, taken verbatim from §9.)
