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
| trigger delivery | `trigger_deliveries` | `TriggerDelivery` | | run |
| settled result of a trigger delivery | `trigger_deliveries.data.outcome` | `TriggerDeliveryData.outcome` | `outcome`: `completed`, `failed`, `cancelled`, `waiting`, `skipped` | worked, failed, cancelled, waiting for a person, skipped |
| reason | `trigger_deliveries.data.reason_code`, `notifications.data.reason_code` | `reason_code` | `reason_code` | the "What happened" line |
| notification | `notifications` | `Notification` | | (email) |
| open or resolved | `notifications.state` | `NotificationState` (`open`, `resolved`) | | |
| notification delivery | `notification_deliveries` | `NotificationDelivery` | | |
| delivery state | `notification_deliveries.state` | `NotificationDeliveryState` (`created`, `sent`, `failed`, `skipped`) | | |
| delivery channel | `notification_deliveries.channel` | `channel` | `email` | |
| deduplication key | `notifications.dedup_key` | `dedup_key` | `automation:<automation_id>` | |

`completed` follows `RunnerEnding` (`api/oss/src/core/sessions/records/dtos.py:34`), so the run
and its trigger delivery use one word. The notification delivery states follow
`ChannelDeliveryState` (`created`, `sent`, `failed`, `api/oss/src/core/channels/dtos.py:102-113`):
a row is `created` before the send is tried. They add `skipped`. **Avoid:** reading `notification_deliveries.channel` as a `core/channels` connection.
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
| G8 | `update_delivery` and the upsert in `write_subscription_delivery_if_live` merge the new `data` into the old one (`||`). The upsert has no status guard, so a repeated event for a `500` row can turn it into `409` or `200` and keep its old `data` keys. | `api/oss/src/dbs/postgres/triggers/dao.py:533-551`, `:672-695`; `dedup_seen` lets a `500` through at `:881-903` |
| G9 | An invalid subscription writes `409 failed`. Only `revoke_subscription` sets `is_valid=false`, and it turns the provider trigger off. Revoking a connection changes only the connection row. | `dispatcher.py:219-238`; `api/oss/src/core/triggers/service.py:1393-1413`, `:1607-1640`; `api/oss/src/core/gateway/connections/service.py:267-299` |
| G9a | The Composio adapter can read a connection's provider status (`get_connection_status`, valid when `status == "ACTIVE"`). Only a person's `refresh_connection` calls it. Nothing checks it on a schedule, so an expired provider login is not noticed, and an event subscription on it stops getting events with no trigger delivery. | `api/oss/src/core/gateway/connections/providers/composio/adapter.py:316-333`; `api/oss/src/core/gateway/connections/service.py:301-384` |
| G10 | A test subscription writes `200 success` with `data.is_test=true` and runs nothing. | `dispatcher.py:181-215` |
| G11 | Nothing sweeps a trigger delivery stuck at `102 claimed`. The detached start has no read timeout. | `api/oss/src/core/workflows/service.py:1059` |
| G12 | No index on `trigger_deliveries` starts with `created_at`. They are `(project_id, created_at)`, `(subscription_id, created_at)`, and the unique `(project_id, subscription_id, event_id)` and `(project_id, schedule_id, event_id)`. No index serves `(project_id, schedule_id, created_at)`. | `api/oss/src/dbs/postgres/triggers/dbes.py:107-134` |
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
| G21 | `turn_ended` on `streams:sessions` carries only ids, and is sent when a `done` commits. The channels outbox (`ChannelsOutboxStreamWorker`) consumes `streams:sessions`; the `SessionEventsWorker` group is not started. The shared consumer deletes an entry before it acknowledges it, so a second consumer group on the same stream would lose entries. | `api/oss/src/tasks/asyncio/sessions/streaming.py:20-30`; `records_worker.py:508-515`; `api/entrypoints/worker_streams.py:102`, `:243-248`; `api/oss/src/tasks/asyncio/shared/consumer.py:388-398` |
| G22 | `records` is in the tracing database, with index `ix_records_project_id_session_id_turn_id`. One turn can hold more than one `done` (runner and watchdog). `RecordsDAOInterface.runner_ended_turns` cannot be reused: it leaves out watchdog endings and reads "completed" when a turn has both endings. | `api/oss/src/dbs/postgres/sessions/records/dao.py:32-40`, `:542-576`; `api/oss/src/dbs/postgres/sessions/records/dbes.py:47-52`; `api/oss/src/core/sessions/records/interfaces.py:114`; `dao.py:572` |
| G23 | The runner's hard deadline ends a run after 11 hours and 30 minutes by default. | `services/runner/src/engines/sandbox_agent/run-limits.ts:43`; `services/runner/src/sessions/turn-settle.ts:31`, `:42` |
| G24 | An abandoned turn writes `error` (`execution_lost`) and no `done`. | `services/runner/src/server.ts:1252-1268` |
| G24a | After the watchdog ends a turn, later records of that turn (a runner that thaws, with its own `done`) are quarantined and hidden from reads. | `api/oss/src/core/sessions/records/service.py:62-78`; `api/oss/src/dbs/postgres/sessions/records/dao.py:219-226` |
| G24b | `paused` and `cancelled` do not end an execution in the sessions code: a paused turn stays continuable. | `api/oss/src/core/sessions/records/dtos.py:30-32` |
| G24c | `session_executions` (core database) keeps each turn's `terminal_outcome` (`completed`, `failed`, `lost`, `stopped`, `continued` when an approval of a paused turn is answered, `not_running` when a Stop finds the turn gone) and an `error` JSON, `settled_by` and `settled_at`, keyed by `(project_id, session_id, execution_id)`, where `execution_id` is the turn id. The runner sends every record through `POST /sessions/records/ingest`. For each `done` with an ending (`runner_ending` is not `None`: not `paused`, not `cancelled`), the route calls `settle_execution_ended` before the record enters the records stream, and `settle` creates the row if it is missing (`lock_for_control` inserts with on-conflict-do-nothing). So the first turn of a trigger run gets a row too. The watchdog settles `lost` and `stopped`. `SessionExecutionsDAOInterface.query_settled(project_id, keys)` reads settled rows by `(session_id, execution_id)`. The records worker settles only continuations, so the ingest route is the path that covers first turns. | `api/oss/src/dbs/postgres/sessions/executions/dbes.py:16-60`; `api/oss/src/apis/fastapi/sessions/router.py:1601-1616`; `api/oss/src/core/sessions/commands/service.py:856`, `:1005-1016`, `:1982-2012`, `:2302-2326`, `:2499`; `api/oss/src/dbs/postgres/sessions/executions/dao.py:67-98`, `:183-258`; `api/oss/src/core/sessions/executions/interfaces.py:90`; `api/oss/src/core/sessions/records/service.py:150-167`; `services/runner/src/sessions/persist.ts:150`; `api/entrypoints/routers.py:1743` |
| G24d | The channels outbox reads `session_executions.terminal_outcome` to learn how a turn ended. | `api/oss/src/tasks/asyncio/channels/outbox.py:72-73`, `:846-865` |
| G24e | `current_session_response` checks `web_url` (scheme, host, no credentials, query or fragment) and quotes each path part before it builds an `/m/w/.../p/...` link. It is in the API layer. | `api/oss/src/apis/fastapi/sessions/utils.py:29-78` |
| G24f | The frontend checks trigger deliveries with the zod schema `triggerDeliveryDataSchema`. | `web/packages/agenta-entities/src/gatewayTrigger/core/types.ts:307-323` |
| G25 | The runner also emits `access_denied` as a run error. That automation is not paused. | `services/runner/src/engines/sandbox_agent/errors.ts:111` |

### Automations

| Id | Fact | Source |
|---|---|---|
| G26 | User actions, each from a route: `edit_subscription` (`service.py:1148`), `delete_subscription` (`:1270`), `refresh_subscription` (`:1377`), `revoke_subscription` (`:1393`), `set_subscription_active` (`:1442`), `edit_schedule` (`:1824`), `delete_schedule` (`:1859`), `set_schedule_active` (`:1873`). | `api/oss/src/core/triggers/service.py`; `api/oss/src/apis/fastapi/triggers/router.py:344-471` |
| G27 | `refresh_schedules` is the only internal caller of `set_schedule_active`. It stops a schedule after its `end_time`. | `service.py:1925-1973` |
| G28 | `delete_*` is a soft delete (`deleted_at`). | `api/oss/src/dbs/postgres/triggers/dao.py:256-283`, `:1030-1051` |
| G29 | An automation has `name` and `created_by_id`. | `api/oss/src/dbs/postgres/triggers/dbas.py:21`, `:50`; `api/oss/src/dbs/postgres/shared/dbas.py:93`, `:135-142` |
| G30 | Edits do not set `updated_at`. | `api/oss/src/dbs/postgres/triggers/mappings.py:101`, `:181` |
| G31 | `TriggersService` is built once in the app, and in 11 tests. | `api/entrypoints/routers.py:1084`; `api/oss/tests/` |
| G31a | A connection can be deleted from the triggers router and from the tools router. The cascade removes its subscriptions (G15). | `api/oss/src/apis/fastapi/triggers/router.py:623-636`; `api/oss/src/apis/fastapi/tools/router.py:526` |

### Recipients and access

| Id | Fact | Source |
|---|---|---|
| G32 | `AccessService.check_human(user_id, project_id, action)` returns a `Decision` with `allowed`. It applies membership and role, for a human without request access. | `api/oss/src/core/access/service.py:295-310`; `api/oss/src/core/access/dtos.py:35-36` |
| G33 | `view_triggers` is a permission (`Permission.VIEW_TRIGGERS`). Custom roles in EE can remove it. | `api/oss/src/core/access/permissions/types.py:169`; `api/AGENTS.md` (custom roles) |
| G34 | `query_project_members(project_id, windowing)` returns `user_id`, `email`, `name`, `role` under the edition rule: OSS uses organization members and roles, EE uses project rows. It does not filter deleted users. | `api/oss/src/core/memberships/service.py:333-350`; `api/oss/src/dbs/postgres/memberships/dao.py:130-148`, `:419` |
| G35 | The memberships DAO reads `organizations.owner_id`, but only in private helpers. | `api/oss/src/dbs/postgres/memberships/dao.py:210`, `:458-466` |
| G35a | The memberships DAO already reads `projects.project_name` and `organizations.name` in its summary columns. | `api/oss/src/dbs/postgres/memberships/dao.py:53-62` |
| G36 | Users are hard-deleted. The memberships DAO is the only new-style code that reads `users`, and `query_project_member_profiles` already returns `email`. | `api/oss/src/services/db_manager.py:1438-1444`, `:1510-1516`; `api/oss/src/dbs/postgres/memberships/dao.py:177-181`, `:242`; `api/oss/src/core/memberships/dtos.py:44-48` |
| G37 | A private agent is visible only to its owner, admins included. Automations have no sharing policy: `view_triggers` lets a member see them. | `api/oss/src/core/sharing/service.py:173` |
| G38 | A project's organization comes from `AccessService.project_organization_id`. | `dispatcher.py:642-648` |

### Email, config, loops, UI

| Id | Fact | Source |
|---|---|---|
| G39 | `send_email` always renders the invitation template. `_send_smtp_email` and `_send_sendgrid_email` take any HTML and run in a thread. SMTP comes first, then SendGrid. With neither, `send_email` returns `True` and sends nothing. `_send_sendgrid_email_sync` also returns `True` when the client cannot be built. | `api/oss/src/utils/emailing.py:66-117`, `:119-137`, `:186-216` |
| G40 | No plain-text part is sent. | `emailing.py:157`, `:217-222` |
| G41 | SMTP takes `SMTP_TIMEOUT` (none by default). `timeout` applies to each socket operation, not to the whole session. The SendGrid client has no default timeout, but `python-http-client` 3.3.7 accepts `timeout` on each call (`client.mail.send.post(request_body=..., timeout=...)`). | `api/oss/src/utils/env.py:2197`; `api/oss/src/utils/lazy.py:110`; `api/uv.lock` (sendgrid 6.12.5, python-http-client 3.3.7) |
| G42 | `asyncio.wait_for` around `asyncio.to_thread` does not stop the thread. | Python `asyncio` semantics; `emailing.py:127`, `:194` |
| G43 | "Email is set up" is `env.smtp.enabled or env.sendgrid.enabled`. | `env.py:2209-2211`, `:2226-2229` |
| G44 | `AgentaConfig` groups feature configs. No notifications config exists. `env.agenta.web_url` is `AGENTA_WEB_URL`. `AGENTA_ACCESS_EMAIL_DISABLED` is the sign-in email method, not a general switch. | `env.py:206-210`, `:861-906`, `:2386-2404` |
| G45 | Periodic trigger work runs from cron through an admin route: cron calls `POST /admin/triggers/schedules/refresh` every minute with `curl --max-time 30`. Every deployment runs one cron container (docker compose, Railway, Helm with `strategy: Recreate`, because supercronic fires every schedule in every pod). The API runs gunicorn with 2 uvicorn workers and `--timeout 60`, a heartbeat check, so a request that awaits survives past 60 seconds as long as provider calls run in a thread. `api/oss/src/utils/locking.py` has `acquire_lock`, `renew_lock` and `release_lock`: the key is `lock:<namespace>:...`, the default TTL is `AGENTA_LOCK_TTL` (15 s), and `renew_lock` checks ownership only with the `owner` token that `acquire_lock` returned. `attachment_sweep_loop` uses its own Lua helpers. | `api/oss/src/crons/triggers.txt:1`; `api/oss/src/crons/triggers.sh:20-28`; `api/oss/src/apis/fastapi/triggers/router.py:478-488`; `api/oss/docker/Dockerfile.gh:99-112`; `hosting/railway/oss/template/template.json:363-365`; `hosting/kubernetes/helm/values.yaml:497-500`; `hosting/docker-compose/oss/docker-compose.gh.yml:79-88`; `hosting/kubernetes/helm/templates/api-deployment.yaml:114-115`; `api/oss/src/utils/locking.py:78-223`; `api/oss/src/tasks/asyncio/sessions/attachment_sweep.py:39-83` |
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
| D11 | One admin route that cron calls every minute runs one pass: it settles trigger deliveries (at most 30 seconds), then sends notification deliveries with the time left. It starts no new send after 45 seconds and ends within about 60 seconds. No lifespan loop, no stream consumer, no hook in the dispatcher. | G45: cron is how periodic trigger work already runs (the schedule refresh), one cron container runs per deployment, and it keeps the pass out of the API worker lifecycle. G21: a second consumer group on `streams:sessions` would lose entries. G11, G24: some runs never send an event. Settling first, with its own time cap, keeps a slow mail server from holding it up (cut for size, owner, 2026-11-05: was two routes). | design |
| D23 | The outcome of a started run comes from `session_executions` (core database), not from the tracing records. The records are read only for a `paused` or `cancelled` turn (which settles no execution) and for the error code of a failed one. | G24c: the ingest route settles every runner ending before the record reaches the records stream, so `session_executions` has no records lag. G24d: the channels outbox already reads it. | design (round 5) |
| D24 | The outcome is written to `data.outcome`, never to `status`. | Writing `500` to a `202` row would make it re-claimable by a repeated event (G7), which would run the automation again. | design (round 5) |
| D25 | An outage brake. When the failures settled in one outcome pass with a platform reason (`start_failed`, `execution_lost`, `sandbox_gone`) come from more than 10 projects, the pass sets a Redis flag for 15 minutes. While the flag is set, platform-reason failures settle but open no notification, and the pass logs one error for the team. | D4 emails on the first `500`. Without a brake, a runner outage opens one notification per affected automation, and every affected customer gets "contact support" at about the same time. The caps slow the emails but do not stop them. After the outage, runs work again and need no email; an automation that still fails after the flag expires opens one as usual. | design (review of 2026-11-05) |
| D26 | The email names the project, and its subject does not say "Your": `Automation "<name>" in <project> is failing`. | When the creator left, owners and admins get the email for an automation they did not create, and a member of several projects cannot tell which one it is. Project names are visible to every project member, so this reveals nothing that D10 protects. | design (review of 2026-11-05) |
| D27 | Cut for size: no check for a newer healthy run before an open, and no wait for a late error code. | Each only buys precision in a rare case (review of 2026-11-05). Without the first, an older overlapping run that fails after a newer success sends one email, and the next healthy run resolves it (known limit 2). Without the second, a late error record gives the reason `runner_error` (known limit 5). This removes one index, one DAO method and one settle row (O6; the other rows keep their numbers). | design |
| D12 | The outcome goes in `data.outcome` and `data.reason_code`, not in new columns. | No `ALTER TABLE` on a table the workers write all the time. G7: a re-claim replaces `data`. G8: the merge keeps it on a status change, so the screen reads `outcome` only on a `202` (section 9). | design |
| D13 | No failure count, no `destination`, no `read_at`. | Nothing reads them in v1. A nullable column can be added later without failing the migration gate. | design |
| D14 | A notification is resolved by a healthy run (D20), and by a person's edit, start (`set_*_active(is_active=true)`), refresh or delete of the automation. A stop, a revoke, an end-time stop and a platform pause resolve nothing. | G26, G27. A stop makes no trigger deliveries, so resolving on it does nothing useful. | design |
| D15 | No shared transaction across DAOs. Each pass step is idempotent, and the order of writes makes a crash between them safe (5.3). | G49. | design |
| D16 | The notification keeps a snapshot of what the email needs (automation name, project name, organization id, reason code). The send step reads no trigger table. The `automation_failing` template and its required permission live in `core/triggers`, and `api/entrypoints/routers.py` passes them to `NotificationsService` as a constructor argument. | `core/notifications` then knows no automation word and imports nothing from `core/triggers`. There is no kind registry: a second kind adds a second constructor argument (cut for size, owner, 2026-11-05). | design |
| D17 | A failure opens a notification only if it ended less than 1 hour before the pass. A `202` row settles once: at its settled execution, or at a `paused` or `cancelled` `done` when no execution is settled. | Without it, the first pass after the deploy emails about every failure of the last 24 hours, also failures already fixed by an edit. It also stops old failures from emailing after the passes were down for a long time. Whether a continuation after an approval reuses the `turn_id` is not settled here, so the rules do not depend on it. | design |
| D18 | The send pass takes at most 10 notification deliveries per project per pass. | One project with thousands of failing automations would otherwise delay every other project's email. It drops no email. | design |
| D19 | No check against an earlier resolve when a notification opens, and no `resolved_at` column. | Cut for size by the owner (2026-11-05). A run that started before a fix and fails after it opens a new notification and sends one email (known limit 1). Without that check nothing reads a resolve time; `updated_at` keeps it. | owner |
| D20 | A run that ends `waiting` counts as healthy, like `completed`. A `cancelled` run counts as neither. | A run that reached an approval request started and worked. Without this, an automation whose runs always ask for approval would keep a notification open for good and hide the next real failure. | design |
| D21 | While a notification is open, each new failure updates `data.last_failed_at`. A healthy run resolves the notification only if it started at or after `last_failed_at`. | A newer failure while open (for example a `403` that pauses the automation) must not be resolved by an older healthy run. `at or after` lets a re-claimed `500` that keeps its `created_at` (G7) resolve its own notification when the retry works. | design |
| D22 | No reconcile step for hard-deleted automations. | Cut for size (review of 2026-11-05). A hard-deleted automation writes no more trigger deliveries, so its open notification only stays as a row (known limit 8). | design |


## 3. Architecture

```text
 cron (one container per deployment, every minute)
   │ POST /admin/triggers/deliveries/settle: settle (≤ 30 s), then send (no new send after 45 s; ends within about 60 s)
   ▼                                               ▼
┌──────────────────────────────────────┐   ┌──────────────────────────────────┐
│ trigger outcome pass                 │   │ notification send pass           │
│ core/triggers/outcomes.py            │   │ core/notifications/service.py    │
│ core/triggers/failure_notifications.py   │   send_pending()                 │
│                                      │   │                                  │
│ trigger_deliveries (core) ─┐         │   │ notification_deliveries          │
│ session_executions (core) ─┼► settle │   │   state = created                │
│ records (tracing, paused   │         │   │        │ template and permission  │
│   and error code only) ────┘         │   │        ▼ from the constructor     │
│   open / resolve ─► notifications ───┼──►│ email ─► SMTP or SendGrid        │
└──────────────────────────────────────┘   └──────────────────────────────────┘
        ▲ resolve on user actions
        │ TriggersService: edit, start, refresh, delete
```

| Layer | New code |
|---|---|
| Core, notifications | `api/oss/src/core/notifications/`: `dtos.py`, `interfaces.py` (`NotificationsDAOInterface`), `service.py` (`open`, `resolve`, `send_pending(deadline)` with the skip checks, render, send and state writes; it takes the `automation_failing` template and permission in its constructor) |
| Core, triggers | `api/oss/src/core/triggers/outcomes.py` (settle table O1 to O11, `settle_pass`); `api/oss/src/core/triggers/failure_notifications.py` (rules A1 to A6, recipients, and the `automation_failing` kind: reason catalog, template, `view_triggers`) |
| Other interfaces | `SessionExecutionsDAOInterface.query_settled` (exists, G24c); `RecordsDAOInterface.turn_signals` (new: per key, the newest `done`'s `stopReason` and the newest `error` code); `TriggersDAOInterface.query_unsettled_deliveries` and `settle_delivery`; `NotificationsDAOInterface.note_failure` (returns the rows it changed); `MembershipsService.fetch_member_emails(user_ids)` and `fetch_organization_owner_id(organization_id)` (in the memberships DAO, which already reads `users`, G36) |
| Link | built in the `automation_failing` template: `env.agenta.web_url` without its trailing slash, then each path part URL-quoted. `AGENTA_WEB_URL` is trusted server config, so no separate check (cut for size, owner, 2026-11-05). |
| API | `POST /admin/triggers/deliveries/settle` on the triggers admin router, next to `/admin/triggers/schedules/refresh`. It calls `settle_pass` and then `NotificationsService.send_pending` with the time left. It uses the admin `Access` auth of the existing admin routes. |
| Cron | new `api/oss/src/crons/deliveries.txt` and `deliveries.sh`, like `triggers.sh` with `curl --max-time 75` (the request ends within about 60 seconds). The settle script is not named `triggers*`, because `triggers.sh` finds its own interval with an awk match on `triggers\.sh`. It is copied and added to the crontab in `api/oss/docker/Dockerfile.gh`, `api/oss/docker/Dockerfile.dev`, `api/ee/docker/Dockerfile.gh` and `api/ee/docker/Dockerfile.dev`, and mounted in the dev compose files. The Railway cron image is built `FROM` the API image and needs no change. |
| DB | `api/oss/src/dbs/postgres/notifications/` (`dbes.py`, `dao.py`, `mappings.py`); the DAO methods above, in their domains' DAOs |
| Wiring | `api/entrypoints/routers.py`: build `NotificationsService`, pass the `automation_failing` template and permission to it, pass the service to `TriggersService` as an optional argument (default `None`, so the 11 tests that build it keep working; G31) |

Dependency direction: `core/triggers` → `core/notifications` → `core/access`, `core/memberships`.
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
| `data` | `JSONB` not null | for `automation_failing`: `automation_id`, `organization_id`, `automation_name`, `project_name`, `failed_at` (start of the first failure), `last_failed_at` (start of the newest failure while open; times are UTC ISO 8601 strings, always compared as `timestamptz`, never as text), `reason_code` |
| lifecycle | | `created_at` (default `CURRENT_TIMESTAMP`), `updated_at`, `deleted_at`, `created_by_id`, `updated_by_id`, `deleted_by_id` |

Primary key `(project_id, id)` (G48). Indexes:

- `uq_notifications_project_id_dedup_key_open`: unique `(project_id, dedup_key)` `WHERE state = 'open'`.
  One open notification per automation, also when two passes race.

`state` names the lifecycle like `session_commands.state`. The resolve time is the row's
`updated_at`: nothing writes the row after it is resolved, and nothing in v1 reads that time.

### 4.2 `notification_deliveries`

| Column | Type | Meaning |
|---|---|---|
| `project_id` | `UUID` not null | FK `projects.id` `ON DELETE CASCADE` |
| `id` | `UUID` not null | |
| `notification_id` | `UUID` not null | read with `project_id`; no FK, by the table rule below |
| `user_id` | `UUID` not null | the recipient |
| `channel` | `VARCHAR` not null | `email` in v1 |
| `state` | `VARCHAR` not null | `created`, `sent`, `failed`, `skipped` |
| `attempt_count` | `INTEGER` not null default 0 | failed send attempts |
| `sent_at` | `TIMESTAMPTZ` null | |
| lifecycle | | as above |

Primary key `(project_id, id)`. Indexes: `uq_notification_deliveries_notification_id_user_id_channel`;
`ix_notification_deliveries_created_project_id_created_at` on `(project_id, created_at)` `WHERE state = 'created'`. The per-project cap (7.1) reads every pending row once per pass, which is cheap at v1 volumes.

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
2. `CREATE INDEX CONCURRENTLY` for the `trigger_deliveries` index (4.3) inside
   `op.get_context().autocommit_block()`, as
   `oss000000012_add_gateway_connections_provider_account_index.py` does. It first runs
   `DROP INDEX CONCURRENTLY IF EXISTS` in the same autocommit block, so an invalid index left by an
   interrupted build is replaced. Alembic never runs a finished revision again, so this never drops
   a valid index. Downgrade:
   `DROP INDEX CONCURRENTLY IF EXISTS`.

Both pass the migration gate: revision 1 creates new tables only, and revision 2 is a concurrent
index. Old code ignores the new tables and the new `data` keys, so a rollout in either direction is
safe.

## 5. Trigger outcome pass

`POST /admin/triggers/deliveries/settle` runs one pass. Cron calls it every minute (G45). The route
takes a guard with `acquire_lock(namespace="triggers", key="settle-pass", ttl=120)` and releases it
with the returned token (`owner=`) at the end. There is no renewal: the pass stops settling after 30
seconds and starts no new send after 45 seconds, so with one 15-second send timeout it ends within
about 60 seconds, well inside the 120-second TTL (cut for size, owner, 2026-11-05). If the guard is
held, the route returns at once. Settling runs whether email is on or off.

### 5.1 Candidates

Two queries per pass, each in pages of 500, until the 30-second settle deadline:

1. **Start-time rows** (`400`, `403`, `422`, `500`), oldest first. They settle at once, so they never
   pile up.
2. **Run rows** (`202`), newest first. A run that is still going is read again on every pass. Newest
   first keeps a backlog of running or lost runs from holding back the runs that just ended.

Pages use keyset paging on the index columns. The first page has no cursor condition. Each next page
adds `AND (created_at, id) > (:last_created_at, :last_id)` for query 1, or
`AND (created_at, id) < (:last_created_at, :last_id)` for query 2, with the last row of the page
before. Unsettled rows stay in the index until the pass writes them, so without the cursor every page
would return the same rows.

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

For run rows, the pass reads, per project, with keys `(data.session_id, data.result.run_id)` (G16):

- `SessionExecutionsDAOInterface.query_settled(project_id, keys)` (core): `terminal_outcome` and
  `settled_at` of each settled turn (G24c).
- Only for keys with no settled execution, and for `failed` ones,
  `RecordsDAOInterface.turn_signals(project_id, keys)` (tracing): the `stopReason` of the newest
  `done`, and the `attributes.code` of the newest `error` record.
  It skips deleted and quarantined records (G24a).

### 5.2 Settle table

The first matching row wins. "Ended at" is the time rule A5 uses, so only rows that can open a notification have one.

| # | Status | Condition | `outcome` | `reason_code` | Ended at |
|---|---|---|---|---|---|
| O1 | `400` | | `failed` | `bad_configuration` | `coalesce(updated_at, created_at)` |
| O2 | `403` | | `failed` | `paused_` + `data.error_details.code` (`paused_missing_principal`, `paused_agent_deleted`, `paused_access_denied`) | `coalesce(updated_at, created_at)` |
| O3 | `422` | | `skipped` | `agent_needs_setup` | `coalesce(updated_at, created_at)` |
| O4 | `500` | | `failed` | `start_failed` | `coalesce(updated_at, created_at)` |
| O5 | `202` | execution `completed` | `completed` | | `settled_at` |
| O7 | `202` | execution `failed` (O6 was cut, D27) | `failed` | `session_executions.error.code` if set (for example an access refusal), else the newest `error` record code, else `runner_error` | `settled_at` |
| O8 | `202` | execution `lost` | `failed` | `execution_lost` | `settled_at` |
| O9a | `202` | execution `continued` (a person answered the approval) | `waiting` | | `settled_at` |
| O9 | `202` | execution settled with any other value (`stopped`, `not_running`, or a value added later), or no settled execution and the newest `done` has `stopReason = cancelled` | `cancelled` | | |
| O10 | `202` | no settled execution, and the newest `done` has `stopReason = paused` | `waiting` | | |
| O11 | `202` | otherwise (still running) | wait | | |

O1 to O4 use the time of the status write, because a start can take long (G11) and the settle write
does not change `updated_at`. O5 to O8 read `session_executions` (D23, G24c). The ingest route
settles the execution before the record reaches the records stream, so the outcome has no records
lag. Only the error code can lag (G20): if no code is there yet when the pass settles the row, the
reason is `runner_error` (known limit 5). A watchdog ending is `lost` (O8), and a runner that thaws after it
cannot change it: its later records are quarantined (G24a), and `settle` keeps the first outcome. O9
covers every other ending in one row: a Stop (`stopped`), a Stop that found the turn gone
(`not_running`), a value added later, and a `cancelled` `done` with no Stop command. None of them
opens or resolves anything. O9a, checked first, covers a paused turn whose approval was answered
before the pass read it: it settles `continued`, which counts as healthy (D20). O10 covers a `paused` turn that is still
waiting, which settles no execution (G24b): the trigger delivery shows "waiting for a person",
and what the run does after the approval is not followed (known limit 6). A run row that is still
running after 24 hours leaves the window unsettled. The 24 hours are longer than the default hard
deadline (G23).

The settle write is guarded. A changed row is left for the next pass:

```sql
UPDATE trigger_deliveries
SET data = (coalesce(data::jsonb, '{}'::jsonb) || CAST(:settled AS jsonb))::json
WHERE project_id = :project_id AND id = :id
  AND (status->>'code') = :status_code_read
  AND (data->>'outcome') IS NULL;
```

### 5.3 Apply

The pass works page by page. For each page it settles every row in memory (5.2), then applies the
rules in this order: failed and skipped rows oldest first (A4 to A6), then healthy rows (A3), then
the other rows. So a healthy run that started after a failure in the same page resolves the
notification that failure opened, and the send step skips its email if it was not sent yet. The
30-second deadline is checked between pages and between rows. A row not reached stays unsettled and
is read again by the next pass, because the settle write comes last.

For a row `D`, every read and write filters by `D.project_id`. `D`'s automation `A` (with deleted
rows) is read only before an open (A5), where its `name`, `created_by_id` and deletion matter; A3
and A4 need only the automation id, which `D` carries. The steps for one row run in this order, and
each one is idempotent (D15):

1. Apply the rules below.
2. Write the guarded settle (5.2).

If the process dies between 1 and 2, the next pass settles `D` again and the rules find the
notification already open or already resolved. Two requests that apply the same `D` (the guard's
120-second TTL ran out during a request) also open at most one notification. Only a `500` row can
change status between the read and the write (G7, G8). Its notification is still right: that start
did fail.

"Healthy" means `completed` or `waiting` (D20).

| # | Rule |
|---|---|
| A1 | `D.outcome` is `cancelled`: settle only. |
| A2 | Before an open: `A` is missing or deleted: settle only (G15, G28). |
| A3 | `D` is healthy: resolve the open notification of `automation:<A.id>` if `D.created_at` is at or after its `data.last_failed_at` (D21). One `UPDATE ... WHERE state = 'open' AND (data->>'last_failed_at')::timestamptz <= :started_at`, so a concurrent `note_failure` or user resolve is not overwritten. |
| A4 | `D.outcome` is `failed` or `skipped`, and a notification of `automation:<A.id>` is open: set its `data.last_failed_at` to `GREATEST` of its value and `D.created_at`, and its `data.failed_at` to `LEAST` of its value and `D.created_at` (`NotificationsDAOInterface.note_failure`, one `UPDATE ... WHERE state = 'open'` that returns the number of rows it changed). 0 rows means nothing is open, and the row goes on to A6 and A5. `LEAST` keeps "Failing since" right when an older failure comes in a later page. |
| A6 | `D.reason_code` is a platform reason and the outage flag is set (D25): settle only. Checked after A4 and before A5, so it blocks only the open. |
| A5 | `D.outcome` is `failed` or `skipped`, nothing is open, and `D` ended (5.2) less than 1 hour ago (D17): open a notification. |

All comparisons use start times (`created_at`):

- A3: a healthy run that started before the newest failure does not resolve the notification.
  Without this, a long run that started before a `403` would resolve the notification of an
  automation that is now paused for good.
- The 1-hour condition limits opens only, so a healthy run that settles late still resolves.


Open:

```sql
INSERT INTO notifications (project_id, id, kind, dedup_key, state, data, created_at)
VALUES (:project_id, :id, 'automation_failing', :key, 'open', CAST(:data AS jsonb), now())
ON CONFLICT (project_id, dedup_key) WHERE state = 'open' DO NOTHING
RETURNING id;
```

The row count of `note_failure` decides between A4 and A5 (no separate read). The recipients
(section 6) are chosen only for A5, before the insert. If a row is returned, the same DAO
method inserts one `created` email notification delivery per recipient, in the same database
transaction. Both tables belong to the notifications DAO, so no transaction crosses DAOs (D15). If
two requests race, the insert of one returns no row, and that request runs `note_failure` again.

Resolve: `state = 'resolved'` and `updated_at = now()`, always with `WHERE state = 'open'`. Unsent notification deliveries are not
touched: the send pass skips them (7.1).

### 5.4 Resolve on user actions

These `TriggersService` methods resolve the notification of `automation:<id>` after a successful
write: `edit_subscription`, `edit_schedule`,
`refresh_subscription`, `delete_subscription`, `delete_schedule`, and `set_subscription_active` and
`set_schedule_active` when `is_active` is true. `refresh_schedules` only stops schedules (G27), so it
resolves nothing and needs no flag. A connection delete removes its subscriptions with a cascade
(G15) and resolves nothing (known limit 8). A resolve failure is logged with ids only and never fails the
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

The same route, after settling, calls `NotificationsService.send_pending(deadline)` with the time
left (section 5). It starts no new send after 45 seconds from the start of the request. The route's
guard keeps a second request from sending the same rows while the first one still runs.

1. Read up to 100 `created` notification deliveries, oldest first, at most 10 per project (D18),
   each joined with its notification on `(project_id, notification_id)`.
2. Mark a notification delivery `skipped` when:
   - the email switch is off or no provider is set up (G43);
   - its notification is resolved;
   - `check_human` no longer allows the kind's required permission (the user left, lost the role,
     or was deleted);
   - `MembershipsService.fetch_member_emails` returns no email for the user (G36).
3. Render the kind's template from `notifications.data` and the email.
4. Send with `send_rendered_email` (7.2).
5. Success: `state = 'sent'`, `sent_at = now()`, guarded by `state = 'created'`.
6. Failure: `attempt_count + 1`. At 5 attempts, `state = 'failed'`. An exception in steps 2 to 4
   (for example `check_human` or rendering) also counts as a failed attempt, so one bad row cannot
   hold its project's 10 places for good. Logs carry the notification id,
   the notification delivery id, the user id and the exception type. They carry no email address,
   subject or exception message (`api/AGENTS.md`: logs carry ids and kinds only).

Sends run outside any transaction. If the process dies after a send and before its write, the next
pass sends again (known limit 7).

### 7.2 Sender

`emailing.py` gets `send_rendered_email(to_email, subject, html, text)`:

- SMTP: `EmailMessage` with `set_content(text)` and `add_alternative(html, subtype="html")`, the
  sender from `_get_sender_email`, and `timeout=env.smtp.timeout or 15` on the connection (G41).
- SendGrid: `Mail(plain_text_content=text, html_content=html)` with the same sender, sent with
  `client.client.mail.send.post(request_body=mail.get(), timeout=15)` (G41). The 15 s timeout bounds how far one send can run past the 45-second cutoff.
- It raises when no provider is set up and when the SendGrid client cannot be built (G39).
- It does not reuse `_send_smtp_email` and `_send_sendgrid_email`, because they call
  `log.exception`, and an SMTP error can hold the recipient's address.

`send_email` keeps its template and its no-op `True` with no provider. The provider call runs in a
thread. The client timeout, not `asyncio.wait_for`, ends a hung call (G42).

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

- `automation_name`: every character in the Unicode categories Cc, Cf, Zl and Zp becomes a space,
  runs of spaces become one, and the result is cut to 80 characters. An empty name becomes
  "Untitled automation". The subject is built from this value only, so it has no line break and no
  direction override.
- `project_name`: from the memberships DAO (G35a), normalized like `automation_name`.
- `link`: `{AGENTA_WEB_URL}/m/w/{organization_id}/p/{project_id}/automations/{automation_id}` (G46): `env.agenta.web_url` without its trailing slash, then each path part URL-quoted, in the template.
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
already created. A notification that opened while email was off stays open with only skipped
notification deliveries. Turning email on does not send it. The next email comes after the
automation is fixed and fails again.

## 9. Automations screen

`deliveryOutcome` in `web/packages/agenta-automation-ui/src/automationModel.ts`: for a trigger
delivery with `status.code` `202` and a `data.outcome`, `completed` is `ok`, `failed` is `bad`,
`cancelled` is a new `cancelled` state, and `waiting` is a new `waiting` state. Every other trigger
delivery keeps today's `status.message` rule (G47), because a merged `data` can carry an old outcome
(G8). The types come from the regenerated Fern client, and the zod boundary schema `triggerDeliveryDataSchema` gains `outcome` and `reason_code` (G24f).

## 10. Known limits

1. **A run that started before a fix and fails after it sends one more email.** Nothing compares the
   failure with the fix (D19, cut by the owner). The next healthy run resolves the new notification.
2. **Overlapping runs.** An older run that fails after a newer run already succeeded opens a
   notification and sends one email (D27). The next healthy run that starts after it resolves the
   notification. A success that started before the newest failure resolves nothing (A3).
3. **A `500` that later runs.** A repeated event can re-claim a `500` (G7). The email was already
   sent. The new run keeps the old `created_at`: if it works, it resolves the notification (D21); if
   it fails after a person's edit, it opens a new one (known limit 1).
4. **Runs that never end** and that the watchdog does not settle (G24), and rows that stay at `102` (G11), are not reported.
5. **An `error` record that is stored after the pass settles the run**, with no `error.code` on the execution, gives the generic reason `runner_error`. The outcome itself is right (D23).
6. **What a run does after an approval is not followed.** The trigger delivery settles `waiting`
   at the `paused` `done` (G24b).
7. **A crash between a send and its write** sends the email twice.
8. **A hard-deleted automation** (a connection delete, G15, G31a) keeps its notification open as a
   row, and an email not sent yet can still go out, with a link to a missing page. It writes no more
   trigger deliveries, so nothing else follows.
9. **Flapping.** An automation that fails and works in turns sends one email per cycle. The send pass
   sends at most 100 emails per minute in total, and at most 10 per project.
10. **Retention.** Nothing deletes old notifications.
11. **Email off, then on.** A notification opened while email was off is not sent later (section 8).
12. **A large backlog of unfinished runs.** In an incident with more than 10,000 unfinished `202`
   rows in 24 hours, each pass reads the newest rows it can in 30 seconds, and older runs are not
   settled until the backlog clears or leaves the window.
13. **A runner ending that never reaches the API.** If the runner cannot send its `done` and the
   watchdog does not settle the turn, the run stays unsettled.

14. **An expired provider login is silent.** When a Gmail or Slack login expires at the provider,
   an event subscription stops getting events. Nothing is written and nothing fails (G9a), so v1
   sends nothing. A schedule whose agent uses that connection fails at run time and is covered.
   Follow-up 1 covers the subscription case.
15. **The outage brake also holds real failures.** While the flag is set, a platform-reason failure
   that is not part of the outage opens nothing. It opens one after the flag expires, if it still
   fails.

## 11. Separate bugs, out of this change

| Bug | Fact |
|---|---|
| `retry_on_error=True` has no effect on any taskiq worker: no retry middleware is registered. | G6 |
| Nothing sweeps trigger deliveries stuck at `102`; the detached start has no read timeout. | G11 |
| Edits do not set `updated_at` on automations. | G30 |
| `query_project_members` returns deleted users. | G34 |

## 12. Follow-ups, out of v1

Named so nobody reads v1 as covering them.

1. **Connection health for event subscriptions.** A daily check of `get_connection_status` (G9a)
   for each connection used by an active subscription, which opens `automation_failing` with a
   reason `connection_expired`. A "no event in N days" check is the fallback for providers without a
   status call.
2. **Per-user opt-out.** v1 has only the server switch. Expect admins to ask for a per-user setting.
3. **An email when a run waits for a person** (D7). An automation that waits for an approval with
   nobody watching is stuck. Expect this to be the first request after v1.
4. The separate bugs in section 11.

