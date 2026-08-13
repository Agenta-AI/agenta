# WP9 — MCP registry and tool allowlist

Delivers `McpGatewayService` and `McpUpstreamRegistry`: target resolution
across the three namespaces, the per-server tool allowlist check, credential
resolution dispatch (the two-mechanism fork), the builtin/agenta/custom
merge for listing, and the relay orchestration WP8's proxy calls into. This
is the domain half of the transport/domain cut
(`workstreams/README.md`): WP8 owns the HTTP surface and the byte-for-byte
relay adapter; this package owns the service, the registry and the
allowlist.

## Files

New:
- `api/oss/src/core/gateways/mcps/service.py` — `McpGatewayService` (§8).
- `api/oss/src/core/gateways/mcps/registry.py` — `McpUpstreamRegistry` (§7.1).

Edited: none. `core/gateways/mcps/{dtos,types,interfaces}.py` are seed-owned
and frozen. `dbs/postgres/gateways/mcps/` (the DAO implementations this
package calls through the `McpEndpointsDAOInterface` / `McpGrantsDAOInterface`
ports) is **WP1**'s, already landed by M1.

## Interfaces

Reproduced verbatim from `entities.md` §7.1 and §8. Do not rename, do not
add methods not listed here.

### `McpUpstreamRegistry` (§7.1)

```python
class McpUpstreamRegistry:
    def __init__(self, *, adapters: Dict[str, McpUpstreamInterface]): ...
    def get(self, key: str) -> McpUpstreamInterface: ...
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

`McpUpstreamRegistry.get` raises on a miss, per §7.1's own comment
(`# raises on a miss`) — reuse `McpEndpointNotFoundError` or a dedicated
registry-miss exception only if `entities.md` names one; it does not, so
raise the existing `ProviderNotFoundError`-shaped pattern is **not**
available (that class lives in the connections domain, out of bounds per
D15/§4.1's "the gateways define their own vocabulary"). Add no new public
exception name beyond what `core/gateways/mcps/types.py` already declares;
if a registry-miss needs its own type, that is a "missing from the design"
item (below), not a name to invent silently.

### `McpGatewayService` (§8)

```python
class McpGatewayService:
    def __init__(
        self,
        *,
        mcp_endpoints_dao: McpEndpointsDAOInterface,
        mcp_grants_dao: McpGrantsDAOInterface,
        policy: GatewayPolicyService,
        resolver: CredentialResolverInterface,
        upstream_registry: McpUpstreamRegistry,
    ) -> None: ...
```

Method surface, in full, with the wave-1 implementation split marked:

```python
class McpGatewayService:
    # --- management --------------------------------------------------------- #

    async def create_endpoint(self, *, project_id, user_id, endpoint) -> Optional[McpEndpoint]: ...
    async def fetch_endpoint(self, *, project_id, endpoint_id) -> Optional[McpEndpoint]: ...
    async def edit_endpoint(self, *, project_id, user_id, endpoint) -> Optional[McpEndpoint]: ...
    async def delete_endpoint(self, *, project_id, endpoint_id) -> bool: ...
    async def query_endpoints(self, *, project_id, endpoint=None, windowing=None) -> List[McpEndpoint]: ...
    async def list_endpoints(self, *, project_id) -> List[McpEndpoint]: ...
    # The three-namespace merge (D27): agenta entries from code, builtin entries
    # generated from the Composio catalog with their connection state resolved
    # through the existing connections service, custom rows from the DAO.

    # --- grants (WP17, WP18 wire these; declared now) ----------------------- #

    async def connect_endpoint(self, *, project_id, user_id, endpoint_id, scopes) -> str: ...
    async def complete_connect(self, *, state, payload) -> McpGrant: ...
    async def revoke_grant(self, *, project_id, grant_id) -> bool: ...
    async def query_grants(self, *, project_id, grant=None, windowing=None) -> List[McpGrant]: ...

    # --- the data plane (WP8) ----------------------------------------------- #

    async def relay(
        self, *, scope, namespace, name, provider=None, integration=None,
        context, body, headers,
    ) -> McpRelayResult: ...
    # name is the last path component (§2.3): the agenta slug (possibly nested),
    # the custom slug, or the builtin connection slug — in which case provider
    # and integration carry the other two segments
```

**The comment `(WP17, WP18 wire these; declared now)` covers the entire
grants block** — `connect_endpoint`, `complete_connect`, `revoke_grant` and
`query_grants` alike. This package declares all four with the exact
signatures above and leaves every body raising `NotImplementedError`,
mirroring the seed-declaration pattern the channels design's WP1 used for
methods owned by a later package (`specs-wp1.md`, `service.py` section:
"WP1 must not implement routing logic, only leave the methods present and
raising `NotImplementedError`"). Wave 3 (WP17/WP18) fills these in; nothing
in wave 1's acceptance tests exercises them.

### Management CRUD — thin DAO delegation

`create_endpoint` / `fetch_endpoint` / `edit_endpoint` / `delete_endpoint` /
`query_endpoints` delegate to `McpEndpointsDAOInterface` (WP1's
implementation, already landed):

```python
# core/gateways/mcps/interfaces.py (seed, frozen — read only)

class McpEndpointsDAOInterface(ABC):
    async def create_endpoint(self, *, project_id: UUID, user_id: UUID, endpoint: McpEndpointCreate) -> Optional[McpEndpoint]: ...
    async def fetch_endpoint(self, *, project_id: UUID, endpoint_id: UUID) -> Optional[McpEndpoint]: ...
    async def fetch_endpoint_by_slug(self, *, project_id: UUID, slug: str) -> Optional[McpEndpoint]: ...
    async def edit_endpoint(self, *, project_id: UUID, user_id: UUID, endpoint: McpEndpointEdit) -> Optional[McpEndpoint]: ...
    async def delete_endpoint(self, *, project_id: UUID, endpoint_id: UUID) -> bool: ...
    async def query_endpoints(self, *, project_id: UUID, endpoint: Optional[McpEndpointQuery] = None, windowing: Optional[Windowing] = None) -> List[McpEndpoint]: ...
```

### `list_endpoints` — the three-namespace merge (D27, §8)

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
  `McpEndpoint` with `namespace=BUILTIN`, `connection_id`, `provider_key`,
  `integration_key` and `slug` stamped from the connection (§4.4's
  documented fields on `McpEndpoint`). D23 restricts wave 1's **reachable
  call targets**, not catalog **listing** — `scope-checklist.md` puts MCP
  registry work in wave 1 unconditionally, so this branch must be
  genuinely implemented, even though nothing calls through it yet.
- **`custom`** — `McpEndpointsDAOInterface.query_endpoints` rows, mapped
  1:1, `namespace=CUSTOM` (the DTO's own default).

Connection-state derivation (§8, verbatim): *"`GatewayConnectionState` is
derived in `McpGatewayService` per owner and per namespace: `READY` iff the
endpoint's scheme is NONE (every `agenta` entry), or — `custom` — a valid
grant exists for this owner, or — `builtin` — the referenced connection row
is active and valid, read through the existing connections service;
`NEEDS_AUTH` otherwise for an OAuth or builtin endpoint ... `NEEDS_INPUT`
reserved for the api_key scheme (deferred with its kind, D14)."* Implement
this for real in wave 1: a `custom` OAuth-scheme endpoint with no grant row
correctly derives `NEEDS_AUTH` today (there being no grants at all is not a
special case — `fetch_grant` simply returns `None`, and the derivation
already handles that).

### The two credential mechanisms — the fork is at the south port, not the entity (D27, §4.4)

Do not build a discriminated endpoint type (`McpBuiltinEndpoint` /
`McpCustomEndpoint`) — `entities.md` explicitly rejects that split: "the
endpoint's identity, config and listing shape are one — only the credential
path forks, and forking every DAO and service signature for a difference
that appears at credential time would spread the fork everywhere it does
not matter." The fork is expressed once, in `relay`'s credential-resolution
step, by constructing the right `McpRelayAuth` arm:

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

For `agenta`/`custom` targets: resolve via `CredentialResolverInterface.resolve()`
(WP2, already landed) with `mode=CredentialMode.USER_OPTIONAL` — "the
deliberate asymmetry from `secrets.md`: one billing identity for models,
personal authority for tools" (§7.2). `NONE`-scheme targets skip resolution
entirely (`credential=None`). For `builtin` targets: **never** call the
resolver — "its credential lives at the broker and never enters our vault"
(§4.4). Instead fetch the connection row directly via `ConnectionsService`
(the same instance `list_endpoints` already uses) and wrap it in
`McpBrokeredAuth`. Routing `builtin` through the resolver with a fourth ref
arm was explicitly rejected (§7.2) — do not add one.

### `relay` — the six-step orchestration (§8, D7 applied to MCP)

`entities.md` gives the full pseudocode for the LLM plane
(`relay_chat_completion`) and states "both planes walk the same six steps ...
only the nouns differ." Implement the MCP equivalent following that shape
exactly:

1. **Resolve target.** By namespace: `agenta` → the code-defined entry
   matching `name`; `builtin` → the connection row matching
   `(provider, integration, name)` via `ConnectionsService`; `custom` →
   `McpEndpointsDAOInterface.fetch_endpoint_by_slug(project_id, slug=name)`.
   Raise `McpEndpointNotFoundError` (constructed with `namespace`,
   `provider`, `integration`, `name` per its signature in §5) when nothing
   resolves.
2. **Allowlist before credential.** `_check_allowlist(target, context)`:
   when `context` names a specific tool and the target's `tool_policy.mode`
   is `INCLUDE`, refuse anything outside `tool_policy.names` with
   `McpToolNotAllowedError` — **before** any credential resolution or
   upstream call (§8: "A refused model or tool must not cost a vault
   read").
3. **Authorize.** `self.policy.authorize(scope=scope,
   permission=Permission.USE_MCP_ENDPOINTS, target=...)`. On denial, record
   the decision via `self.policy.record(...)` **before** raising
   `PolicyDeniedError` — the audit ordering rule (§8: "The denial is
   recorded before the exception leaves").
4. **Resolve credential**, per the two-mechanism fork above.
5. **Dispatch.** `self.upstream_registry.get(<adapter key for namespace>).relay(
   route=..., auth=..., context=..., body=..., headers=...)`. The
   namespace→adapter-key mapping (`agenta`→`"mock"` in wave 1 — the wiring
   block's own comment: `"mock": MockMcpAdapter(), # serves the
   agenta-namespace mocks (D23)`; `builtin`→`"composio"`; `custom`→`"http"`)
   is a private implementation detail of this file — `entities.md` names no
   public function for it on the MCP plane (contrast the LLM plane's
   `select_upstream`, explicitly named in §7.1). Do not invent a public
   name for it.
6. **Record and, for a list method, filter.** `self.policy.record(...)`
   with the real outcome. When `context.method` is a list operation
   (`tools/list`), apply the tool policy to the **response body**: "an
   `INCLUDE` tool policy filters the list result — entries dropped whole,
   never renamed — while credential death does not filter anything (D18).
   Policy hides what may never be called; credential state never hides
   what policy allows" (§8, verbatim). This is the one place `relay`
   inspects and rewrites the upstream's JSON body rather than relaying it
   untouched — narrowly scoped to dropping whole tool entries by name, never
   renaming or editing a surviving entry.

`target` in this pseudocode is service-internal (the resolved row or
generated entry, plus which namespace answered) and never crosses a layer —
it is not a DTO in §4 and must not be added to `dtos.py`.

## Contracts this package must honour

- **D18 — a dead secret does not hide tools.** A `custom` OAuth endpoint
  with `is_valid=False` on its grant still lists its tools; only the call
  fails. Do not let credential health leak into the list-filtering step —
  only `tool_policy` filters the list.
- **D19/D20 — an endpoint is a server, not a tool; only custom endpoints are
  rows.** `list_endpoints` must never persist a generated `agenta`/`builtin`
  entry; they are computed on every call.
- **The empty allowlist refuses** (§4.4): `tool_policy.mode == INCLUDE` with
  an empty `names` list means every tool is refused, not every tool
  allowed. The permissive reading is the wrong default.
- **`fetch_grant`'s `user_id=None` selects the project-owned grant, not
  "any"** (§7). This package does not implement grant fetching in wave 1
  (declared, `NotImplementedError`), but must not pass `user_id=None`
  through the resolver's `USER_OPTIONAL` mode meaning "skip the owner
  check" — the mode logic itself lives in WP2's resolver, already correct;
  this package must call it correctly.
- **`McpUpstreamRegistry.get` raises on a miss** (§7.1) — never returns
  `None` and silently no-ops.

## Missing from the design, needs a ruling

- **No named exception for a registry key miss.** `entities.md` §7.1 says
  `get()` "raises on a miss" but does not name the exception type for the
  MCP registry (the LLM plane's analog is likewise unnamed). Do not import
  `ProviderNotFoundError` from `core/gateway/connections/exceptions.py` —
  that is a different domain's exception, out of bounds per D15/§4.1. Raise
  a plain, already-declared `GatewaysError` or `McpUpstreamError` with a
  message naming the missing key until a ruling adds a dedicated type; do
  not invent a new public exception name unilaterally.
- **No public name for the namespace→adapter-key selector.** Noted above —
  implement it as a private function, do not add it to `entities.md`'s
  public surface.

## Test layer

- `McpUpstreamRegistry.get`/`keys` — **unit**. Trivial, mirrors
  `ConnectionsGatewayRegistry`'s own tests if any exist, or a fresh minimal
  test: registering two mock adapters, `get()` returns the right one,
  `get()` on a missing key raises, `keys()` lists both.
- `McpGatewayService`'s CRUD delegation — **unit**, with a mock
  `McpEndpointsDAOInterface` (an in-memory dict-backed double, not the real
  Postgres DAO). Assert each method calls the right DAO verb with the right
  arguments and returns what the DAO returned.
- `list_endpoints`'s three-namespace merge — **unit** with mocks for both
  the DAO and `ConnectionsService` (a stub returning a canned list of
  `Connection` rows). Assert: agenta entries appear with `namespace=AGENTA`
  and no `id`; builtin entries appear with `namespace=BUILTIN`,
  `connection_id`/`provider_key`/`integration_key` stamped; custom rows
  appear with `namespace=CUSTOM`; no generated entry is ever passed to a
  DAO write.
- Connection-state derivation — **unit**. A `custom` OAuth endpoint with no
  grant (mock `McpGrantsDAOInterface.fetch_grant` returning `None`) derives
  `NEEDS_AUTH`; a `custom` NONE-scheme endpoint derives `READY`
  unconditionally; a `builtin` entry backed by a mock `Connection` with
  `is_valid=False` derives `NEEDS_AUTH`.
- `relay`'s six-step order — **unit**, with a mock `GatewayPolicyService`,
  mock resolver, mock `McpUpstreamRegistry`. Assert: a tool outside the
  policy raises `McpToolNotAllowedError` **without** the mock resolver or
  mock adapter ever being called (proves step ordering, not just the final
  outcome); a policy denial calls `policy.record` before the exception
  propagates (assert on call order via the mocks' call logs); a `builtin`
  target never calls the resolver, only `ConnectionsService`.
- Tool-list filtering — **unit**. A mock adapter returns a canned
  `tools/list` JSON body with three tools; a target with `tool_policy.mode
  == INCLUDE, names=["a","b"]` filters the response to two entries,
  unmodified in shape; a target with `mode == ALL` passes all three
  through untouched.
- The full relay path against a real mock MCP server, and the merge against
  a real Postgres-backed `McpEndpointsDAO` — **acceptance**, part of
  Checkpoint A (shared with WP8; see `specs-wp8.md`'s acceptance section).

## Executable done test

Plan.md's stated done condition, verbatim: *"a custom server registers and
resolves, and a built-in one needs no row."* Concretely:

```text
create_endpoint(project_id=P, user_id=U, endpoint=McpEndpointCreate(
    slug="acme-notion", auth_mode=NONE, data=McpEndpointData(url="https://...")
))
  -> a row exists; fetch_endpoint_by_slug(P, "acme-notion") resolves it

list_endpoints(project_id=P)
  -> contains an entry with namespace=CUSTOM, slug="acme-notion"
  -> contains entries with namespace=BUILTIN for every active composio
     connection in P, with NO corresponding row in mcp_gateway_endpoints
```

## Out of scope

- The HTTP surface, `McpGatewayProxy`, `parse_mcp_call_context`, and the
  `HttpMcpAdapter` south-port implementation — **WP8**.
- The management CRUD router and models
  (`apis/fastapi/gateways/mcps/{router,models}.py`) — **WP10**.
  `apis/fastapi/gateways/exceptions.py` — **the seed** (R1).
- `ComposioMcpAdapter` — not owned by any wave-1 package; `builtin` targets
  are not called until a package for it is scheduled.
- The real bodies of `connect_endpoint`, `complete_connect`, `revoke_grant`,
  `query_grants` — WP17/WP18 (wave 3).
- `dbs/postgres/gateways/mcps/` (DAO implementation, migration) — **WP1**,
  already landed by M1.
- `core/access/permissions/types.py`'s six new members — **WP3**, already
  landed by M1.

## Checkpoint

Feeds **Checkpoint A**, together with WP8 (see `specs-wp8.md`'s acceptance
section for the shared suite) at the M2 merge.

## `api/entrypoints/routers.py` diff

This package owns the `McpGatewayService` and `McpUpstreamRegistry`
construction block — the one other packages (WP8's adapter entry, WP10's
router construction) attach to. Applied at the M2 merge together with the
sibling fragments from `specs-wp6.md`/`specs-wp7.md`/`specs-wp8.md`/`specs-wp10.md`:

```diff
+from oss.src.core.gateways.mcps.service import McpGatewayService
+from oss.src.core.gateways.mcps.registry import McpUpstreamRegistry
+
+mcp_gateway_service = McpGatewayService(
+    mcp_endpoints_dao=mcp_endpoints_dao,
+    mcp_grants_dao=mcp_grants_dao,
+    policy=gateway_policy_service,
+    resolver=credential_resolver,
+    upstream_registry=McpUpstreamRegistry(adapters={
+        "http": HttpMcpAdapter(),          # custom: McpDirectAuth (WP8)
+        "composio": ComposioMcpAdapter(),  # builtin: McpBrokeredAuth (not wave 1)
+        "mock": MockMcpAdapter(),          # serves the agenta-namespace mocks (D23, WP5)
+    }),
+)
```

`mcp_endpoints_dao`, `mcp_grants_dao`, `gateway_policy_service` and
`credential_resolver` are constructed earlier in the file by WP1/WP2/WP3's
fragments (already landed at M1) — this fragment only adds the service and
registry. As with WP8's fragment, the local variable names above are
wiring convenience following the naming style `entities.md`'s own wiring
pseudocode uses (`llm_endpoints_dao = LlmEndpointsDAO(...)`), not symbols
the design fixes.

**Note the `ComposioMcpAdapter()` line has no owning package in wave 1** —
either it must be stubbed (raising on every call) until a later package
implements it, or the dict entry is omitted and `list_endpoints`'s builtin
branch is the only place `builtin` support exists in wave 1 (listing works,
calling does not, and would raise via `McpUpstreamRegistry.get("composio")`
missing the key). Flag this at the M2 merge — it is not resolved by this
spec.
