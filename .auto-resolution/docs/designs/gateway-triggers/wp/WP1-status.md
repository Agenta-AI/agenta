# WP1 — Status

**Lane** WL1 · **Stream** WS1 · **Branch** `wp1-events-catalog` (not yet created)

| Field | Value |
|-------|-------|
| State | CODE COMPLETE (awaiting orchestrator commit/PR) |
| Contract frozen (WS-PRE) | ☑ `TriggersGatewayInterface` + `Event` DTO + catalog routes (implemented as written) |
| Branch created | ☐ (anchor `wp0-connections-extract`) |
| Subagent | — |
| PR | — |

## Checklist

- [x] Domain skeleton (apis/fastapi/triggers, core/triggers, dbs/postgres/triggers)
- [x] `ComposioTriggersAdapter` behind `TriggersGatewayInterface` (catalog + subscription verbs)
- [x] Events catalog routes + `trigger_config` schema return
- [x] Wiring in `entrypoints/routers.py` (gated on `env.composio.enabled`; lifespan close added)
- [x] E5: v3 REST paths verified vs live Composio API reference
- [x] AC: browse + fetch schema, both editions (provider catalog ungated; event browse gated on COMPOSIO_API_KEY)
- [ ] PR opened `--base wp0-connections-extract` (orchestrator)

## Decisions

- [x] E5 paths confirmed (verified against live Composio API reference, docs.composio.dev):
  - List trigger types: `GET /triggers_types` (query `toolkit_slugs`, `limit`, `cursor`)
  - Get one trigger type (config schema): `GET /triggers_types/{slug}`
  - Create/upsert instance: `POST /trigger_instances/{slug}/upsert` (body `connected_account_id`, `trigger_config`)
  - Enable/disable instance: `PATCH /trigger_instances/manage/{trigger_id}` (body `status` = `"enable"`/`"disable"`)
  - Delete instance: `DELETE /trigger_instances/manage/{trigger_id}`
  - All paths are relative to `env.composio.api_url` (default `/api/v3`); adapter builds `f"{api_url}{path}"` exactly like `ComposioToolsAdapter`. Docs currently surface these under the `v3.1` minor; the path *segments* (what E5 asked to confirm) are stable across v3/v3.1 and we keep the shared `env.composio.api_url` base.

## Notes / blockers

- E5 resolved without live creds: paths confirmed from the public Composio API reference (no auth needed).
- WP1 adds **no new env var**: it reuses the existing `env.composio` (enabled = key present).
  `COMPOSIO_WEBHOOK_SECRET` is deliberately deferred to WP4 (ingress, gap I2) — adding it
  now would be a consumer-less dead config.
- `dbs/postgres/triggers/` is an empty package skeleton in WP1 — the `subscriptions`/`deliveries`
  tables + DAO + mappings are WP3 scope, so no DBE/migration here.
- EE catalog is gated on the existing `VIEW_TOOLS` permission (no `VIEW_TRIGGERS` introduced —
  triggers share the gateway permission surface, per gap non-goal "no EE-only gating beyond tools").
- Files changed listed in the final report to the orchestrator.
