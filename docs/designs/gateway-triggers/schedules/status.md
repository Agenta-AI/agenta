# Trigger Schedules — Status

Cron-driven analogue to trigger subscriptions. See `plan.md` for the full work breakdown.

| Field | Value |
|-------|-------|
| State | WP1 CONTRACT DONE (in working tree) — Wave 1 (WP0/WP2/WPD/WP3/WP4/WP6/WP5) ready to fan out |
| Domain | OSS, `core/triggers/` (extends shipped-but-unreleased gateway-triggers) |
| Migration strategy | Triggers: edit `oss000000003` in place; Webhooks: new data-only `oss000000004` |
| Dispatch reuse | Same worker → dispatcher → invoke → delivery path; producer differs only |
| Code written | **WP1 only** — `core/triggers/dtos.py` + `exceptions.py` (frozen contract) |
| Orchestration | `wp/contracts.md` (frozen WP1), `wp/orchestration.md` (two-wave plan + broken call sites), `wp/WP{0,2,D,3,4,5,6}-spec.md` |

## Parallel build plan (two waves)

- **Wave 0 (done):** WP1 DTOs + exceptions written serially as the frozen contract. This
  intentionally broke reads of `subscription.enabled`/`.valid`/`.data.ti_id` — fixed in Wave 1.
- **Wave 1 (fan out after compact):** spawn a subagent per WP against `wp/contracts.md` +
  `wp/WP*-spec.md`. WP4 + WP5 are fully independent; the rest code against documented signatures
  and stitch. Verification steps in `wp/orchestration.md`.

## Work packages

| WP | Unit | Depends on | State |
|----|------|-----------|-------|
| WP1 | DTOs: typed flags, `ti_id` top-level, `TriggerSchedule*` | — | ☐ not started |
| WP0 | Migration: edit `oss000000003` (tables, `ti_id`, deliveries) | WP1 | ☐ not started |
| WP2 | DAO / DBE / mappings (schedules + `ti_id` column + flags) | WP0, WP1 | ☐ not started |
| WPD | Dispatcher refactor (entity-agnostic `dispatch`) | WP1, WP2 | ☐ not started |
| WP3 | Service `refresh_schedules` + CRUD + admin route | WP2, WPD | ☐ not started |
| WP4 | Cron wiring (`triggers.sh/.txt`, Dockerfile, `croniter` dep) | WP3 | ☐ not started |
| WP6 | Play/pause `/start`·`/stop` (3 domains) + webhook `is_active` migration `oss000000004` | WP1, WPD | ☐ not started |
| WP5 | Web: schedule drawer + list + play/pause (3 domains) + prefill rename | WP3, WP6 | ☐ not started |

**Critical path:** WP1 → WP0 → WP2 → WPD → WP3 → WP4. WP6 forks off {WP1, WPD}; WP5 forks off {WP3, WP6}.

## Checklist

- [ ] WP1: `TriggerSubscriptionFlags{is_active,is_valid}`, `TriggerScheduleFlags{is_active}`, `WebhookSubscriptionFlags{is_active}` (no `is_valid`)
- [ ] WP1: `ti_id` → top-level `TriggerSubscription` field (out of `TriggerSubscriptionData`)
- [ ] WP1: `TriggerScheduleData{event_key, schedule, inputs_fields, references, selector}` + `TriggerSchedule*` CRUD DTOs
- [ ] WP1: `TriggerDelivery` gains nullable `schedule_id`; `subscription_id` nullable
- [ ] WP0: `oss000000003` — `ti_id` column + partial unique index on `trigger_subscriptions`
- [ ] WP0: `oss000000003` — new `trigger_schedules` table (before deliveries) + partial active index
- [ ] WP0: `oss000000003` — deliveries `subscription_id` nullable, `schedule_id` + FK + XOR check + split dedup indexes
- [ ] WP0: `downgrade()` mirrors all of the above
- [ ] WP2: `TriggerScheduleDBE` + `TriggerSchedulesDAO.fetch_active_schedules` (partial-index query)
- [ ] WP2: `ti_id` lookups (dao.py:220,246) filter the column; mappings stop stuffing `ti_id` into `data`
- [ ] WP2: typed-flag (de)serialization both domains; generalized `write_delivery`
- [ ] WPD: `dispatch(*, project_id, entity, event_id, event)`; lookup moves to worker task
- [ ] WPD: `is_active` silent skip; `is_valid=false` → failed-delivery path
- [ ] WP3: cron-expr validation (5-field, parseable) at create/edit
- [ ] WP3: `refresh_schedules` + `croniter.match` fire gate
- [ ] WP3: schedule CRUD routes + `/admin/triggers/schedules/refresh`; register admin router
- [ ] WP3: subscription reads `enabled→flags.is_active`, `data.ti_id→ti_id`
- [ ] WP4: `crons/triggers.{sh,txt}` + OSS Dockerfile (dev + gh) + compose mount
- [ ] WP4: `croniter` in `api/pyproject.toml`
- [ ] WP6: `/start`·`/stop` routes (flip `is_active`) on trigger_subscriptions, trigger_schedules, webhook_subscriptions
- [ ] WP6: webhook mappings start (de)serializing `flags` (currently ignored); webhook dispatcher `is_active` gate
- [ ] WP6: migration `oss000000004` (core_oss) — backfill `webhook_subscriptions.flags.is_active=true` + partial active index
- [ ] WP5: schedule drawer mirroring `TriggerSubscriptionDrawer`; schedules list/table; play/pause control (3 domains); subscription prefill rename
- [ ] Tests: unit (cron validation, fire gate, flag models incl. webhook, dispatcher + webhook gate) + acceptance (CRUD, refresh, start/stop ×3), both editions
- [ ] Migration up/down clean, both editions (live DB / CI)

## Decisions

- [x] Period = **cron expression**, 5-field, UTC, 1-minute floor, every-minute allowed; validated via `croniter`.
- [x] Fire gate = `croniter.match(schedule, trigger_datetime)` — stateless, idempotent, **skip on missed tick** (no catch-up).
- [x] Base tick = **1 minute** (reuse live-eval cadence).
- [x] Cron endpoint named `/admin/triggers/schedules/refresh` (matches `/admin/<domain>/refresh` convention).
- [x] Active-schedule query backed by a **partial index** (`flags->>'is_active'='true' AND deleted_at IS NULL`); predicate matches DAO filter exactly.
- [x] Dispatcher refactor (**X.2**): lift the `ti_id` lookup out of `dispatch`; pass the resolved entity in. Composio worker task does the lookup; refresh service passes the schedule row directly. Steps 2–5 shared verbatim.
- [x] Gate semantics: `is_active=false` → silent skip; `is_valid=false` → **not** silent (failed-delivery path, for visibility).
- [x] Deliveries reuse the **same `trigger_deliveries` table**; nullable `subscription_id` + new nullable `schedule_id`; XOR check `(subscription_id IS NULL) <> (schedule_id IS NULL)`; two partial unique dedup indexes.
- [x] Typed flag models per domain (`TriggerSubscriptionFlags`, `TriggerScheduleFlags`) — **no bare `Flags()`**, no top-level hoisted bools.
- [x] Realign existing trigger subscriptions `enabled/valid → is_active/is_valid` (code-layer; webhooks left untouched, still flag-less).
- [x] Promote `ti_id` to a top-level indexed column, **fully removed from `data` JSONB** (clean, no drift).
- [x] **Trigger schema: no new migration** — fold into the initial `oss000000003` (unreleased; edit in place). `trigger_schedules` created before `trigger_deliveries` so the FK resolves.
- [x] **Webhook flags: separate `oss000000004`** (core_oss, data-only). Webhooks are on the released `core` chain and already have a `flags` column, so this only backfills `is_active=true` (+ partial index) — **no edit-in-place, no `is_valid`**.
- [x] Play/pause = **`/start` + `/stop`** POST routes flipping `is_active` (mirrors `/revoke`, live-eval `/open`·`/close`), on **all three** domains.
- [x] Webhooks get `is_active` + play/pause (full parity) — reverses the earlier "leave webhooks alone" defer. But **no `is_valid`** (no validity concept) and no other webhook lifecycle work.
- [x] Edition = OSS, alongside `core/triggers/`.

## Notes

- The trigger tables are **unreleased**, so there is no production DB that has run `oss000000003`.
  Editing it in place avoids stacking ALTER-on-ALTER for a schema no one has applied. No backfill
  is needed — no rows exist.
- Webhook subscriptions had no flags today (only `deleted_at`), though the `flags` JSONB **column
  already exists** (created in the released `core` chain). This work gives them `is_active` + play/pause
  (WP6) via a data-only `oss000000004` backfill — but **no `is_valid`**: webhooks have no `/revoke`,
  no external connection, nothing to invalidate. `is_valid` is trigger-specific (Composio can revoke a
  connection out from under a subscription).
- Reuse anchors (no reinvention): references via `_normalize_references` /
  `WorkflowsService.retrieve_workflow_revision`; web drawer mirrors
  `TriggerSubscriptionDrawer.tsx`; reference-family build mirrors `runnable/deploy.ts`;
  cron mechanism mirrors `crons/queries.{sh,txt}` + live-eval `refresh_runs`.
- Live evals have **no per-run interval** — the tick is global and every active run fires every
  tick. The per-schedule cron expression is genuinely net-new logic; there was no prior pattern
  to copy for it.
