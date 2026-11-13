# WP6 — Play/pause (`/start` + `/stop`) across all three domains + webhook flags

Read `contracts.md` first. Depends on WP1 (flag DTOs) and WPD (webhook is_active gate) — documented.

## Routes (all per-item POST, flip `is_active`)
Shape mirrors `/revoke` and live-eval `/open`·`/close`. `/start` → `is_active=true`,
`/stop` → `is_active=false`. Full-PUT semantics on these non-git entities: load the full current
entity, override only `flags.is_active`, write it back (memory `feedback_edits_full_put`).

### Trigger subscriptions
- `api/oss/src/apis/fastapi/triggers/router.py`: `POST /subscriptions/{id}/start` + `/stop`.
- `api/oss/src/core/triggers/service.py`: `set_subscription_active(*, project_id, user_id,
  subscription_id, is_active)` (or start/stop methods). NOTE: subscription has BOTH `is_active`
  and `is_valid` — only touch `is_active`. If the existing `/revoke` semantics overlap, keep
  `/revoke` (provider-side) distinct from `/stop` (local is_active).

### Trigger schedules
- Same router/service: `POST /schedules/{id}/start` + `/stop`. (Coordinate with WP3 so these are
  added once — recommend WP6 owns all start/stop routes, WP3 owns CRUD + refresh.)

### Webhook subscriptions — the bulk of WP6
- `api/oss/src/core/webhooks/types.py`: add `WebhookSubscriptionFlags(BaseModel){is_active: bool = True}`
  and a `flags` field on `WebhookSubscription` + `WebhookSubscriptionEdit`
  (`flags: WebhookSubscriptionFlags = Field(default_factory=...)`). **No `is_valid`.**
- `api/oss/src/dbs/postgres/webhooks/mappings.py`: webhook mappings **currently ignore `flags`
  entirely** (`map_subscription_dto_to_dbe_edit` at mappings.py:81 maps name/desc/tags/meta/data but
  not flags). Add flags ser/de like the trigger mappings: write `flags.model_dump()` into the JSONB
  `flags` column on create/edit, read `WebhookSubscriptionFlags(**(dbe.flags or {}))` on read.
- `api/oss/src/apis/fastapi/webhooks/router.py`: `POST /subscriptions/{id}/start` + `/stop`.
- `api/oss/src/core/webhooks/service.py`: the start/stop service methods.
- Webhook dispatcher `is_active` gate is in WPD (coordinate).

## Migration — NEW `oss000000004` (webhook flags only)
`api/oss/databases/postgres/migrations/core_oss/versions/oss000000004_add_webhook_subscription_flags.py`
- `revision = "oss000000004"`, `down_revision = "oss000000003"`.
- Webhooks are on the RELEASED `core` chain and the `flags` JSONB **column already exists** — this is
  DATA-ONLY (backfill) + an index. Do NOT add a column, do NOT edit the webhook create migration.
- `upgrade()`:
  ```python
  op.execute("UPDATE webhook_subscriptions SET flags = COALESCE(flags, '{}'::jsonb) || '{\"is_active\": true}'::jsonb")
  op.create_index("ix_webhook_subscriptions_active", "webhook_subscriptions", ["project_id"],
                  unique=False,
                  postgresql_where=sa.text("(flags ->> 'is_active') = 'true' AND deleted_at IS NULL"))
  ```
- `downgrade()`: drop the index; `op.execute("UPDATE webhook_subscriptions SET flags = flags - 'is_active'")`.

## AC
- `/start`·`/stop` flips `is_active` on each of the three domains (round-trip via GET).
- A stopped entity does not dispatch (trigger: WPD gate; webhook: WPD gate; schedule:
  `fetch_active_schedules` excludes it).
- `oss000000004` up/down clean, both editions; webhook rows get `is_active=true`.
- Webhook DTO has `flags.is_active` but NO `is_valid`.
