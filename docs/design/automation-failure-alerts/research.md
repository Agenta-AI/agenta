# Research: How Automations Work Today

Every statement here was read from the code or the local EE dev database
(`agenta_ee_core`, `agenta_ee_tracing`) on 2026-09-24 and 2026-09-25. Local numbers are not
production numbers. Paths are relative to the repo root; short paths such as
`core/triggers/service.py` are under `api/oss/src/`.

## 1. Two entry paths, one dispatcher

### Scheduled automations (no Composio)

- A `cron` container runs `supercronic /app/crontab` in compose, Helm
  (`hosting/kubernetes/helm/templates/cron-deployment.yaml`, on by default) and Railway
  (`hosting/railway/oss/cron/Dockerfile`).
- The crontab is built from the `*.txt` files in `api/oss/src/crons` and `api/ee/src/crons`
  (`api/oss/docker/Dockerfile.gh:96-119`, `api/ee/docker/Dockerfile.gh:96-127`).
- `triggers.sh` runs every minute and POSTs to
  `http://api:8000/admin/triggers/schedules/refresh` with `Authorization: Access <key>`. A curl
  failure is caught and the script exits 0.
- `TriggersService.refresh_schedules` (`core/triggers/service.py:1679-1780`) loads active
  schedules across all projects, turns off schedules past `end_time` (1713-1721), checks
  `croniter.match` for one timestamp only (no catch-up), builds
  `event_id = "{schedule_id}:{tick_iso}"`, dedups, and enqueues `triggers.dispatch_schedule`.
- The refresh handler (`apis/fastapi/triggers/router.py:1474-1498`) always answers HTTP 200. It
  returns `{"status": "failure"}` in the body when the service reports a failure.

### Event automations (Composio)

- At startup the API finds or creates one Composio webhook subscribed to
  `composio.trigger.message` only (`core/triggers/providers/composio/adapter.py:23,131-160`).
- `POST /triggers/composio/events/` (`apis/fastapi/triggers/router.py:1573-1627`) checks
  timestamp freshness, then HMAC, then webhook-id replay; enqueues `triggers.dispatch`; answers
  202.

### Dispatch

- Only the `worker-queues` dispatcher runs in production. Both constructions pass
  `dispatch_fn`, so the inline invoke branch is reached only by tests
  (`api/entrypoints/worker_queues.py:247-270`, `api/entrypoints/routers.py:989-1033`).
- `TriggersDispatcher._run` (`tasks/asyncio/triggers/dispatcher.py:224-422`):
  1. creates `delivery_id = uuid7()` and `session_id = uuid4().hex`;
  2. claims (below);
  3. builds the request; an exception writes `400 failed` and abandons the session;
  4. calls `run_id = await self._dispatch_fn(project_id, user_id, request)`; an exception writes
     `500 failed`, abandons the session, and re-raises;
  5. writes `202 dispatched` with `data.result.run_id`.
- `_dispatch_detached_run` in `worker_queues.py:247` takes no `run_id`. The one in
  `routers.py:989` does. `invoke_workflow_detached(..., run_id=None, ...)`
  (`core/workflows/service.py:3295`) creates `run_id` when none is passed and puts it in
  `request.meta`.

### The claim (`dbs/postgres/sessions/streams/dao.py:163-273`)

- One statement: a CTE locks the live parent (`deleted_at IS NULL`, `is_active`, and `is_valid`
  for subscriptions); it inserts the delivery with `status 102 claimed` and
  `data = {"session_id": ...}`; then it inserts the `session_streams` row with the `ag.*`
  tags.
- `ON CONFLICT (project_id, schedule_id|subscription_id, event_id) DO UPDATE` runs only when
  the existing row's code is `500`. It sets `id`, `created_by_id`, `status`, `data` (replaced)
  and `updated_at`. A column not in that list keeps its old value.

## 2. Status values written on a delivery

| Code, message | Written by | `data.error` |
|---|---|---|
| `102 claimed` | claim | none |
| `202 dispatched` | dispatcher after start | none; `result.run_id` |
| `200 success` | `is_test` capture (`data.is_test = true`), or the inline path (tests only) | none |
| `409 failed` | invalid subscription, no claim | "Subscription is invalid (provider connection revoked or unsynced)" |
| `400 failed` | request build error | `str(e)`; the only explicit raise is "Entity has no bound workflow reference" |
| `500 failed` | detached start error | "Workflow service returned HTTP {code} on detached start: {body}", "Workflow service was never reached on detached start: ...", "Workflow service closed the stream before emitting a started record.", "Workflow revision has no runnable service URL.", or empty |

- A target that is not an agent answers the NDJSON request with HTTP 406
  (`sdks/python/agenta/sdk/decorators/routing.py:469-491,555`), so the delivery is `500` with
  "HTTP 406 on detached start".
- Dedup (`dbs/postgres/triggers/dao.py:663-739`) reads only `status`. It treats a missing row
  and a `500` row as not seen; any other code as seen.

Local data (all `is_test` null):

| Code | Error | Count |
|---|---|---|
| 500 | "HTTP 500 on detached start" wrapping a `400` from `/workflows/revisions/resolve` | 99 |
| 102 | none (stuck claims from 2026-09-20 11:35) | 40 |
| 500 | empty (inline timeouts before detached starts) | 28 |
| 202 | none | 20 |
| 500 | "closed the stream before emitting a started record" | 8 |
| 500 | "Agent run failed: No user message to send (prompt/messages empty)." | 6 |
| 200 | none (inline) | 2 |

## 3. Writers of `trigger_deliveries`

| Function | Writes |
|---|---|
| `SessionStreamsDAO.claim_trigger_delivery` | insert; on a `500` conflict: id, created_by_id, status, data, updated_at |
| `TriggersDAO.write_subscription_delivery_if_live` (dispatcher `is_test` and `409` paths) | insert; on conflict: status, data (merged), updated_at, updated_by_id |
| `TriggersDAO.update_delivery` (dispatcher completion) | status, updated_at; `data` merged with `||` |
| `TriggersDAO.write_delivery` | no production caller |
| Cascade deletes | from `projects`, `trigger_schedules`, `trigger_subscriptions` (and `gateway_connections` through subscriptions) |

## 4. The run's id and its turns

| Hop | Code |
|---|---|
| API sets `meta.run_id` | `core/workflows/service.py:3316-3321` |
| SDK sets `turn_id = meta.run_id` | `sdks/python/agenta/sdk/agents/handler.py:494` |
| SDK sends `turnId` | `sdks/python/agenta/sdk/agents/utils/wire.py:183-184` |
| Runner uses it, else a random id | `services/runner/src/server.ts:235-237` |
| Records store it | `services/runner/src/sessions/persist.ts:99` |

- Local check: all 20 deliveries that have `result.run_id` join to their records on
  `(project_id, session_id, turn_id)`. `data.session_id` (32 hex characters) equals
  `records.session_id`; `records.turn_id` is a dashed UUID equal to `result.run_id`.
- Of 203 local trigger sessions, 56 have records; 1 has two turns 4.5 hours apart (a later
  follow-up message, not a continuation).

**Approval continuations** (`core/sessions/commands/service.py:599-866`):

- A paused turn has no `session_executions` row until someone acts on it.
- On approval, the API locks the paused turn's execution, settles it `continued`, creates a new
  execution with `execution_id = uuid4()` and `parent_execution_id` = the paused turn's id, and
  starts it with `run_id` = that new id. So the continuation's `turn_id` is the new id.
- A continuation can pause again; the next approval creates another child. Chains are longer
  than two in practice.
- **No deadline exists.** The watchdog's idle reclaim after 1800 s collapses the session flags
  but leaves the approval pending and answerable. A pending approval ends only when the run is
  stopped, the session is deleted, a new turn starts in the session, or the execution is
  terminal. Local: a trigger session has an approval pending since 2026-09-07.

## 5. How a turn ends

- Only a `done` record ends a turn (`core/sessions/records/dtos.py:18`). An `error` record alone
  is not terminal, with one exception: the runner's abandon path (`server.ts:1019`) writes an
  `error` with code `execution_lost` and no `done`.
- Runner writes (`services/runner/src`):
  - `engines/sandbox_agent/run-turn.ts:1678-1848`: `error` with a code (`runner_error` or a
    classified code), then `done` with `stopReason = error`.
  - `server.ts:1004-1008,1037-1042`: backstop `error` with no code, then `done` with no stop
    reason, or `cancelled` when a person stopped the run.
  - `tracing/otel.ts:2203-2211`: `done`; `stopReason` is set only for `paused`, `cancelled`,
    `error`.
- API writes (`tasks/asyncio/sessions/orphan_sweep.py:145-231`): the watchdog writes `error`
  (`execution_lost`) plus `done` with no stop reason, or `done` with `stopReason = cancelled`.
- Tool failures are `tool_result` records, not `error` records. No runner path writes an
  `error` and then keeps working.
- Records that arrive after the watchdog ended a turn are kept with `quarantined_at` set and are
  excluded from transcripts.
- Local `done` records after an `error`: 27 with no stop reason, 2 with `error`, 4 with
  `cancelled` (all "Sandbox acquisition was aborted.", a person's stop).
- Runner error codes (`engines/sandbox_agent/errors.ts:79-105`): `runner_error`,
  `starter_credits_*`, `credential_delivery_failed`, `rate_limited`, `session_turn_in_use`,
  `sandbox_gone`, `execution_lost`, `subscription_login_*`; the API adds
  `continuation_execution_lost`.
- The runner's hard limit for a run is 11 hours, plus 30 minutes of settle time
  (`services/runner/src/run-limits.ts:39`, `turn-settle.ts:42`).

## 6. Records table (tracing DB)

- Columns include `project_id uuid`, `session_id varchar`, `turn_id varchar`, `record_type`,
  `attributes jsonb`, `quarantined_at`, `deleted_at`, `sequence`.
- Index `ix_records_project_id_session_id_turn_id (project_id, session_id, turn_id)` serves
  lookups by turn.
- The core and tracing databases are separate; no SQL join or transaction spans both.

## 7. Background loops in the API

- The API lifespan (`api/entrypoints/routers.py:331-429`) starts its loops in every API process.
- `orphan_sweep_loop` (the watchdog) runs every 60 s in every process with no global lock; it
  stays correct through per-session locks and idempotent writes.
- `attachment_sweep_loop` (`tasks/asyncio/sessions/attachment_sweep.py`) takes a lease per pass:
  `SET NX EX` on `locks:sessions:attachment-sweep` with TTL `max(2 x interval, 300)`, renews it
  with a compare-and-expire script between batches, releases it with compare-and-delete. A
  process without the lease skips the pass. It uses `LockEngine` (volatile Redis).
- `utils/locking.py` has `acquire_lock(namespace, key, ttl=...)` (`SET NX EX`).
- Redis: `REDIS_URI_VOLATILE` for cache and locks; `REDIS_URI_DURABLE` for streams
  (`dbs/redis/shared/engine.py`).

## 8. Streams (why the design does not use them)

- The records worker publishes `turn_ended` to `streams:sessions` only for turns with a `done`
  (`tasks/asyncio/sessions/records_worker.py:35-56,455-480`). Payload: `kind`, `project_id`,
  `session_id`, `turn_id`.
- The channels outbox is its only consumer group, and `StreamConsumer.ack_and_delete` deletes
  each entry after the ack (`tasks/asyncio/shared/consumer.py:279-293`).
- The records worker has no core-database reader and no taskiq producer
  (`records_worker.py:101-116`).

## 9. Taskiq

- No retry middleware is registered in `api/`. Trigger tasks carry `retry_on_error=True`
  labels that have no effect today. taskiq 0.12 ships `SmartRetryMiddleware`.
- `worker-queues` builds one broker per domain (`api/entrypoints/worker_queues.py`).

## 10. Email

- `utils/emailing.py`: `send_email` renders a fixed invite template with `str.format` and no
  escaping; it resolves the sender before checking whether email is enabled, so it raises
  `ValueError` when no sender is set; then SMTP, else SendGrid, else it logs and returns `True`.
- SMTP and SendGrid transports run in a thread. `SMTP_TIMEOUT` defaults to none, so an SMTP call
  has no timeout unless the variable is set.
- Config (`utils/env.py:1863-1910`): SMTP needs host, port and sender; SendGrid needs
  `SENDGRID_API_KEY` and a sender.
- No shared HTML-escape helper exists; modules call `html.escape` directly.
- No compose file has an SMTP capture service. Email tests use fakes
  (`api/oss/tests/pytest/unit/test_email_service.py`).
- Callers today: org invites (`services/organization_service.py:154,494`) and admin password
  reset (`services/user_service.py:161`).

## 11. Recipients and links

- `created_by_id` on schedules and subscriptions is a `users.id` (set from
  `request.state.user_id`; API keys use their creator).
- `db_manager.get_project_members(project_id)` returns `ProjectMemberDB` rows with `user`,
  `role` and `is_demo`; it does not filter `deleted_at`. Roles include `owner`, `admin`,
  `developer`, `editor`, `annotator`, `viewer`. The organization owner always has full access.
- `users.email` defaults to `demo@agenta.ai` (`models/db_models.py:113`).
- A run started from a Slack or Telegram channel can carry the agent creator's id
  (`tasks/asyncio/channels/inbox.py:197,598,840`).
- The mobile app is served under `/m` (`web/mobile/next.config.ts:29`). Automation run history:
  `/m/w/{workspace_id}/p/{project_id}/automations/{automation_id}?view=runs`. No URL opens one
  single run.
- `AGENTA_WEB_URL` (`utils/env.py:716`) is the app base address.

## 12. Delivery API and app

- Endpoints: `GET /deliveries`, `POST /deliveries/query`, `GET /deliveries/{id}`
  (`apis/fastapi/triggers/router.py:428-446`), returning the `TriggerDelivery` DTO
  (`core/triggers/dtos.py:385`), mapped by `map_delivery_dbe_to_dto`
  (`dbs/postgres/triggers/mappings.py:217`).
- The app reads deliveries with axios and the zod schema `triggerDeliverySchema`
  (`web/packages/agenta-entities/src/gatewayTrigger/core/types.ts:321`, `.passthrough()`).
- Status is read in `web/packages/agenta-automation-ui/src/automationModel.ts:160`
  (`deliveryOutcome`), `runModel.ts`, `runListView.ts`, `useAutomationRuns.ts`, and in
  `web/packages/agenta-entity-ui/src/gatewayTrigger/drawers/DeliveryDetails.tsx` and
  `TriggerDeliveriesDrawer.tsx`.

## 13. Cron base URL per deployment

- The API app has `root_path="/api"` (`api/entrypoints/routers.py:584-588`), so it serves both
  `/admin/...` and `/api/admin/...`.
- Compose: host `api` exists on the compose network; `http://api:8000/admin/...` works.
- Helm: the API Service is `<fullname>-api` on port 8000 (`templates/api-service.yaml:5`);
  no Service is named `api`. `AGENTA_API_INTERNAL_URL` is emitted only when
  `agenta.apiInternalUrl` is set (`_helpers.tpl:1066-1068`), and `values.yaml` has no default.
- Railway: the cron image sets `AGENTA_API_INTERNAL_URL=http://api.railway.internal:8000/api`;
  the scripts ignore it. Whether plain `api` resolves on Railway is not known from the repo.

## 14. Related findings outside this feature

- `records.sh` (records retention) is in no crontab, so it never runs. Locally 9,337 records are
  older than 7 days.
- The refresh handler always answers HTTP 200, so cron logs cannot show a failed refresh.
- An edit request without `flags` resets a subscription's `is_valid` to `true`.
- Revoking a gateway connection does not stop its subscriptions; Composio keeps sending events.
- The ORM model lacks `ix_trigger_deliveries_schedule_id_created_at`, which the migration
  creates.
