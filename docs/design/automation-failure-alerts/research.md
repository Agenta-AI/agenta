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
- The crontab is built from a hard-coded list of `*.txt` files in 4 Dockerfiles
  (`Dockerfile.gh:96-127` and `Dockerfile.dev:62-76`, in `api/oss/docker` and `api/ee/docker`): queries,
  triggers and gateways in OSS; meters, spans and events added in EE. `records.txt` exists but
  is not in the list. Railway uses the OSS image, so it runs the OSS crons only.
- `triggers.sh` runs every minute and POSTs to
  `http://api:8000/admin/triggers/schedules/refresh` with `Authorization: Access <key>`. A curl
  failure is caught and the script exits 0.
- `TriggersService.refresh_schedules` (`core/triggers/service.py:1679-1780`) returns one bool
  (False for a fetch error, a missing taskiq client, or any per-schedule failure). It loads active
  schedules across all projects, turns off schedules past `end_time` (1713-1721), checks
  `croniter.match` for one timestamp only (no catch-up), builds
  `event_id = "{schedule_id}:{tick_iso}"`, dedups, and enqueues `triggers.dispatch_schedule`.
- The refresh handler (`apis/fastapi/triggers/router.py:1474-1498`) answers HTTP 200 with
  `{"status": "failure"}` when the service reports a failure, and 200 with `{"status": "error"}`
  when `trigger_datetime` is missing. Unhandled exceptions and auth failures give a non-200.

### Event automations (Composio)

- When Composio is enabled, the API finds or creates one Composio webhook at startup
  (`core/triggers/providers/composio/adapter.py:23,131-160`). A new webhook subscribes to
  `composio.trigger.message` only; an existing one is reused as it is. In local dev, events
  arrive through the compose service `composio` (profile `with-tunnel`,
  `api/entrypoints/dispatcher_composio.py`).
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
- `invoke_workflow_detached` returns `record_run_id or run_id`, so `data.result.run_id` can come
  from the first streamed record; the dispatcher's own id is the reliable one.
- `worker_queues.py` has three copies of `_dispatch_detached_run`: the triggers copy at line 247
  takes no `run_id`; the channels (317) and interactions (458) copies serve other paths. The
  copy in `routers.py:989` takes `run_id`. `invoke_workflow_detached(..., run_id=None, ...)`
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
| `500 failed` | detached start error | `str(e)`. Known texts: "Workflow service returned HTTP {code} on detached start: {body}", "Workflow service was never reached on detached start: ...", "Workflow service closed the stream before emitting a started record.", "Workflow revision has no runnable service URL.", "Detached workflow run failed to start.", errors from `_prepare_invoke`, or empty. The list is not closed. |

- A runnable that returns a batch (non-streaming) result to the NDJSON request answers HTTP 406
  (`sdks/python/agenta/sdk/decorators/routing.py:469-491,555`), so the delivery is `500` with
  "Workflow service returned HTTP 406 on detached start: ...". A runnable that fails answers
  with its own error status instead.
- Dedup (`dbs/postgres/triggers/dao.py:663-739`) reads only `status`. It treats a missing row
  and a `500` row as not seen; any other code as seen.

Local data (all `is_test` null):

| Code | Error | Count |
|---|---|---|
| 500 | "HTTP 500 on detached start" wrapping a `400` from `/workflows/revisions/resolve` | 99 (102 on a later count; the dev database is live) |
| 102 | none (stuck claims from 2026-09-20 11:35) | 40 |
| 500 | empty (dated 2026-08-27 to 09-11, before detached starts; likely inline timeouts) | 28 |
| 202 | none | 20 |
| 500 | "closed the stream before emitting a started record" | 8 |
| 500 | "Agent run failed: No user message to send (prompt/messages empty)." | 6 |
| 200 | none (inline) | 2 |

## 3. Writers of `trigger_deliveries`

| Function | Writes |
|---|---|
| `SessionStreamsDAO.claim_trigger_delivery` | insert; on a `500` conflict: id, created_by_id, status, data, updated_at |
| `TriggersDAO.write_subscription_delivery_if_live` (dispatcher `is_test` and `409` paths) | insert; on conflict (no WHERE, so it can overwrite a settled row): status, data (merged), updated_at, updated_by_id |
| `TriggersDAO.update_delivery` (dispatcher completion) | status, updated_at; `data` merged with `||` |
| `TriggersDAO.write_delivery` | no route caller; an unconditional upsert |
| Cascade deletes | from `projects`, `trigger_schedules`, `trigger_subscriptions` (and `gateway_connections` through subscriptions). Deleting a schedule or subscription through the API is a soft delete (`deleted_at`), so no cascade runs; `cleanup_test_subscription` hard-deletes test subscriptions (`service.py:1181`). |

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
- Of 206 local trigger sessions (one per delivery), 56 have records; 1 has two turns: the second is a
  follow-up message a person typed 4 hours 44 minutes later, not a continuation.

**Executions and interactions (core DB):**

- `session_executions` has a row for most turns that ended: the runner's ingest route settles
  every `done` that is not paused, cancelled or error (`apis/fastapi/sessions/router.py:1105-1118`),
  and control actions create rows too. It has no `created_at` column. Columns: `state`
  (`terminal`, `running`, `active`, `recoverable`, ...), `terminal_outcome` (`completed`,
  `continued`, `stopped`, `lost`, `not_running`), `error`, `parent_execution_id`,
  `source_interaction_id`. A failed turn whose `done` has no stop reason is settled
  `completed`, so this table cannot tell success from failure.
- `session_interactions` holds approvals: `session_id`, `turn_id`, `status` (`pending`,
  `responded`, `resolved`, `cancelled`), with a partial index on pending rows.

**Approval continuations** (`core/sessions/commands/service.py:599-866`):

- A paused turn has no `session_executions` row until someone acts on it.
- On approval, the API locks the paused turn's execution, settles it `continued`, creates a new
  execution with `execution_id = uuid4()` and `parent_execution_id` = the paused turn's id, and
  starts it with `run_id` = that new id. So the continuation's `turn_id` is the new id.
- A continuation can pause again; the next approval creates another child. Locally, chains of
  approval continuations reach 2; chains that mix approvals with a person's queued input reach
  6 turns.
- `parent_execution_id` is also set for a person's steer and queued-input turns
  (`commands/service.py:253,1531`) and for a replacement continuation created when a person
  sends after a lost continuation (`_reopen_continuation_attempt`, `:1057-1118`), which has no
  `source_interaction_id`. Approval continuations are the children with
  `source_interaction_id IS NOT NULL` (locally 67 of 86 children).
- When a continuation (or any child turn) in `pending_delivery` or `running` is lost, the
  watchdog sets its execution to `recoverable` with `error.code = continuation_execution_lost`
  and writes no record (`commands/service.py:1581-1612`). The commands sweep can later deliver
  it again under the same id. The watchdog writes `error` and `done` only for first turns.
- A Stop cancels pending approvals in a try/except that only logs (`sessions/router.py:533-551`),
  so a failed cleanup can leave an approval pending.
- **No deadline exists.** The watchdog's idle reclaim after 1800 s collapses the session flags
  but leaves the approval pending and answerable. A pending approval ends only when the run is
  stopped, the session is deleted, a new turn starts in the session, or the execution is
  terminal. Local: a trigger session has an approval pending since 2026-09-07.

## 5. How a turn ends

- Only a `done` record ends a turn (`core/sessions/records/dtos.py:18`). The runner's abandon
  path (`server.ts:1010-1021`) writes an `error` with code `execution_lost` and no `done`; the
  API does not treat that as terminal, and the watchdog later writes its own `error` and
  `done`.
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
- Records that arrive after a turn was ended by another writer (lost or stopped) are kept with
  `quarantined_at` set and excluded from reads; with `late_output = reject`
  (`utils/env.py:687`) they are dropped instead.
- Local non-quarantined `done` records after an `error`: 27 with no stop reason, 2 with
  `error`, 4 with `cancelled` (all "Sandbox acquisition was aborted.", a person's stop). With
  quarantined rows there is a fifth `cancelled`.
- Runner error codes (`engines/sandbox_agent/errors.ts:79-105`): `runner_error`,
  `starter_credits_*`, `credential_delivery_failed`, `rate_limited`, `session_turn_in_use`,
  `sandbox_gone`, `execution_lost`, `subscription_login_*`. `session_turn_in_use` is only sent
  as a live event and never stored as a record (`server.ts:844-866`).
- A dead sandbox is found by the runner's liveness probe, which writes `error` (`sandbox_gone`)
  and `done(error)`; the watchdog keys only on heartbeat age.
- `runner_error` is the most common code locally (15 of 33 errors; 12 of them "402 ...
  requires more credits"). It carries provider failures an owner can fix, such as used-up
  credits and failed model authentication, and some an owner cannot fix, such as "model is
  currently at capacity", which is provider text passed through (`errors.ts:413-503`). The
  runner's own "Runner at capacity (N concurrent runs)" (`server.ts:1512`) is an HTTP 429 on
  the start, not a record. `rate_limited` has two messages: "Too many requests right now..."
  for any text that matches `PROXY_RATE_LIMIT` (`errors.ts:124,151`), and "Too many requests to
  the model provider right now..." for provider quota errors (`:126`).
- Messages without a code: "No user message to send (prompt/messages empty)."
  (`run-plan.ts:797`, owner input problem) and "runtime_provided local run requires a mounted
  subscription: ..." (`run-plan.ts:104`, runner operator configuration such as
  `PI_CODING_AGENT_DIR`).
- Runner limits: total run 11 hours, counted after sandbox acquisition
  (`engines/sandbox_agent/run-limits.ts:39`, `AGENTA_RUNNER_RUN_TOTAL_TIMEOUT_MS`), hard
  deadline 11 hours 30 minutes counted from `run()`, before acquisition (`sessions/turn-settle.ts:42`,
  `AGENTA_RUNNER_TURN_HARD_DEADLINE_MS`), abandon grace 60 seconds
  (`AGENTA_RUNNER_TURN_ABANDON_GRACE_MS`), and a 30-minute no-progress timeout. A pause retires
  these deadlines.
- Records of one turn can be committed out of order: a failed project group stays pending for a
  reclaim after 30 seconds, an EE entitlements failure defers an organization, a batch can stop
  at its size limit (`records_worker.py:317`), and several consumers run in parallel. Record
  `sequence` is assigned during the insert from a per-session cursor (`records/dao.py:72-117`),
  when `sequence_writes` is on; older rows have none.
  `RecordsDAO._transcript_order` (`dbs/postgres/sessions/records/dao.py:262`) sorts sequenced
  rows by `sequence`, which is ingest order; the producer's order is `timestamp` then
  `record_index`. In EE, the records of an organization over its records quota are dropped and
  acknowledged (`records_worker.py:381-401`).

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
- `utils/locking.py` has `acquire_lock` (line 78, `SET NX EX`, returns an owner token or None),
  `renew_lock` (157) and `release_lock` (223). The compare scripts (lines 26-38) check ownership
  only when `owner=` is passed. Keys are packed as `cache:p:<12>:u:<12>:lock:{ns}:{key}`. A
  Redis error makes `acquire_lock` return None and `renew_lock` return False.
- The dev compose volatile Redis uses `volatile-lru`, so keys with a TTL can be evicted.
- Redis: `REDIS_URI_VOLATILE` for cache and locks; `REDIS_URI_DURABLE` for streams
  (`dbs/redis/shared/engine.py`).

## 8. Streams (why the design does not use them)

- The records worker publishes `turn_ended` to `streams:sessions` only for turns with a `done`
  (`tasks/asyncio/sessions/records_worker.py:35-56,455-480`). Payload: `kind`, `project_id`,
  `session_id`, `turn_id`. `SessionTurnsService.complete_turn` also publishes it.
- The channels outbox is its only consumer group, and `StreamConsumer.ack_and_delete` deletes
  each entry after the ack (`tasks/asyncio/shared/consumer.py:279-293`).
- The records worker reads and writes the core database (it settles `session_executions` and
  cancels `session_interactions`, `api/entrypoints/worker_streams.py:106-124`) but has no taskiq
  producer.

## 9. Taskiq

- No retry middleware is registered in `api/`. Trigger tasks carry `retry_on_error=True`
  labels that have no effect today. taskiq 0.12 ships `SmartRetryMiddleware`.
- `worker-queues` builds one broker per domain (`api/entrypoints/worker_queues.py`).

## 10. Email

- `utils/emailing.py`: `send_email` renders a fixed invite template with `str.format` and no
  escaping; it resolves the sender before checking whether email is enabled, so it raises
  `ValueError` when no sender is set; then SMTP, else SendGrid, else it logs and returns `True`.
- SMTP and SendGrid transports run in a thread. `SMTP_TIMEOUT` defaults to none, so an SMTP call
  has no timeout unless the variable is set; it is read only in `emailing.py`.
- `SendGridAPIClient` (sendgrid 6.12.5) takes no timeout, but its `python_http_client.Client`
  does; setting `client.timeout` after construction applies to requests.
- Config (`utils/env.py:1863-1910`): SMTP needs host, port and sender; SendGrid needs
  `SENDGRID_API_KEY` and a sender.
- No shared HTML-escape helper exists; modules call `html.escape` directly.
- No compose file has an SMTP capture service. Email tests use fakes
  (`api/oss/tests/pytest/unit/test_email_service.py`).
- Callers today: org invites (`services/organization_service.py:154`), a notice to workspace
  admins when a member joins (`:494`), and admin password reset (`services/user_service.py:161`).

## 11. Recipients and links

- `created_by_id` on schedules and subscriptions is a `users.id` (set from
  `request.state.user_id`; API keys use their creator).
- `db_manager.get_project_members(project_id)` returns `ProjectMemberDB` rows with `user`,
  `role` and `is_demo`; it does not filter `deleted_at`. Roles include `owner`, `admin`,
  `developer`, `editor`, `annotator`, `viewer`. The organization owner always has full access.
- `users.email` defaults to `demo@agenta.ai` (`models/db_models.py:113`).
- A run started from a Slack or Telegram channel uses the agent creator's id only when the
  sender has no linked account (`tasks/asyncio/channels/inbox.py:598,840`).
- The mobile app is served under `/m` (`web/mobile/next.config.ts:29`). Automation run history:
  `/m/w/{workspace_id}/p/{project_id}/automations/{automation_id}?view=runs`. A run's
  transcript: `/m/w/{workspace_id}/p/{project_id}/sessions/{session_id}` (not for runs that failed
  before the start, whose session is abandoned). `projects.workspace_id` is not null.
- `AGENTA_WEB_URL` (`utils/env.py:716`) is the app base address.

## 12. Delivery API and app

- Endpoints: `GET /deliveries`, `POST /deliveries/query`, `GET /deliveries/{id}`
  (`apis/fastapi/triggers/router.py:428-446`), returning the `TriggerDelivery` DTO
  (`core/triggers/dtos.py:385`), mapped by `map_delivery_dbe_to_dto`
  (`dbs/postgres/triggers/mappings.py:217`).
- The app reads deliveries with axios and the zod schema `triggerDeliverySchema`
  (`web/packages/agenta-entities/src/gatewayTrigger/core/types.ts:321`, `.passthrough()`).
- Status is read in `web/packages/agenta-automation-ui/src/automationModel.ts:160`
  (`deliveryOutcome`), `runModel.ts`, `runListView.ts`, `useAutomationRuns.ts`,
  `AutomationRunPane.tsx`, `AutomationRunRow.tsx`, and in
  `web/packages/agenta-entity-ui/src/gatewayTrigger/drawers/DeliveryDetails.tsx` and
  `TriggerDeliveriesDrawer.tsx`.

## 13. Cron base URL per deployment

- The API serves both `/admin/...` and `/api/admin/...`: `ApiPrefixStripMiddleware`
  (`api/oss/src/middlewares/prefix.py`, added in `api/entrypoints/routers.py`) removes the
  `/api` prefix.
- Compose: host `api` exists on the compose network; `http://api:8000/admin/...` works.
- Helm: the API Service is `<fullname>-api` on port 8000 (`templates/api-service.yaml:5`);
  no Service is named `api`. `AGENTA_API_INTERNAL_URL` is emitted only when
  `agenta.apiInternalUrl` is set (`_helpers.tpl:1066-1068`), and `values.yaml` has no default.
- Railway: the cron image sets `AGENTA_API_INTERNAL_URL=http://api.railway.internal:8000/api`;
  the scripts ignore it. Whether plain `api` resolves on Railway is not known from the repo.

## 14. Related findings outside this feature

- `records.sh` (records retention) is in no crontab, so it never runs. Locally 9,337 records are
  older than 7 days.
- The refresh handler answers HTTP 200 when the refresh failed, and `triggers.sh` then prints
  "✅ Schedule refresh completed successfully" next to the `{"status":"failure"}` body and exits
  0.
- An edit request whose body leaves out `is_valid` resets it to `true` (and the edit also resets
  `is_active` from the body).
- Revoking a gateway connection does not stop its subscriptions; Composio keeps sending events.
- The ORM model lacks `ix_trigger_deliveries_schedule_id_created_at`, which the migration
  creates.
