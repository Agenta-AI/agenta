# WP9 — MCP registry and tool allowlist

Delivers `MCPGatewayService` and `MCPUpstreamRegistry`: target resolution
across the three namespaces, the per-server tool allowlist check, secret
resolution dispatch (the two-mechanism fork), the builtin/agenta/custom
merge for listing, and the relay orchestration WP8's proxy calls into. This
is the domain half of the transport/domain cut
(`workstreams/README.md`): WP8 owns the HTTP surface and the byte-for-byte
relay adapter; this package owns the service, the registry and the
allowlist.

## Files

New:
- `api/oss/src/core/gateways/mcps/service.py` — `MCPGatewayService` (§8).
- `api/oss/src/core/gateways/mcps/registry.py` — `MCPUpstreamRegistry` (§7.1).

Edited: none. `core/gateways/mcps/{dtos,types,interfaces}.py` are seed-owned
and frozen. `dbs/postgres/gateways/mcps/` (the DAO implementation this
package calls through the `MCPEndpointsDAOInterface` port) is **WP1**'s,
already landed by M1.

## Interfaces

Reproduced verbatim from `entities.md` §7.1 and §8. Do not rename, do not
add methods not listed here.

### `MCPUpstreamRegistry` (§7.1)

```python
class MCPUpstreamRegistry:
    def __init__(self, *, adapters: Dict[str, MCPUpstreamInterface]): ...
    def get(self, key: str) -> MCPUpstreamInterface: ...
    def keys(self) -> list[str]: ...
```

"Registries copy an existing shape verbatim" (§7.1) — four structurally
identical registries already exist. The closest, read and confirmed:
`api/oss/src/core/gateway/connections/registry.py::ConnectionsGatewayRegistry`:

```python
class ConnectionsGatewayRegistry:
    def __init__(self, *, adapters: Dict[str, ConnectionsGatewayInterface]):
        self._adapters = adapters

    def get(self, provider_key: str) -> ConnectionsGatewayInterface:
        adapter = self._adapters.get(provider_key)
        if not adapter:
            raise ProviderNotFoundError(provider_key)
        return adapter

    def keys(self) -> list[str]:
        return list(self._adapters.keys())
```

`MCPUpstreamRegistry.get` raises on a miss, per §7.1's own comment
(`# raises on a miss`) — reuse `MCPEndpointNotFoundError` or a dedicated
registry-miss exception only if `entities.md` names one; it does not, so
raise the existing `ProviderNotFoundError`-shaped pattern is **not**
available (that class lives in the connections domain, out of bounds per
D15/§4.1's "the gateways define their own vocabulary"). Add no new public
exception name beyond what `core/gateways/mcps/types.py` already declares;
if a registry-miss needs its own type, that is a "missing from the design"
item (below), not a name to invent silently.

### `MCPGatewayService` (§8)

```python
class MCPGatewayService:
    def __init__(
        self,
        *,
        mcp_endpoints_dao: MCPEndpointsDAOInterface,
        policy: GatewayPolicyService,
        resolver: SecretsResolverInterface,
        connections_service: ConnectionsService,
        upstream_registry: MCPUpstreamRegistry,
    ) -> None: ...
```

`connections_service` is the existing connections-domain service
(`core/gateway/connections/service.py`), passed by reference — a concrete
service object, not a port, per `entities.md` §8's own note ("the interface
rule is enforced at the DAO and adapter seams, not between services"). It is
required, not optional: `list_endpoints`'s `builtin` merge and `relay`'s
brokered-target resolution both call through it (below), so the constructor
must accept it even though nothing in this package instantiates it.

Method surface, in full, with the wave-1 implementation split marked:

```python
class MCPGatewayService:
    # --- management --------------------------------------------------------- #

    async def create_endpoint(self, *, project_id, user_id, endpoint) -> Optional[MCPEndpoint]: ...
    async def fetch_endpoint(self, *, project_id, endpoint_id) -> Optional[MCPEndpoint]: ...
    async def edit_endpoint(self, *, project_id, user_id, endpoint) -> Optional[MCPEndpoint]: ...
    async def delete_endpoint(self, *, project_id, endpoint_id) -> bool: ...
    async def query_endpoints(self, *, project_id, endpoint=None, windowing=None) -> List[MCPEndpoint]: ...
    async def list_endpoints(self, *, project_id) -> List[MCPEndpoint]: ...
    # The three-source merge (D30): builtin/agenta entries from code, builtin/composio entries
    # generated from the Composio catalog with their connection state resolved
    # through the existing connections service, custom rows from the DAO.

    # No connect/consent verbs here. Composio (builtin) servers connect
    # through the existing integrations connect flow, whose state machine and
    # redirect it already drives. Whatever the OAuth checkpoint (WP17, WP18)
    # ends up wiring for a custom server writes the vault secret, then calls
    # edit_endpoint to point secret_id at it (§2.1) — the same full PUT every
    # other field on the row goes through, not a document or verb of its own.

    # --- the data plane (WP8) ----------------------------------------------- #

    async def relay(
        self, *, scope, namespace, name, provider=None, integration=None,
        context, body, headers,
    ) -> MCPRelayResult: ...
    # name is the last path component (§2.3): the agenta slug (possibly nested),
    # the custom slug, or the builtin connection slug — in which case provider
    # and integration carry the other two segments
```

This package declares no connect/consent verbs at all — there is no grant
row to create, revoke or query, so there is nothing here for a later
package to fill in. WP17's `TokenStorage` adapter (`core/gateways/mcps/
token_storage.py`) is where a custom server's OAuth exchange actually
lands: it resolves through the endpoint's own `secret_id` and writes the
`oauth_grant` secret in place, calling this package's `edit_endpoint` the
first time to point `secret_id` at it. WP9 owns none of that; it only has
to make sure `edit_endpoint` remains the one door every field on the row
goes through, including this one.

### Management CRUD — thin DAO delegation

`create_endpoint` / `fetch_endpoint` / `edit_endpoint` / `delete_endpoint` /
`query_endpoints` delegate to `MCPEndpointsDAOInterface` (WP1's
implementation, already landed):

```python
# core/gateways/mcps/interfaces.py (seed, frozen — read only)

class MCPEndpointsDAOInterface(ABC):
    async def create_endpoint(self, *, project_id: UUID, user_id: UUID, endpoint: MCPEndpointCreate) -> Optional[MCPEndpoint]: ...
    async def fetch_endpoint(self, *, project_id: UUID, endpoint_id: UUID) -> Optional[MCPEndpoint]: ...
    async def fetch_endpoint_by_slug(self, *, project_id: UUID, slug: str) -> Optional[MCPEndpoint]: ...
    async def edit_endpoint(self, *, project_id: UUID, user_id: UUID, endpoint: MCPEndpointEdit) -> Optional[MCPEndpoint]: ...
    async def delete_endpoint(self, *, project_id: UUID, endpoint_id: UUID) -> bool: ...
    async def query_endpoints(self, *, project_id: UUID, endpoint: Optional[MCPEndpointQuery] = None, windowing: Optional[Windowing] = None) -> List[MCPEndpoint]: ...
```

### `list_endpoints` — the three-source merge (D30, §8)

The one read that spans namespaces. There is no `catalog.py` under
`core/gateways/mcps/` (unlike the LLM plane, which has one explicitly —
compare the top-of-document file tree in `entities.md` §0: `llms/` lists
`catalog.py`, `mcps/` does not). The merge logic therefore lives directly in
`service.py`:

- **`agenta`** — entries defined in code. In wave 1 (D23) these are the
  mocks WP5 registers; nothing in `entities.md` names a public function or
  module for this enumeration (contrast the LLM plane's
  `standard_llm_endpoint`/`standard_llm_endpoints`, which are explicitly
  named in §8). Keep the agenta enumeration a private, service-internal
  list — do not invent a public symbol name `entities.md` does not give.
- **`builtin`** — generated from the Composio catalog, "with their
  connection state resolved through the existing connections service"
  (§8). This is a **real integration with an already-landed dependency**,
  not a stub: `ConnectionsService` (`api/oss/src/core/gateway/connections/service.py`,
  read and confirmed) already exposes `query_connections(*, project_id,
  provider_key=None, integration_key=None, is_active=True) ->
  List[Connection]`. `list_endpoints` calls it filtered to
  `provider_key="composio"` and maps each `Connection` row into an
  `MCPEndpoint` with `namespace=BUILTIN`, `connection_id`, `provider_key`,
  `integration_key` and `slug` stamped from the connection (§4.4's
  documented fields on `MCPEndpoint`). D23 restricts wave 1's **reachable
  call targets**, not catalog **listing** — `scope-checklist.md` puts MCP
  registry work in wave 1 unconditionally, so this branch must be
  genuinely implemented, even though nothing calls through it yet.
- **`custom`** — `MCPEndpointsDAOInterface.query_endpoints` rows, mapped
  1:1, `namespace=CUSTOM` (the DTO's own default).

Connection-state derivation (§8, verbatim): *"`GatewayConnectionState` is
derived in `MCPGatewayService` per namespace: `READY` iff the endpoint's
scheme is NONE (every `agenta` entry), or — `custom` — `secret_id` is set
and `flags.is_valid` is true, or — `builtin` — the referenced connection row
is active and valid, read through the existing connections service;
`NEEDS_AUTH` otherwise for an OAuth or builtin endpoint ... `NEEDS_INPUT`
reserved for the api_key scheme (deferred with its kind, D14)."* Implement
this for real in wave 1: a `custom` OAuth-scheme endpoint with `secret_id`
still `None` correctly derives `NEEDS_AUTH` today — reading the column
directly off the row, not a special case.

### The two secret mechanisms — the fork is at the south port, not the entity (D27, §4.4)

Do not build a discriminated endpoint type (`MCPBuiltinEndpoint` /
`MCPCustomEndpoint`) — `entities.md` explicitly rejects that split: "the
endpoint's identity, config and listing shape are one — only the secret
path forks, and forking every DAO and service signature for a difference
that appears at secret time would spread the fork everywhere it does
not matter." The fork is expressed once, in `relay`'s secret-resolution
step, by constructing the right `MCPRelayAuth` arm:

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

For `agenta`/`custom` targets: resolve via `SecretsResolverInterface.resolve()`
(WP2, already landed) with `mode=SecretMode.PROJECT_ONLY` — every gateway
secret is project-owned (`../out-of-scope.md`). For a `custom` OAuth-scheme
endpoint the ref is `BoundSecretRef(secret_id=endpoint.secret_id)` — the
endpoint's own column is the project-level answer, so this package needs no
grants dependency to resolve it. `NONE`-scheme targets skip resolution
entirely (`secret=None`). For `builtin` targets: **never** call the
resolver — "its secret lives at the broker and never enters our vault"
(§4.4). Instead fetch the connection row directly via `ConnectionsService`
(the same instance `list_endpoints` already uses) and wrap it in
`MCPBrokeredAuth`. Routing `builtin` through the resolver with a third ref
arm was explicitly rejected (§7.2) — do not add one.

### `relay` — the six-step orchestration (§8, D7 applied to MCP)

`entities.md` gives the full pseudocode for the LLM plane
(`relay_chat_completion`) and states "both planes walk the same six steps ...
only the nouns differ." Implement the MCP equivalent following that shape
exactly:

1. **Resolve target.** By namespace: `agenta` → the code-defined entry
   matching `name`; `builtin` → the connection row matching
   `(provider, integration, name)` via `ConnectionsService`; `custom` →
   `MCPEndpointsDAOInterface.fetch_endpoint_by_slug(project_id, slug=name)`.
   Raise `MCPEndpointNotFoundError` (constructed with `namespace`,
   `provider`, `integration`, `name` per its signature in §5) when nothing
   resolves.
2. **Allowlist before secret.** `_check_allowlist(target, context)`:
   when `context` names a specific tool, refuse anything the target's
   `tools` filter disallows with
   `MCPToolNotAllowedError` — **before** any secret resolution or
   upstream call (§8: "A refused model or tool must not cost a vault
   read").
3. **Authorize.** `self.policy.authorize(scope=scope,
   permission=Permission.USE_MCP_ENDPOINTS, target=...)`. On denial, record
   the decision via `self.policy.record(...)` **before** raising
   `PolicyDeniedError` — the audit ordering rule (§8: "The denial is
   recorded before the exception leaves").
4. **Resolve secret**, per the two-mechanism fork above.
5. **Dispatch.** `self.upstream_registry.get(<adapter key for namespace>).relay(
   route=..., auth=..., context=..., body=..., headers=...)`. The
   namespace→adapter-key mapping (`agenta`→`"mock"` in wave 1 — the wiring
   block's own comment: `"mock": MockMCPAdapter(), # serves the
   builtin/agenta mocks (D23)`; `builtin/composio`→`"composio"`; `custom`→`"http"`)
   is a private implementation detail of this file — `entities.md` names no
   public function for it on the MCP plane (contrast the LLM plane's
   `select_upstream`, explicitly named in §7.1). Do not invent a public
   name for it.
6. **Record and, for a list method, filter.** `self.policy.record(...)`
   with the real outcome. When `context.method` is a list operation
   (`tools/list`), apply the tool policy to the **response body**: "an
   `INCLUDE` tool policy filters the list result — entries dropped whole,
   never renamed — while secret death does not filter anything (D18).
   Policy hides what may never be called; secret state never hides
   what policy allows" (§8, verbatim). This is the one place `relay`
   inspects and rewrites the upstream's JSON body rather than relaying it
   untouched — narrowly scoped to dropping whole tool entries by name, never
   renaming or editing a surviving entry.

`target` in this pseudocode is service-internal (the resolved row or
generated entry, plus which namespace answered) and never crosses a layer —
it is not a DTO in §4 and must not be added to `dtos.py`.

## Contracts this package must honour

- **D18 — a dead secret does not hide tools.** A `custom` OAuth endpoint
  with `flags.is_valid=False` still lists its tools; only the call
  fails. Do not let secret health leak into the list-filtering step —
  only the `tools` filter trims the list.
- **D19/D20 — an endpoint is a server, not a tool; only custom endpoints are
  rows.** `list_endpoints` must never persist a generated `agenta`/`builtin`
  entry; they are computed on every call.
- **An explicit empty allowlist refuses; an absent one does not** (§4.4):
  `tools: {"allowlist": []}` refuses every tool, while `tools: {}` constrains
  nothing. Only a written list narrows.
- **Every `resolve()` call this package makes uses `mode=SecretMode.PROJECT_ONLY`**
  (§7.2) — the mode logic itself lives in WP2's resolver, already correct;
  this package must call it with the right mode, not invent a fallback of
  its own.
- **`MCPUpstreamRegistry.get` raises on a miss** (§7.1) — never returns
  `None` and silently no-ops.

## Missing from the design, needs a ruling

- **No named exception for a registry key miss.** `entities.md` §7.1 says
  `get()` "raises on a miss" but does not name the exception type for the
  MCP registry (the LLM plane's analog is likewise unnamed). Do not import
  `ProviderNotFoundError` from `core/gateway/connections/exceptions.py` —
  that is a different domain's exception, out of bounds per D15/§4.1. Raise
  a plain, already-declared `GatewaysError` or `MCPUpstreamError` with a
  message naming the missing key until a ruling adds a dedicated type; do
  not invent a new public exception name unilaterally.
- **No public name for the namespace→adapter-key selector.** Noted above —
  implement it as a private function, do not add it to `entities.md`'s
  public surface.

## Test layer

- `MCPUpstreamRegistry.get`/`keys` — **unit**. Trivial, mirrors
  `ConnectionsGatewayRegistry`'s own tests if any exist, or a fresh minimal
  test: registering two mock adapters, `get()` returns the right one,
  `get()` on a missing key raises, `keys()` lists both.
- `MCPGatewayService`'s CRUD delegation — **unit**, with a mock
  `MCPEndpointsDAOInterface` (an in-memory dict-backed double, not the real
  Postgres DAO). Assert each method calls the right DAO verb with the right
  arguments and returns what the DAO returned.
- `list_endpoints`'s three-source merge — **unit** with mocks for both
  the DAO and `ConnectionsService` (a stub returning a canned list of
  `Connection` rows). Assert: agenta entries appear with `namespace=BUILTIN`
  and `provider_key="agenta"`
  and no `id`; builtin entries appear with `namespace=BUILTIN`,
  `connection_id`/`provider_key`/`integration_key` stamped; custom rows
  appear with `namespace=CUSTOM`; no generated entry is ever passed to a
  DAO write.
- Connection-state derivation — **unit**. A `custom` OAuth endpoint with
  `secret_id=None` derives `NEEDS_AUTH`; a `custom` OAuth endpoint with
  `secret_id` set but `flags.is_valid=False` also derives `NEEDS_AUTH`; a
  `custom` NONE-scheme endpoint derives `READY` unconditionally; a `builtin`
  entry backed by a mock `Connection` with `is_valid=False` derives
  `NEEDS_AUTH`.
- `relay`'s six-step order — **unit**, with a mock `GatewayPolicyService`,
  mock resolver, mock `MCPUpstreamRegistry`. Assert: a tool outside the
  policy raises `MCPToolNotAllowedError` **without** the mock resolver or
  mock adapter ever being called (proves step ordering, not just the final
  outcome); a policy denial calls `policy.record` before the exception
  propagates (assert on call order via the mocks' call logs); a `builtin`
  target never calls the resolver, only `ConnectionsService`.
- Tool-list filtering — **unit**. A mock adapter returns a canned
  `tools/list` JSON body with three tools; a target with
  `tools.allowlist=["a","b"]` filters the response to two entries, unmodified
  in shape; a target with no filter passes all three through untouched.
- The full relay path against a real mock MCP server, and the merge against
  a real Postgres-backed `MCPEndpointsDAO` — **acceptance**, part of
  Checkpoint A (shared with WP8; see `specs-wp8.md`'s acceptance section).

## Executable done test

Plan.md's stated done condition, verbatim: *"a custom server registers and
resolves, and a built-in one needs no row."* Concretely:

```text
create_endpoint(project_id=P, user_id=U, endpoint=MCPEndpointCreate(
    slug="acme-notion", auth_mode=NONE, data=MCPEndpointData(url="https://...")
))
  -> a row exists; fetch_endpoint_by_slug(P, "acme-notion") resolves it

list_endpoints(project_id=P)
  -> contains an entry with namespace=CUSTOM, slug="acme-notion"
  -> contains entries with namespace=BUILTIN for every active composio
     connection in P, with NO corresponding row in mcps_endpoints
```

## Out of scope

- The HTTP surface, `MCPGatewayProxy`, `parse_mcp_call_context`, and the
  `HttpMCPAdapter` south-port implementation — **WP8**.
- The management CRUD router and models
  (`apis/fastapi/gateways/mcps/{router,models}.py`) — **WP10**.
  `apis/fastapi/gateways/exceptions.py` — **the seed** (R1).
- `ComposioMCPAdapter` — not owned by any wave-1 package; `builtin` targets
  are not called until a package for it is scheduled.
- `core/gateways/mcps/token_storage.py` (`VaultTokenStorage`) and the OAuth
  client that drives a custom server's connect flow — **WP17/WP18** (wave 3).
- `dbs/postgres/gateways/mcps/` (DAO implementation, migration) — **WP1**,
  already landed by M1.
- `core/access/permissions/types.py`'s six new members — **WP3**, already
  landed by M1.

## Checkpoint

Feeds **Checkpoint A**, together with WP8 (see `specs-wp8.md`'s acceptance
section for the shared suite) at the M2 merge.

## `api/entrypoints/routers.py` diff

This package owns the `MCPGatewayService` and `MCPUpstreamRegistry`
construction block — the one other packages (WP8's adapter entry, WP10's
router construction) attach to. Applied at the M2 merge together with the
sibling fragments from `specs-wp6.md`/`specs-wp7.md`/`specs-wp8.md`/`specs-wp10.md`:

```diff
+from oss.src.core.gateways.mcps.service import MCPGatewayService
+from oss.src.core.gateways.mcps.registry import MCPUpstreamRegistry
+
+mcp_gateway_service = MCPGatewayService(
+    mcp_endpoints_dao=mcp_endpoints_dao,
+    policy=gateway_policy_service,
+    resolver=secret_resolver,
+    connections_service=connections_service,
+    upstream_registry=MCPUpstreamRegistry(adapters={
+        "http": HttpMCPAdapter(),          # custom: MCPDirectAuth (WP8)
+        "composio": ComposioMCPAdapter(),  # builtin: MCPBrokeredAuth (not wave 1)
+        "mock": MockMCPAdapter(),          # serves the builtin/agenta mocks (D23, WP5)
+    }),
+)
```

`mcp_endpoints_dao`, `gateway_policy_service` and `secret_resolver` are
constructed earlier in the file by WP1/WP2/WP3's fragments (already landed
at M1); `connections_service` is the pre-existing connections-domain
instance every other leaf service in the file already receives by
reference (`entities.md` §8) — this fragment only adds the service and
registry. As with WP8's fragment, the local variable names above are
wiring convenience following the naming style `entities.md`'s own wiring
pseudocode uses (`llm_endpoints_dao = LLMEndpointsDAO(...)`), not symbols
the design fixes.

**Note the `ComposioMCPAdapter()` line has no owning package in wave 1** —
either it must be stubbed (raising on every call) until a later package
implements it, or the dict entry is omitted and `list_endpoints`'s builtin
branch is the only place `builtin` support exists in wave 1 (listing works,
calling does not, and would raise via `MCPUpstreamRegistry.get("composio")`
missing the key). Flag this at the M2 merge — it is not resolved by this
spec.
