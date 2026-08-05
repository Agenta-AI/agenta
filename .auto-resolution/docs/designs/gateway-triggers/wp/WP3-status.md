# WP3 — Status

**Lane** WL3 · **Stream** WS3 · **Branch** `wp3-subscriptions` (created by orchestrator)

| Field | Value |
|-------|-------|
| State | IMPLEMENTED (pending commit + live-API test run) |
| Contract frozen (WS-PRE) | ☑ Subscription/Delivery DTOs + routes + DAO surface |
| Consumes frozen | ☑ ConnectionsGW (WP0) ☑ TriggersGW (WP1) |
| Branch created | (orchestrator) |
| Subagent | WP3 build |
| PR | — |

## Checklist

- [x] `trigger_subscriptions` table (FlagsDBA enabled/valid, DataDBA, FK → gateway_connections)
- [x] `trigger_deliveries` table (+ `event_id` = provider `metadata.id` dedup column, unique per subscription)
- [x] DBA mixins (mirror webhooks/dbas.py) — `dbs/postgres/triggers/dbas.py`
- [x] Migration in `core_oss` (`oss000000003`, down_revision `oss000000002`; runs in both editions)
- [x] Subscription CRUD routes + adapter calls (ti_* create / set-status / delete)
- [x] Delivery read routes (`/triggers/deliveries`, `/{id}`, `/query`)
- [x] DAO surface for WP4: `get_subscription_by_trigger_id`, `write_delivery`, `dedup_seen`
- [x] AC tests (OSS + EE): list/query/404 DB-only; create/list/disable/delete + C7 gated on COMPOSIO_API_KEY
- [ ] PR opened `--base wp2-resolver-promote` (orchestrator)

## Decisions (locked, built to)

- [x] I4 idempotency — `event_id` (String) dedup column on `trigger_deliveries`, unique on
  `(project_id, subscription_id, event_id)`; `write_delivery` upserts on it, `dedup_seen` checks it.
- [x] M8 default mapping — inputs-only; `inputs_fields` template stored on the subscription, resolved
  (by WP4) via the promoted `agenta.sdk.utils.resolvers.resolve_target_fields`. No schema validation.

## Implementation notes

- Tables named `trigger_subscriptions` / `trigger_deliveries` (domain-prefixed, mirroring
  `webhook_subscriptions`/`webhook_deliveries`) — NOT bare `subscriptions`/`deliveries`, which would
  collide with EE billing subscriptions.
- Subscription DTO nests `event_key`/`ti_id`/`trigger_config`/`inputs_fields`/`references`/`selector`
  under `data` (exactly as webhooks nests `event_types`/`payload_fields` under `data`); `connection_id`,
  `enabled`, `valid` are top-level. The frozen field inventory is satisfied; nesting follows the
  webhooks precedent it mirrors.
- `enabled`/`valid` persist in the FlagsDBA `flags` JSONB (`{"enabled":..,"valid":..}`).
- C7 enforced: `delete_subscription` / `revoke_subscription` only touch the provider trigger instance
  (`ti_*`) via the adapter, never the shared `gateway_connections` row.
- EE permissions: added `EDIT_TRIGGERS` to EDITOR_PERMISSIONS and `RUN_TRIGGERS` to ANNOTATOR_PERMISSIONS
  (parallel to `EDIT_TOOLS`/`RUN_TOOLS`) so the developer role can actually exercise subscription CRUD —
  the enum values existed but were ungranted to every role except owner. See blocker note below.

## Notes / blockers

- **Testing seam (not a blocker, but a constraint):** acceptance tests run over HTTP against a live API,
  so the Composio adapter cannot be dependency-injected/mocked. The instruction "mock the adapter" is
  satisfied in spirit by gating the adapter-dependent path (create → ti_* → disable → delete, plus the
  C7 connection-intact assertion) on `COMPOSIO_API_KEY`, exactly as the existing tools/connections and
  triggers/catalog suites do. DB-only reads/queries/404s run unconditionally and prove the migration
  landed. If a true adapter mock is wanted, it needs a unit-test harness against `TriggersService`
  (out of WP3's acceptance-test scope).
- **EE permission grant (flagged for review):** I added `EDIT_TRIGGERS`/`RUN_TRIGGERS` to the
  editor/annotator role sets. This is the minimal change to make the locked `EDIT_TRIGGERS` gating
  functional for non-owner roles; if WP1 intended a different role mapping, adjust there.
