# Design: automation failure emails

## Context

This change builds on two earlier plans:

- **v0.** `docs/design/automation-failure-alerts/` on branch `docs/automation-failure-alerts-plan`,
  2026-09-25. It planned a polling monitor, a state table per automation, and a "needs attention"
  email.
- **v1.** The plan agreed in Slack: a generic notifications base, one email per automation,
  recipients beyond the creator, a switch, and writing each run's result back to its delivery.

This design keeps the v1 product decisions and corrects them against the current code. The facts
are in section 1. Each fact was read on `main` at commit `d1c6dd2e6` (release v0.128.6). Section 2
gives the decisions, and marks the ones the owner has not confirmed.

Terms:

- **Automation**: a schedule (`trigger_schedules`) or an event subscription (`trigger_subscriptions`).
- **Delivery**: one row in `trigger_deliveries`, written each time an automation tries to run.
- **Run**: the agent turn that a `202` delivery started. Its records are in the tracing database.
- **Outcome**: how a delivery ended, in `data.outcome`. New in this change.
- **Notification**: one row in `notifications`. One open row per automation at most.

## 1. Facts

### Deliveries

| Id | Fact | Source |
|---|---|---|
| G1 | A successful detached start writes `202 dispatched` with `data.result.run_id`. Nothing updates the delivery later. | `api/oss/src/tasks/asyncio/triggers/dispatcher.py:492-494`, `:533-537`; `api/entrypoints/worker_queues.py:285-291` |
| G2 | A build or reference failure writes `400 failed`. | `dispatcher.py:478-488` |
| G3 | `missing_principal`, `agent_deleted` and `access_denied` write `403 failed` through `refuse_delivery`. That method pauses the automation (`flags.is_active=false`, `meta.paused_reason`) only if it inserted the row. A paused automation writes no more deliveries. | `dispatcher.py:316`, `:403`, `:437`, `:651-685`; `api/oss/src/dbs/postgres/triggers/dao.py:69-88`, `:562-620`; `api/oss/src/tasks/taskiq/triggers/worker.py:124-129` |
| G4 | A model that needs setup writes `422 skipped`. The automation stays on, so each fire writes another `422`. | `dispatcher.py:62-63`, `:620-640` |
| G5 | A failed start writes `500 failed` and raises. | `dispatcher.py:519-531` |
| G6 | No retry happens after a `500`. `max_retries=5` is set, but the broker registers only the tracing middleware. In taskiq 0.12.4 only `SmartRetryMiddleware` and `SimpleRetryMiddleware` read `retry_on_error`. | `api/oss/src/tasks/taskiq/triggers/worker.py:36-40`, `:86-90`; `api/oss/src/core/triggers/dtos.py:35`; `api/oss/src/tasks/taskiq/shared/broker.py:94-99`; `api/uv.lock` (taskiq 0.12.4) |
| G7 | A `500` row is the only one that a repeated event can claim again. The re-claim replaces `id`, `status` and `data`. | `api/oss/src/dbs/postgres/sessions/streams/dao.py:318-338` |
| G8 | `update_delivery` merges the new `data` into the old one (`||`). It does not replace it. | `api/oss/src/dbs/postgres/triggers/dao.py:672-695` |
| G9 | An invalid subscription writes `409 failed`. Only `revoke_subscription` sets `is_valid=false`, and it also disables the provider trigger. Revoking a connection changes only the connection row and does not reach subscriptions. | `dispatcher.py:219-238`; `api/oss/src/core/triggers/service.py:1393-1413`, `:1607-1640`; `api/oss/src/core/gateway/connections/service.py:267-299` |
| G10 | A test subscription writes `200 success` with `data.is_test=true` and runs nothing. | `dispatcher.py:181-215` |
| G11 | Nothing sweeps a delivery stuck at `102 claimed`. The detached start has no read timeout. | `api/oss/src/core/workflows/service.py:1059` |
| G12 | `trigger_deliveries` has no index on `created_at` alone. Its indexes start with `project_id`, `subscription_id` or `schedule_id`. | `api/oss/src/dbs/postgres/triggers/dbes.py:109-134` |
| G13 | `data` is a `TriggerDeliveryData`. It has `session_id`, `result`, `error` and `error_details` (an `AgentError` with `code`). | `api/oss/src/core/triggers/dtos.py:382-401` |
| G14 | When an agent is archived, its automations are paused by `pause_triggers_for_artifact`, with no delivery row. | `api/oss/src/core/workflows/service.py:1896`; `api/oss/src/dbs/postgres/triggers/dao.py:642` |

### Run endings

| Id | Fact | Source |
|---|---|---|
| G15 | A delivery's `data.result.run_id` is the run's `turn_id` in `records`. The dispatcher sets no `on_busy`, so the SDK keeps the run id. | `api/oss/src/core/workflows/service.py:3987-3992`; `sdks/python/agenta/sdk/agents/handler.py:683`; `sdks/python/agenta/sdk/decorators/routing.py:256`, `:299-303`; `services/runner/src/server.ts:305-307` |
| G16 | Only a `done` record ends a turn. `done.stopReason` is set only for `paused`, `cancelled` and `error`. | `api/oss/src/core/sessions/records/dtos.py:18`; `services/runner/src/tracing/otel.ts:2627-2634` |
| G17 | Some failures write an `error` record and then a `done` with no `stopReason`. | `services/runner/src/server.ts:1215-1226`, `:1316-1323` |
| G18 | When a runner dies, the watchdog writes `error` (`execution_lost`) and a plain `done` through the records stream. A stopped execution gets `done(stopReason=cancelled)`. | `api/oss/src/tasks/asyncio/sessions/orphan_sweep.py:107`, `:144-230`, `:670-684` |
| G19 | A records batch that fails stays pending and is claimed again after `AGENTA_RECORDS_RECLAIM_IDLE_MS` (30 s), up to `AGENTA_RECORDS_MAX_DELIVERIES` (5) times. Later batches commit in the meantime, so an `error` record can commit after its `done`. | `api/oss/src/tasks/asyncio/sessions/records_worker.py:316-317`, `:459-530`; `api/oss/src/tasks/asyncio/shared/consumer.py:222-258`; `api/oss/src/utils/env.py:664-678` |
| G20 | `turn_ended` on `streams:sessions` carries only `kind`, `project_id`, `session_id` and `turn_id`. It is sent after a `done` commits, before a late `error`. The `SessionEventsWorker` group is not started. | `api/oss/src/tasks/asyncio/sessions/streaming.py:20-30`; `records_worker.py:87-107`, `:508-515`; `api/entrypoints/worker_streams.py:167-198` |
| G21 | `records` is in the tracing database and has an index `ix_records_project_id_session_id_turn_id`. `runner_ended_turns` cannot be reused: it leaves out watchdog endings, and it reads "completed" when a turn has both endings. | `api/oss/src/dbs/postgres/sessions/records/dao.py:32-40`, `:542-576`; `api/oss/src/dbs/postgres/sessions/records/dbes.py:47-52` |
| G22 | A run ends by the runner's hard deadline: 11 hours plus 30 minutes by default. | `services/runner/src/engines/sandbox_agent/run-limits.ts:43`; `services/runner/src/sessions/turn-settle.ts:31`, `:42` |
| G23 | An abandoned turn writes `error` (`execution_lost`) and no `done`. | `services/runner/src/server.ts:1252-1268` |

### Automations

| Id | Fact | Source |
|---|---|---|
| G24 | User actions on an automation, each from a route: `edit_subscription` (`service.py:1148`), `delete_subscription` (`:1270`), `refresh_subscription` (`:1377`), `revoke_subscription` (`:1393`), `set_subscription_active` (`:1442`), `edit_schedule` (`:1824`), `delete_schedule` (`:1859`), `set_schedule_active` (`:1873`). | `api/oss/src/core/triggers/service.py`; `api/oss/src/apis/fastapi/triggers/router.py:344-471` |
| G25 | Platform actions on an automation: `refresh_schedules` stops a schedule after its `end_time` through `set_schedule_active`, and `refuse_delivery` pauses (G3). | `service.py:1925-1973` |
| G26 | Delete is soft (`deleted_at`). | `api/oss/src/dbs/postgres/triggers/dao.py:256-283`, `:1030-1051` |
| G27 | An automation has `name`, `created_by_id` and an `artifact_id` column for its agent. | `api/oss/src/dbs/postgres/triggers/dbas.py:21`, `:40-63`; `api/oss/src/dbs/postgres/shared/dbas.py:93`, `:135-142` |
| G28 | Edits do not set `updated_at`. | `api/oss/src/dbs/postgres/triggers/mappings.py:101`, `:181` |

### Recipients

| Id | Fact | Source |
|---|---|---|
| G29 | `MembershipsService.is_member(user_id, project_id)` and `resolve(...)` apply the edition rule. OSS: every organization member is in every project with the organization role. EE: a member needs a project row. | `api/oss/src/core/memberships/service.py:173-205`, `:232`, `:282`; `api/entrypoints/access.py:35-40` |
| G30 | `query_project_members(project_id, windowing)` returns `user_id`, `email`, `name` and `role` under the same rule. It has no role filter and does not filter deleted users. | `api/oss/src/core/memberships/service.py:333-350`; `api/oss/src/dbs/postgres/memberships/dao.py:130-148`, `:419` |
| G31 | The organization owner is `organizations.owner_id`. The memberships DAO already reads it. | `api/oss/src/dbs/postgres/memberships/dao.py:210`, `:465` |
| G32 | Users have `email` and `deleted_at`. | `api/oss/src/models/db_models.py:79`, `:86` |
| G33 | New code must not read `project_members` to decide access. | `api/AGENTS.md`, "Project membership and access" |

### Email, config, loops, UI

| Id | Fact | Source |
|---|---|---|
| G34 | `send_email` always renders the invitation template. `_send_smtp_email` and `_send_sendgrid_email` take any HTML and run in a thread. SMTP is chosen first, then SendGrid. With neither, it returns `True` and sends nothing. | `api/oss/src/utils/emailing.py:66-117`, `:119-137`, `:186-204` |
| G35 | No plain-text part is sent. | `emailing.py:157`, `:217-222` |
| G36 | SMTP has an optional `SMTP_TIMEOUT` (none by default). The SendGrid client has no timeout. | `api/oss/src/utils/env.py:2197`; `api/oss/src/utils/lazy.py:110` |
| G37 | "Email is set up" is `env.smtp.enabled or env.sendgrid.enabled`. | `env.py:2209-2211`, `:2226-2229` |
| G38 | `AgentaConfig` groups feature configs (`sessions`, `webhooks`). No notifications config exists. `env.agenta.web_url` is `AGENTA_WEB_URL`. | `env.py:861-906`, `:866` |
| G39 | The API lifespan starts background loops with `asyncio.create_task`. `attachment_sweep_loop` holds a Redis lease so that one replica runs each pass. | `api/entrypoints/routers.py:417-434`; `api/oss/src/tasks/asyncio/sessions/attachment_sweep.py:18-173` |
| G40 | The automation page is `/m/w/{workspace_id}/p/{project_id}/automations/{automation_id}`. The API answers the organization id where a workspace id was. | `web/mobile/src/pages/w/[workspace_id]/p/[project_id]/automations/[automation_id].tsx`; `web/mobile/src/features/automations/AutomationListScreen.tsx:115`; `api/AGENTS.md` |
| G41 | The screen reads `status.message`: `success`, `failed`, `skipped`, and anything else (for example `dispatched`) is pending. | `web/packages/agenta-automation-ui/src/automationModel.ts:160-171` |
| G42 | The latest `core_oss` revision is `oss000000062`. | `api/oss/databases/postgres/migrations/core_oss/versions/` |

## 2. Decisions

| # | Decision | Why | Owner confirmed |
|---|---|---|---|
| D1 | One email per automation. A connection gets no email of its own. | Ashraf, Slack. Also G9: nothing detects a broken connection. | yes |
| D2 | Recipients: the creator if still a member, else the project's `owner` and `admin` members, else the organization owner. | Ashraf, Slack (v1). | yes |
| D3 | No reminders and no "fixed" email. After a fix, the next failure sends one new email. | v0 R4, R6; v1. | yes |
| D4 | A `500` sends an email on the first one. | G6: no retry exists, so the first `500` is the final result of that fire. v1 said "after all 5 retries", and those retries do not exist. | **no** |
| D5 | `409` sends no email. | G9: only a person's revoke causes it, and the revoke turns the provider trigger off, so at most an event already in flight writes a `409`. | **no** |
| D6 | `403` and `422` send an email. | G3: a `403` pauses the automation for good, which is the worst silent failure. G4: a `422` skips every fire until someone fixes the model. | **no** |
| D7 | A run that waits for a person (`paused`) sends no email. Its outcome is shown on the screen. | v1 lists failures only, and a wait is not a failure. v0 A4 had an email for it. | **no** |
| D8 | An agent archived by a person (G14) sends no email. | A person did it, and it writes no delivery. | **no** |
| D9 | The switch defaults to on. | v1: "Self-hosters can turn emails off". This replaces v0 R9 (default off). | **no** |
| D10 | One background pass decides outcomes, and a second one sends email. Both poll. There is no hook in the dispatcher and no consumer on `streams:sessions`. | G19, G20: a `turn_ended` event comes before a late `error`, so a hook must wait anyway. G11, G23: some runs never send an event. One poller is one writer and needs no queue. The v1 plan already had a periodic check, so this removes the queue and keeps the check. | design |
| D11 | The outcome goes in `data.outcome` and `data.outcome_code`, not in new columns. | G7: the re-claim replaces `data`, so a stale outcome cannot survive a status change. It adds no `ALTER TABLE` to a table that workers write all the time. | design |
| D12 | `notifications` has no failure count. `notification_deliveries` has no `destination` and no `read_at`. | Nothing reads them in v1. A nullable column can be added later without failing the migration gate (`api/AGENTS.md`, "Migration gate"). | design |
| D13 | A notification closes on a person's edit, start, stop, refresh or delete, and on a success. A revoke closes nothing, and platform pauses close nothing. | G24, G25. Closing in the service methods of user routes, not in the DAO, keeps platform writes out. | design |
| D14 | Recipients are chosen when the notification opens. The email address is read when the email is sent. | The send pass runs within about 60 s of the open, so membership is not checked again. A deleted user is skipped (section 7.1). | design |

## 3. Architecture

```text
              API lifespan (one replica per pass, Redis lease)
┌─────────────────────────────────────┐   ┌──────────────────────────────────┐
│ automation outcome pass (60 s)      │   │ notification send pass (60 s)    │
│ core/triggers/outcomes.py           │   │ core/notifications/service.py    │
│                                     │   │                                  │
│ trigger_deliveries (core) ─┐        │   │ notification_deliveries          │
│ records (tracing) ─────────┼► decide│   │   status = pending               │
│                            ▼        │   │        │                         │
│     data.outcome  ──►  open / close │──►│        ▼                         │
│                        notifications│   │ EmailSender → SMTP or SendGrid   │
└─────────────────────────────────────┘   └──────────────────────────────────┘
        ▲ close on user actions
        │ TriggersService: edit, start, stop, refresh, delete
```

Layers, as `api/AGENTS.md` requires:

| Layer | New code |
|---|---|
| Core | `api/oss/src/core/notifications/` (`dtos.py`, `interfaces.py`, `service.py`, `email.py`); `api/oss/src/core/triggers/outcomes.py` (decision table, apply rules, recipients, reason catalog) |
| DB | `api/oss/src/dbs/postgres/notifications/` (`dbes.py`, `dao.py`, `mappings.py`); `RecordsDAO.turn_endings`; `TriggersDAO.query_undecided_deliveries` and `settle_delivery`; `MembershipsDAO.fetch_organization_owner` |
| Tasks | `api/oss/src/tasks/asyncio/triggers/outcome_loop.py`; `api/oss/src/tasks/asyncio/notifications/send_loop.py` |
| Wiring | `api/entrypoints/routers.py` lifespan |

`core/notifications` knows nothing about automations. It stores a kind, a key, a JSON `data`, and
deliveries. `core/triggers/outcomes.py` decides what to open and close. A new kind in v2 adds its
own producer and a template, and no new table.

`TriggersService` gets a `NotificationsService` dependency, through its interface, to close
notifications on user actions. It is wired in `api/entrypoints/`.

## 4. Data

### 4.1 `notifications`

| Column | Type | Meaning |
|---|---|---|
| `id` | `UUID` PK | |
| `project_id` | `UUID` not null | FK `projects.id` `ON DELETE CASCADE` |
| `kind` | `VARCHAR` not null | `automation_failing` in v1 |
| `dedup_key` | `VARCHAR` not null | `automation:<automation_id>` |
| `status` | `VARCHAR` not null | `open` or `resolved` |
| `data` | `JSONB` not null | for `automation_failing`: `automation_id`, `automation_kind` (`schedule` or `subscription`), `delivery_id`, `failed_at`, `reason_code` |
| `resolved_at` | `TIMESTAMPTZ` null | |
| lifecycle | | `created_at` (default `CURRENT_TIMESTAMP`), `updated_at`, `deleted_at`, `created_by_id`, `updated_by_id`, `deleted_by_id` |

Indexes:

- `ux_notifications_project_id_dedup_key_open`: unique on `(project_id, dedup_key)` `WHERE status = 'open'`.
  It guarantees one open notification per automation, also when two passes or two replicas race.
- `ix_notifications_project_id_dedup_key_resolved_at`: on `(project_id, dedup_key, resolved_at)`,
  for the stale-failure check (5.3, rule A4).

### 4.2 `notification_deliveries`

| Column | Type | Meaning |
|---|---|---|
| `id` | `UUID` PK | |
| `project_id` | `UUID` not null | FK `projects.id` `ON DELETE CASCADE` |
| `notification_id` | `UUID` not null | the notification. No FK, by the table rule below |
| `user_id` | `UUID` not null | the recipient |
| `channel` | `VARCHAR` not null | `email` in v1 |
| `status` | `VARCHAR` not null | `pending`, `sent`, `failed`, `skipped` |
| `attempts` | `INTEGER` not null default 0 | failed send attempts |
| `sent_at` | `TIMESTAMPTZ` null | |
| lifecycle | | as above |

Indexes: unique `(notification_id, user_id, channel)`; partial `(created_at) WHERE status = 'pending'`
for the send pass.

Table rules (`docs/designs/oss-ee-convergence/migration-chains-and-edition-switch.md`, rules 1 and 4):
the six lifecycle columns, one hard FK at the owning scope (`projects.id`), and no other FK.

### 4.3 `trigger_deliveries`

No new column. `TriggerDeliveryData` gets two optional fields:

| Field | Values |
|---|---|
| `outcome` | `succeeded`, `failed`, `cancelled`, `paused`, `skipped` |
| `outcome_code` | the reason code of a `failed` or `skipped` outcome (section 7) |

A new index `ix_trigger_deliveries_created_at` on `(created_at)` serves the outcome pass (G12).

### 4.4 Migrations

Two revisions in `api/oss/databases/postgres/migrations/core_oss/versions/`, after `oss000000062`:

1. Create both tables and their indexes, in one transaction. Nothing else is locked.
2. `CREATE INDEX CONCURRENTLY ix_trigger_deliveries_created_at` inside
   `op.get_context().autocommit_block()`, as `oss000000012_add_gateway_connections_provider_account_index.py`
   does. If an earlier build failed and left an invalid index, drop it first. Downgrade:
   `DROP INDEX CONCURRENTLY IF EXISTS`.

Both pass the migration gate: revision 1 only touches its own new tables, and revision 2 is a
concurrent index. Old code ignores the new tables and the new `data` keys, so a rollout in either
direction is safe.

## 5. Outcome pass

Every 60 s, under the Redis lease `locks:triggers:outcome-pass` (TTL 300 s, renewed after each
page), as `attachment_sweep_loop` does (G39). It always runs. The email switch does not stop it.

### 5.1 Candidates

```sql
SELECT project_id, id, schedule_id, subscription_id, status, data, created_at
FROM trigger_deliveries
WHERE created_at > now() - interval '24 hours'
  AND status->>'code' IN ('202', '400', '403', '422', '500')
  AND data->>'outcome' IS NULL
  AND (created_at, id) > (:after_created_at, :after_id)
ORDER BY created_at, id
LIMIT 500;
```

The pass reads every page of the window. Runs that are still going are read again in each pass.

For `202` rows, the pass reads the run endings with a new `RecordsDAO.turn_endings(project_id, keys)`,
one query per project, with keys `(data.session_id, data.result.run_id)` (G15). It returns, per key:
whether a `done` exists, its `stopReason`, its `created_at`, and the `code` of the newest `error`
record. It skips deleted and quarantined records, and it does not skip watchdog endings (G21).

### 5.2 Decision table

The first matching row wins.

| # | Status | Condition | Outcome | `outcome_code` |
|---|---|---|---|---|
| O1 | `400` | | `failed` | `bad_configuration` |
| O2 | `403` | | `failed` | `data.error_details.code` (`missing_principal`, `agent_deleted`, `access_denied`) |
| O3 | `422` | | `skipped` | `agent_needs_setup` |
| O4 | `500` | | `failed` | `start_failed` |
| O5 | `202` | no `done` | wait | |
| O6 | `202` | `done.created_at` less than 5 minutes ago | wait | |
| O7 | `202` | `stopReason = paused` | `paused` | |
| O8 | `202` | `stopReason = cancelled` | `cancelled` | |
| O9 | `202` | `stopReason = error`, or an `error` record exists | `failed` | the newest `error` code, or `runner_error` |
| O10 | `202` | otherwise | `succeeded` | |

O6 waits 5 minutes because a late `error` record arrives within about 2.5 minutes (G19: 30 s, 5
times). O7 and O8 come before O9 because the runner writes those stop reasons on purpose (G16).
O9 covers the plain `done` after an `error` (G17, G18). A `202` without `done` after 24 hours leaves
the window undecided. The 24 hours are longer than the default hard deadline (G22).

The write is guarded, so a delivery that changed after it was read is left for the next pass:

```sql
UPDATE trigger_deliveries
SET data = (coalesce(data::jsonb, '{}'::jsonb) || :outcome_json)::json
WHERE project_id = :project_id AND id = :id
  AND status->>'code' = :status_code_read
  AND data->>'outcome' IS NULL;
```

0 rows changed means: skip the apply step. A re-claimed `500` has a new `id` and a new `data`
(G7), so the pass decides it again from its new status.

### 5.3 Apply

The guarded write and the apply step for one delivery `D` run in one transaction on the core
database. Deliveries are applied in `created_at` order. `A` is `D`'s automation, read with its
deleted rows.

| # | Rule |
|---|---|
| A1 | `D.outcome` is `cancelled` or `paused`: stop. |
| A2 | `A` is missing or deleted: stop. |
| A3 | `D.outcome` is `succeeded`: close the open notification of `automation:<A.id>`, if any. Stop. |
| A4 | `D.outcome` is `failed` or `skipped`: open a notification for `automation:<A.id>`, unless one is open, or a notification for that key was resolved after `D.created_at`. |

Open, in SQL terms:

```sql
INSERT INTO notifications (id, project_id, kind, dedup_key, status, data, ...)
SELECT ...
WHERE NOT EXISTS (
  SELECT 1 FROM notifications
  WHERE project_id = :project_id AND dedup_key = :key
    AND resolved_at > :failed_at)
ON CONFLICT (project_id, dedup_key) WHERE status = 'open' DO NOTHING
RETURNING id;
```

If a row is returned, the same transaction inserts one `notification_deliveries` row per recipient
(section 6). Each row is `pending` if the switch is on and email is set up (G37). Otherwise it is
`skipped`.

Close: set `status = 'resolved'`, `resolved_at = now()`, and set its `pending` deliveries to
`skipped`. In the same transaction.

### 5.4 Close on user actions

After a successful write, these `TriggersService` methods close the notification of
`automation:<id>`: `edit_subscription`, `edit_schedule`, `set_subscription_active`,
`set_schedule_active`, `refresh_subscription`, `delete_subscription`, `delete_schedule` (G24).
`refresh_schedules` calls `set_schedule_active` for a platform stop (G25). So the close goes in the
route-facing calls, with a flag that `refresh_schedules` sets to false. A close failure is logged
and never fails the user's request.

## 6. Recipients

Chosen when the notification opens (D14), in this order. The first step that gives at least one
user wins.

1. `A.created_by_id`, if `MembershipsService.is_member(user_id, project_id)` is true and the user
   has no `deleted_at` (G29, G32).
2. Every member from `MembershipsService.query_project_members(project_id)` with role `owner` or
   `admin`, all pages, without deleted users (G30). In OSS this is the organization's owners and
   admins (G29).
3. The organization owner, from a new `MembershipsDAO.fetch_organization_owner(organization_id)`,
   if the user has no `deleted_at` (G31).

No step reads `project_members` directly (G33). With no recipient, the notification opens with no
delivery, and a warning is logged.

## 7. Email

### 7.1 Sending

`emailing.py` gets `send_rendered_email(to_email, subject, html, text)`. It uses SMTP, then
SendGrid, like `send_email` (G34), and sends a plain-text part and an HTML part. `send_email`
renders its template and calls it. With no provider set up it raises, so a caller cannot read
"nothing sent" as success. `send_email` keeps today's no-op.

The send pass, every 60 s under lease `locks:notifications:send-pass`:

1. Read up to 100 `pending` email deliveries, oldest first.
2. For each, read the notification, the user and the automation. Mark the delivery `skipped` if
   the notification is resolved, the user is deleted, or the automation is deleted.
3. Render the email and send it with a 30 s timeout (`asyncio.wait_for`). The provider call runs
   in a thread (G34), so the timeout frees the pass even when SendGrid has none (G36).
4. Success: `status = 'sent'`, `sent_at = now()`, guarded by `status = 'pending'`.
5. Failure: `attempts + 1`. At 5 attempts, `status = 'failed'` and an error log. A failed delivery
   is retried on the next pass, so 5 attempts span about 5 minutes.

A send runs outside any transaction. If the process dies after the send and before the write, the
next pass sends again. This is rare and accepted.

### 7.2 Content

Every value is HTML-escaped in the HTML part.

```text
Subject: Your automation "{automation_name}" is failing

Your automation "{automation_name}" for the agent "{agent_name}" is failing.

Failing since: {failed_at, UTC}
What happened: {reason}
What to do: {action}

[Open automation]  {web_url}/m/w/{organization_id}/p/{project_id}/automations/{automation_id}

You will not get another email about this until it is fixed.
```

An automation without a name shows "Untitled automation". The agent name comes from the
automation's `artifact_id` (G27); if it cannot be read, the line leaves out the agent. The raw error
text (`data.error`) is never sent.

### 7.3 Reason catalog

| Code | What happened | What to do |
|---|---|---|
| `bad_configuration` | The automation could not prepare the run. Its agent or its inputs are not set correctly. | Open the automation and check its agent and inputs. |
| `missing_principal` | The automation was paused because it has no owner to run as. | Open the automation, save it, then turn it on. |
| `agent_deleted` | The automation was paused because its agent was deleted. | Choose another agent, then turn the automation on. |
| `access_denied` | The automation was paused because its owner can no longer run the agent. | Check who can use the agent, then turn the automation on. |
| `agent_needs_setup` | The agent's model needs setup, so runs are skipped. | Set up the agent's model. The next run starts as usual. |
| `start_failed` | Agenta could not start the run. | Nothing to change. If it keeps failing, contact support. |
| `execution_lost`, `sandbox_gone` | The agent stopped responding and the run was closed. | Nothing to change. If it keeps failing, contact support. |
| `starter_credits_exhausted`, `starter_credits_program_paused`, `wallet_balance_exhausted` | The run stopped because there are no credits left. | Add credits or add your own model key. |
| `rate_limited` | The model provider refused the request because of a rate or quota limit. | Check your limits with the model provider. |
| `run_total_time_limit`, `run_idle_time_limit`, `run_first_response_time_limit`, `turn_time_limit_reached`, `tool_call_time_limit` | The run took longer than the time limit. | Open the automation to see the run. |
| any other code | The agent's run ended with an error. | Open the automation to see the run and its error. |

The runner codes come from `services/runner/src/engines/sandbox_agent/errors.ts`. An unknown code
uses the last row, so a new runner code needs no change here.

## 8. Config

`NotificationsConfig` in `env.py`, as `env.agenta.notifications` (G38):

| Setting | Env variable | Default |
|---|---|---|
| `email_enabled` | `AGENTA_NOTIFICATIONS_EMAIL_ENABLED` | `true` |

Passes, windows, limits and timeouts are constants in code.

## 9. Automations screen

`deliveryOutcome` in `web/packages/agenta-automation-ui/src/automationModel.ts` reads
`data.outcome` first: `succeeded` is `ok`, `failed` is `bad`, `skipped` is `skipped`, `cancelled`
is a new `cancelled` state, and `paused` is a new `waiting` state. With no `data.outcome`, it
keeps today's `status.message` rule (G41). The types come from the regenerated Fern client.

## 10. Known limits

Each one is a scenario in the specs.

1. **A failure that happened before a fix can still email, if no notification was open.** A4 drops
   a failure older than the last close of its key. If nothing was open, nothing was closed, so a
   run that started before an edit and failed after it opens a notification.
2. **Overlapping runs.** If a newer run succeeds and is decided before an older failed run, and no
   notification was open, the older failure opens one. The next success closes it.
3. **A `500` that later runs.** A repeated event can re-claim a `500` (G7). The email was already
   sent. The new run's outcome is decided again and can close the notification.
4. **Runs that never end** (G23) or stay at `102` (G11) are not reported.
5. **An `error` record more than 5 minutes late** reads as a success.
6. **The turn after an approval is not followed.** The delivery tracks only the first turn (G15).
   That turn ends `paused`.
7. **A crash between a send and its write** sends the email twice.

## 11. Separate bugs, out of this change

| Bug | Fact |
|---|---|
| `retry_on_error=True` has no effect on any taskiq worker: no retry middleware is registered. | G6 |
| Nothing sweeps deliveries stuck at `102`; the detached start has no read timeout. | G11 |
| Edits do not set `updated_at` on automations. | G28 |
| The SendGrid client has no timeout. | G36 |
