# Research: Code Facts for Automation Failure Notices

**Checked:** 2026-09-25, on the current `main` code. Every fact below was read in the file and
line given. Paths are relative to the repo root. Facts carry an id (F1, F2, ...) so the plan can
cite them.

Terms used here:

- **Automation**: a schedule (`trigger_schedules`) or an event subscription
  (`trigger_subscriptions`). The web app calls both "automations".
- **Delivery**: one row in `trigger_deliveries`. The platform writes one row for each time an
  automation tries to run.
- **Run**: the agent execution that a delivery starts. The runner calls it a *turn*.
- **Records**: the transcript rows that the runner writes for a run (`records` table, tracing
  database).

## 1. Automations and their creator

| Id | Fact | Source |
|---|---|---|
| F1 | Schedules and subscriptions have `created_by_id`, `updated_by_id`, `created_at`, `updated_at`, `deleted_at` from `LifecycleDBA`. | `api/oss/src/dbs/postgres/shared/dbas.py:90-117` |
| F2 | `created_by_id` is set to the calling user on create. | `api/oss/src/dbs/postgres/triggers/mappings.py:42`, `:123` |
| F3 | An automation points to its agent only inside the JSON column `data.references`. There is no agent column. | `api/oss/src/core/triggers/dtos.py:267`, `:332` |
| F4 | Every change to an automation goes through `dao.edit_subscription` or `dao.edit_schedule`: user edits, play/pause, revoke/refresh (`is_valid`), and the platform's own deactivation when a schedule passes its `end_time`. | `api/oss/src/core/triggers/service.py:1073`, `:1267`, `:1273`, `:1411`, `:1615`, `:1670`, `:1714-1719` |
| F5 | An edit sets `updated_by_id` but **not** `updated_at`. The column has no server default and no database trigger; `server_onupdate` in the migration is SQLAlchemy metadata only. Today nothing records *when* an automation was last edited. | `api/oss/src/dbs/postgres/triggers/mappings.py:87-108`, `:162-181`; `api/oss/databases/postgres/migrations/core_oss/versions/oss000000003_add_trigger_subscriptions_and_deliveries.py:59-64` |

## 2. Recipients

| Id | Fact | Source |
|---|---|---|
| F6 | Users have `email` and a soft-delete column `deleted_at`. | `api/oss/src/models/db_models.py:101-123` |
| F7 | Project membership is a row in `project_members` (`user_id`, `project_id`, `role`, `deleted_at`). OSS and EE use the same model. | `api/oss/src/models/db_models.py:253-290` |
| F8 | An organization has no email. It has `owner_id`, a required foreign key to `users.id` with `ondelete="RESTRICT"`. | `api/oss/src/models/db_models.py:41-45` |

## 3. How a delivery starts a run

The path: cron or Composio webhook → Redis queue `queues:triggers` → `TriggersWorker` in the
`worker-queues` process → `TriggersDispatcher`.

| Id | Fact | Source |
|---|---|---|
| F9 | Each schedule tick has its own `event_id` (`<schedule_id>:<tick time>`), so one tick maps to one delivery. | `api/oss/src/core/triggers/service.py:1729` |
| F10 | An inactive automation writes **no** delivery row. It is skipped with a log line. | `api/oss/src/tasks/asyncio/triggers/dispatcher.py:99-104`, `:197-202`; `api/oss/src/tasks/taskiq/triggers/worker.py:124-129` |
| F11 | A subscription that is not valid (connection revoked or not synced) writes a delivery with status `409 failed` and does not run. | `dispatcher.py:155-174` |
| F12 | The dispatcher claims the delivery by inserting it with status `102 claimed`, in one statement that also checks the automation is still live and active. | `api/oss/src/dbs/postgres/sessions/streams/dao.py:163-272` |
| F13 | Each run gets a new session: `session_id = uuid4().hex`. The delivery stores it in `data.session_id`. | `dispatcher.py:249`, `:277` |
| F14 | If the inputs or the agent reference cannot be built, the delivery becomes `400 failed`. | `dispatcher.py:317-327` |
| F15 | If the start call fails, the delivery becomes `500 failed` and the task raises. | `dispatcher.py:338-349` |
| F16 | If the start call succeeds, the delivery becomes `202 dispatched` with `data.result.run_id`. Nothing updates the delivery after that. The code comment says so. | `dispatcher.py:350-362`; `api/entrypoints/worker_queues.py:255-262` |
| F17 | `data.error` holds the raw exception text (`str(e)`), for example the HTTP body of a failed start. It is not written for users. | `dispatcher.py:322`, `:344`; `api/oss/src/core/workflows/service.py:866-876` |
| F18 | A `500` delivery is the only status that a later attempt for the same `event_id` can claim again. The re-claim replaces the row's `id`, `status` and `data`. | `streams/dao.py:217-237`; `api/oss/src/core/triggers/dtos.py:39` |
| F19 | Failed tasks are not retried. `retry_on_error=True` is set, but no retry middleware is registered, and the receiver acknowledges the message when the task ends (`WHEN_SAVED`), also on error. A second attempt happens only if the same event arrives again (Composio re-sends it, or the cron calls the same tick twice) or a worker crashes before the acknowledge. | `api/oss/src/tasks/taskiq/triggers/worker.py:36-40`, `:86-90`; no `RetryMiddleware` in `api/`; `taskiq/receiver/receiver.py:77`, `:195-199` |
| F20 | A delivery can stay `102 claimed` for good if the worker dies after the claim, or if the start call waits forever: the start stream has `read=None` (no read timeout). | `api/oss/src/core/workflows/service.py:853` |
| F21 | Trigger runs start with `strict_start=False`, so the **first** record from the service counts as "started", even if that record is an error. A run that fails at once still gets `202 dispatched`. | `api/oss/src/core/workflows/service.py:1305`, `:1344`, `:881-913` |

Delivery status summary:

| Status | Meaning | Final? |
|---|---|---|
| no row | automation inactive | n/a |
| `102 claimed` | claimed, start not finished | no; stuck if the worker died (F20) |
| `202 dispatched` | run started | yes for the delivery; the run outcome is elsewhere (section 4) |
| `400 failed` | could not build the request | yes |
| `409 failed` | subscription invalid | yes |
| `500 failed` | start call failed | yes, unless the same event arrives again (F18) |
| `200 success` | test subscription captured an event | yes; not a real run |

## 4. How a run ends

| Id | Fact | Source |
|---|---|---|
| F22 | The delivery's `run_id` becomes the run's `turn_id`: the API puts it in `meta.run_id`, the SDK sends it as `turnId`, the runner uses it, and records store it in `records.turn_id`. | `api/oss/src/core/workflows/service.py:1316-1325`; `sdks/python/agenta/sdk/agents/handler.py:494`; `sdks/python/agenta/sdk/agents/wire_models.py:561`; `services/runner/src/server.ts:235-237`; `api/oss/src/dbs/postgres/sessions/records/dbas.py:13-16` |
| F23 | The API returns `record.run_id` from the first stream record if it has one, else its own id. | `api/oss/src/core/workflows/service.py:905-911` |
| F24 | Every run ends with exactly one `done` record. Only `done` ends a run. | `api/oss/src/core/sessions/records/dtos.py:15-18`; `services/runner/src/server.ts:986-1004` |
| F25 | `done.stopReason` is written only for `paused`, `cancelled` and `error`. A normal finish has no `stopReason`. | `services/runner/src/tracing/otel.ts:2197-2210` |
| F26 | A failed run writes an `error` record and then `done`. Some failure paths write `done` **without** `stopReason: error`: a failure before the agent starts (for example, the sandbox cannot be created) writes `error` then a plain `done`. | `services/runner/src/engines/sandbox_agent/run-turn.ts:1676-1719`, `:1843-1847`; `services/runner/src/server.ts:994-1003` |
| F27 | If the runner dies, the watchdog ends the run with an `error` record (`execution_lost`) and a plain `done`. | `api/oss/src/tasks/asyncio/sessions/orphan_sweep.py:165-200` |
| F28 | A user Stop ends the run with `done(stopReason=cancelled)`. | `orphan_sweep.py:203-226`; `services/runner/src/server.ts:953-961` |
| F29 | A run that waits for a human ends its turn with `done(stopReason=paused)`. | `api/oss/src/tasks/asyncio/sessions/records_worker.py:27-30`, `:59-74` |
| F30 | Records are written by the records worker in the `worker-streams` process. After each commit it publishes the ended turns, paused ones included, to `streams:sessions`. | `api/oss/src/tasks/asyncio/sessions/records_worker.py:34-53`; `api/entrypoints/worker_streams.py:106` |
| F31 | `streams:sessions` has one consumer, the channels outbox. | `records_worker.py:46-50` |
| F32 | A batch that fails to write stays pending and is retried after 30 s, while later batches commit. So an `error` record can commit **after** its `done`. | `records_worker.py:82-96`, `:114` |
| F33 | Late records for a run the watchdog already ended get `quarantined_at` and are hidden from transcripts. | `api/oss/src/dbs/postgres/sessions/records/dbas.py:74-80` |
| F34 | `session_executions` has an outcome column, but rows exist only for runs touched by a Stop, an approval continuation or the watchdog. A normal run that ends by itself has no row. It is not a general outcome source. | `api/oss/src/dbs/postgres/sessions/executions/dao.py:67-98`; `api/oss/src/core/sessions/records/service.py:138-175` |

Outcome of one run, from its records:

| Records for the `turn_id` | Outcome |
|---|---|
| `done(stopReason=error)` | failed |
| `error` record + `done` without `stopReason` | failed (F26, F27) |
| `done(stopReason=cancelled)` | cancelled |
| `done(stopReason=paused)` | waiting for a human |
| `done` without `stopReason` and no `error` record | succeeded (but see F32: the `error` record can arrive later) |
| no `done` | still running, or lost before the watchdog acted |

## 5. Errors and their wording

| Id | Fact | Source |
|---|---|---|
| F35 | Every `error` record has a `message` and an optional `code`. | `services/runner/src/protocol.ts:519-539` |
| F36 | Codes: `runner_error`, `starter_credits_exhausted`, `starter_credits_program_paused`, `starter_credits_unavailable`, `credential_delivery_failed`, `rate_limited`, `session_turn_in_use`, `sandbox_gone`, `execution_lost`, `subscription_login_required`, `subscription_login_refreshed`. | `services/runner/src/engines/sandbox_agent/errors.ts:79-105` |
| F37 | Most messages are fixed, safe text. The catch-all `runner_error` message is the **raw first line** of the error, which can contain anything. | `errors.ts:503` |
| F38 | The fixed messages are written for the chat ("Send the message again to retry", "You can continue from here"), not for an email about a scheduled run. | `errors.ts:76-77`, `:486-490` |
| F39 | `session_turn_in_use` cannot happen for a trigger run: every trigger run has a new session (F13), and this error is sent live only and never stored. | `services/runner/src/server.ts:843-866` |

## 6. Approvals

| Id | Fact | Source |
|---|---|---|
| F40 | A request for a human is a row in `session_interactions` (core database): `session_id`, `turn_id`, `kind`, `status`, `created_at`. | `api/oss/src/dbs/postgres/sessions/interactions/dbas.py:14-29` |
| F41 | Kinds: `user_approval`, `user_input`, `client_tool`. | `api/oss/src/core/sessions/interactions/dtos.py:10-13` |
| F42 | Status: `pending` (waiting), `responded` and `resolved` (answered), `cancelled` (the runner dropped the request). There is a partial index on `status = 'pending'`. | `dtos.py:16-21`; `api/oss/src/dbs/postgres/sessions/interactions/dbes.py:41-45` |
| F43 | The runner creates the row by an HTTP call with a few retries. If all retries fail, it logs `DROPPED` and the row does not exist, although the run is paused. | `services/runner/src/sessions/interactions.ts:1-6`, `:139-180` |

## 7. Email

| Id | Fact | Source |
|---|---|---|
| F44 | `send_email` renders one fixed template ("{user} has {action} {workspace} on Agenta"). It has no other template and does not HTML-escape its values. | `api/oss/src/utils/emailing.py:20-45`, `:67-117` |
| F45 | It uses SMTP if set up, else SendGrid, else logs and returns `True` without sending. | `emailing.py:100-117` |
| F46 | "Email is set up" is `env.smtp.enabled or env.sendgrid.enabled`. | `api/oss/src/utils/env.py:2110`, `:1891-1893`, `:1908-1911` |
| F47 | SMTP has an optional timeout (`SMTP_TIMEOUT`; none by default). The SendGrid client is created without a timeout. | `env.py:1877`; `api/oss/src/utils/lazy.py:112` |
| F48 | If the SendGrid client fails to build once, the failure is cached for the life of the process. | `lazy.py:89-116` |
| F49 | Send errors are raised to the caller. There is no retry. | `emailing.py:135-137`, `:202-204` |

## 8. Links

| Id | Fact | Source |
|---|---|---|
| F50 | The automation page is `/m/w/{workspace_id}/p/{project_id}/automations/{automation_id}`, where `automation_id` is the schedule id or the subscription id. | `web/mobile/src/pages/w/[workspace_id]/p/[project_id]/automations/[automation_id].tsx`; `web/mobile/next.config.ts:29`; `web/packages/agenta-automation-ui/src/useAutomationEditor.ts:21-38` |
| F51 | The web base URL is `env.agenta.web_url` (`AGENTA_WEB_URL`). | `api/oss/src/utils/env.py:716` |

## 9. Existing building blocks

| Id | Fact | Source |
|---|---|---|
| F52 | The API starts background loops in its lifespan: the watchdog (`orphan_sweep_loop`) and `attachment_sweep_loop`. | `api/entrypoints/routers.py:375-414` |
| F53 | `attachment_sweep_loop` runs one pass per interval under a Redis lease (`SET NX EX`, renew and release only by the owner). | `api/oss/src/tasks/asyncio/sessions/attachment_sweep.py:15-155` |
| F54 | `utils/locking.py` has shared `acquire_lock`, `renew_lock`, `release_lock`. | `api/oss/src/utils/locking.py:78`, `:157`, `:223` |
| F55 | There is an events pipeline: `publish_event` writes to `streams:events`; the events worker stores each event and then, as a post-step, dispatches matching webhooks. This is the existing "one event, many deliveries" pattern. | `api/oss/src/core/events/streaming.py:61-90`; `api/entrypoints/worker_streams.py:140-171`; `api/oss/src/core/events/types.py:13` |
| F56 | There is no notifications domain in the API today. | `api/oss/src/core/` listing |
| F57 | API settings live in config classes in `env.py` and are read through the shared `env` object. | `api/oss/src/utils/env.py`; `AGENTS.md` "Environment config" |

## 9b. Facts checked while writing the plan

| Id | Fact | Source |
|---|---|---|
| F58 | The SDK replaces `meta.run_id` with an admission `execution_id` only when the request has `on_busy`. The trigger dispatcher does not set `on_busy`, so a trigger run keeps the API's `run_id`. | `sdks/python/agenta/sdk/decorators/routing.py:244-298`; `api/oss/src/tasks/asyncio/triggers/dispatcher.py:309-316` |
| F59 | No SDK code writes a `run_id` key into a stream record, so F23 falls back to the API's own `run_id`. | search for `"run_id"` in `sdks/python/agenta/sdk` |
| F60 | OSS and EE both create `project_members` rows when a user joins a project. | `api/oss/src/services/db_manager.py:835`, `:929`; `api/oss/src/core/accounts/service.py:532` |
| F61 | `get_organization_owner(organization_id)` returns the owner user. It does not filter `deleted_at`. | `api/oss/src/services/db_manager.py:709-730`, `:1236-1257` |
| F62 | Records have an ingest time `created_at` with a server default, and an index `ix_records_project_id_session_id_turn_id`. `settled_turns` is a batch query by `(session_id, turn_id)` pairs that skips deleted and quarantined rows. | `api/oss/src/dbs/postgres/sessions/records/dbes.py:22-49`; `api/oss/src/dbs/postgres/shared/dbas.py:93-97`; `api/oss/src/dbs/postgres/sessions/records/dao.py:473-524` |
| F63 | `trigger_deliveries.created_at` has a server default. A re-claim of a `500` row does not change `created_at`. The table's indexes all start with `project_id`, `subscription_id` or `schedule_id`. | migration `oss000000003...py:184-189`, `:218-249`; `api/oss/src/dbs/postgres/sessions/streams/dao.py:228-234` |
| F64 | Projects have `workspace_id` and `organization_id`. | `api/oss/src/models/db_models.py:149-157` |
| F65 | No API config class exists for triggers or automations today. `AgentaConfig` groups feature configs such as `webhooks` and `sessions`. | `api/oss/src/utils/env.py:711-756` |

## 10. What the facts mean for the requirements

These are consequences, not design decisions.

- **R1 (run fails):** the delivery never shows it (F16, F21). The only reliable source is the
  records of the run's `turn_id` (F22-F27). A failure can be detected only after `done`, and the
  `error` record can arrive late (F32).
- **R2 (run never starts):** the delivery shows it directly: `400`, `409`, `500` (F11, F14, F15).
  A `500` can still turn into a real run later (F18, F19), but only if the same event arrives
  again. A delivery stuck at `102` (F20) is also a "never started" case, found only by age.
- **R5 and A2 (edit resets the failing state):** there is one place where every edit passes
  (F4), but no edit time is stored today (F5). Platform edits (end-time deactivation, revoke)
  pass the same place.
- **A1 (creator gone):** "gone" can be read as `users.deleted_at` set, or no live
  `project_members` row (F6, F7). The fallback is the owner's email (F8).
- **A4 (needs approval):** `session_interactions` gives "waiting" and "answered" in the core
  database (F40-F42), but a row can be missing for a paused run (F43). `done(paused)` in records
  always exists (F29).
- **R8 (plain language):** error codes exist (F36), but the catch-all message is raw (F37) and
  the fixed messages are chat wording (F38). The email needs its own wording per code.
- **R9 and A7:** the provider check exists (F46). `send_email` needs a new template (F44), and
  sends need a timeout (F47).
- **R10 (foundation for more channels):** the events pipeline (F55) already turns one event into
  many deliveries. There is no notifications domain (F56).
