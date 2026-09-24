# Research: How Automations Work Today

All statements were read from the code and checked in three independent passes on
2026-09-24 and 2026-09-25. Local numbers come from the EE dev stack
(`agenta_ee_core`, `agenta_ee_tracing`), not from production. Paths are relative to the repo
root. Short paths such as `core/triggers/service.py` are under `api/oss/src/`.

## 1. Two entry paths, one dispatcher

### Scheduled automations (no Composio)

1. A `cron` container runs `supercronic /app/crontab` in every deployment target (compose,
   Helm `templates/cron-deployment.yaml`, Railway `hosting/railway/oss/cron/Dockerfile`).
2. `api/oss/src/crons/triggers.sh` runs every minute (`triggers.txt`). It POSTs to
   `http://api:8000/admin/triggers/schedules/refresh` with the `Access` key. A curl failure is
   caught and the script exits 0.
3. `TriggersService.refresh_schedules` (`api/oss/src/core/triggers/service.py:1679-1780`)
   loads active schedules across all projects, deactivates schedules past `end_time`, checks
   `croniter.match` for one timestamp only (no catch-up), builds
   `event_id = "{schedule_id}:{tick_iso}"`, dedups, and enqueues `triggers.dispatch_schedule`.
4. The admin route requires the `Access` key (`api/oss/src/middlewares/auth.py`). It skips
   only permission and entitlement checks.

### Event automations (Composio)

1. At startup the API finds or creates one Composio webhook subscribed to
   `composio.trigger.message` only (`core/triggers/providers/composio/adapter.py:23,131-160`).
   It reuses an existing webhook without checking its events, and re-runs this lazily after a
   signature mismatch (`core/triggers/utils.py:27-68`).
2. Creating a subscription upserts a Composio trigger instance and stores its `ti_*` id.
3. `POST /triggers/composio/events/` (`apis/fastapi/triggers/router.py:1573-1627`) checks
   timestamp freshness, then HMAC, then webhook-id replay; enqueues `triggers.dispatch`;
   answers 202. Enqueue failure answers 503. A body without a trigger id answers 202 and does
   nothing.
4. The worker finds the subscription by `ti_*` across projects and refuses if two projects
   match.

### Dispatch and run

- Only the `worker-queues` dispatcher runs. The instance built in `api/entrypoints/routers.py`
  sits on a producer-only broker. Both use `_dispatch_detached_run`
  (`api/entrypoints/worker_queues.py:247-270`).
- `_run` (`api/oss/src/tasks/asyncio/triggers/dispatcher.py:224-362`):
  1. Claim: one write inserts the delivery at `102 claimed` and a `session_streams` row tagged
     `ag.origin=trigger`, `ag.trigger.id`, `ag.trigger.kind`, `ag.trigger.delivery_id`, only
     if the parent is live.
  2. Input mapping or missing reference: `400 failed`, session soft-deleted.
  3. `invoke_workflow_detached` (`core/workflows/service.py:3295-3345`) mints
     `run_id = uuid4()`, puts it in `request.meta`, POSTs `/invoke`, and returns on the first
     NDJSON record. Triggers do not pass `strict_start`, so an error frame as the first record
     still counts as started.
  4. Start error: `500 failed`, session soft-deleted, task re-raises (no effect, see below).
  5. Success: `202 dispatched` with `data.result.run_id`.
- An invalid subscription writes `409 failed` with no claim and no session.
- A trigger can target any workflow, not only agents (`service.py:846-906`). A batch handler
  answers 406 to the NDJSON request, so the delivery becomes `500`.

## 2. The run's id is the runner's turn id

| Hop | Code |
|---|---|
| API sets `meta.run_id` | `api/oss/src/core/workflows/service.py:3316-3321` |
| SDK sets `turn_id = meta.run_id` | `sdks/python/agenta/sdk/agents/handler.py:494` |
| SDK sends `turnId` | `sdks/python/agenta/sdk/agents/utils/wire.py:183-184` |
| Runner uses it (else a random id) | `services/runner/src/server.ts:235-237,488-492` |
| Records store it | `services/runner/src/sessions/persist.ts:99` |

Local check: 20 of 20 deliveries at `202` join to their records on
`(project_id, session_id, turn_id = data.result.run_id)`. Each of these sessions has exactly
one turn.

An approval continuation runs as a new turn in the same session. The chain is
`parent_execution_id` in the executions table and the command's `expected_turn_id`
(`api/oss/src/core/sessions/commands/service.py:796-818`).

## 3. Where state lives

| Store | Database | Holds |
|---|---|---|
| `trigger_schedules`, `trigger_subscriptions` | core | Automation definitions, flags, `created_by_id` |
| `trigger_deliveries` | core | One row per fire: `status {code, message}` (free-form, no enum), `data` (`session_id`, `result.run_id`, `error` string, `is_test`) |
| `session_streams` | core | Session row with `ag.*` tags; flags `is_alive`, `is_running` |
| `records` | tracing | Turn records: `turn_id`, `record_type`, `attributes` JSONB, `quarantined_at` |

- No single transaction or SQL join covers core and tracing.
- `TriggerDeliveryData` (`core/triggers/dtos.py:368-382`) is a closed Pydantic model: unknown
  keys are dropped.
- Index `ix_trigger_deliveries_schedule_id_created_at` exists in migration `oss000000003` but
  not in the ORM model (`dbs/postgres/triggers/dbes.py:109-135`).
- Editing a schedule or subscription replaces `meta`, `data` and `flags` whole
  (`dbs/postgres/triggers/mappings.py:103-107,176-180`).

## 4. How a failure shows in the records

- Error records carry `attributes.code` and `attributes.message`.
- Many error records have no code. The runner's backstop `persistError(message)` in
  `server.ts` sends none. Engine errors carry codes (`runner_error` and others); the watchdog
  writes `execution_lost` (`api/oss/src/tasks/asyncio/sessions/orphan_sweep.py:180`).
  Local counts: 16 without code, 15 `runner_error`, 2 `execution_lost`.
- `done.stopReason` values written: `paused`, `cancelled`, `error` (`services/runner/src/tracing/otel.ts:2204-2209`)
  and `cancelled` in the backstop. Local `done` counts: 472 none, 155 paused, 38 cancelled,
  2 error.
- All 3 failed automation turns locally end with a `done` that has no `stopReason`. The
  abandon path (`server.ts:1019`) writes an `error` and no `done`.
- "The agent produced no output" exists only as a live-stream frame in the SDK Vercel adapter
  (`sdks/python/agenta/sdk/agents/adapters/vercel/stream.py:426,720`). It is never stored.
- Runner error codes: `runner_error`, `starter_credits_*`, `credential_delivery_failed`,
  `rate_limited`, `session_turn_in_use`, `sandbox_gone`, `execution_lost`,
  `subscription_login_*` (`services/runner/src/engines/sandbox_agent/errors.ts:79-105`),
  plus `continuation_execution_lost` from the API.

## 5. Failure points and what records them today

| Failure | Recorded as | Visible in app |
|---|---|---|
| Agent fails after start (common case) | stays `202`; error record only | "Running" forever |
| Runner dies, watchdog settles `execution_lost` | error record; delivery untouched | "Running" forever |
| Worker crash between claim and start | stuck at `102`; dedup skips redelivery | "Running" forever |
| Input mapping, missing reference | `400 failed` | Failed row and banner |
| Invalid subscription | `409 failed` | Failed row and banner |
| Start error, non-agent target (406) | `500 failed` | Failed row and banner |
| Cron cannot reach the API | nothing | Silent |
| Missed tick (API slow or down) | nothing | Silent |
| Unknown `ti_*`, inactive parent | log only | Silent |
| Connection revoked | nothing; Composio keeps sending events and runs continue | Silent |
| Composio disable or delete fails | `meta.needs_provider_cleanup`, never read | Hidden |

## 6. Retries do not run

- Trigger tasks set `retry_on_error=True, max_retries=5`, but no taskiq retry middleware is
  registered anywhere in `api/`. taskiq 0.12.4 acks a task that raises.
- `xautoclaim` (idle 10 minutes) re-delivers only after a worker crash, and dedup then skips
  the row at `102`.
- A `500` is final for schedules: the next tick has a new `event_id`.
- Local: 40 deliveries stuck at `102` from 2026-09-20, each with a live session and zero
  records.

## 7. Streams and signals

- The records worker publishes `turn_ended` to `streams:sessions` after commit
  (`api/oss/src/tasks/asyncio/sessions/records_worker.py:455-480`). Payload: `kind`,
  `project_id`, `session_id`, `turn_id` only. It fires for paused turns too, and again for a
  late quarantined `done`.
- `SessionTurnsService.complete_turn` also publishes it, only from the sessions router, which
  trigger runs do not use.
- The channels outbox is the only consumer group of `streams:sessions`. `SessionEventsWorker`
  exists but is not wired (`api/entrypoints/worker_streams.py:214-245`).
- `StreamConsumer.ack_and_delete` runs `XACK` then `XDEL`
  (`api/oss/src/tasks/asyncio/shared/consumer.py:279-293`), so a second consumer group misses
  entries.
- `streams:records` uses approximate MAXLEN 100k; entries can be trimmed if worker-streams is
  down.
- `streams:events`: OSS and EE consume it for webhooks; the ingest step is EE-only. It has no
  reclaim. EE drops events for an org over its `EVENTS_INGESTED` quota. `EventType` and
  `WebhookEventType` have no session, run or trigger types.
- The watchdog (`orphan_sweep.py`) settles runs with a heartbeat older than 90 s and never
  touches deliveries. Worst case to settle a dead runner: about 3 minutes. A hung runner that
  still sends heartbeats: up to the 11-hour hard limit plus 30 minutes.

## 8. Email infrastructure

- `api/oss/src/utils/emailing.py` `send_email(to_email, subject, username, action, workspace, call_to_action)`:
  renders one invite-shaped template without escaping, then uses SMTP if enabled, else
  SendGrid. It raises `ValueError` if no sender is set. It returns `True` without sending if a
  sender is set but no transport. With SMTP enabled it never falls back to SendGrid.
- Transport functions `_send_smtp_email` and `_send_sendgrid_email` take
  `(to_email, subject, html_content, from_email)` and run in a thread.
- Callers: org invites (`services/organization_service.py:154,494`) and admin password reset
  (`services/user_service.py:161`). Each first checks `env.smtp.enabled or env.sendgrid.enabled`.
- Config (`api/oss/src/utils/env.py:1863-1910`): SMTP needs host, port and sender. SendGrid
  needs `SENDGRID_API_KEY` and a sender from `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_ADDRESS`,
  `AGENTA_AUTHN_EMAIL_FROM` or `AGENTA_SEND_EMAIL_FROM_ADDRESS`.
- `AGENTA_WEB_URL` (`env.py:716`) gives the app address for links.
- No email templates, recipient logic or preferences exist for runs.

## 9. Recipients

- `created_by_id` is always a real user. Session auth uses the session user; API keys use
  `api_key.created_by_id`; build-kit calls carry the calling user's id.
- A run started from a Slack or Telegram channel can use the agent creator's id
  (`api/oss/src/tasks/asyncio/channels/inbox.py:197,598,840`).
- `users.email` defaults to the placeholder `demo@agenta.ai` (`models/db_models.py:113`).
- Membership: `get_project_members` (`services/db_manager.py:2510`).

## 10. Frontend (web/mobile and web/packages)

- Run history reads deliveries (`useAutomationRuns.ts`). `deliveryOutcome`
  (`web/packages/agenta-automation-ui/src/automationModel.ts:160`) maps `success` to ok,
  `failed` to bad, anything else to pending, shown as "Running" (`runModel.ts:167-179`).
- "Needs attention" exists but every call passes `hasRecentFailure=false`
  (`AutomationCardBody.tsx:31`, `AutomationListScreen.tsx:226`, `automationListView.ts:74`).
- `AutomationFailureBanner` shows only when the newest delivery is `failed`.
- `AutomationRunConversation.tsx` mounts a live conversation with a composer, so users can add
  turns to an automation's session.
- `RunFailureCallout.tsx` (`web/packages/agenta-chat`) already groups runner codes into
  starter-credit, subscription-login and retryable sets.
- Mobile "Run now" starts a manual session with no delivery, so it never reaches alerts.
  `is_test` deliveries are `200` with `data.is_test=true`; the inline path also writes `200`,
  so filter on `data.is_test`, not on the code.

## 11. Infrastructure findings outside this feature

- All 7 cron scripts hard-code `http://api:8000` with no override: triggers, evaluations
  refresh, MCP OAuth sweep, and EE meters, events, spans, records. The Helm service is named
  `<fullname>-api`, so every cron job fails on Helm. Railway uses `*.railway.internal`; short
  `api` probably fails there too. Cloud config is not in this repo.
- `records.sh` is in no crontab, image or compose file, so records retention never runs.
  Locally 9,337 records are older than 7 days.
- An edit request without `flags` resets `is_valid` to `true`, which re-enables a revoked
  subscription.
- Revoking a gateway connection only flips `gateway_connections.is_valid`. Composio keeps
  sending events and the dispatcher never checks the connection.
- Deleting a connection hard-deletes it and cascades to its subscriptions and deliveries.
- Triggers are not gated by entitlements in OSS or EE.

## 12. Local data sample (EE dev, not production)

| Measure | Value |
|---|---|
| Schedules | 14 total, 7 active, 1 project |
| Subscriptions | 3 active |
| Deliveries | 200 total: 138 `500`, 40 `102`, 20 `202`, 2 `200` |
| Top `500` errors | "Workflow service returned HTTP 500 on detached start" 96, blank 28, "closed the stream before emitting a started record" 8, "No user message to send" 6 |
| `202` runs in last 7 days | 6: 3 failed (no error code), 3 succeeded |

Production numbers are still needed. The read-only queries are in [sizing.sql](./sizing.sql)
(steps: core inventory and daily runs; export dispatched turns to CSV; tracing outcome split,
top codes and worst hour). They were tested on the local EE database.
