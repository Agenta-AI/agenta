# Trigger Schedules — Plan

A cron-driven analogue to trigger subscriptions. A subscription fires when Composio delivers
an event; a **schedule** fires when our own cron tick matches its cron expression. Both emit
the same trigger event down the **same dispatch path** (worker → dispatcher → invoke → delivery).
The only runtime difference is the producer.

This builds on the shipped (but unreleased) gateway-triggers domain in `core/triggers/`. Because
the trigger tables have **not been released**, the schema changes edit the **initial migration
`oss000000003` in place** rather than stacking new ALTER migrations.

---

## 0. Decisions (locked)

| Area | Decision |
|------|----------|
| Edition | OSS, alongside `core/triggers/` |
| Period | Cron expression (string), **5-field** (1-minute floor), **UTC**, every-minute allowed |
| Period validation | `croniter` at create/edit; reject unparseable / non-5-field as 422 |
| Fire gate | `croniter.match(schedule, trigger_datetime)` — stateless, idempotent, **skip on missed tick** (no catch-up) |
| Base tick | Every **1 minute** (reuse live-eval cadence) |
| Cron endpoint | `POST /admin/triggers/schedules/refresh?trigger_interval&trigger_datetime` |
| Cron wiring | New `crons/triggers.{sh,txt}` + OSS Dockerfile (dev + gh); shared `cron` container |
| Active query | Partial index `(project_id) WHERE flags->>'is_active'='true' AND deleted_at IS NULL` |
| Dispatcher | Lookup lifted **out** of `dispatch`; new signature `dispatch(*, project_id, entity, event_id, event)` |
| Gate semantics | `is_active=false` → silent skip; `is_valid=false` → **not** silent (failed-delivery path) |
| Deliveries | **Same `trigger_deliveries` table**; nullable `subscription_id` + new nullable `schedule_id`; XOR check |
| Typed flags | `TriggerSubscriptionFlags{is_active,is_valid}`, `TriggerScheduleFlags{is_active}` — nested models, no bare `Flags()` |
| Realign subs | `enabled/valid` → `is_active/is_valid` (code-layer; JSONB bag not enumerated in migration) |
| `ti_id` | Promoted to top-level indexed column, **removed from `data` JSONB** |
| Migration (triggers) | All trigger schema folded into `oss000000003` (edit-in-place; unreleased) |
| Migration (webhooks) | New `oss000000004` (core_oss) — data-only backfill `flags.is_active=true` (column already exists, released chain) |
| Play/pause | `/start` + `/stop` POST routes flipping `is_active`, on **all three** domains (trigger_subscriptions, trigger_schedules, webhook_subscriptions) |
| Webhook flags | `is_active` **only** — no `is_valid` (webhooks have no external connection / no validity concept) |
| Reuse | References via `_normalize_references` / `WorkflowsService.retrieve_workflow_revision`; FE drawer mirrors `TriggerSubscriptionDrawer` |

### Flag matrix (per domain)

| Domain | Flags | Migration | Why |
|--------|-------|-----------|-----|
| `trigger_subscriptions` | `is_active`, `is_valid` | code-layer rename in `oss000000003` shape | Composio connection can be revoked → `is_valid` |
| `trigger_schedules` | `is_active` | new table in `oss000000003` | no external connection |
| `webhook_subscriptions` | `is_active` | **new `oss000000004`** (data-only) | no external connection; just a URL — no validity concept |

---

## 1. Work Packages — functional dependencies (the true DAG)

Six units. Fan-in is real: a node can need two others.

```text
WP0 ───────────────┬────────────────▶ WP2 ──────────┬─────────▶ WP3 ──────▶ WP4
(migration: tables, │   (schedule DAO  ▲              │ (refresh    (cron
 ti_id, deliveries) │    reads tables) │              │  service)    wiring)
                    │                  │              │   ▲
WP1 ───────────────┘                  │              │   │
(DTOs: flags, ti_id,                  │              │   │
 schedule data) ──────────────────────┘              │   │
      │                                               │   │
      └──────────────────────▶ WPD ──────────────────┘   │
                          (dispatcher refactor) ──────────┘

WP5 (web) ◀── WP3 (schedule CRUD API contract)
```

Edges (`X ← Y` reads "X functionally needs Y"):

- **WP1 ← (none)** — pure DTO layer; defines the contracts everything else builds against.
- **WP0 ← WP1** — the migration column shapes (`ti_id`, `flags` keys, `schedule_id`) mirror the DTOs.
- **WP2 ← WP0, WP1** — schedule DAO/mappings read the new tables and (de)serialize the typed flags / `ti_id` column.
- **WPD ← WP1, WP2** — dispatcher refactor consumes the resolved entity (subscription **or** schedule) and the generalized delivery write.
- **WP3 ← WP2, WPD** — `refresh_schedules` iterates active schedules (DAO) and dispatches via the refactored dispatcher; schedule CRUD reuses `_normalize_references`.
- **WP4 ← WP3** — cron `.sh`/`.txt`/Dockerfile fire the `/admin/triggers/schedules/refresh` route added in WP3.
- **WP6 ← WP1, WPD** — `/start`·`/stop` flip `flags.is_active` (DTOs from WP1); webhook side also needs the WPD `is_active` dispatcher gate + the `oss000000004` flag backfill. Touches all three domains.
- **WP5 ← WP3, WP6** — web builds against the schedule CRUD contract (WP3) and the play/pause routes (WP6).

**Critical path:** WP1 → WP0 → WP2 → WPD → WP3 → WP4. WP6 forks off {WP1, WPD}; WP5 forks off {WP3, WP6}.

---

## 2. Migration — single edit to `oss000000003` (WP0)

`oss000000003_add_trigger_subscriptions_and_deliveries.py` is the **initial, unreleased**
migration. Edit it in place; no backfill anywhere (no rows exist). New table order matters:
`trigger_schedules` must be created **before** `trigger_deliveries` so the new FK resolves.

### 2.1 `trigger_subscriptions` — promote `ti_id`

- Add column `ti_id` (`sa.String()`, nullable) — born top-level, never in JSONB.
- Add partial unique index:
  ```sql
  CREATE UNIQUE INDEX ix_trigger_subscriptions_ti_id
    ON trigger_subscriptions (project_id, ti_id)
    WHERE ti_id IS NOT NULL AND deleted_at IS NULL;
  ```
- Flags untouched in migration — `enabled→is_active`/`valid→is_valid` is a code-layer rename;
  the `flags` JSONB bag is not enumerated here.

### 2.2 `trigger_schedules` — new table (insert before deliveries)

Mirrors `trigger_subscriptions` **minus** `connection_id` and `ti_id`. Columns: `project_id`,
`id`, `name`, `description`, `data` (JSON — holds `event_key`, `schedule` cron expr,
`inputs_fields`, `references`, `selector`), `flags` (JSONB), `meta`, `tags`, full lifecycle
(`created_at`/`updated_at`/`deleted_at` + `*_by_id`). FK `project_id → projects` CASCADE.
PK `(project_id, id)`. Indexes:

- `ix_trigger_schedules_project_id_created_at` `(project_id, created_at)`
- `ix_trigger_schedules_project_id_deleted_at` `(project_id, deleted_at)`
- partial active index:
  ```sql
  CREATE INDEX ix_trigger_schedules_active
    ON trigger_schedules (project_id)
    WHERE (flags ->> 'is_active') = 'true' AND deleted_at IS NULL;
  ```
  Predicate must match the DAO filter verbatim or Postgres won't use it.

### 2.3 `trigger_deliveries` — generalize to both sources

- `subscription_id` → `nullable=True`.
- Add `schedule_id` (`sa.UUID()`, nullable) + composite FK
  `(project_id, schedule_id) → trigger_schedules(project_id, id)` CASCADE.
- XOR check constraint:
  ```sql
  CHECK ((subscription_id IS NULL) <> (schedule_id IS NULL))
  ```
- Replace the single unique dedup index with **two partial unique indexes**:
  ```sql
  CREATE UNIQUE INDEX ix_trigger_deliveries_subscription_id_event_id
    ON trigger_deliveries (project_id, subscription_id, event_id)
    WHERE subscription_id IS NOT NULL;
  CREATE UNIQUE INDEX ix_trigger_deliveries_schedule_id_event_id
    ON trigger_deliveries (project_id, schedule_id, event_id)
    WHERE schedule_id IS NOT NULL;
  ```

### 2.4 `downgrade()`

Mirror everything: drop the two partial dedup indexes + restore the single one, drop the XOR
check + `schedule_id` FK/column, restore `subscription_id` NOT NULL, drop `trigger_schedules`
(+ its indexes), drop the `ti_id` index + column.

### 2.5 `oss000000004` — webhook flags (NEW core_oss migration, data-only)

Webhooks are on the **separate, released `core` chain** (`f0a1b2c3d4e5_add_webhooks`, which
already has a child `ab12cd34ef56`), so they do **not** get edit-in-place. The
`webhook_subscriptions.flags` JSONB **column already exists** — this migration only backfills
values. Parents on `oss000000003` (current core_oss head); runs both editions.

- `upgrade()`: backfill `is_active=true` on every live row, idempotent merge:
  ```sql
  UPDATE webhook_subscriptions
     SET flags = COALESCE(flags, '{}'::jsonb) || '{"is_active": true}'::jsonb;
  ```
- `upgrade()` (cont.): add the partial active index (the dispatcher now gates on it):
  ```sql
  CREATE INDEX ix_webhook_subscriptions_active
    ON webhook_subscriptions (project_id)
    WHERE (flags ->> 'is_active') = 'true' AND deleted_at IS NULL;
  ```
- `downgrade()`: drop the index; strip the key
  (`SET flags = flags - 'is_active'`).
- **No `is_valid`** — webhooks have no validity concept.

---

## 3. Per-package detail

### WP1 — DTOs & typed flags (`core/triggers/dtos.py`)

- **`TriggerSubscriptionFlags`** `{is_active: bool = True, is_valid: bool = True}`.
- **`TriggerScheduleFlags`** `{is_active: bool = True}`.
- **`WebhookSubscriptionFlags`** `{is_active: bool = True}` (in `core/webhooks/types.py`) — webhooks have no validity concept, so **no `is_valid`**.
- **`TriggerSubscription`**: replace top-level `enabled`/`valid` with `flags: TriggerSubscriptionFlags`;
  add top-level `ti_id: Optional[str]`. `TriggerSubscriptionData` loses `ti_id`.
- **`TriggerScheduleData`** `{event_key, schedule: str, inputs_fields, references, selector}`.
- **`TriggerSchedule(Identifier, Lifecycle, Header, Metadata)`** `{data, flags}` + `TriggerScheduleCreate/Edit/Query`.
- **`TriggerDelivery`/`TriggerDeliveryData`**: add nullable `schedule_id`; `subscription_id` nullable.
- Reuse the existing context-field allowlists; schedule reuses `TRIGGER_CONTEXT_FIELDS`.

**AC:** flag models serialize to/from `{is_active, ...}`; no bare-bool top-level on subscription.

### WP0 — Migration (see §2)

**AC:** `alembic upgrade head` + `downgrade` clean, both editions (live DB / CI).

### WP2 — DAO, DBE, mappings (`dbs/postgres/triggers/`)

- `dbas.py`: `TriggerScheduleDBA` (mirror subscription DBA, drop `connection_id`); subscription DBA gains `ti_id` column.
- `dbes.py`: `TriggerScheduleDBE` (`__tablename__ = "trigger_schedules"`, indexes incl. partial active); deliveries DBE gains `schedule_id` FK + split dedup indexes + XOR check.
- `mappings.py`: typed-flag (de)serialization for both domains; stop stuffing `ti_id` into `data` (read/write the column; the PUT-preserve logic at mappings.py:107-111 moves to the column); schedule create/edit/read mappings.
- `dao.py`: `ti_id` lookups (dao.py:220, dao.py:246) filter the **column**; new `TriggerSchedulesDAO` with `fetch_active_schedules` (partial-index query), CRUD, generalized `write_delivery` (sets whichever FK applies).

**AC:** dispatcher lookup is an index seek; `fetch_active_schedules` uses the partial index.

### WPD — Dispatcher refactor (`tasks/asyncio/triggers/dispatcher.py`, `tasks/taskiq/triggers/worker.py`)

- New signature: `dispatch(*, project_id, entity, event_id, event)` — lookup removed from the body.
- Body becomes entity-agnostic: gate on `entity.flags.is_active` (silent skip); `is_valid=false`
  falls through to the existing failed-delivery branch; dedup + `_build_context` + invoke +
  `write_delivery` shared verbatim. `write_delivery` sets `subscription_id` **or** `schedule_id`
  from the entity type.
- **Composio path**: the *worker task* (not HTTP ingress — ingress must keep ack-fast) does the
  `ti_id` → subscription lookup, then calls `dispatch`.
- **Schedule path**: `refresh_schedules` already holds the schedule row; enqueues a task that
  calls `dispatch` directly — no lookup.
- **Webhook dispatcher** (`tasks/asyncio/webhooks/dispatcher.py`): add an `is_active` gate
  (silent skip when paused). Today it has no flag gate at all — this is the runtime half of the
  new webhook play/pause.

**AC:** existing dispatcher unit tests pass after signature shift; Composio happy-path unchanged end-to-end; a paused webhook subscription does not dispatch.

### WP3 — Service & router (`core/triggers/service.py`, `apis/fastapi/triggers/router.py`, `entrypoints/routers.py`)

- Service: schedule CRUD reusing `_normalize_references` / `retrieve_workflow_revision`;
  cron-expr validation (5-field, parseable) at create/edit; `refresh_schedules(timestamp, interval)`
  → `fetch_active_schedules` → `croniter.match(schedule, trigger_datetime)` gate → build envelope → enqueue dispatch.
  Subscription reads change `existing.enabled` → `existing.flags.is_active`, `existing.data.ti_id` → `existing.ti_id`.
- Router: schedule CRUD routes + admin `POST /refresh`; register admin router under `/admin/triggers/schedules` in `entrypoints/routers.py`.

**AC:** schedule CRUD round-trips; refresh dispatches only schedules whose cron matches the tick.

### WP4 — Cron wiring (`crons/`, OSS Dockerfiles, `pyproject.toml`)

- `api/oss/src/crons/triggers.sh` (mirror `queries.sh`; POST to `/admin/triggers/schedules/refresh`).
- `api/oss/src/crons/triggers.txt` (`* * * * *` — every minute).
- OSS `Dockerfile.dev` + `Dockerfile` (gh): copy `triggers.sh`/`triggers.txt` into the crontab pipeline; compose `cron` service volume mount for `triggers.sh`.
- Add `croniter` to `api/pyproject.toml` base deps.

**AC:** cron container fires the endpoint each minute; the schedule whose cron matches actually invokes its workflow (observed delivery row).

### WP6 — Play/pause (`/start` + `/stop`) across all three domains

A start/stop pair (POST a verb to flip `is_active`), following the existing noun-verb route
shape (`/revoke`, live-eval `/close`+`/open`). `/start` sets `is_active=true`, `/stop` sets
`is_active=false`. Per-item only (`/{id}/start`, `/{id}/stop`).

- **`trigger_subscriptions`** (`apis/fastapi/triggers/router.py` + service): `/subscriptions/{id}/start|stop`.
- **`trigger_schedules`** (same router/service): `/schedules/{id}/start|stop`.
- **`webhook_subscriptions`** (`apis/fastapi/webhooks/router.py` + `core/webhooks/service.py` + mappings):
  `/subscriptions/{id}/start|stop`. This is the bulk of the webhook work — webhook mappings
  **currently ignore `flags` entirely**, so they must start (de)serializing `WebhookSubscriptionFlags`.
- Toggle is a focused flag flip (full-PUT semantics on these non-git entities: source the full
  entity, override only `flags.is_active`).

**AC:** `/start`/`/stop` flips `is_active` on each domain; a stopped subscription/schedule does
not dispatch (trigger via dispatcher gate, webhook via WPD gate, schedule via `fetch_active_schedules`).

### WP5 — Web (`agenta-entity-ui/src/gatewayTrigger/`)

The web extension covers **three** surfaces, all in the gateway-trigger entity-ui package:

1. **Schedule drawer** — create/edit, mirroring `TriggerSubscriptionDrawer.tsx`. Swap the
   Composio event picker for a **cron-expression field** (with a human-readable "next run"
   hint validated client-side); reuse the reference-family build from `runnable/deploy.ts`
   (application/evaluator/environment families) exactly as the subscription drawer does.
2. **Schedules list/table** — mirror the subscriptions list; columns: name, cron expr (rendered
   human-readable), bound workflow, `is_active` state, last delivery. Row actions include
   **play/pause**.
3. **Play/pause control** — a toggle on each row/drawer for **all three** entity types
   (subscriptions, schedules, webhooks) calling the WP6 `/start`·`/stop` routes; optimistic
   update of `flags.is_active`. Subscription/webhook drawer prefill reads `flags.is_active`
   (subscription rename `enabled` → `flags.is_active`).

Data layer: schedule query/mutation atoms mirroring the subscription atoms (list, get, create,
edit, delete, start, stop); deliveries view reused (delivery rows now carry `schedule_id`).

**AC:** create/edit a schedule from the UI (references sent as the full prefixed family, edit
prefills correctly); play/pause toggles state on all three entity types; schedules list renders
cron + state.

---

## 4. Test plan

| Layer | Coverage |
|-------|----------|
| Unit | cron-expr validation (valid / non-5-field / unparseable); fire-gate `croniter.match` boundary cases; `TriggerScheduleFlags`/`TriggerSubscriptionFlags`/`WebhookSubscriptionFlags` (de)serialization; dispatcher refactor (entity-agnostic gate + delivery FK selection); webhook `is_active` gate |
| Acceptance | schedule CRUD round-trip (both editions per test convention); `/admin/triggers/schedules/refresh` dispatches matching schedules only; delivery row written with `schedule_id`; `/start`·`/stop` flips `is_active` and a stopped entity does not dispatch (all three domains) |
| Migration | `upgrade`/`downgrade` clean, both editions (live DB / CI) |

OSS uses `cls_account`; EE uses inline business+developer account.

---

## 5. Out of scope (deferred)

- Webhooks gain `is_active` + play/pause (WP6), but **no `is_valid`** and no other lifecycle work.
- No per-schedule timezone (UTC only); no missed-tick catch-up; no arbitrary start anchor.
- No stored watermark / tick counter — the fire gate is a pure function of `trigger_datetime`.
