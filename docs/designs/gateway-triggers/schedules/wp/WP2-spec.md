# WP2 — DAO, DBE, mappings (`dbs/postgres/triggers/`)

Read `contracts.md` first. Build against frozen WP1 DTOs and the WP0 schema.

## Files
- `api/oss/src/dbs/postgres/triggers/dbas.py`
- `api/oss/src/dbs/postgres/triggers/dbes.py`
- `api/oss/src/dbs/postgres/triggers/mappings.py`
- `api/oss/src/dbs/postgres/triggers/dao.py`

## dbas.py
- `TriggerSubscriptionDBA`: add `ti_id = Column(String, nullable=True)` (alongside `connection_id`).
- NEW `TriggerScheduleDBA`: mirror `TriggerSubscriptionDBA` but **without `connection_id`**
  (same mixins: ProjectScope, Lifecycle, Identifier, Header, Data, Flags, Tags, Meta).
- `TriggerDeliveryDBA`: `subscription_id` → `nullable=True`; add `schedule_id = Column(UUID(as_uuid=True), nullable=True)`.

## dbes.py
- NEW `TriggerScheduleDBE(Base, TriggerScheduleDBA)`, `__tablename__ = "trigger_schedules"`,
  table_args mirroring `TriggerSubscriptionDBE` minus the gateway_connections FK + connection index;
  add the partial active index `ix_trigger_schedules_active` (predicate must match WP0 verbatim) and
  the created_at/deleted_at indexes.
- `TriggerSubscriptionDBE`: add `ix_trigger_subscriptions_ti_id` partial unique index to table_args.
- `TriggerDeliveryDBE`: add `(project_id, schedule_id) → trigger_schedules` FK; replace the single
  unique dedup index with the two partial ones; add the XOR `CheckConstraint`.

## mappings.py  (CURRENT broken anchors)
- DELETE `_SUBSCRIPTION_FLAGS = ("enabled","valid")` (line 22) and `_flags_to_dbe(enabled, valid)` (line 25).
- Replace with typed flag (de)serialization using `TriggerSubscriptionFlags` /
  `TriggerScheduleFlags`: DBE.flags JSONB `{"is_active":..., "is_valid":...}` ↔ the flag model
  (use `flags.model_dump()` / `TriggerSubscriptionFlags(**(dbe.flags or {}))`).
- Stop stuffing `ti_id` into `data` (current create maps `data={"ti_id": ...}` at mappings.py:36-38;
  the PUT-preserve logic at 107-111). Instead read/write the **`ti_id` column**. On full-PUT edit,
  preserve the existing `ti_id` column value when the client omits it.
- Add schedule create/edit/read mappings (`TriggerSchedule*` ↔ `TriggerScheduleDBE`). No ti_id, no connection_id.
- Delivery mapping: carry both `subscription_id` and `schedule_id` (one will be None).

## dao.py
- The two `ti_id` lookups currently filter `TriggerSubscriptionDBE.data["ti_id"].astext == trigger_id`
  (dao.py:220 and dao.py:246) → repoint to `TriggerSubscriptionDBE.ti_id == trigger_id`.
- `create_subscription` currently takes `ti_id` and routes it into `data` — route it to the column.
- NEW `TriggerSchedulesDAO` (or extend `TriggersDAO`): `fetch_active_schedules(*, project_id=None)`
  using the partial active index filter (`flags->>'is_active'='true' AND deleted_at IS NULL`); plus
  schedule CRUD (`create/get/edit/delete/query`) mirroring subscription CRUD.
- Generalize `write_delivery` to set `subscription_id` OR `schedule_id`. Add a schedule-side dedup
  (`dedup_seen` variant keyed on schedule_id) if dispatch dedups schedule events.
- **Per memory `dao_one_connection_per_call`:** one `engine.session()` per call; do not call
  session-opening helpers inside row loops.

## AC
- Subscription dispatch lookup is an index seek on the `ti_id` column.
- `fetch_active_schedules` uses the partial index.
- `ruff check` clean; no reference to `enabled`/`valid`/`data["ti_id"]` remains in this folder.
