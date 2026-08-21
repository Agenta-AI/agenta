# API design

Concrete backend changes for the design in `design.md`. One config entry resolves
into two callback tools, search and execute, both routed through the Composio
adapter we already use. There is no session table and no session service.

## 1. Config schema

Add a per-connection type to the tool config union in
`sdks/python/agenta/sdk/agents/tools/models.py`. It uses a distinct discriminator,
so it does not collide with the existing per-action `gateway` type, which stays.

```python
class GatewayToolkitConfig(ToolConfigBase):
    type: Literal["gateway_toolkit"] = "gateway_toolkit"
    provider: str = "composio"
    integration: str
    connection: str            # project-scoped connection slug
    tools: ToolkitPolicy       # authorization policy
    # permission (allow|ask|deny) comes from ToolConfigBase
```

```python
class ToolkitPolicy(BaseModel):
    mode: Literal["all", "include"] = "all"
    actions: list[str] | None = None   # required when mode == "include"
```

The `actions` are Agenta action keys. The server maps them to Composio slugs, so
the stored config does not depend on how Composio spells a slug. The SDK holds the
canonical persisted contract; the API aliases it as it does today
(`api/oss/src/core/tools/dtos.py:200`).

## 2. Resolution: one config, two callback tools

Today the gateway resolver returns exactly one spec per config, and the SDK
enforces that count: the resolver rejects a response whose spec count does not
match the ref count (`sdks/python/agenta/sdk/agents/platform/gateway.py:196`). The
new type must produce two specs from one config, so this is the seam that changes.

- Relax the resolver contract so one `gateway_toolkit` config yields several specs
  instead of exactly one. The `gateway_toolkit` path returns two; the old
  per-action path still returns one.
- Carry the several specs through `GatewayToolResolution` and `ResolvedToolSet`
  (`sdks/python/agenta/sdk/agents/tools/models.py:436`).
- Give each spec a `call_ref` that names the connection and the tool, so the names
  are unique and stable across runs:
  `composio.<connection-uuid>.search` and `composio.<connection-uuid>.execute`.
- Make no per-action Composio calls at run start. The serial resolve loop and its
  all-or-nothing failure (#5173) are gone for the new type, because resolution now
  produces two fixed specs without touching Composio.

The two `call_ref` values are stable for the life of the connection and contain no
volatile id, so the warm-sandbox fingerprint stays stable across runs
(`services/runner/src/engines/sandbox_agent/session-identity.ts:207`).

## 3. Execute path: the two meta-tools at /tools/call

`POST /tools/call` (`api/oss/src/apis/fastapi/tools/router.py:1129`) gains a branch
for the two Composio meta-tools. Both use the existing Composio adapter with the
key injected from `env.composio` (`api/oss/src/core/tools/providers/composio/adapter.py:54`).

- **search** calls `COMPOSIO_SEARCH_TOOLS` through the adapter's existing search
  path (`adapter.py:225`, `search_capabilities`). It returns the matching action
  slugs and each one's input schema inline. Pin the call to the latest toolkit
  version (section 5).
- **execute** first checks the requested slug against the config's policy. If the
  policy is `include` and the slug is not listed, it returns a permission error
  without calling Composio. Otherwise it runs the action through the adapter's
  existing execute path (`adapter.py:166`, `execute`), resolving the connection's
  account per call from the connection's provider account id
  (`api/oss/src/core/gateway/connections/dtos.py:68`). Pin the call to the latest
  version.

Both reuse the existing handler, permission gate, tracing, and result path.
Composio's `user_id` stays `str(project_id)`, unchanged
(`api/oss/src/core/gateway/connections/service.py:174`).

## 4. Policy enforcement

The allow-list lives on the config entry and is enforced at the execute callback in
the API, not in any server-side filter. When the policy is `include`, the API
rejects a slug the list does not name and returns a clear error, which the model
reads and recovers from. When the policy is `all`, every slug in the toolkit is
allowed. There is no session-side filter to configure or keep in sync.

## 5. Version pinning (root of #5174)

Pin both the search call and the execute call to the latest toolkit version. Call
Composio API v3.1, which defaults tool endpoints to the latest version, or pass an
explicit latest version. `ComposioConfig` (`api/oss/src/utils/env.py:685`) has no
version field today; the version is baked into the default URL, which is why
discovery and resolve disagree now. After the pin, a slug that search returns is one
that execute can run. A rare mismatch stays possible and is handled as a soft
per-call error, not a run-ending failure.

## 6. Result cap (closes #5341)

Lower the callback result cap to a byte and token budget well below one megabyte
(`services/runner/src/tools/callback.ts`), and on overflow replace the body with a
short steering message that names the size and tells the model to narrow, filter,
or paginate. This also helps the current per-action path.

## 7. Clear not-configured error (closes #5407)

When `COMPOSIO_API_KEY` is absent, return a clear 501 or 503 that says Composio is
not configured, instead of the current bare 404 (`api/entrypoints/routers.py`). A
self-hoster can then diagnose the missing key.

## 8. What does not change

- No session table, no session service, no session id storage, no PATCH, no
  get-or-create, no connected-account pinned at create. Each execute passes the
  account per call.
- The `gateway_connections` table and the OAuth connect flow.
- The runner. It delivers the two callback tools on every harness including Pi,
  through the internal channel it already uses for every Agenta tool.
- The existing per-action `gateway` type stays, so old configs keep parsing and the
  compat layer gives a migration path.
