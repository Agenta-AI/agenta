# API design

Concrete backend changes for Option 1 (call the session's meta-tools over REST as
our own callback tools). See `design.md` for the reasoning and the rejected
Option 2.

## 1. Config schema

Add a per-connection type to the tool config union in
`sdks/python/agenta/sdk/agents/tools/models.py`. It uses a distinct discriminator
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

`actions` are Agenta action keys. The adapter maps them to Composio slugs, so the
stored config does not depend on Composio's slug spelling. The SDK is the
canonical persisted contract; the API aliases it as it does today
(`api/oss/src/core/tools/dtos.py:200`).

## 2. Session mapping table

Store the Composio session id in a small dedicated table, not in the connection
`data` blob, because one connection can back several policies and the blob update
is an unlocked read-modify-write.

```
gateway_sessions
  project_id        uuid
  connection_id     uuid        # the resolved connection UUID
  policy_hash       text        # canonical hash of the tool policy
  provider_session_id text      # Composio trs_...
  unique (project_id, connection_id, policy_hash)
```

The uniqueness constraint gives safe get-or-create. Sessions do not expire, so no
expiry column and no timer.

## 3. Session lifecycle service

Add a service under `api/oss/src/core/tools/providers/composio/`:

- `get_or_create_session(project_id, connection, policy) -> provider_session_id`
  Looks up `(project_id, connection_id, policy_hash)`. On a hit, returns the id.
  On a miss, creates a session and inserts the row:
  ```python
  composio.sessions.create(
      user_id=str(project_id),
      toolkits=[integration],
      tools={integration: {"enable": composio_slugs}} if mode == "include" else None,
      connected_accounts={integration: connection.provider_connection_id},
      manage_connections=False,
      workbench={"enable": False},
  )
  ```
  Note: no `mcp=True`, because Option 1 uses REST, not MCP.
- `execute_meta(provider_session_id, meta_tool, arguments)` calls Composio's
  session execute endpoint. This is the one call the meta-tools relay to.
- Recreate lazily: if execute reports the session gone, create a new one and
  retry once.

Composio's `user_id` stays `str(project_id)`, unchanged
(`api/oss/src/core/gateway/connections/service.py:174`).

## 4. Resolution change (run start)

Today the gateway resolver returns exactly one `ResolvedTool` per config
(`sdks/python/agenta/sdk/agents/platform/gateway.py:193`). The new type resolves
to a few meta-tool callback specs. The seams to change:

- The gateway resolver contract: allow one config to produce several specs.
- `GatewayToolResolution` and `ResolvedToolSet` to carry them
  (`sdks/python/agenta/sdk/agents/tools/models.py:436`).
- Each spec is a callback tool with a `call_ref` that names the connection and
  the meta-tool, for example `composio.<connection-uuid>.search`, so the names
  are unique and stable.
- No per-action Composio calls at run start, so the serial resolve loop and its
  all-or-nothing failure (#5173) are gone for the new type.

## 5. Execute path

`POST /tools/call` (`api/oss/src/apis/fastapi/tools/router.py:1129`) gains a
branch: when the `call_ref` names a Composio meta-tool, it calls the session
lifecycle service's `execute_meta`, which calls Composio with the key injected
from `env.composio`. This reuses the existing handler, permission check, tracing,
and result path. The Composio-facing call is the existing adapter's execute shape
(`api/oss/src/core/tools/providers/composio/adapter.py:166`), pointed at the
session execute endpoint.

## 6. Result cap

Lower the callback result cap to a byte budget well below one megabyte
(`services/runner/src/tools/callback.ts`), and on overflow replace the body with a
short message naming the size and telling the model to narrow, filter, or
paginate. Closes #5341, and it applies to the current per-action path too.

## 7. Error handling (closes #5407, #5173)

- When `COMPOSIO_API_KEY` is absent, return a clear 501 or 503 that says Composio
  is not configured, instead of the current bare 404
  (`api/entrypoints/routers.py`).
- With sessions there is no per-action resolve loop, so one dead action no longer
  fails the whole run. A tool that fails at call time returns its own error and
  the rest keep working.
- Stale action in an explicit `include` policy: validate the actions when
  creating the session, and if Composio rejects one, drop it with a named warning
  rather than failing the whole session create.

## 8. Version drift (root of #5174)

Sessions manage toolkit versions in one scope, so the discovery-versus-resolve
drift is gone by design. No version field is added.

## 9. What does not change

- The `gateway_connections` table and the OAuth connect flow.
- The runner. Option 1 delivers callback tools, which the runner already handles
  on every harness including Pi.
- The frontend connect and permission flows. The drawer gains a connection-level
  entry instead of per-action rows, but that is a separate frontend task.
