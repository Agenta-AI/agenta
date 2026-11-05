# Design: automation failure emails

## Context

This design keeps the product decisions of the plan agreed in Slack (v1) and corrects them against
the code. It replaces the v0 plan on branch `docs/automation-failure-alerts-plan`. Every fact in
section 1 was read on `main` at commit `d1c6dd2e6` (release v0.128.6). Section 2 lists the decisions
and marks the ones the owner has not confirmed. [review-loop.md](review-loop.md) keeps the history of
every review round and cut. Rule and row numbers were made consecutive in the clean rewrite of
2026-11-05; decision and fact ids were kept, so some numbers are missing.

## Naming

"Automation" is the product word for a trigger schedule or a trigger subscription. It is used in the
notification layer and the UI. The trigger layer keeps its own names.

| Concept | Database | DTO / code | JSON | UI |
|---|---|---|---|---|
| automation | `trigger_schedules`, `trigger_subscriptions` | `TriggerSchedule`, `TriggerSubscription` | `automation_id` in `notifications.data` | automation |
| trigger delivery | `trigger_deliveries` | `TriggerDelivery` | | run |
| settled result | `trigger_deliveries.data.outcome` | `TriggerDeliveryData.outcome` | `completed`, `failed`, `cancelled`, `waiting`, `skipped` | worked, failed, cancelled, waiting for a person, skipped |
| reason | `trigger_deliveries.data.reason_code`, `notifications.data.reason_code` | `reason_code` | | the "What happened" line |
| notification | `notifications` | `Notification` | | (email) |
| open or resolved | `notifications.state` | `NotificationState` (`open`, `resolved`) | | |
| notification delivery | `notification_deliveries` | `NotificationDelivery` | | |
| delivery state | `notification_deliveries.state` | `NotificationDeliveryState` (`created`, `sent`, `failed`, `skipped`) | | |
| delivery channel | `notification_deliveries.channel` | `channel` | `email` | |
| deduplication key | `notifications.dedup_key` | `dedup_key` | `automation:<automation_id>` | |

- `completed` follows `RunnerEnding` (`api/oss/src/core/sessions/records/dtos.py:34`).
- The delivery states follow `ChannelDeliveryState` (`api/oss/src/core/channels/dtos.py:102-113`): a
  row is `created` before the send is tried. They add `skipped`.
- **Avoid:** reading `notification_deliveries.channel` as a `core/channels` connection. Here a
  channel is only a way to reach a person.
- Verbs: a pass **settles** a trigger delivery. A notification is **opened** and **resolved**.
- `waiting` replaces the runner's `stopReason` `paused` in the settle table (O8, O9). The trigger
  layer already uses "paused" for an automation that is turned off.

## 1. Facts

### Trigger deliveries

| Id | Fact | Source |
|---|---|---|
| G1 | A successful detached start writes `202 dispatched` with `data.result.run_id` and `data.session_id`. Nothing updates the trigger delivery later. | `api/oss/src/tasks/asyncio/triggers/dispatcher.py:492-494`, `:533-537`; `api/entrypoints/worker_queues.py:285-291` |
| G2 | A build or reference failure writes `400 failed`. | `dispatcher.py:479-489` |
| G3 | `missing_principal`, `agent_deleted` and `access_denied` write `403 failed` with `data.error_details.code`, through `refuse_delivery`, which also pauses the automation (`flags.is_active=false`). A paused automation writes no more trigger deliveries. | `dispatcher.py:316`, `:403`, `:437`, `:651-685`; `api/oss/src/dbs/postgres/triggers/dao.py:69-88`, `:562-620`; `api/oss/src/tasks/taskiq/triggers/worker.py:124-129` |
| G4 | A model that needs setup writes `422 skipped`. The automation stays on, so each fire writes another `422`. | `dispatcher.py:62-63`, `:620-640` |
| G5 | A failed start writes `500 failed` and raises. | `dispatcher.py:519-531` |
| G6 | No retry happens after a `500`: `max_retries=5` is set, but no retry middleware is registered (taskiq 0.12.4 reads `retry_on_error` only in its retry middlewares). | `api/oss/src/tasks/taskiq/triggers/worker.py:36-40`; `api/oss/src/tasks/taskiq/shared/broker.py:94-99`; `api/uv.lock` |
| G7 | A repeated event can claim a `500` row again. The claim gives the row a new `id` and replaces `status` and `data`. It keeps `created_at`. | `api/oss/src/dbs/postgres/sessions/streams/dao.py:318-339` |
| G8 | `update_delivery` (`:672-695`) and the upsert in `write_subscription_delivery_if_live` (`:533-551`) merge new `data` into the old one. The upsert has no status guard, so a repeated event for a `500` row can turn it into `409` or `200` and keep its old `data` keys. | `api/oss/src/dbs/postgres/triggers/dao.py`; `dedup_seen` at `:881-903` |
| G9 | An invalid subscription writes `409 failed`. Only `revoke_subscription` sets `is_valid=false`, and it turns the provider trigger off. Revoking a connection changes only the connection row. | `dispatcher.py:219-238`; `api/oss/src/core/triggers/service.py:1393-1413`, `:1607-1640`; `api/oss/src/core/gateway/connections/service.py:267-299` |
| G9a | The Composio adapter can read a connection's provider status (`get_connection_status`), but only a person's refresh calls it. An expired provider login is not noticed, and an event subscription on it stops getting events with no trigger delivery. | `api/oss/src/core/gateway/connections/providers/composio/adapter.py:316-333`; `api/oss/src/core/gateway/connections/service.py:301-384` |
| G10 | A test subscription writes `200 success` with `data.is_test=true` and runs nothing. | `dispatcher.py:181-215` |
| G11 | Nothing sweeps a trigger delivery stuck at `102 claimed`. The detached start has no read timeout. | `api/oss/src/core/workflows/service.py:1059` |
| G12 | No index on `trigger_deliveries` starts with `created_at`. | `api/oss/src/dbs/postgres/triggers/dbes.py:107-134` |
| G13 | `data` is `JSON` and `status` is `JSONB`. `TriggerDeliveryData` has `session_id`, `result`, `error`, `error_details`. | `api/oss/src/dbs/postgres/shared/dbas.py:195-208`; `api/oss/src/core/triggers/dtos.py:382-401` |
| G14 | When an agent is archived, its automations are paused with no trigger delivery. | `api/oss/src/core/workflows/service.py:1896`; `api/oss/src/dbs/postgres/triggers/dao.py:642` |
| G15 | Deleting a connection is a hard `DELETE`, from the triggers router or the tools router. The cascade removes its subscriptions and their trigger deliveries. | `api/oss/src/dbs/postgres/gateway/connections/dao.py:238-257`; `api/oss/src/dbs/postgres/triggers/dbes.py:24-29`; `api/oss/src/apis/fastapi/triggers/router.py:623-636`; `api/oss/src/apis/fastapi/tools/router.py:526` |

### Run endings

| Id | Fact | Source |
|---|---|---|
| G16 | `data.result.run_id` is the run's turn id, and `data.session_id` its session id. The dispatcher sets no `on_busy`, so the SDK keeps the run id. | `api/oss/src/core/workflows/service.py:3987-3992`; `sdks/python/agenta/sdk/agents/handler.py:683`; `sdks/python/agenta/sdk/decorators/routing.py:256`, `:299-303`; `services/runner/src/server.ts:305-307` |
| G17 | Only a `done` record ends a turn. `done.attributes.stopReason` is `paused`, `cancelled`, `error`, or absent. An `error` record has its code in `attributes.code`, which can be missing. | `api/oss/src/core/sessions/records/dtos.py:18`; `services/runner/src/tracing/otel.ts:2627-2634`; `api/oss/src/tasks/asyncio/sessions/orphan_sweep.py:178-183` |
| G18 | **Runner bug.** When a run fails before the agent loop (an acquire failure, a sandbox that cannot be created), the runner's fallback writes an `error` record and then a `done` with no `stopReason`, because `persistTerminal` keeps only `cancelled`. The ingest route reads that `done` as `completed`. | `services/runner/src/server.ts:1145-1153`, `:1215-1226`, `:1316-1323`; `api/oss/src/core/sessions/records/dtos.py:37-41` |
| G19 | When a runner dies, the watchdog writes `error` (`execution_lost`) and a `done`, and settles the execution `lost`. A user Stop settles it `stopped`. | `orphan_sweep.py:107`, `:144-230`, `:640-684` |
| G20 | A records batch that fails is claimed again after 30 s and retried with no end, while later batches commit. So an `error` record can be stored long after its turn ended. | `api/oss/src/tasks/asyncio/sessions/records_worker.py:316-317`, `:459-530`; `api/oss/src/tasks/asyncio/shared/consumer.py:222-299`; `api/oss/src/utils/env.py:664-678` |
| G21 | The channels outbox consumes `streams:sessions`. The shared consumer deletes an entry before it acknowledges it, so a second consumer group on that stream would lose entries. | `api/entrypoints/worker_streams.py:102`, `:243-248`; `api/oss/src/tasks/asyncio/shared/consumer.py:388-398` |
| G22 | `records` is in the tracing database, with index `ix_records_project_id_session_id_turn_id`. | `api/oss/src/dbs/postgres/sessions/records/dao.py:32-40`; `api/oss/src/dbs/postgres/sessions/records/dbes.py:47-52` |
| G23 | The runner's hard deadline ends a run after 11 hours 30 minutes by default. | `services/runner/src/engines/sandbox_agent/run-limits.ts:43`; `services/runner/src/sessions/turn-settle.ts:42` |
| G24 | An abandoned turn writes `error` (`execution_lost`) and no `done`. | `services/runner/src/server.ts:1252-1268` |
| G24a | After the watchdog ends a turn, later records of that turn are quarantined and hidden from reads. | `api/oss/src/core/sessions/records/service.py:62-78`; `api/oss/src/dbs/postgres/sessions/records/dao.py:219-226` |
| G24b | `paused` and `cancelled` settle no execution: a paused turn stays continuable. | `api/oss/src/core/sessions/records/dtos.py:30-41` |
| G24c | `session_executions` (core database) keeps each turn's `terminal_outcome` (`completed`, `failed`, `lost`, `stopped`, `continued` when an approval is answered, `not_running` when a Stop finds the turn gone), an `error` JSON and `settled_at`, keyed by `(project_id, session_id, execution_id)` with `execution_id` = the turn id. The runner sends every record through `POST /sessions/records/ingest`, which settles the execution for each `done` with an ending before the record reaches the records stream, and creates the row if it is missing. So a trigger's first turn gets a row. `SessionExecutionsDAOInterface.query_settled(project_id, keys)` reads settled rows. | `api/oss/src/dbs/postgres/sessions/executions/dbes.py:16-60`; `api/oss/src/apis/fastapi/sessions/router.py:1601-1616`; `api/oss/src/core/sessions/commands/service.py:856`, `:1005-1016`, `:1982-2012`, `:2499`; `api/oss/src/dbs/postgres/sessions/executions/dao.py:67-98`, `:183-258`; `services/runner/src/sessions/persist.ts:150`; `api/entrypoints/routers.py:1401`, `:1743` |
| G24d | The channels outbox already reads `session_executions.terminal_outcome` to learn how a turn ended. | `api/oss/src/tasks/asyncio/channels/outbox.py:72-73`, `:846-865` |
| G25 | The runner also emits `access_denied` as a run error. That automation is not paused. | `services/runner/src/engines/sandbox_agent/errors.ts:111` |

### Automations

| Id | Fact | Source |
|---|---|---|
| G26 | User actions, each from a route: `edit_subscription` (`:1148`), `delete_subscription` (`:1270`), `refresh_subscription` (`:1377`), `revoke_subscription` (`:1393`), `set_subscription_active` (`:1442`), `edit_schedule` (`:1824`), `delete_schedule` (`:1859`), `set_schedule_active` (`:1873`). | `api/oss/src/core/triggers/service.py`; `api/oss/src/apis/fastapi/triggers/router.py:344-471` |
| G27 | `refresh_schedules` is the only internal caller of `set_schedule_active`. It stops a schedule after its `end_time`. | `service.py:1925-1973` |
| G28 | `delete_*` is a soft delete (`deleted_at`). | `api/oss/src/dbs/postgres/triggers/dao.py:256-283`, `:1030-1051` |
| G29 | An automation has `name` and `created_by_id`. | `api/oss/src/dbs/postgres/triggers/dbas.py:21`, `:50`; `api/oss/src/dbs/postgres/shared/dbas.py:93` |
| G30 | Edits do not set `updated_at` on automations. | `api/oss/src/dbs/postgres/triggers/mappings.py:101`, `:181` |
| G31 | `TriggersService` is built once in the app, and in 11 tests. | `api/entrypoints/routers.py:1084`; `api/oss/tests/` |

### Recipients and access

| Id | Fact | Source |
|---|---|---|
| G32 | `AccessService.check_human(user_id, project_id, action)` returns a `Decision` with `allowed`, and applies membership and role for a human without request access. | `api/oss/src/core/access/service.py:295-310`; `api/oss/src/core/access/dtos.py:35-36` |
| G33 | `view_triggers` is a permission. Custom roles in EE can remove it. | `api/oss/src/core/access/permissions/types.py:169` |
| G34 | `query_project_members(project_id, windowing)` returns `user_id`, `email`, `role` under the edition rule (OSS: organization members; EE: project rows). | `api/oss/src/core/memberships/service.py:333-350`; `api/oss/src/dbs/postgres/memberships/dao.py:130-148` |
| G35 | The memberships DAO already reads `organizations.owner_id`, `projects.project_name` and `users.email`, in private helpers and in the members query. | `api/oss/src/dbs/postgres/memberships/dao.py:53-62`, `:177-181`, `:210`, `:458-466` |
| G36 | Users are hard-deleted. | `api/oss/src/services/db_manager.py:1438-1444`, `:1510-1516` |
| G37 | A private agent is visible only to its owner, admins included. Automations have no sharing policy: `view_triggers` lets a member see them. | `api/oss/src/core/sharing/service.py:173` |
| G38 | A project's organization comes from `AccessService.project_organization_id`. | `dispatcher.py:642-648` |

### Email, config, cron, UI

| Id | Fact | Source |
|---|---|---|
| G39 | `send_email` always renders the invitation template. With no provider it returns `True` and sends nothing, and `_send_sendgrid_email_sync` also returns `True` when the client cannot be built. The provider call runs in a thread. | `api/oss/src/utils/emailing.py:66-117`, `:119-137`, `:186-216` |
| G40 | No plain-text part is sent. | `emailing.py:157`, `:217-222` |
| G41 | The SMTP `timeout` (`SMTP_TIMEOUT`, none by default) applies to each socket operation, not to the whole session. `python-http-client` 3.3.7 accepts `timeout` on each call (`client.mail.send.post(request_body=..., timeout=...)`), also per socket operation. | `api/oss/src/utils/env.py:2197`; `api/oss/src/utils/lazy.py:110`; `api/uv.lock` |
| G43 | "Email is set up" is `env.smtp.enabled or env.sendgrid.enabled`. | `env.py:2209-2211`, `:2226-2229` |
| G44 | `AgentaConfig` groups feature configs. No notifications config exists. `env.agenta.web_url` is `AGENTA_WEB_URL`. | `env.py:861-906`, `:866` |
| G45 | Cron calls `POST /admin/triggers/schedules/refresh` every minute from `api/oss/src/crons/triggers.txt`. Every deployment runs one cron container (compose, Railway, Helm with `strategy: Recreate`). The Dockerfiles build `/app/crontab` from `triggers-cron`, removing the user field and the `/proc` redirect from each line. `triggers.sh` finds its interval by matching `triggers\.sh` in the crontab. The API runs gunicorn with uvicorn workers and `--timeout 60`, a heartbeat check, so a request that awaits survives past 60 seconds. `acquire_lock` (`api/oss/src/utils/locking.py:78`) takes a `ttl` and returns an owner token for `release_lock`. | `api/oss/src/crons/triggers.txt:1`; `api/oss/src/crons/triggers.sh:5`, `:20-28`; `api/oss/docker/Dockerfile.gh:99`, `:113-119`; `api/ee/docker/Dockerfile.gh:98-99`; `hosting/railway/oss/template/template.json:363-365`; `hosting/kubernetes/helm/values.yaml:497-500`; `hosting/docker-compose/oss/docker-compose.gh.yml:79-88`; `api/entrypoints/uvicorn_worker.py` |
| G46 | The automation page is `/m/w/{workspace_id}/p/{project_id}/automations/{automation_id}`, where the workspace id is the organization id. | `web/mobile/src/pages/w/[workspace_id]/p/[project_id]/automations/[automation_id].tsx`; `api/AGENTS.md` |
| G47 | The screen reads `status.message`: `success`, `failed`, `skipped`, else pending. The zod schema `triggerDeliveryDataSchema` passes unknown keys through. | `web/packages/agenta-automation-ui/src/automationModel.ts:160-171`; `web/packages/agenta-entities/src/gatewayTrigger/core/types.ts:307-322` |
| G48 | The latest `core_oss` revision is `oss000000062`. Sibling delivery tables use the key `(project_id, id)`. | `api/oss/databases/postgres/migrations/core_oss/versions/`; `api/oss/src/dbs/postgres/triggers/dbes.py:107` |
| G49 | No core DAO interface takes a database session. | `api/oss/src/dbs/postgres/triggers/dao.py:562-713`; `api/oss/src/core/triggers/interfaces.py` |

## 2. Decisions

| # | Decision | Why | Owner confirmed |
|---|---|---|---|
| D1 | One email per automation. A connection gets no email of its own. | Ashraf, Slack. G9: nothing detects a broken connection. | yes |
| D2 | Recipients: the creator, else the project's owners and admins, else the organization owner. Each must have `view_triggers`. | Ashraf, Slack. G33, G37: `view_triggers` is who can see an automation. | yes (chain) |
| D3 | No reminders and no "fixed" email. After a fix, the next failure sends one new email. | v1. | yes |
| D4 | A `500` sends an email on the first one. | G6: no retry exists. D25 holds it during an outage. | **no** |
| D5 | `409` sends no email. | G9: only a person's revoke causes it, and the revoke turns the provider trigger off. | **no** |
| D6 | `403` and `422` send an email. | G3: a `403` pauses the automation for good. G4: a `422` skips every fire. | **no** |
| D7 | A run that waits for a person sends no email. The screen shows it as waiting. | v1 lists failures only. | **no** |
| D8 | An agent archived by a person (G14) sends no email. | A person did it, and it writes no trigger delivery. | **no** |
| D9 | The email switch defaults to on. The release notes and the self-hosting docs name it. | v1. | **no** |
| D10 | The email does not name the agent. | G37: a private agent's name would reach admins who cannot see it. | **no** |
| D11 | One admin route, called by cron every minute, settles trigger deliveries and then sends emails. | G45: cron is how periodic trigger work already runs. G21: a stream consumer would lose entries. G11, G24: some runs never send an event. | design |
| D12 | The result goes in `data.outcome` and `data.reason_code`, not in new columns or in `status`. | No `ALTER TABLE` on a busy table. G7: writing `500` to a `202` row would let a repeated event run the automation again. | design |
| D14 | A notification is resolved by a healthy run (D20), and by a person's edit, start, refresh or delete of the automation. | G26, G27. A stop, a revoke, an end-time stop and a platform pause make no fix. | design |
| D15 | No transaction crosses DAOs. Each step is idempotent, and the order of writes makes a crash between steps safe. | G49. | design |
| D16 | The notification keeps a snapshot of what the email needs. The `automation_failing` template and its permission live in `core/triggers` and are passed to `NotificationsService` in its constructor. | `core/notifications` imports nothing from `core/triggers`. A second kind adds a second constructor argument. | design |
| D17 | A failure opens a notification only if it ended less than 1 hour before the pass. | Without it, the first pass after the deploy emails about every failure of the last 24 hours. | design |
| D18 | At most 10 emails per project per pass, 100 in all. | One project with many failing automations would otherwise delay every other project's email. | design |
| D19 | No check against an earlier resolve when a notification opens. | Owner cut. Known limit 1. | owner |
| D20 | A run that ends `waiting` counts as healthy. | Otherwise an automation whose runs always ask for approval keeps its notification open for good. | design |
| D21 | While a notification is open, each failure updates `data.last_failed_at` (the newest start) and `data.failed_at` (the oldest start). A healthy run resolves it only if it started at or after `last_failed_at`. | A long healthy run that started before a `403` must not resolve the notification of an automation that is now paused for good. | design |
| D23 | A started run's outcome comes from `session_executions`. The tracing records are read only for a `paused` or `cancelled` turn and for a failed run's error code. | G24c: no records lag for the outcome. G24d: the channels outbox already reads it. | design |
| D25 | An outage brake on failures with a platform reason (5.4). | D4 without a brake would send "contact support" to every affected customer at once. | design |
| D26 | The email names the project: `Automation "<name>" in <project> is failing`. | Owners and admins may get the email for an automation they did not create, in one of several projects. | design |
| D28 | The runner's fallback writes `stopReason: "error"` on a real failure (task 1.1). | G18: without it, a failed acquire settles `completed`, sends no email and resolves an open notification. It also fixes every other reader of `session_executions`. | design |

## 3. Architecture

```text
 cron (triggers.txt, every minute)
   │ POST /admin/triggers/deliveries/settle   (guard lock, TTL 600 s)
   ▼
 settle_pass (≤ 30 s)                             send_pending (no new send after 45 s)
 core/triggers/outcomes.py                        core/notifications/service.py
 core/triggers/failure_notifications.py
   trigger_deliveries ─┐                            notification_deliveries (state = created)
   session_executions ─┼─► settle ─► open/resolve ─► notifications ─► email (SMTP or SendGrid)
   records (paused,    │
     cancelled, codes) ┘
   ▲ resolve on user actions: TriggersService edit, start, refresh, delete
```

| Layer | New code |
|---|---|
| Runner | `services/runner/src/server.ts`: `persistTerminal` keeps `error`; both fallback paths pass `"error"` on a real failure (D28). |
| Core, notifications | `api/oss/src/core/notifications/`: `dtos.py`, `interfaces.py` (`NotificationsDAOInterface`), `service.py` (`open`, `resolve(project_id, dedup_key, started_at=None)`, `note_failure`, `send_pending(deadline)`; the `automation_failing` template and permission come in the constructor). |
| Core, triggers | `api/oss/src/core/triggers/outcomes.py` (settle table, `settle_pass`); `api/oss/src/core/triggers/failure_notifications.py` (rules A1 to A6, the outage brake, recipients, the template with its reason catalog and link). |
| Interfaces | `SessionExecutionsDAOInterface.query_settled` (exists); `RecordsDAOInterface.turn_signals` (new); `TriggersDAOInterface.query_unsettled_deliveries` and `settle_delivery` (new); `MembershipsService.fetch_member_emails(user_ids)`, `fetch_organization_owner_id(organization_id)` and `fetch_project_name(project_id)` (new, in the memberships DAO, G35). |
| DB | `api/oss/src/dbs/postgres/notifications/` (`dbes.py`, `dao.py`, `mappings.py`). |
| API | `POST /admin/triggers/deliveries/settle` on the triggers admin router, with the admin `Access` auth. It runs `settle_pass`, then `send_pending`. |
| Cron | one more line in `api/oss/src/crons/triggers.txt` that calls the route with `curl --max-time 75`, like `triggers.sh`. No new cron file: the Dockerfiles already turn every line of `triggers.txt` into the crontab (G45). |
| Wiring | `api/entrypoints/routers.py`: build `NotificationsService` with the template and permission; pass it to `TriggersService` as an optional argument (default `None`, G31). |

Dependency direction: `core/triggers` → `core/notifications` → `core/access`, `core/memberships`.
Core code uses DAO interfaces only.

## 4. Data

### 4.1 `notifications`

| Column | Type | Meaning |
|---|---|---|
| `project_id` | `UUID` not null | FK `projects.id` `ON DELETE CASCADE` |
| `id` | `UUID` not null | |
| `kind` | `VARCHAR` not null | `automation_failing` in v1 |
| `dedup_key` | `VARCHAR` not null | `automation:<automation_id>` |
| `state` | `VARCHAR` not null | `open` or `resolved` |
| `data` | `JSONB` not null | `automation_id`, `organization_id`, `automation_name`, `project_name`, `failed_at`, `last_failed_at`, `reason_code`. Times are UTC ISO 8601 strings, compared as `timestamptz`. |
| lifecycle | | `created_at` (default `CURRENT_TIMESTAMP`), `updated_at`, `deleted_at`, `created_by_id`, `updated_by_id`, `deleted_by_id` |

Primary key `(project_id, id)` (G48). Index `uq_notifications_project_id_dedup_key_open`: unique
`(project_id, dedup_key)` `WHERE state = 'open'`. It guarantees one open notification per
automation, also when two requests race.

### 4.2 `notification_deliveries`

| Column | Type | Meaning |
|---|---|---|
| `project_id` | `UUID` not null | FK `projects.id` `ON DELETE CASCADE` |
| `id` | `UUID` not null | |
| `notification_id` | `UUID` not null | read with `project_id`; no FK |
| `user_id` | `UUID` not null | the recipient |
| `channel` | `VARCHAR` not null | `email` in v1 |
| `state` | `VARCHAR` not null | `created`, `sent`, `failed`, `skipped` |
| `attempt_count` | `INTEGER` not null default 0 | failed send attempts |
| `sent_at` | `TIMESTAMPTZ` null | |
| lifecycle | | as above |

Primary key `(project_id, id)`. Indexes: `uq_notification_deliveries_notification_id_user_id_channel`;
`ix_notification_deliveries_created_project_id_created_at` on `(project_id, created_at)`
`WHERE state = 'created'`. The tables hold no email address. They follow the table rules in
`docs/designs/oss-ee-convergence/migration-chains-and-edition-switch.md` (lifecycle columns, one FK
at the owning scope).

### 4.3 `trigger_deliveries`

No new column. `TriggerDeliveryData` gets `outcome` and `reason_code` (both optional).

New index `ix_trigger_deliveries_unsettled_created_at_id` on `(created_at, id)`
`WHERE (data->>'outcome') IS NULL AND (status->>'code') IN ('202','400','403','422','500')` (G12, G13).
A settled row leaves the index. The DAO writes these conditions as literal SQL, not bind parameters,
so a prepared statement still matches the partial index. `TriggerDeliveryDBE.__table_args__`
declares it too.

### 4.4 Migrations

Two revisions in `api/oss/databases/postgres/migrations/core_oss/versions/`, after `oss000000062`:

1. Create both tables and their indexes. It touches no existing table.
2. In `op.get_context().autocommit_block()`, as `oss000000012_add_gateway_connections_provider_account_index.py`
   does: `DROP INDEX CONCURRENTLY IF EXISTS`, then `CREATE INDEX CONCURRENTLY` (4.3). The drop
   replaces an invalid index left by an interrupted build; alembic never runs a finished revision
   again. Downgrade: `DROP INDEX CONCURRENTLY IF EXISTS`.

Both pass the migration gate. Old code ignores the new tables and `data` keys.

## 5. Settle pass

The route takes `acquire_lock(namespace="triggers", key="settle-pass", ttl=600)` and releases it with
the returned token at the end. If the lock is held, it returns at once. There is no renewal: the
lock outlasts any request, because each socket operation of a send has a 15-second timeout and no
new send starts after 45 seconds (G41). If a request crashes, the next one can run after at most 10
minutes. Settling runs whether email is on or off.

### 5.1 Candidates

Two queries, in pages of 500, with keyset paging on `(created_at, id)`, inside the last 24 hours
(longer than the hard deadline, G23):

1. **Start-time rows** (`400`, `403`, `422`, `500`), oldest first, cursor
   `(created_at, id) > (:last_created_at, :last_id)`.
2. **Run rows** (`202`, G1), newest first, cursor `(created_at, id) < (:last_created_at, :last_id)`.
   Runs still going are read again on every pass; newest first keeps them from holding back the
   runs that just ended.

```sql
SELECT project_id, id, schedule_id, subscription_id, status, data, created_at, updated_at
FROM trigger_deliveries
WHERE (data->>'outcome') IS NULL
  AND (status->>'code') IN ('202','400','403','422','500')
  AND (status->>'code') = '202'                 -- query 1: <> '202'
  AND created_at > now() - interval '24 hours'
  -- next pages: AND (created_at, id) < (:last_created_at, :last_id)
ORDER BY created_at DESC, id DESC               -- query 1: ASC
LIMIT 500;
```

For run rows, per project, with keys `(data.session_id, data.result.run_id)` (G16):

- `query_settled` (core) gives `terminal_outcome`, `error` and `settled_at` (G24c).
- Only for keys with no settled execution, or settled `failed` with no `error.code`,
  `turn_signals` (tracing, G22) gives the newest `done`'s `stopReason` (G17) and the newest `error`
  record's code. It skips deleted and quarantined records (G24a).

### 5.2 Settle table

The first matching row wins. "Ended at" is used only by A6.

| # | Status | Condition | `outcome` | `reason_code` | Ended at |
|---|---|---|---|---|---|
| O1 | `400` (G2) | | `failed` | `bad_configuration` | `coalesce(updated_at, created_at)` |
| O2 | `403` (G3) | | `failed` | `paused_` + `data.error_details.code` | `coalesce(updated_at, created_at)` |
| O3 | `422` (G4) | | `skipped` | `agent_needs_setup` | `coalesce(updated_at, created_at)` |
| O4 | `500` (G5) | | `failed` | `start_failed` | `coalesce(updated_at, created_at)` |
| O5 | `202` | execution `completed` | `completed` | | |
| O6 | `202` | execution `failed` | `failed` | the execution's `error.code`, else the newest `error` record's code, else `runner_error` | `settled_at` |
| O7 | `202` | execution `lost` (G19) | `failed` | `execution_lost` | `settled_at` |
| O8 | `202` | execution `continued` | `waiting` | | |
| O9 | `202` | no settled execution, newest `done` has `stopReason = paused` | `waiting` | | |
| O10 | `202` | any other settled value (`stopped`, `not_running`, later values), or no settled execution and newest `done` has `stopReason = cancelled` | `cancelled` | | |
| — | `202` | otherwise (still running) | not settled | | |
| — | `102`, `409`, `200` (G10) | | not settled | | |

- O1 to O4 use the time of the status write, because a start can take long (G11).
- O5 is correct only with the runner fix (D28, G18).
- A watchdog ending is `lost` (O7) and stays so: a runner that thaws later is quarantined (G24a).
- O8 is a paused turn whose approval was answered before the pass read it (D20).

The settle write is guarded, so a row that changed since it was read is left for the next pass (G7,
G8):

```sql
UPDATE trigger_deliveries
SET data = (coalesce(data::jsonb, '{}'::jsonb) || CAST(:settled AS jsonb))::json
WHERE project_id = :project_id AND id = :id
  AND (status->>'code') = :status_code_read
  AND (data->>'outcome') IS NULL;
```

### 5.3 Apply

The pass works page by page. For each page:

1. Settle every row in memory (5.2).
2. Update the outage count (5.4).
3. Group the rows by automation. For each group, apply the rules to its failed and skipped rows
   oldest first, then to its healthy rows, then write each row's guarded settle. So a failure and a
   newer success of one automation in one page open and resolve before the send step reads them.
4. Check the 30-second deadline between groups and between pages. A group not reached stays
   unsettled for the next pass.

Every read and write filters by the row's `project_id`. A crash between a rule and its settle write
is safe: the next pass settles the row again and finds the notification already open or resolved.

"Healthy" means `completed` or `waiting` (D20). For a row `D` of automation `A`:

| # | Rule |
|---|---|
| A1 | `D.outcome` is `cancelled`: nothing. |
| A2 | `D` is healthy: `resolve(project_id, automation:<A.id>, started_at=D.created_at)`, one `UPDATE ... SET state='resolved' WHERE state='open' AND (data->>'last_failed_at')::timestamptz <= :started_at` (D21). |
| A3 | `D.outcome` is `failed` or `skipped`: `note_failure`, one `UPDATE ... WHERE state='open'` that sets `last_failed_at = GREATEST(...)` and `failed_at = LEAST(...)` and returns its row count. 1 row: done. 0 rows: nothing is open, go on. |
| A4 | The outage flag is set and `D.reason_code` is a platform reason (5.4): nothing. |
| A5 | `D` ended more than 1 hour ago (D17): nothing. |
| A6 | Read `A` (its `name` and `created_by_id`, G29) with deleted rows. If it is missing or deleted (G15, G28): nothing. Else choose recipients (section 6) and open. |

Open, in one DAO transaction (both tables belong to the notifications DAO, D15):

```sql
INSERT INTO notifications (project_id, id, kind, dedup_key, state, data, created_at)
VALUES (:project_id, :id, 'automation_failing', :key, 'open', CAST(:data AS jsonb), now())
ON CONFLICT (project_id, dedup_key) WHERE state = 'open' DO NOTHING
RETURNING id;
```

If a row is returned, the same transaction inserts one `created` email delivery per recipient. If
no row is returned, another request opened it first, and this request runs `note_failure` again.

### 5.4 Outage brake

After each page is settled in memory, the pass adds to a count of distinct projects whose rows in
this pass settled `failed` with a platform reason (`start_failed`, `execution_lost`,
`sandbox_gone`) and ended less than 1 hour ago. When the count passes 10, the pass sets the Redis
flag `notifications:outage-brake` for 15 minutes and logs one error with the count. Rule A4 reads
the flag. While it is set, those failures update an open notification (A3) but open none.

### 5.5 Resolve on user actions

After a successful write, `TriggersService` calls `resolve(project_id, automation:<id>)` with no
`started_at` from `edit_subscription`, `edit_schedule`, `refresh_subscription`,
`delete_subscription`, `delete_schedule`, and `set_subscription_active` and `set_schedule_active`
when `is_active` is true. `refresh_schedules` only stops schedules (G27) and resolves nothing. A
resolve failure is logged with ids only and never fails the request.

## 6. Recipients

Chosen when the notification opens. The first step that gives at least one user wins. Every
candidate must pass `AccessService.check_human(user_id, project_id, view_triggers)` (G32, G33).

1. The automation's `created_by_id`.
2. The members from `MembershipsService.query_project_members(project_id)` with role `owner` or
   `admin`, all pages (G34).
3. The organization owner, from `MembershipsService.fetch_organization_owner_id`, with the
   organization from `AccessService.project_organization_id` (G35, G38).

No step reads `project_members` directly. With no recipient, the notification opens with no
delivery, and a warning with ids only is logged.

## 7. Email

### 7.1 Send step

After settling, the route calls `NotificationsService.send_pending(deadline)`, where the deadline is
45 seconds after the request started.

1. Read up to 100 `created` deliveries, oldest first, at most 10 per project (D18), joined with
   their notification on `(project_id, notification_id)`.
2. Mark a delivery `skipped` when the switch is off or no provider is set up (G43), its notification
   is resolved, `check_human` no longer allows `view_triggers`, or
   `MembershipsService.fetch_member_emails` returns no email (G36).
3. Start no new send after the deadline. Render the template and send with `send_rendered_email`.
4. Success: `state='sent'`, `sent_at=now()`, guarded by `state='created'`.
5. Failure, or an exception in steps 2 and 3: `attempt_count + 1`; at 5, `state='failed'`. Logs
   carry ids and the exception type only, never an address, subject or message.

### 7.2 Sender

`emailing.py` gets `send_rendered_email(to_email, subject, html, text)`, which adds the plain-text part that today's code lacks (G40):

- SMTP: `EmailMessage` with `set_content(text)` and `add_alternative(html, subtype="html")`, the
  sender from `_get_sender_email`, and `timeout=env.smtp.timeout or 15` per socket operation (G41).
- SendGrid: `Mail(plain_text_content=text, html_content=html)`, sent with
  `client.client.mail.send.post(request_body=mail.get(), timeout=15)`.
- It raises when no provider is set up and when the SendGrid client cannot be built (G39).
- It does not reuse `_send_smtp_email` and `_send_sendgrid_email`, which call `log.exception`, and
  an SMTP error can hold the recipient's address.

`send_email` keeps its template and its behavior.

### 7.3 Content

```text
Subject: Automation "{automation_name}" in {project_name} is failing

The automation "{automation_name}" in the project "{project_name}" is failing.

Failing since: {failed_at, UTC}
What happened: {reason}
What to do: {action}

[Open automation]  {link}

You will not get another email about this until it is fixed.
```

- `automation_name` and `project_name` (from `MembershipsService.fetch_project_name`): every
  character in the Unicode categories Cc, Cf, Zl and Zp becomes a space, runs of spaces become one,
  and the result is cut to 80 characters. An empty automation name becomes "Untitled automation".
- `link`: `env.agenta.web_url` without its trailing slash, then
  `/m/w/{organization_id}/p/{project_id}/automations/{automation_id}`, each part URL-quoted (G46).
- Every value is HTML-escaped in the HTML part. The raw error text is never sent.

### 7.4 Reason catalog

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
| any other code, the runner's `access_denied` included (G25) | The agent's run ended with an error. | Open the automation to see the run and its error. |

## 8. Config

`NotificationsConfig` in `env.py` as `env.agenta.notifications` (G44): `email_enabled`, from
`AGENTA_NOTIFICATIONS_EMAIL_ENABLED`, default `true`. The send step reads it on each request.

## 9. Automations screen

`deliveryOutcome` in `web/packages/agenta-automation-ui/src/automationModel.ts`: for a trigger
delivery with `status.code` `202` and a `data.outcome`, `completed` is `ok`, `failed` is `bad`,
`cancelled` is a new `cancelled` state and `waiting` a new `waiting` state. Every other row keeps
today's rule, because a merged `data` can keep an old outcome (G8). The zod schema gains `outcome`
(G47).

## 10. Known limits

1. **A run that started before a fix and fails after it** sends one more email (D19). A `500`
   re-claimed after a fix keeps its old start time and behaves the same way (G7).
2. **Overlapping runs.** An older run that fails after a newer success, when the two land in
   different pages or passes, opens a notification and sends one email. The next healthy run that
   starts after it resolves it.
3. **Runs that never end**: rows stuck at `102` (G11), and turns the runner abandons without a `done`
   (G24) that the watchdog does not settle.
4. **A late error code.** An `error` record stored after the pass settles the run gives the reason
   `runner_error` (G20). The outcome is right.
5. **What a run does after an approval** is not followed: the trigger delivery settles `waiting`
   (G24b).
6. **A crash between a send and its write** sends the email twice.
7. **A hard-deleted automation** (a connection delete, G15) keeps its notification as an open row,
   and an email not sent yet can still go out, with a link to a missing page.
8. **Flapping.** An automation that fails and works in turns sends one email per cycle.
9. **Retention.** Nothing deletes old notifications.
10. **Email off, then on.** A notification opened while email was off is not sent later.
11. **A large backlog of unfinished runs** (more than the pass reads in 30 seconds) delays the
    settling of older runs until the backlog clears or leaves the 24-hour window.
12. **An expired provider login is silent** for event subscriptions (G9a). Follow-up 1.
13. **The outage brake also holds real failures** with a platform reason while it is set. They open
    after it expires, if they still fail.
14. **A recipient who leaves before the send.** Recipients are chosen at the open. If the only
    recipient leaves before the send, the email is skipped and nobody else gets it.

## 11. Separate bugs, out of this change

| Bug | Fact |
|---|---|
| `retry_on_error=True` has no effect on any taskiq worker. | G6 |
| Nothing sweeps trigger deliveries stuck at `102`; the detached start has no read timeout. | G11 |
| `query_project_members` returns deleted users. | G34 |
| Edits do not set `updated_at` on automations. | G30 |

## 12. Follow-ups, out of v1

1. **Connection health for event subscriptions.** A daily `get_connection_status` check for
   connections used by active subscriptions (G9a), with "no event in N days" as the fallback.
2. **Per-user opt-out.** v1 has only the server switch.
3. **An email when a run waits for a person** (D7).
