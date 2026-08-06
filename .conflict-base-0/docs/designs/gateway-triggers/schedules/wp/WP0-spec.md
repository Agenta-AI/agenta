# WP0 — Migration (edit `oss000000003` in place)

Read `contracts.md` first. Build against the frozen WP1 DTOs.

## File

`api/oss/databases/postgres/migrations/core_oss/versions/oss000000003_add_trigger_subscriptions_and_deliveries.py`
— the **initial, unreleased** migration. Edit in place. No backfill (no rows exist). Mirror every
`upgrade()` change in `downgrade()`.

## Changes (order matters)

### 1. `trigger_subscriptions` — promote `ti_id`
In the existing `op.create_table("trigger_subscriptions", ...)`, add:
- `sa.Column("ti_id", sa.String(), nullable=True)` (place near `connection_id`).
After the table, add:
```python
op.create_index(
    "ix_trigger_subscriptions_ti_id",
    "trigger_subscriptions",
    ["project_id", "ti_id"],
    unique=True,
    postgresql_where=sa.text("ti_id IS NOT NULL AND deleted_at IS NULL"),
)
```

### 2. `trigger_schedules` — NEW table, created BEFORE `trigger_deliveries`
Mirror the `trigger_subscriptions` create_table but **drop `connection_id` and the
gateway_connections FK**; keep `project_id`, `id`, `name`, `description`, `data` (JSON),
`flags` (JSONB), `meta`, `tags`, full lifecycle columns. FK `project_id → projects` CASCADE,
PK `(project_id, id)`. Indexes:
```python
op.create_index("ix_trigger_schedules_project_id_created_at", "trigger_schedules",
                ["project_id", "created_at"], unique=False)
op.create_index("ix_trigger_schedules_project_id_deleted_at", "trigger_schedules",
                ["project_id", "deleted_at"], unique=False)
op.create_index("ix_trigger_schedules_active", "trigger_schedules", ["project_id"],
                unique=False,
                postgresql_where=sa.text("(flags ->> 'is_active') = 'true' AND deleted_at IS NULL"))
```

### 3. `trigger_deliveries` — generalize
In its `create_table`:
- `subscription_id` → `nullable=True`.
- add `sa.Column("schedule_id", sa.UUID(), nullable=True)`.
- add composite FK `(project_id, schedule_id) → trigger_schedules(project_id, id)` CASCADE.
- add `sa.CheckConstraint("(subscription_id IS NULL) <> (schedule_id IS NULL)",
  name="ck_trigger_deliveries_exactly_one_parent")`.
Replace the single unique index `ix_trigger_deliveries_subscription_id_event_id` with two partial:
```python
op.create_index("ix_trigger_deliveries_subscription_id_event_id", "trigger_deliveries",
                ["project_id", "subscription_id", "event_id"], unique=True,
                postgresql_where=sa.text("subscription_id IS NOT NULL"))
op.create_index("ix_trigger_deliveries_schedule_id_event_id", "trigger_deliveries",
                ["project_id", "schedule_id", "event_id"], unique=True,
                postgresql_where=sa.text("schedule_id IS NOT NULL"))
```

### 4. `downgrade()`
Reverse-order mirror: drop the two delivery partial indexes (+ recreate the old single one if you
want strict symmetry), drop the check + schedule_id FK/column, restore `subscription_id` NOT NULL,
drop `trigger_schedules` (+ its 3 indexes), drop `ix_trigger_subscriptions_ti_id` + the `ti_id` column.

## AC
- `alembic upgrade head` then `downgrade` clean, both editions (run in CI/live stack).
- The partial-index predicates EXACTLY match the DAO filters in WP2 (`flags->>'is_active'='true'`,
  `ti_id IS NOT NULL AND deleted_at IS NULL`).

## Do NOT
- Do not touch webhook tables (that's WP6's `oss000000004`).
- Do not add a flags column or enumerate flag keys — flags live in the existing JSONB `flags` column.
