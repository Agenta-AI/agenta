# WP0 — Status

**Lane** WL0 · **Stream** WS0 · **Branch** `wp0-connections-extract` (not yet created)

| Field | Value |
|-------|-------|
| State | IMPLEMENTED (awaiting orchestrator commit/PR) — B1/B2/B3 resolved in spec |
| Contract frozen (WS-PRE) | ☑ `ConnectionsService` + `ConnectionsGatewayInterface` + `Connection`/`Usage` DTOs |
| Branch created | ☐ (orchestrator) |
| Subagent | WP0 impl |
| PR | — (orchestrator) |

## Checklist

- [x] Migration: `tool_connections` → `gateway_connections` in `core_oss` (both editions)
- [x] `core/connections/` service + DAO interface + `ConnectionsService` + `ConnectionsGatewayInterface`
- [x] `dbs/postgres/connections/` DBE + DAO + mappings
- [x] Move Composio auth verbs into shared `ComposioConnectionsAdapter`
- [x] Repoint `ToolsService` + `/tools/connections` + `/callback` handlers (delegate)
- [x] C7 cross-domain revoke rule (local-only `is_valid=False`) + `usage()` read
- [x] AC: existing `/tools/connections` contract unchanged (14 operation_ids preserved, incl. `query_tool_connections`)
- [ ] AC: migration up/down clean, both editions (needs live DB — run in CI/stack)
- [ ] PR opened `--base main` (orchestrator)

## Decisions

- [x] C7 revoke rule confirmed: local-only `is_valid=False` on the shared row; no provider
  call, no cascade; provider revoke stays on DELETE. `usage()` is read-only seam.

## Notes

All three prior blockers resolved per the updated spec and implemented:

- **B1 (Option A, full extract):** `ConnectionsService` (project-scoped, owns
  `gateway_connections`, returns `Connection` DTOs) is the WS3/WS5 contract;
  `ConnectionsGatewayInterface` is the provider-keyed adapter port holding only the four
  auth verbs, implemented by `ComposioConnectionsAdapter`. `ConnectionsDAOInterface` is
  the persistence port. Nothing in `connections` imports from `tools`; `ToolsService`
  depends on `ConnectionsService` (one-way). `ToolsGatewayInterface` keeps only catalog +
  `execute`; `ComposioToolsAdapter` lost the four auth verbs and its `_delete` helper.
- **B2:** `operation_id="query_tool_connections"` left untouched. The table rename moved the
  table-defining code wholesale into `dbs/postgres/connections/dbes.py` as
  `gateway_connections` with `uq_/ix_gateway_connections_*`; the old `dbs/postgres/tools`
  package (DBE/DAO/mappings) was deleted (full extract ⇒ no in-place patch and no duplicate
  SQLAlchemy mapping of the same table). The `uq_` IntegrityError match moved with it.
- **B3 / C7:** `ConnectionsService.revoke_connection` keeps today's local-only semantics
  verbatim (`is_valid=False`, no provider call, no cascade). `usage()` reports
  `tools=True` / `subscriptions=0` (seam; no subscription consumer exists yet).

Layout chosen `core/connections/` + `dbs/postgres/connections/` (flat, matching existing
`core/tools/` and `core/triggers/`), not a `gateway/` subtree — the task brief specified
the flat paths and no `gateway/` tree exists in the working copy.

Migration authored once at `core_oss` head `oss000000002` (revises `oss000000001`),
rename-only via `op.rename_table` + `RENAME CONSTRAINT` + `RENAME INDEX`, with a clean
inverse `downgrade`. Legacy `core` chain (parked `e5f6a1b2c3d4`) untouched; `core_ee` not
touched. OAuth state utils moved to `core/connections/utils.py`; the callback URL still
points at `/tools/connections/callback` (handler stays on the tools router) so the public
contract is byte-for-byte unchanged.

Acceptance tests added in both editions:
`oss/tests/pytest/acceptance/tools/test_tools_connections.py` and
`ee/tests/pytest/acceptance/tools/test_tools_connections.py` (DB-only query + 404 always
run; create/revoke gated on `COMPOSIO_API_KEY`). Updated the lifecycle-conventions unit
test to register `connections.dbes` instead of the deleted `tools.dbes`.
