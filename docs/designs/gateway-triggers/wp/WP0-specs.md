# WP0 — Connection extract (A2-2)

**Lane** WL0 (root, anchor `main`) · **Stream** WS0 (api) · **Area** api (touches shipped tools)

Parent docs: [`../plan.md`](../plan.md) §4, [`../gap.md`](../gap.md) §2.1, [`../proposal.md`](../proposal.md) (A2-2),
[`../mimics.md`](../mimics.md) (Triggers vs Tools, Part B).

## Goal

Move the provider connection out of `/tools` into a shared, **routerless** `connections`
domain, leaving the `/tools/connections` HTTP contract byte-for-byte unchanged. This is the
FK root: `gateway_connections` must exist before any subscription can reference it.

## Closes (gap items)

C1, C2, C3, C4, C5, C6 — and lands the **C7** cross-domain revoke *rule* in code.

## Scope

- **Migration** — rename `tool_connections` → `gateway_connections` (+ its `uq_`/`ix_`
  constraints); rename-only, **no data transform**. Author the revision **once in the shared
  `core_oss` chain** (rooted `oss000000000`, version table `alembic_version_oss`), which runs
  in **both** editions — EE ships the `oss/` tree and runs it from there (no copy in
  `core_ee`). **Not** the parked legacy `core` tree (frozen at `park00000000`) and **not**
  `core_ee` (EE-only divergence; `gateway_connections` is shared schema). See
  `application/docs/designs/oss-ee-convergence/migration-chains-and-edition-switch.md`.
- **Domain** — create `core/gateway/connections/` (service + DAO + `ConnectionsGatewayInterface`)
  and `dbs/postgres/gateway/connections/` (DBE + DAO + mappings). **No router.**
- **Adapter** — move the Composio **auth** verbs (`initiate_connection`, `get_connection_status`,
  `refresh_connection`, `revoke_connection`) out of `ComposioToolsAdapter` into the shared
  connection adapter behind `ConnectionsGatewayInterface`.
- **Repoint tools** — `ToolsService` connection management delegates to `ConnectionsService`;
  the `/tools/connections` + `/callback` handlers call through it. Fix only the FORCED
  `tool_connections` string refs: tablename + `uq_`/`ix_` in `dbs/postgres/tools/dbes.py`, and
  the `uq_tool_connections_*` IntegrityError match at `dao.py:72`. **B2: do NOT rename
  `operation_id="query_tool_connections"` at `apis/fastapi/tools/router.py:160`** — it is part
  of the frozen `/tools` OpenAPI contract; the table rename does not require touching it.
- **C7 rule (B3)** — `revoke_connection` keeps today's **local-only** behavior verbatim
  (`is_valid=False` on the row; **no** provider call, **no** cascade — provider revoke stays
  on DELETE). Because tools and triggers read the **same** `gateway_connections` row, that one
  flag IS the cross-domain effect ("revoke-for-everyone" via the shared row, not a new provider
  call). C7 additionally ships the `usage()` read ("used by tools / N subs") + the seam.
  Subscription delete must **not** revoke the connection.

## Contracts this WP freezes (consumed by WS3, WS5 — freeze in WS-PRE)

**B1 = Option A (full extract, no leaks).** Two layers, two names — mirroring how tools is
built (`ToolsGatewayInterface` adapter + `ToolsService`). WS3/WS5 freeze against
**`ConnectionsService`**, not the adapter port. **Nothing in `connections` imports from
`tools`** (no leak): `ToolsService` depends on `ConnectionsService`, never the reverse.

```text
# SERVICE — project-scoped, owns gateway_connections, returns domain DTOs. WS3/WS5 consume THIS.
ConnectionsService:
  initiate_connection(*, project_id, provider, integration, ...) -> Connection
  get_connection_status(*, project_id, connection_id) -> Status
  refresh_connection(*, project_id, connection_id) -> Connection
  revoke_connection(*, project_id, connection_id) -> Connection    # is_valid=False on the shared row → cross-domain (C7, B3)
  list_connections(*, project_id, ...) -> list[Connection]          # backs /tools|/triggers/connections views
  usage(*, project_id, connection_id) -> Usage                      # "used by tools / N subs" (what C7 ships)

# ADAPTER PORT — provider-keyed, returns provider data. The 4 Composio auth verbs move behind THIS.
ConnectionsGatewayInterface:
  initiate_connection(*, request: ConnectionRequest) -> ConnectionResponse
  get_connection_status(*, provider_connection_id) -> dict
  refresh_connection(*, provider_connection_id, ...) -> dict
  revoke_connection(*, provider_connection_id) -> bool

Connection DTO: { id (ca_*), project_id, provider, integration, slug, status, ... }
gateway_connections columns: (unchanged from tool_connections; already domain-neutral)
```

`ToolsService` delegates connection management to `ConnectionsService`. `ToolsGatewayInterface`
keeps only the tool-specific verbs (`execute`, catalog); the connection auth verbs move out to
`ConnectionsGatewayInterface` (implemented by a shared `ComposioConnectionsAdapter`).

## Functional deps

None — root.

## Stubs needed

None.

## Decisions (RESOLVED — locked by orchestrator)

- **B1** = Option A: full extract, two names (`ConnectionsService` + `ConnectionsGatewayInterface`),
  no `connections → tools` import. WS3/WS5 freeze against `ConnectionsService`.
- **B2** = do not rename the `query_tool_connections` operation_id; only forced table refs change.
- **B3 / C7** = local-only `is_valid=False` revoke, cross-domain via the shared row; ship the
  `usage()` read. Subscription delete must not revoke the connection.

## Acceptance criteria

- Every existing `/tools/connections` test passes **unchanged** (contract-frozen invariant).
- Migration up/down clean on **both** editions; `core_oss` chain head advances; legacy `core`
  untouched.
- connect / refresh / revoke still work end-to-end via `/tools/connections`.
- (No triggers-side AC — no consumer yet.)

## Risk

The only PR that edits shipped tools code. Keep it a pure refactor + rename — **no behavior
change visible at `/tools`**. Largest blast radius; reviewed and merged first (it is WL0).
