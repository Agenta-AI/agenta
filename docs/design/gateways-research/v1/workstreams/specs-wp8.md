# WP8 — MCP ingress and proxy

Delivers the MCP gateway's data-plane HTTP surface: one router class,
`MCPGatewayProxy`, declaring the three namespaced relay routes over the
route grammar D27 settles, plus the one south-port adapter that turns a
resolved route and a resolved secret into a real Streamable HTTP call
against a `custom` server. Owns the transport and the byte-for-byte relay;
does **not** own routing decisions, allowlist enforcement, secret
resolution or the builtin/agenta merge — those are `MCPGatewayService`
(WP9). This is the cut `workstreams/README.md` names: "on each plane,
transport and domain are different packages."

## Files

New:
- `api/oss/src/apis/fastapi/gateways/mcps/proxy.py` — `MCPGatewayProxy`
  (§9): two POST routes plus the shared 405 handler for the stream
  verbs.
- `api/oss/src/apis/fastapi/gateways/mcps/utils.py` — `parse_mcp_call_context`
  (§9): the one pure function that reads the caller's request for routing.
- `api/oss/src/core/gateways/mcps/providers/http/adapter.py` — `HttpMCPAdapter`,
  the `MCPUpstreamInterface` implementation for remote Streamable HTTP
  servers (`custom`, per the wiring block in §9: registered under the
  `"http"` key).

Edited: none. `core/gateways/mcps/{dtos,types,interfaces}.py` are seed-owned
and frozen; `core/gateways/mcps/service.py` and `registry.py` are WP9's.

## Interfaces

Reproduced verbatim from `entities.md` §7.1 and §9. Do not rename, do not
add routes or parameters not listed here.

### The route grammar — two routes, three shapes (D30, §2.3)

```text
/gateways/mcps/builtin/agenta/{slug:path}                      builtin/agenta/tools
/gateways/mcps/builtin/{provider}/{integration}/{connection}  builtin/composio/notion/my-notion
/gateways/mcps/custom/{slug}                                  custom/acme-notion
```

Both builtin shapes are served by **one** route, `/builtin/{provider}/{rest:path}`:
the arity differs per provider, and two competing routes cannot share a
provider segment. `split_builtin_path(provider, rest)` reads each provider's
own grammar off the tail.

- **`agenta`** takes the tail whole. An identifier this codebase owns may
  carry `/` separators (`builtin/agenta/tools/search` is one endpoint whose
  slug is `tools/search`, §2.3), which is why the route parameter is
  FastAPI's `{rest:path}` converter — a plain `{slug}` component would 404
  on the first nested identifier.
- **`composio`** takes two components, `{integration}/{connection}` — the
  brokered connection's own unique key minus the project and the provider
  (`gateway_connections`'s `(project_id, provider_key, integration_key,
  slug)`, §2.3). Neither is ever nested.
- **`custom/{slug}`** — its own route, **one fixed path component**. The
  slug is unique per project (`uq_mcps_endpoints_project_slug`), never
  nested.

The routes cannot collide with the CRUD router's paths sharing the
same `/gateways/mcps` prefix (`router.py`, WP10) because every CRUD path
starts with `endpoints`, and none of `builtin | standard | custom` can
spell it (§9).

### `MCPGatewayProxy` (§9)

```python
class MCPGatewayProxy:
    def __init__(self, *, mcp_gateway_service: MCPGatewayService):
        self.service = mcp_gateway_service
        self.router = APIRouter()

        # One URL per server (D16). Streamable HTTP, stateless JSON mode:
        # POST carries JSON-RPC; GET/DELETE answer 405, as the runner's
        # internal tool server already does. No version segment: the MCP
        # protocol is a POST to the endpoint URL itself, revision negotiated
        # in a header (§2.3). Two routes: builtin's arity differs per
        # provider, so its tail is a catch-all that split_builtin_path
        # divides; custom's slug is a single component.
        self.router.add_api_route(
            "/builtin/{provider}/{rest:path}",
            self.relay_builtin, methods=["POST"],
            operation_id="mcp_gateway_relay_builtin",
        )
        self.router.add_api_route(
            "/custom/{slug}", self.relay_custom, methods=["POST"],
            operation_id="mcp_gateway_relay_custom",
        )
        # the same two paths answer GET/DELETE with 405 via
        # self.reject_stream_verbs, include_in_schema=False — elided
```

The two handlers "are thin ... they exist because the routes carry
different path parameters, not because the behaviour differs" (§9): each
parses headers via `parse_mcp_call_context`, reads `get_auth_scope()`, and
delegates to `self.service.relay(...)` with its own namespace and path
segments. `relay_builtin` passes `provider`, and `integration` when its
provider's grammar carries one; `relay_custom` passes only `name` (the slug).

`reject_stream_verbs` answers GET and DELETE on the same two paths with
405, `include_in_schema=False` — the shape the runner's own internal MCP
server already uses for the Streamable-HTTP stream-management verbs it does
not implement (`services/runner/src/tools/tool-mcp-http.ts`, lines 367–371:
`if (req.method !== "POST") { res.writeHead(405, ...) }`).

### `parse_mcp_call_context` (§9)

```python
# apis/fastapi/gateways/mcps/utils.py
def parse_mcp_call_context(*, headers: Dict[str, str]) -> MCPCallContext:
    """Read the protocol's method and target headers (`mcp.md`, header-based
    routing) — the body is never parsed for routing. Header names are pinned
    against the 2026-07-28 revision at implementation time, in this one file."""
```

`MCPCallContext` (seed, `core/gateways/mcps/dtos.py`, §4.4):

```python
class MCPCallContext(BaseModel):
    method: str
    target: Optional[str] = None
```

The exact header names are **not** given in `entities.md` — the docstring
above says so explicitly ("pinned ... at implementation time, in this one
file"), so this is deferred implementation work, not a design gap. `mcp.md`
only establishes that the revision moved method and target routing onto
required HTTP headers (§"Three changes that are explicitly about
intermediaries" — "Header-based routing").

### The south port: `MCPUpstreamInterface` and `HttpMCPAdapter` (§7.1)

```python
# core/gateways/mcps/interfaces.py (seed, frozen — read only)

@dataclass
class MCPRelayResult:
    """A single JSON answer. The gateway targets the stateless revision in JSON
    mode — one request, one `application/json` response, 202 for notifications
    (`mcp.md`; the in-tree precedent is the runner's internal tool server,
    services/runner/src/tools/tool-mcp-http.ts). No SSE leg to carry."""
    status_code: int
    headers: Dict[str, str]
    body: bytes


class MCPUpstreamInterface(ABC):
    @abstractmethod
    async def relay(
        self,
        *,
        route: MCPResolvedRoute,
        auth: MCPRelayAuth,
        #
        context: MCPCallContext,
        body: bytes,
        headers: Dict[str, str],
    ) -> MCPRelayResult:
        """Transparent per-server relay (D16): same method, same body, same
        response, with only the route and the authorization changed. `auth` is
        the discriminated union from §4.4 — MCPDirectAuth for agenta and custom,
        MCPBrokeredAuth for builtin — so the two secret mechanisms cannot be
        conflated by an adapter (D27). Raises MCPUpstreamError on transport
        failure; protocol-level errors from the server are NOT exceptions — they
        are the response body, relayed, because the server's own failure reason
        is what lets the model correct itself (the pass-through rule in
        api/AGENTS.md's error-envelope scope)."""
        ...
```

`MCPResolvedRoute` (seed, §4.4):

```python
class MCPResolvedRoute(BaseModel):
    url: str
    headers: Dict[str, str] = Field(default_factory=dict)
    settings: MCPEndpointSettings = Field(default_factory=MCPEndpointSettings)
```

`MCPDirectAuth` / `MCPRelayAuth` (seed, §4.4 — reproduced so the adapter's
input shape is unambiguous):

```python
class MCPDirectAuth(BaseModel):
    """agenta + custom: the secret is ours to present — an oauth_grant
    resolved from the vault (§7.2), or nothing for a NONE-scheme target."""
    secret: Optional[ResolvedSecret] = None

class MCPBrokeredAuth(BaseModel):
    """builtin: the integrations domain brokered the authorization and holds the
    secret upstream; what we carry is its connection row."""
    connection: Connection

MCPRelayAuth = Union[MCPDirectAuth, MCPBrokeredAuth]
```

`HttpMCPAdapter(MCPUpstreamInterface)` implements `relay()` against
`MCPDirectAuth` only — it is registered under the `"http"` key and is only
ever reached via the `custom` namespace (§4.4: "builtin and custom are two
secret mechanisms ... the fork is real behaviour ... at the south
port"). It never receives `MCPBrokeredAuth`; that arm is `ComposioMCPAdapter`
(a separate provider, out of this package's ownership per
`workstreams/README.md`'s file table, and out of scope entirely — no work
package in wave 1 owns it, since `builtin` MCP servers are not called in
Checkpoint A under D23).

Body: POST `body` verbatim to `route.url`, with `route.headers` (the
endpoint's own non-secret configured headers, §2.4) merged under the
caller's forwarded `headers` (already stripped of Agenta's own
authorization, §7.1's LLM-side analog), plus one derived header when
`auth.secret` is present. The exact translation from a `ResolvedSecret`
into a wire header depends on which secret kind backs it —
`OAuthGrantSettingsDTO.access_token` / `.token_type` (`entities.md` §4.5) is
the only populated shape reachable in this wave, and it maps to
`Authorization: {token_type} {access_token}`. **In Checkpoint A this branch
is unreachable in practice**: D23 restricts wave 1's reachable MCP targets
to unauthenticated servers (`auth_mode = NONE`) and the mocks, and OAuth
`oauth_grant` secrets do not exist until WP16/WP17 (wave 3). Implement the
secret branch so it type-checks against `entities.md`'s frozen shapes, but do
not build integration tests that depend on a real one existing — there is
nothing to resolve yet.

No JSON-RPC parsing happens in the adapter. `MCPRelayResult` carries
whatever `status_code`, `headers` and `body` the upstream returned,
untouched — the pass-through discipline in `api/AGENTS.md`'s error-envelope
scope ("the gateway and workflow-tool arms carry their upstream's shape").
Any tool-list filtering by policy happens one layer up, in
`MCPGatewayService.relay` (WP9) — that requires inspecting the JSON body,
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
  lives in `apis/fastapi/gateways/exceptions.py`, which the **seed** owns (R1) —
  three packages need the decorator, so no one package can. It is already on the
  branch when this package starts; import it, do not write it.
- **`MCPAuthRequiredError` maps to 409, carrying `GatewayConnectionRequirement`**
  — an interaction, not a failure (D17). Unreachable in wave 1 (no OAuth
  targets exist yet), but the mapping must exist so nothing breaks when
  wave 3 lands.
- **Streaming is not this plane's concern.** Unlike the LLM proxy
  (`StreamingResponse` over an `AsyncIterator[bytes]`), `MCPRelayResult.body`
  is `bytes` — one JSON answer, no SSE leg (§7.1). Do not adapt LLM-plane
  streaming code into this adapter.
- **The allowlist check happens before secret resolution, in the
  service, not here** (§8: "Allowlist before secret. A refused model or
  tool must not cost a vault read"). WP8's adapter must not be the place
  that decides whether a tool is allowed — it relays whatever
  `MCPGatewayService.relay` hands it after that decision already passed.

## The SSRF guard at relay time (D28) — this package owns the relay half

A `custom` endpoint's URL was typed by a user and **this adapter is the process that
connects to it**. Without the guard, a tenant can point an endpoint at
`http://169.254.169.254/` and have the gateway fetch cloud secrets with our network
position. WP10 gates the URL at registration; that is not sufficient on its own, because
a hostname's DNS answer can change between the row being saved and this relay running.

**Write no new guard.** `api/oss/src/core/webhooks/utils.py` already implements it, and
three call sites already import it across domains (webhook delivery, EE's organization
OIDC issuer, the custom-provider URL on a secret) — so the cross-domain import has
precedent. Blocked means private, loopback, link-local (which is what covers the metadata
address), reserved, multicast or unspecified, plus plain `http`.

```python
from oss.src.core.webhooks.utils import resolve_validated_webhook_ip
```

In `HttpMCPAdapter.relay`, before the outbound POST:

1. `resolved_ip = resolve_validated_webhook_ip(route.url)` — raises `ValueError` on a
   blocked target. Translate it into `MCPUpstreamError`; it is a transport-layer refusal,
   not a protocol error, so it must not be relayed as an upstream body.
2. **Connect to the returned IP, not the hostname.** This is the part that is easy to drop
   and is the only reason the function returns a value. Copy the pinning from
   `api/oss/src/core/webhooks/delivery.py::send_webhook_request`: swap the host in the URL
   for the literal IP (bracketing IPv6, preserving an explicit port), set `Host` back to
   the original authority, and pass `extensions={"sni_hostname": parsed.hostname}` so TLS
   still validates against the real name. Re-resolving the hostname in the HTTP client
   reopens the rebind window the check just closed.
3. **Distinguish the two failure messages.** `resolve_validated_webhook_ip` raises with
   "could not be resolved" for a DNS failure and "blocked IP range" for a guard hit — keep
   them distinct in the error text, so an operator reading a hostname typo does not see a
   security rejection. The runner's guard makes the same distinction on purpose
   (`services/runner/src/engines/sandbox_agent/mcp.ts:191`).

**Only the `custom` namespace needs this.** `agenta` targets are ours and `builtin` targets
are the broker's — neither URL comes from a user. Guard on the namespace rather than
guarding unconditionally, or the mocks (WP5, reachable on a compose host) fail their own
acceptance tests.

**Two facts about the flag, both load-bearing.** `AGENTA_INSECURE_EGRESS_ALLOWED` defaults
to `true` (`api/oss/src/utils/env.py`), and the guard is a no-op when it is on — so a unit
test that does not set it `false` will pass while proving nothing. Set it explicitly in the
test. The second: nothing in this repo's deployment configuration sets it, so the
checkpoint A verification runs with it `false`.

**The host allowlist.** Carry the runner's escape hatch so a self-hoster can permit one
known internal server without disabling the guard globally — the runner reads
`AGENTA_AGENT_MCPS_HOST_ALLOWLIST` (comma-separated hostnames). Add the API-side equivalent
through `api/oss/src/utils/env.py` and the shared `env` object, never `os.getenv` in feature
code (`api/AGENTS.md`).

## Missing from the design, needs a ruling

- **Exact HTTP header names for MCP routing are undecided by design**
  (noted above; `entities.md` explicitly defers this to implementation
  time, so it is not treated as a gap needing a ruling, only as
  implementation work this package must do first).

## Test layer

Per the house rule: unit tests import freely and need nothing running;
anything needing Postgres, Redis or the API is integration or acceptance.

- `parse_mcp_call_context` — **unit**. Pure function; feed representative
  header dicts (both routing headers present, one missing, malformed
  values) and assert the parsed `MCPCallContext` or the raised error.
- `HttpMCPAdapter.relay()` — **unit**. Run against an in-process mock HTTP
  server (or an `httpx` mock transport) standing in for the upstream — no
  real network, no real MCP server. Assert: body passed through
  byte-for-byte; `route.headers` merged under caller headers; no
  `Authorization` header added when `auth.secret is None`; the derived
  `Authorization` header is correct when a secret is present; a
  connection failure raises `MCPUpstreamError`; a non-2xx JSON-RPC error
  body from the mock upstream is returned as `MCPRelayResult`, not raised.
- `MCPGatewayProxy` routing (which handler each path reaches, the 405s) —
  **unit**. Mount the router in a bare `FastAPI()` app with `TestClient`,
  a mock `MCPGatewayService` (a stub whose `relay()` returns a canned
  `MCPRelayResult` and records its call arguments), and a mock
  `get_auth_scope()`. Assert: `POST /builtin/agenta/tools/search` reaches
  `relay_builtin` with `provider="agenta", name="tools/search"` (proving the
  catch-all nests correctly); `POST /builtin/composio/notion/my-notion`
  reaches the same handler with `provider="composio", integration="notion",
  name="my-notion"`; `POST /custom/acme-notion` reaches `relay_custom` with
  `name="acme-notion"`; `GET`/`DELETE` on any of the three return 405. No
  Postgres, no real service — this is in-process ASGI against a mock,
  which the house rule's "nothing running" test still passes (no
  external process, no network).
- Byte-for-byte relay end to end, and the tool-outside-allowlist refusal —
  **acceptance**, part of Checkpoint A. Needs the deployed stack: real
  Postgres (WP1's tables), the mock MCP server running as a compose
  service (WP5, D23), and WP9's real `MCPGatewayService`. WP8 does not own
  writing this test alone — it is the shared Checkpoint A suite
  (`plan.md`) — but WP8's own "done" claim rests on it passing.

## Executable done test

Plan.md's stated done condition for WP8: *"list and call both relay
unchanged and a tool outside the allowlist is refused."* Concretely, once
WP8 and WP9 are both merged at M2 and the stack is deployed:

```text
POST /gateways/mcps/builtin/agenta/<mock-slug>   {"method":"tools/list", ...}
  -> 200, body identical to the mock server's own tools/list response

POST /gateways/mcps/builtin/agenta/<mock-slug>   {"method":"tools/call","tool":"<in-policy>", ...}
  -> 200, body identical to the mock server's own tool result

POST /gateways/mcps/builtin/agenta/<mock-slug>   {"method":"tools/call","tool":"<not-in-policy>", ...}
  -> 403, MCPToolNotAllowedError mapped through handle_gateway_exceptions
```

## Out of scope

- Everything in `core/gateways/mcps/service.py` and `registry.py` — target
  resolution, the allowlist check, secret resolution, the
  three-source `list_endpoints` merge, tool-list filtering by policy —
  **WP9**.
- `ComposioMCPAdapter` (the `builtin` south-port adapter) and anything
  touching `MCPBrokeredAuth` — not owned by any wave-1 package; `builtin`
  MCP servers are not reachable under D23 in Checkpoint A.
- The management CRUD router (`apis/fastapi/gateways/mcps/{router,models}.py`)
  — **WP10**. `apis/fastapi/gateways/exceptions.py` — **the seed** (R1),
  already present; import it.
- OAuth, consent, step-up — wave 3 (WP16–WP20). `MCPAuthRequiredError`'s 409
  mapping must exist (it is part of the frozen exceptions table) but is
  unreachable until then.
- Endpoint configuration (timeouts, ceilings, extra headers) — WP21, after
  checkpoint C.

## `api/entrypoints/routers.py` diff

This file is never owned by a package (`workstreams/README.md`). WP8
contributes two fragments, applied together with WP6's, WP7's, WP9's and
WP10's fragments at the M2 merge (the merge that follows wave 1's second
fan-out, per `plan.md`).

Adapter registration (into the `MCPUpstreamRegistry` construction WP9
owns — see `specs-wp9.md`'s diff for the surrounding block; this package
contributes only the `"http"` entry):

```diff
     upstream_registry=MCPUpstreamRegistry(adapters={
-        # WP9 constructs this dict; WP8, WP5 and (later) the Composio
-        # adapter each contribute one entry, combined at the M2 merge.
+        "http": HttpMCPAdapter(),          # custom: MCPDirectAuth
     }),
```

Proxy construction and mount:

```diff
+from oss.src.apis.fastapi.gateways.mcps.proxy import MCPGatewayProxy
+
+mcp_gateway_proxy = MCPGatewayProxy(mcp_gateway_service=mcp_gateway_service)
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
`entities.md` names — the class name `MCPGatewayProxy`, its constructor
signature, and the mount's `prefix`/`include_in_schema` kwargs are the load-
bearing parts, taken verbatim from §9.)
