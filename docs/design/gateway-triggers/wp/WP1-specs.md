# WP1 — Triggers skeleton + events catalog + adapter

**Lane** WL1 (anchor WL0) · **Stream** WS1 (api) · **Area** api

Parent docs: [`../plan.md`](../plan.md) §4, [`../gap.md`](../gap.md) §2.2, [`../mimics.md`](../mimics.md) (Triggers vs Tools, Part A).

## Goal

Stand up the triggers domain skeleton, the read-only **events** catalog, and the
`ComposioTriggersAdapter` that later WPs call to manage `ti_*` instances.

## Closes (gap items)

E1, E2, E3, E4 — and resolves **E5** (verify v3 REST paths).

## Scope

- **Skeleton** — `apis/fastapi/triggers/`, `core/triggers/`, `dbs/postgres/triggers/`
  (mirror the tools layout; `action → event`).
- **Adapter** — `ComposioTriggersAdapter` (own httpx client, no SDK; `_get/_post/_delete`
  + slug mapping modeled on `ComposioToolsAdapter`) behind `TriggersGatewayInterface`:
  `list_events`, `get_event`, `create_subscription`, `set_subscription_status`,
  `delete_subscription`.
- **Catalog** — `/triggers/catalog/.../integrations/{i}/events/{event_key}` returning the
  event's `trigger_config` JSON Schema (analogue of an action's `input_parameters`).
- **Wiring** — `triggers` block in `entrypoints/routers.py` next to tools; adapter built
  only when `env.composio.enabled`.
- **Permission** — introduce a dedicated **`VIEW_TRIGGERS`** permission (mirror the tools
  triad in `api/ee/src/core/access/permissions/types.py`: add a `# Triggers` block and
  register `VIEW_TRIGGERS` into the viewer `default_permissions`). Catalog routes gate on
  `Permission.VIEW_TRIGGERS` — **do NOT reuse `VIEW_TOOLS`**.
- **E5** — verify exact Composio v3 REST paths (`triggers_types`, `trigger_instances/...`)
  against the live OpenAPI spec; SDK method names are stable, paths must be confirmed.

## Contracts this WP freezes (consumed by WS3, WS5 — freeze in WS-PRE)

```text
TriggersGatewayInterface:
  list_events(*, provider, integration) -> list[Event]
  get_event(*, event_key) -> EventType            # carries trigger_config JSON Schema
  create_subscription(*, project_id, event_key, connected_account_id, trigger_config) -> "ti_*"
  set_subscription_status(*, trigger_id, enabled: bool) -> None
  delete_subscription(*, trigger_id) -> None
Catalog HTTP: GET /triggers/catalog/providers/{p}/integrations/{i}/events[/{event_key}]
Event DTO: { key, provider, integration, trigger_config: <JSONSchema>, ... }
```

## Functional deps

None in-feature (uses `env.composio`, not the connection). Root in the §1 DAG.

## Stubs needed

None.

## Decision to lock first

**E5 — exact v3 REST paths** (verify vs live OpenAPI; the adapter can't be written
correctly without them).

## Acceptance criteria (both editions)

- Browse providers / integrations / events.
- Fetch one event's `trigger_config` schema.
- Catalog empty / disabled when `env.composio` unset.
- (Real adapter calls need live Composio creds — gate the integration test on that.)
