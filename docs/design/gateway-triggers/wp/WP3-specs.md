# WP3 — Subscriptions + deliveries

**Lane** WL3 (anchor WL2) · **Stream** WS3 (api) · **Area** api

Parent docs: [`../plan.md`](../plan.md) §4, [`../gap.md`](../gap.md) §2.3, [`../mimics.md`](../mimics.md) (Triggers vs Webhooks),
[`../mapping.md`](../mapping.md) §3–§4.

## Goal

The two-table heart of the domain, modeled on webhooks' `webhook_subscriptions` +
`webhook_deliveries`. Functional as **subscription CRUD** before any dispatch exists.

## Closes (gap items)

S1, S2, S3, S4, S5.

## Scope

- **`subscriptions` table** (FlagsDBA enabled/valid, DataDBA): `ti_*`, `trigger_config`,
  `inputs_fields` (the mapping template), destination `references`/`selector`, the bound
  **workflow ref**, **FK → `gateway_connections`**. Many per connection.
- **`deliveries` table** (modeled on `webhook_deliveries`): resolved `inputs`, workflow
  `references`, `result`/`error`, plus the `metadata.id` **dedup column** (I4).
- **DBA mixins** for both (mirror `dbs/postgres/webhooks/dbas.py`; tools has none).
- **Migration** authored once in the shared `core_oss` chain (both editions, per WP0's rule).
- **Subscription CRUD** `/triggers/subscriptions/` · `/query` · `/{id}` · `/{id}/refresh` ·
  `/{id}/revoke` — create/disable/delete the Composio `ti_*` through the adapter
  (`TriggersGatewayInterface.create_subscription` etc.), referencing a shared connection.
  Deleting a subscription must **not** revoke the connection (C7).
- **Delivery read** routes `/triggers/deliveries` · `/{id}` · `/query`.

## Contracts this WP freezes (consumed by WS4, WS6 — freeze in WS-PRE)

```text
Subscription DTO: { id, project_id, connection_id (FK), event_key, ti_id, trigger_config,
                    inputs_fields, references, selector, enabled, valid, ... }
Delivery DTO:     { id, subscription_id, event_id (metadata.id), inputs, references, result, error, ... }
HTTP: /triggers/subscriptions/{,query,{id},{id}/refresh,{id}/revoke}; /triggers/deliveries/{,{id},query}
DAO surface (for WP4): get_subscription_by_trigger_id, write_delivery, dedup_seen(event_id)
```

## Functional deps (fan-in)

- **WP0** — `subscriptions` FKs `gateway_connections`.
- **WP1** — `create_subscription` builds the `ti_*` via `TriggersGatewayInterface` (the
  adapter, **not** the catalog routes).

## Stubs needed (until deps merge)

- `ConnectionsGatewayInterface` (WP0) — stub the connection lookup/FK target.
- `TriggersGatewayInterface` (WP1) — stub `create_subscription`/`set_status`/`delete`.

Both against their frozen WS-PRE contracts; mock in unit tests.

## Decisions to lock first

- **Idempotency store (I4)** — lean: a `metadata.id` dedup column on `deliveries`.
- **Default mapping + validation posture (M8)** — inputs-only default; schema validation a stretch.

## Acceptance criteria (both editions)

- Create a subscription on a shared connection bound to a workflow.
- List / disable / delete it; deleting it leaves the connection intact (C7).
- Deliveries list returns rows.
