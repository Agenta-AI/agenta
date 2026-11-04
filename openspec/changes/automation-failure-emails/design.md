# Design: automation failure emails

## Context

This change builds on two earlier plans:

- **v0.** `docs/design/automation-failure-alerts/` on branch `docs/automation-failure-alerts-plan`,
  2026-09-25: a polling monitor, a state table per automation, and a "needs attention" email.
- **v1.** The plan agreed in Slack: a generic notifications base, one email per automation,
  recipients beyond the creator, a switch, and each run's result written back to its trigger
  delivery.

This design keeps the v1 product decisions and corrects them against the code. Every fact in
section 1 was read on `main` at commit `d1c6dd2e6` (release v0.128.6). Section 2 lists the
decisions and marks the ones the owner has not confirmed. [review-loop.md](review-loop.md)
records the review rounds.

## Naming

"Automation" is the product word for a trigger schedule or a trigger subscription. It is used in
the notification layer and the UI. The trigger layer keeps its own names.

| Concept | Database | DTO / code | JSON | UI |
|---|---|---|---|---|
| automation | `trigger_schedules`, `trigger_subscriptions` | `TriggerSchedule`, `TriggerSubscription` | `automation_id` in `notifications.data` | automation |
| trigger delivery | `trigger_deliveries` | `TriggerDelivery` | `trigger_delivery_id` in `notifications.data` | run |
| settled result of a trigger delivery | `trigger_deliveries.data.outcome` | `TriggerDeliveryData.outcome` | `outcome`: `completed`, `failed`, `cancelled`, `waiting`, `skipped` | worked, failed, cancelled, waiting for a person, skipped |
| reason | `trigger_deliveries.data.reason_code`, `notifications.data.reason_code` | `reason_code` | `reason_code` | the "What happened" line |
| notification | `notifications` | `Notification` | | (email) |
| open or resolved | `notifications.state` | `NotificationState` (`open`, `resolved`) | | |
| notification delivery | `notification_deliveries` | `NotificationDelivery` | | |
| delivery state | `notification_deliveries.state` | `NotificationDeliveryState` (`pending`, `sent`, `failed`, `skipped`) | | |
| delivery channel | `notification_deliveries.channel` | `channel` | `email` | |
| deduplication key | `notifications.dedup_key` | `dedup_key` | `automation:<automation_id>` | |

`completed` follows `RunnerEnding` (`api/oss/src/core/sessions/records/dtos.py:34`), so the run
and its trigger delivery use one word. The notification delivery states follow
`SessionCommandState` (`pending`, `api/oss/src/core/sessions/commands/dtos.py:32`) and add `sent`
and `skipped`. **Avoid:** reading `notification_deliveries.channel` as a `core/channels` connection.
In this table a channel is only a way to reach a person (`email` in v1).

Verbs: a pass **settles** a trigger delivery (as `settled_at` and `settled_by` do in sessions). A
notification is **opened** and **resolved**. "Close" is not used. `dedup_key` has no column
precedent in the repo. The name follows the open and resolve model of incident tools.

`waiting` replaces the runner's `stopReason` `paused` in one place (the settle table, O7). The
trigger layer already uses "paused" for an automation that is turned off (`meta.paused_reason`).

## 1. Facts

### Trigger deliveries

| Id | Fact | Source |
|---|---|---|
| G1 | A successful detached start writes `202 dispatched` with `data.result.run_id`. Nothing updates the trigger delivery later. | `api/oss/src/tasks/asyncio/triggers/dispatcher.py:492-494`, `:533-537`; `api/entrypoints/worker_queues.py:285-291` |
| G2 | A build or reference failure writes `400 failed`. | `dispatcher.py:479-489` |
| G3 | `missing_principal`, `agent_deleted` and `access_denied` write `403 failed` with `data.error_details.code`, through `refuse_delivery`. It pauses the automation (`flags.is_active=false`, `meta.paused_reason`) only if it inserted the row. A paused automation writes no more trigger deliveries. | `dispatcher.py:316`, `:403`, `:437`, `:651-685`; `api/oss/src/dbs/postgres/triggers/dao.py:69-88`, `:562-620`; `api/oss/src/tasks/taskiq/triggers/worker.py:124-129` |
| G4 | A model that needs setup writes `422 skipped`. The automation stays on, so each fire writes another `422`. | `dispatcher.py:62-63`, `:620-640` |
| G5 | A failed start writes `500 failed` and raises. | `dispatcher.py:519-531` |
| G6 | No retry happens after a `500`. `max_retries=5` is set, but the broker registers only the tracing middleware. In taskiq 0.12.4 only the retry middlewares read `retry_on_error`. | `api/oss/src/tasks/taskiq/triggers/worker.py:36-40`, `:86-90`; `api/oss/src/tasks/taskiq/shared/broker.py:94-99`; `api/uv.lock` |
| G7 | A repeated event can claim a `500` row again. The claim gives the row a new `id` and replaces `status` and `data`. It keeps `created_at`. | `api/oss/src/dbs/postgres/sessions/streams/dao.py:318-339` |
| G8 | `update_delivery` and the upsert in `write_subscription_delivery_if_live` merge the new `data` into the old one (`||`). The upsert has no status guard, so a repeated event for a `500` row can turn it into `409` or `200` and keep its old `data` keys. | `api/oss/src/dbs/postgres/triggers/dao.py:520-560`, `:672-695`, `:881-903` |
| G9 | An invalid subscription writes `409 failed`. Only `revoke_subscription` sets `is_valid=false`, and it turns the provider trigger off. Revoking a connection changes only the connection row. | `dispatcher.py:219-238`; `api/oss/src/core/triggers/service.py:1393-1413`, `:1607-1640`; `api/oss/src/core/gateway/connections/service.py:267-299` |
| G10 | A test subscription writes `200 success` with `data.is_test=true` and runs nothing. | `dispatcher.py:181-215` |
| G11 | Nothing sweeps a trigger delivery stuck at `102 claimed`. The detached start has no read timeout. | `api/oss/src/core/workflows/service.py:1059` |
| G12 | No index on `trigger_deliveries` starts with `created_at`. They start with `project_id` or `subscription_id`. | `api/oss/src/dbs/postgres/triggers/dbes.py:107-134` |
| G13 | `data` is a `JSON` column, `status` is `JSONB`. `TriggerDeliveryData` has `session_id`, `result`, `error`, `error_details`. | `api/oss/src/dbs/postgres/shared/dbas.py:195-208`; `api/oss/src/core/triggers/dtos.py:382-401` |
| G14 | When an agent is archived, its automations are paused by `pause_triggers_for_artifact`, with no trigger delivery. | `api/oss/src/core/workflows/service.py:1896`; `api/oss/src/dbs/postgres/triggers/dao.py:642` |
| G15 | Deleting a connection is a hard `DELETE`. The foreign key cascade removes its subscriptions and their trigger deliveries. | `api/oss/src/dbs/postgres/gateway/connections/dao.py:238-257`; `api/oss/src/dbs/postgres/triggers/dbes.py:24-29`, `:92-102` |

### Run endings

| Id | Fact | Source |
|---|---|---|
| G16 | `data.result.run_id` is the run's `turn_id` in `records`, and `data.session_id` is its `session_id`. The dispatcher sets no `on_busy`, so the SDK keeps the run id. | `api/oss/src/core/workflows/service.py:3987-3992`; `sdks/python/agenta/sdk/agents/handler.py:683`; `sdks/python/agenta/sdk/decorators/routing.py:256`, `:299-303`; `services/runner/src/server.ts:305-307` |
| G17 | Only a `done` record ends a turn. `done.attributes.stopReason` is set only for `paused`, `cancelled` and `error`. An `error` record has its code in `attributes.code`, which can be missing. | `api/oss/src/core/sessions/records/dtos.py:18`; `services/runner/src/tracing/otel.ts:2627-2634`; `services/runner/src/server.ts:1144`; `api/oss/src/tasks/asyncio/sessions/orphan_sweep.py:178-183` |
| G18 | Some failures write an `error` record and then a `done` with no `stopReason`. | `services/runner/src/server.ts:1215-1226`, `:1316-1323` |
| G19 | When a runner dies, the watchdog writes `error` (`execution_lost`) and a plain `done` through the records stream. A stopped execution gets `done(stopReason=cancelled)`. | `orphan_sweep.py:107`, `:144-230`, `:670-684` |
| G20 | A records batch that fails stays pending. It is claimed again after `AGENTA_RECORDS_RECLAIM_IDLE_MS` (30 s). After `AGENTA_RECORDS_MAX_DELIVERIES` (5) it is kept and retried with no end, unless the failure is known to be permanent. Later batches commit in the meantime, so an `error` record can commit long after its `done`. | `api/oss/src/tasks/asyncio/sessions/records_worker.py:316-317`, `:459-530`; `api/oss/src/tasks/asyncio/shared/consumer.py:222-299`; `api/oss/src/utils/env.py:664-678` |
| G21 | `turn_ended` on `streams:sessions` carries only ids, and is sent when a `done` commits. The `SessionEventsWorker` group is not started. | `api/oss/src/tasks/asyncio/sessions/streaming.py:20-30`; `records_worker.py:508-515`; `api/entrypoints/worker_streams.py:167-198` |
| G22 | `records` is in the tracing database, with index `ix_records_project_id_session_id_turn_id`. One turn can hold more than one `done` (runner and watchdog). `RecordsDAOInterface.runner_ended_turns` cannot be reused: it leaves out watchdog endings and reads "completed" when a turn has both endings. | `api/oss/src/dbs/postgres/sessions/records/dao.py:32-40`, `:542-576`; `api/oss/src/dbs/postgres/sessions/records/dbes.py:47-52`; `api/oss/src/core/sessions/records/interfaces.py:114`; `dao.py:572` |
| G23 | The runner's hard deadline ends a run after 11 hours and 30 minutes by default. | `services/runner/src/engines/sandbox_agent/run-limits.ts:43`; `services/runner/src/sessions/turn-settle.ts:31`, `:42` |
| G24 | An abandoned turn writes `error` (`execution_lost`) and no `done`. | `services/runner/src/server.ts:1252-1268` |
| G25 | The runner also emits `access_denied` as a run error. That automation is not paused. | `services/runner/src/engines/sandbox_agent/errors.ts:111` |

### Automations

| Id | Fact | Source |
|---|---|---|
| G26 | User actions, each from a route: `edit_subscription` (`service.py:1148`), `delete_subscription` (`:1270`), `refresh_subscription` (`:1377`), `revoke_subscription` (`:1393`), `set_subscription_active` (`:1442`), `edit_schedule` (`:1824`), `delete_schedule` (`:1859`), `set_schedule_active` (`:1873`). | `api/oss/src/core/triggers/service.py`; `api/oss/src/apis/fastapi/triggers/router.py:344-471` |
| G27 | `refresh_schedules` is the only internal caller of `set_schedule_active`. It stops a schedule after its `end_time`. | `service.py:1925-1973` |
| G28 | `delete_*` is a soft delete (`deleted_at`). | `api/oss/src/dbs/postgres/triggers/dao.py:256-283`, `:1030-1051` |
| G29 | An automation has `name` and `created_by_id`. | `api/oss/src/dbs/postgres/triggers/dbas.py:21`, `:50`; `api/oss/src/dbs/postgres/shared/dbas.py:93`, `:135-142` |
| G30 | Edits do not set `updated_at`. | `api/oss/src/dbs/postgres/triggers/mappings.py:101`, `:181` |
| G31 | `TriggersService` is built once. | `api/entrypoints/routers.py:1084` |

### Recipients and access

| Id | Fact | Source |
|---|---|---|
| G32 | `AccessService.check_human(user_id, project_id, action)` returns a `Decision` with `allowed`. It applies membership and role, for a human without request access. | `api/oss/src/core/access/service.py:295-310`; `api/oss/src/core/access/dtos.py:35-36` |
| G33 | `view_triggers` is a permission (`Permission.VIEW_TRIGGERS`). Custom roles in EE can remove it. | `api/oss/src/core/access/permissions/types.py:169`; `api/AGENTS.md` (custom roles) |
| G34 | `query_project_members(project_id, windowing)` returns `user_id`, `email`, `name`, `role` under the edition rule: OSS uses organization members and roles, EE uses project rows. It does not filter deleted users. | `api/oss/src/core/memberships/service.py:333-350`; `api/oss/src/dbs/postgres/memberships/dao.py:130-148`, `:419` |
| G35 | The memberships DAO reads `organizations.owner_id`, but only in private helpers. | `api/oss/src/dbs/postgres/memberships/dao.py:210`, `:458-466` |
| G36 | Users are hard-deleted. No new-style core reader returns a user's email; `api/oss/src/dbs/postgres/users/dao.py` reads identities only. | `api/oss/src/services/db_manager.py:1438-1444`, `:1510-1516`; `api/oss/src/core/users/` (types only) |
| G37 | A private agent is visible only to its owner, admins included. Automations have no sharing policy: `view_triggers` lets a member see them. | `api/oss/src/core/sharing/service.py:173` |
| G38 | A project's organization comes from `AccessService.project_organization_id`. | `dispatcher.py:642-648` |

### Email, config, loops, UI

| Id | Fact | Source |
|---|---|---|
| G39 | `send_email` always renders the invitation template. `_send_smtp_email` and `_send_sendgrid_email` take any HTML and run in a thread. SMTP comes first, then SendGrid. With neither, `send_email` returns `True` and sends nothing. `_send_sendgrid_email_sync` also returns `True` when the client cannot be built. | `api/oss/src/utils/emailing.py:66-117`, `:119-137`, `:186-216` |
| G40 | No plain-text part is sent. | `emailing.py:157`, `:217-222` |
| G41 | SMTP takes `SMTP_TIMEOUT` (none by default). The SendGrid client has no default timeout, but `python-http-client` 3.3.7 accepts `timeout` on each call (`client.mail.send.post(request_body=..., timeout=...)`). | `api/oss/src/utils/env.py:2197`; `api/oss/src/utils/lazy.py:110`; `api/uv.lock` (sendgrid 6.12.5, python-http-client 3.3.7) |
| G42 | `asyncio.wait_for` around `asyncio.to_thread` does not stop the thread. | Python `asyncio` semantics; `emailing.py:127`, `:194` |
| G43 | "Email is set up" is `env.smtp.enabled or env.sendgrid.enabled`. | `env.py:2209-2211`, `:2226-2229` |
| G44 | `AgentaConfig` groups feature configs. No notifications config exists. `env.agenta.web_url` is `AGENTA_WEB_URL`. `AGENTA_ACCESS_EMAIL_DISABLED` is the sign-in email method, not a general switch. | `env.py:206-210`, `:861-906`, `:2386-2404` |
| G45 | The API lifespan starts background loops with `asyncio.create_task`. `attachment_sweep_loop` holds a Redis lease so one replica runs each pass. `api/oss/src/utils/locking.py` has shared `acquire_lock`, `renew_lock` and `release_lock`. `bootstrap_access()` runs in the API, so `check_human` works in a background task. | `api/entrypoints/routers.py:417-434`, `:801`; `api/oss/src/tasks/asyncio/sessions/attachment_sweep.py:18-173`; `api/oss/src/utils/locking.py:78`, `:157`, `:223` |
| G46 | The automation page is `/m/w/{workspace_id}/p/{project_id}/automations/{automation_id}`. The API answers the organization id where a workspace id was. | `web/mobile/src/pages/w/[workspace_id]/p/[project_id]/automations/[automation_id].tsx`; `web/mobile/src/features/automations/AutomationListScreen.tsx:115`; `api/AGENTS.md` |
| G47 | The screen reads `status.message`: `success`, `failed`, `skipped`, and anything else is pending. | `web/packages/agenta-automation-ui/src/automationModel.ts:160-171` |
| G48 | The latest `core_oss` revision is `oss000000062`. Sibling delivery tables use the key `(project_id, id)`. A partial unique index on open rows is named like `uq_session_commands_open_target`. | `api/oss/databases/postgres/migrations/core_oss/versions/`; `api/oss/src/dbs/postgres/triggers/dbes.py:107`; `api/oss/src/dbs/postgres/sessions/commands/dbes.py:44` |
| G49 | No core DAO interface takes a database session. Every `TriggersDAO` method opens and commits its own session. | `api/oss/src/dbs/postgres/triggers/dao.py:562-713`; `api/oss/src/core/triggers/interfaces.py` |

## 2. Decisions

| # | Decision | Why | Owner confirmed |
|---|---|---|---|
| D1 | One email per automation. A connection gets no email of its own. | Ashraf, Slack. G9: nothing detects a broken connection. | yes |
| D2 | Recipients: the creator, else the project's `owner` and `admin` members, else the organization owner. Each must have `view_triggers` in the project. | Ashraf, Slack. G33, G37: `view_triggers` is who can see an automation. | yes (chain); the permission check is a design addition |
| D3 | No reminders and no "fixed" email. After a fix, the next failure sends one new email. | v0 R4, R6; v1. | yes |
| D4 | A `500` sends an email on the first one. | G6: no retry exists, so the first `500` is the final result of that fire. | **no** |
| D5 | `409` sends no email. | G9: only a person's revoke causes it, and the revoke turns the provider trigger off. | **no** |
| D6 | `403` and `422` send an email. | G3: a `403` pauses the automation for good. G4: a `422` skips every fire until someone fixes the model. | **no** |
| D7 | A run that waits for a person sends no email. The screen shows it as waiting. | v1 lists failures only. v0 A4 had an email for it. | **no** |
| D8 | An agent archived by a person (G14) sends no email. | A person did it, and it writes no trigger delivery. | **no** |
| D9 | The switch defaults to on. The release notes and the self-hosting docs name `AGENTA_NOTIFICATIONS_EMAIL_ENABLED`. | v1: "Self-hosters can turn emails off". This replaces v0 R9 (default off). A self-hoster who set up SMTP for invitations starts to send automation emails after the upgrade. | **no** |
| D10 | The email does not name the agent. | G37: a private agent's name would reach admins who cannot see the agent. v1 listed the agent. | **no** |
| D11 | Two polling passes, not hooks: one settles trigger deliveries, one sends notification deliveries. | G20, G21: a `turn_ended` event can come long before a late `error`. G11, G24: some runs never send an event. A send can take 30 s, so 100 sends would hold up settling if both ran in one pass. | design |
| D12 | The outcome goes in `data.outcome` and `data.reason_code`, not in new columns. | No `ALTER TABLE` on a table the workers write all the time. G7: a re-claim replaces `data`. G8: the merge keeps it on a status change, so the screen reads `outcome` only on a `202` (section 9). | design |
| D13 | No failure count, no `destination`, no `read_at`. | Nothing reads them in v1. A nullable column can be added later without failing the migration gate. | design |
| D14 | A notification is resolved by a success, and by a person's edit, start (`set_*_active(is_active=true)`), refresh or delete of the automation. A stop, a revoke, an end-time stop and a platform pause resolve nothing. | G26, G27. A stop makes no trigger deliveries, so resolving on it does nothing useful. | design |
| D15 | No shared transaction across DAOs. Each pass step is idempotent, and the order of writes makes a crash between them safe (5.3). | G49. | design |
| D16 | The notification keeps a snapshot of what the email needs (automation name, link, reason code). The send pass reads no trigger table. The `automation_failing` kind (template, reason catalog, required permission) lives in `core/triggers` and is registered with `core/notifications` in `api/entrypoints/routers.py`. | `core/notifications` then knows no automation word and imports nothing from `core/triggers`. `view_triggers` is declared once. | design |
| D17 | A failure opens a notification only if it ended less than 1 hour before the pass. A `202` row settles at its first final `done`. | Without it, the first pass after the deploy emails about every failure of the last 24 hours, also failures already fixed by an edit. It also stops old failures from emailing after the passes were down for a long time. Whether a continuation after an approval reuses the `turn_id` is not settled here, so the rules do not depend on it. | design |
| D18 | The send pass takes at most 10 notification deliveries per project per pass. | One project with thousands of failing automations would otherwise delay every other project's email. It drops no email. | design |
| D19 | `resolved_at` is the time from which the automation counts as fixed: the start (`created_at`) of the successful run, or the time of the person's action. | A4 compares a failure's start with it. With the settle time instead, a failure that started after a success but settled after it would be dropped. | design |


## 3. Architecture

```text
              API lifespan (each pass on one replica, Redis lease)
┌──────────────────────────────────────┐   ┌──────────────────────────────────┐
│ trigger outcome pass (60 s)          │   │ notification send pass (60 s)    │
│ core/triggers/outcomes.py            │   │ core/notifications/service.py    │
│ core/triggers/failure_notifications.py   │   send_pending()                 │
│                                      │   │                                  │
│ trigger_deliveries (core) ─┐         │   │ notification_deliveries          │
│ records (tracing) ─────────┼► settle │   │   state = pending                │
│                            ▼         │   │        │ registered kind:         │
│   open / resolve ─► notifications ───┼──►│        ▼ template, permission    │
└──────────────────────────────────────┘   │ email ─► SMTP or SendGrid        │
        ▲ resolve on user actions          └──────────────────────────────────┘
        │ TriggersService: edit, start, refresh, delete
```

| Layer | New code |
|---|---|
| Core, notifications | `api/oss/src/core/notifications/`: `dtos.py`, `interfaces.py` (`NotificationsDAOInterface`, `NotificationKind`), `service.py` (`open`, `resolve`, `send_pending` with the skip checks, render, send and state writes) |
| Core, triggers | `api/oss/src/core/triggers/outcomes.py` (settle table O1 to O10); `api/oss/src/core/triggers/failure_notifications.py` (rules A0 to A4, recipients, and the `automation_failing` kind: reason catalog, template, `view_triggers`) |
| Core, users | `api/oss/src/core/users/interfaces.py`: `UsersDAOInterface.fetch_emails(user_ids)` |
| Other interfaces | `RecordsDAOInterface.turn_endings`; `TriggersDAOInterface.query_unsettled_deliveries` and `settle_delivery`; `MembershipsService.fetch_organization_owner_id` |
| DB | `api/oss/src/dbs/postgres/notifications/` (`dbes.py`, `dao.py`, `mappings.py`); the DAO methods above, in their domains' DAOs |
| Tasks | `api/oss/src/tasks/asyncio/triggers/outcome_pass.py` (`outcome_pass_loop`); `api/oss/src/tasks/asyncio/notifications/send_pass.py` (`send_pass_loop`). Each holds only the loop and the lease. |
| Wiring | `api/entrypoints/routers.py`: build `NotificationsService`, register the `automation_failing` kind, pass the service to `TriggersService` (G31), start both loops |

Dependency direction: `core/triggers` → `core/notifications` → `core/access`, `core/users`.
`core/notifications` imports nothing from `core/triggers`. Core code uses DAO interfaces only.

## 4. Data

### 4.1 `notifications`

| Column | Type | Meaning |
|---|---|---|
| `project_id` | `UUID` not null | FK `projects.id` `ON DELETE CASCADE` |
| `id` | `UUID` not null | |
| `kind` | `VARCHAR` not null | `automation_failing` in v1 |
| `dedup_key` | `VARCHAR` not null | `automation:<automation_id>` |
| `state` | `VARCHAR` not null | `open` or `resolved` |
| `data` | `JSONB` not null | for `automation_failing`: `automation_id`, `automation_name`, `trigger_delivery_id`, `failed_at`, `reason_code`, `link` |
| `resolved_at` | `TIMESTAMPTZ` null | the time from which the automation counts as fixed (D19) |
| lifecycle | | `created_at` (default `CURRENT_TIMESTAMP`), `updated_at`, `deleted_at`, `created_by_id`, `updated_by_id`, `deleted_by_id` |

Primary key `(project_id, id)` (G48). Indexes:

- `uq_notifications_project_id_dedup_key_open`: unique `(project_id, dedup_key)` `WHERE state = 'open'`.
  One open notification per automation, also when two passes race.
- `ix_notifications_project_id_dedup_key_resolved_at`: `(project_id, dedup_key, resolved_at)`, for
  rule A4.

`state` names the lifecycle like `session_commands.state`. `resolved_at` is set if and only if
`state = 'resolved'`, and one DAO method writes both.

### 4.2 `notification_deliveries`

| Column | Type | Meaning |
|---|---|---|
| `project_id` | `UUID` not null | FK `projects.id` `ON DELETE CASCADE` |
| `id` | `UUID` not null | |
| `notification_id` | `UUID` not null | read with `project_id`; no FK, by the table rule below |
| `user_id` | `UUID` not null | the recipient |
| `channel` | `VARCHAR` not null | `email` in v1 |
| `state` | `VARCHAR` not null | `pending`, `sent`, `failed`, `skipped` |
| `attempt_count` | `INTEGER` not null default 0 | failed send attempts |
| `sent_at` | `TIMESTAMPTZ` null | |
| lifecycle | | as above |

Primary key `(project_id, id)`. Indexes: `uq_notification_deliveries_notification_id_user_id_channel`;
`ix_notification_deliveries_state_created_at` on `(state, created_at)` `WHERE state = 'pending'`.

Table rules (`docs/designs/oss-ee-convergence/migration-chains-and-edition-switch.md`, rules 1 and 4):
the six lifecycle columns, one hard FK at the owning scope (`projects.id`), and no other FK. The
tables hold ids, the automation name and the reason code. They hold no email address.

### 4.3 `trigger_deliveries`

No new column. `TriggerDeliveryData` gets `outcome` and `reason_code` (both optional).

New index `ix_trigger_deliveries_unsettled_created_at_id` on `(created_at, id)`
`WHERE (data->>'outcome') IS NULL AND (status->>'code') IN ('202','400','403','422','500')`.
`data` is `JSON` and `status` is `JSONB` (G13). Both expressions are immutable, so the partial index
is valid. A settled row leaves the index. Rows from before the deploy and `202` rows that never end
stay in it, so it is about as large as a plain `created_at` index. The candidate queries read only
the last 24 hours of it. `TriggerDeliveryDBE.__table_args__` declares the same index.

Postgres uses a partial index only when the query's condition matches the index condition. The DAO
writes the outcome and status conditions as literal SQL text, not as bind parameters, so a prepared
statement keeps the match.

### 4.4 Migrations

Two revisions in `api/oss/databases/postgres/migrations/core_oss/versions/`, after `oss000000062`:

1. Create both tables and their indexes in one transaction. It touches no existing table.
2. `CREATE INDEX CONCURRENTLY ix_trigger_deliveries_unsettled_created_at_id` inside
   `op.get_context().autocommit_block()`, as
   `oss000000012_add_gateway_connections_provider_account_index.py` does. If an earlier build
   failed and left an invalid index, drop it first. Downgrade: `DROP INDEX CONCURRENTLY IF EXISTS`.

Both pass the migration gate: revision 1 creates new tables only, and revision 2 is a concurrent
index. Old code ignores the new tables and the new `data` keys, so a rollout in either direction is
safe.

## 5. Trigger outcome pass

Every 60 s under the lease `locks:triggers:outcome-pass` (TTL 300 s, renewed after each page), with
`acquire_lock`, `renew_lock` and `release_lock` (G45). If renewal fails, the pass stops. It runs
whether email is on or off.

### 5.1 Candidates

Two queries per pass, each in pages of 500, each with at most 20 pages:

1. **Start-time rows** (`400`, `403`, `422`, `500`), oldest first. They settle at once, so they never
   pile up.
2. **Run rows** (`202`), newest first. A run that is still going is read again on every pass. Newest
   first keeps a backlog of running or lost runs from holding back the runs that just ended.

```sql
SELECT project_id, id, schedule_id, subscription_id, status, data, created_at, updated_at
FROM trigger_deliveries
WHERE (data->>'outcome') IS NULL
  AND (status->>'code') IN ('202','400','403','422','500')
  AND (status->>'code') = '202'            -- query 2; query 1 uses <> '202'
  AND created_at > now() - interval '24 hours'
ORDER BY created_at DESC, id DESC          -- query 1: ASC
LIMIT 500;
```

For run rows, `RecordsDAOInterface.turn_endings(project_id, keys)` reads the run endings, one query
per project, with keys `(data.session_id, data.result.run_id)` (G16). Per key it returns the newest
`done` by `created_at` (its `attributes.stopReason` and `created_at`), and the `attributes.code` of
the newest `error` record. It skips deleted and quarantined records, and it keeps watchdog endings
(G22).

### 5.2 Settle table

The first matching row wins. "Ended at" is the time rule A0 uses.

| # | Status | Condition | `outcome` | `reason_code` | Ended at |
|---|---|---|---|---|---|
| O1 | `400` | | `failed` | `bad_configuration` | `coalesce(updated_at, created_at)` |
| O2 | `403` | | `failed` | `paused_` + `data.error_details.code` (`paused_missing_principal`, `paused_agent_deleted`, `paused_access_denied`) | `coalesce(updated_at, created_at)` |
| O3 | `422` | | `skipped` | `agent_needs_setup` | `coalesce(updated_at, created_at)` |
| O4 | `500` | | `failed` | `start_failed` | `coalesce(updated_at, created_at)` |
| O5 | `202` | no `done` | wait | | |
| O6 | `202` | the newest `done` was stored less than 5 minutes ago | wait | | |
| O7 | `202` | `stopReason = paused` | `waiting` | | `done.created_at` |
| O8 | `202` | `stopReason = cancelled` | `cancelled` | | `done.created_at` |
| O9 | `202` | `stopReason = error`, or an `error` record exists | `failed` | the newest `error` code, else `runner_error` | `done.created_at` |
| O10 | `202` | otherwise | `completed` | | `done.created_at` |

O1 to O4 use the time of the status write, because a start can take long (G11) and the settle write
does not change `updated_at`. O6 waits 5 minutes because a records batch that fails is claimed again
after 30 s (G20). The 5 minutes cover a short database problem, not a long one (known limit 5). O7
and O8 come before O9 because the runner writes those stop reasons on purpose (G17). O9 covers the
plain `done` after an `error` (G18, G19). A run row settles once, at its first final `done`.
Anything written for the same turn later is not followed (known limit 6). A run row without `done`
after 24 hours leaves the window unsettled. The 24 hours are longer than the default hard deadline
(G23).

The settle write is guarded. A changed row is left for the next pass:

```sql
UPDATE trigger_deliveries
SET data = (coalesce(data::jsonb, '{}'::jsonb) || CAST(:settled AS jsonb))::json
WHERE project_id = :project_id AND id = :id
  AND (status->>'code') = :status_code_read
  AND (data->>'outcome') IS NULL;
```

### 5.3 Apply

For each settled trigger delivery `D`. `A` is `D`'s automation, read by `project_id` and id, with
deleted rows. Every read and write filters by `D.project_id`. The steps run in this order, and each
one is idempotent (D15):

1. Apply the rules below.
2. Write the guarded settle (5.2).

If the process dies between 1 and 2, the next pass settles `D` again and the rules find the
notification already open or already resolved. Two passes that apply the same `D` (a lease that
expired during a pass) also open at most one notification. Only a `500` row can change status
between the read and the write (G7, G8). Its notification is still right: that start did fail.

| # | Rule |
|---|---|
| A0 | `D` ended (5.2) more than 1 hour before now: settle only (D17). |
| A1 | `D.outcome` is `cancelled` or `waiting`: settle only. |
| A2 | `A` is missing or deleted: settle only (G15, G28). |
| A3 | `D.outcome` is `completed`: resolve the open notification of `automation:<A.id>`, with `resolved_at = D.created_at`, if its `data.failed_at` is earlier than `D.created_at`. |
| A4 | `D.outcome` is `failed` or `skipped`: open a notification for `automation:<A.id>`, unless one is open; or one for that key has `resolved_at` later than `D.created_at`; or `A` has a trigger delivery settled `completed` whose `created_at` is later than `D.created_at`. |

All comparisons use start times (`created_at`):

- A3: a run that started before the failure and succeeded after it does not resolve the
  notification. Without this, a long run that started before a `422` would resolve it, and the
  next `422` would send a second email.
- A4, `resolved_at`: a run that started before a fix and failed after it opens nothing.
- A4, completed delivery: a run that started before a newer successful run and failed after it
  opens nothing. The automation already works.

The completed-delivery check reads `trigger_deliveries` by `(project_id, subscription_id)` or
`(project_id, schedule_id)` and `created_at > D.created_at`, through the existing indexes (G12) and
the 24-hour window.

Open:

```sql
INSERT INTO notifications (project_id, id, kind, dedup_key, state, data, created_at)
SELECT :project_id, :id, 'automation_failing', :key, 'open', CAST(:data AS jsonb), now()
WHERE NOT EXISTS (
  SELECT 1 FROM notifications
  WHERE project_id = :project_id AND dedup_key = :key AND resolved_at > :failed_at)
ON CONFLICT (project_id, dedup_key) WHERE state = 'open' DO NOTHING
RETURNING id;
```

The completed-delivery check runs before the insert. The recipients (section 6) are chosen before
the insert, and only when no notification is open for the key. If a row is returned, the same DAO
method inserts one `pending` email notification delivery per recipient, in the same database
transaction. Both tables belong to the notifications DAO, so no transaction crosses DAOs (D15).

Resolve: `state = 'resolved'` and `resolved_at` (D19). Pending notification deliveries are not
touched: the send pass skips them (7.1).

### 5.4 Resolve on user actions

These `TriggersService` methods resolve the notification of `automation:<id>`, with
`resolved_at = now()`, after a successful write: `edit_subscription`, `edit_schedule`,
`refresh_subscription`, `delete_subscription`, `delete_schedule`, and `set_subscription_active` and
`set_schedule_active` when `is_active` is true. `refresh_schedules` only stops schedules (G27), so it
resolves nothing and needs no flag. A resolve failure is logged with ids only and never fails the
user's request.

## 6. Recipients

Chosen when the notification opens, in this order. The first step that gives at least one user
wins. Every candidate must pass `AccessService.check_human(user_id, project_id, view_triggers)`
(G32, G33), which also decides membership.

1. `A.created_by_id`.
2. The members from `MembershipsService.query_project_members(project_id)` with role `owner` or
   `admin`, all pages (G34). In OSS these are the organization's owners and admins.
3. The organization owner, from a new `MembershipsService.fetch_organization_owner_id(organization_id)`,
   with `organization_id` from `AccessService.project_organization_id` (G35, G38).

No step reads `project_members` directly. With no recipient, the notification opens with no
notification delivery, and a warning with ids only is logged.

## 7. Email

### 7.1 Send pass

`NotificationsService.send_pending`, every 60 s under the lease `locks:notifications:send-pass`.

1. Read up to 100 `pending` notification deliveries, oldest first, at most 10 per project (D18),
   each joined with its notification on `(project_id, notification_id)`.
2. Mark a notification delivery `skipped` when:
   - the email switch is off or no provider is set up (G43);
   - its notification is resolved;
   - `check_human` no longer allows the kind's required permission (the user left, lost the role,
     or was deleted);
   - `UsersDAOInterface.fetch_emails` returns no email for the user (G36).
3. Render the kind's template from `notifications.data` and the email.
4. Send with `send_rendered_email` (7.2).
5. Success: `state = 'sent'`, `sent_at = now()`, guarded by `state = 'pending'`.
6. Failure: `attempt_count + 1`. At 5 attempts, `state = 'failed'`. Logs carry the notification id,
   the notification delivery id, the user id and the exception type. They carry no email address,
   subject or exception message (`api/AGENTS.md`: logs carry ids and kinds only).

Sends run outside any transaction. If the process dies after a send and before its write, the next
pass sends again (known limit 7).

### 7.2 Sender

`emailing.py` gets `send_rendered_email(to_email, subject, html, text)`:

- SMTP: `EmailMessage` with `set_content(text)` and `add_alternative(html, subtype="html")`,
  `timeout=30` on the connection.
- SendGrid: `Mail(plain_text_content=text, html_content=html)`, sent with
  `client.client.mail.send.post(request_body=mail.get(), timeout=30)` (G41).
- It raises when no provider is set up and when the SendGrid client cannot be built (G39).
- It does not reuse `_send_smtp_email` and `_send_sendgrid_email`, because they call
  `log.exception`, and an SMTP error can hold the recipient's address.

`send_email` keeps its template and its no-op `True` with no provider. The provider call runs in a
thread. The client timeout, not `asyncio.wait_for`, ends a hung call (G42).

### 7.3 Content

```text
Subject: Your automation "{automation_name}" is failing

Your automation "{automation_name}" is failing.

Failing since: {failed_at, UTC}
What happened: {reason}
What to do: {action}

[Open automation]  {link}

You will not get another email about this until it is fixed.
```

- `automation_name`: every character in the Unicode categories Cc, Cf, Zl and Zp becomes a space,
  runs of spaces become one, and the result is cut to 80 characters. An empty name becomes
  "Untitled automation". The subject is built from this value only, so it has no line break and no
  direction override.
- `link`: `{AGENTA_WEB_URL}/m/w/{organization_id}/p/{project_id}/automations/{automation_id}` (G46).
- Every value is HTML-escaped in the HTML part.
- The raw error text (`data.error`) is never sent.

### 7.4 Reason catalog

Part of the `automation_failing` kind in `core/triggers/failure_notifications.py`.

| `reason_code` | What happened | What to do |
|---|---|---|
| `bad_configuration` | The automation could not prepare the run. Its agent or its inputs are not set correctly. | Open the automation and check its agent and inputs. |
| `paused_missing_principal` | The automation was paused because it has no owner to run as. | Open the automation, save it, then turn it on. |
| `paused_agent_deleted` | The automation was paused because its agent was deleted. | Choose another agent, then turn the automation on. |
| `paused_access_denied` | The automation was paused because its owner can no longer run the agent. | Check who can use the agent, then turn the automation on. |
| `agent_needs_setup` | The agent's model needs setup, so runs are skipped. | Set up the agent's model. The next run starts as usual. |
| `start_failed` | Agenta could not start the run. | Nothing to change. If it keeps failing, contact support. |
| `execution_lost`, `sandbox_gone` | The agent stopped responding and the run ended. | Nothing to change. If it keeps failing, contact support. |
| `starter_credits_exhausted`, `starter_credits_program_paused`, `wallet_balance_exhausted` | The run stopped because there are no credits left. | Add credits or add your own model key. |
| `rate_limited` | The model provider refused the request because of a rate or quota limit. | Check your limits with the model provider. |
| `run_total_time_limit`, `run_idle_time_limit`, `run_first_response_time_limit`, `turn_time_limit_reached`, `tool_call_time_limit` | The run took longer than its time limit. | Open the automation to see the run. |
| any other code, `access_denied` from a run included (G25) | The agent's run ended with an error. | Open the automation to see the run and its error. |

The runner codes come from `services/runner/src/engines/sandbox_agent/errors.ts`. The `paused_`
prefix keeps the dispatcher's `access_denied` apart from the runner's (G25).

## 8. Config

`NotificationsConfig` in `env.py` as `env.agenta.notifications`, in alphabetical order in
`AgentaConfig` (G44):

| Setting | Env variable | Default |
|---|---|---|
| `email_enabled` | `AGENTA_NOTIFICATIONS_EMAIL_ENABLED` | `true` |

The send pass reads it on each pass. Turning it off also skips notification deliveries that are
already pending. A notification that opened while email was off stays open with only skipped
notification deliveries. Turning email on does not send it. The next email comes after the
automation is fixed and fails again.

## 9. Automations screen

`deliveryOutcome` in `web/packages/agenta-automation-ui/src/automationModel.ts`: for a trigger
delivery with `status.code` `202` and a `data.outcome`, `completed` is `ok`, `failed` is `bad`,
`cancelled` is a new `cancelled` state, and `waiting` is a new `waiting` state. Every other trigger
delivery keeps today's `status.message` rule (G47), because a merged `data` can carry an old outcome
(G8). The types come from the regenerated Fern client.

## 10. Known limits

1. **A failure from before a fix can still email if nothing was open and no success is recorded.**
   A4 drops a failure older than the last resolve or the newest completed run. An edit with
   nothing open records nothing.
2. **The pass sees a failure before an older run's success.** The email is sent. The success then
   resolves the notification only if it started after the failure (A3).
3. **A `500` that later runs.** A repeated event can re-claim a `500` (G7). The email was already
   sent. The row gets a new id, so `trigger_delivery_id` in the notification points to an id that no
   longer exists. The new run keeps the old `created_at`.
4. **Runs that never end** (G24) or stay at `102` (G11) are not reported.
5. **An `error` record later than 5 minutes** after its `done` reads as a success (G20).
6. **Records after the first final `done` are not followed**, for example the run after an
   approval if it reuses the turn, or a second `done` written by the watchdog.
7. **A crash between a send and its write** sends the email twice.
8. **An automation removed by a connection delete** (G15) keeps its notification open. A pending
   email can still be sent, with a link to a missing page.
9. **Flapping.** An automation that fails and succeeds in turns sends one email per cycle. The send
   pass sends at most 100 emails per minute in total, and at most 10 per project.
10. **Retention.** Nothing deletes old notifications.
11. **Email off, then on.** A notification opened while email was off is not sent later (section 8).

## 11. Separate bugs, out of this change

| Bug | Fact |
|---|---|
| `retry_on_error=True` has no effect on any taskiq worker: no retry middleware is registered. | G6 |
| Nothing sweeps trigger deliveries stuck at `102`; the detached start has no read timeout. | G11 |
| Edits do not set `updated_at` on automations. | G30 |
| `query_project_members` returns deleted users. | G34 |
