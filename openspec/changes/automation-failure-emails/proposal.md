# Automation failure emails

Status: proposal, not implemented. It replaces the v1 plan discussed in Slack and the v0 plan on
branch `docs/automation-failure-alerts-plan`. [design.md](design.md) lists every fact with its
file and line, and every decision the owner has not confirmed yet.

## Why

An automation (a schedule or an event subscription) can stop working, and nobody is told. Four
facts cause this:

- After a run starts, its delivery stays at `202 dispatched` for good. Nothing writes how the run
  ended (`api/entrypoints/worker_queues.py:285-291`, `api/oss/src/tasks/asyncio/triggers/dispatcher.py:492-494`).
  The automations screen shows such a run as pending, also when it failed.
- When the platform pauses an automation (`403`: the agent was deleted, access was denied, or the
  automation has no principal), only the delivery row records it (`dispatcher.py:651-685`,
  `api/oss/src/dbs/postgres/triggers/dao.py:562-620`).
- A failed start (`500`) is not retried. The task sets `max_retries=5`, but no retry middleware is
  registered on the broker (`api/oss/src/tasks/taskiq/triggers/worker.py:36-40`,
  `api/oss/src/tasks/taskiq/shared/broker.py:94-99`). In taskiq 0.12.4 only the retry middleware
  reads `retry_on_error`.
- The email code can send only the invitation template. It has no plain-text part and no
  HTML escaping (`api/oss/src/utils/emailing.py:17-45`, `:157`).

## What Changes

- **Run outcomes.** A background pass decides how each automation run ended and writes it to the
  delivery as `data.outcome`. The automations screen shows the real result. This runs whether or
  not email is on.
- **Failure notices.** When an automation starts failing, the pass opens one notification for it.
  The notification stays open until the automation is fixed. While it is open, more failures send
  nothing.
- **Notifications foundation.** Two new tables: `notifications` (what happened, one open row per
  key) and `notification_deliveries` (who gets it, on which channel). v1 has one kind,
  `automation_failing`, and one channel, `email`.
- **Email.** A second background pass sends pending email deliveries, with HTML and plain text,
  escaped values, a timeout, and a fixed number of attempts.
- **Switch.** `AGENTA_NOTIFICATIONS_EMAIL_ENABLED` (default `true`) turns email off. Notifications
  are still recorded, and their email deliveries are marked `skipped`. With no email provider set
  up, deliveries are also `skipped`.

What counts as a failure, one email per automation:

| Delivery | Meaning | Email |
|---|---|---|
| `400 failed` | The run could not be prepared (no agent reference, input mapping failed) | yes |
| `403 failed` | The platform paused the automation | yes |
| `422 skipped` | The agent's model needs setup | yes |
| `500 failed` | The run could not be started | yes, on the first one |
| `202`, run ended with an error | The run failed, also when the watchdog closed it | yes |
| `202`, run ended `cancelled` or `paused` | A person stopped it, or it waits for a person | no |
| `409 failed` | A person revoked the subscription | no |
| `200 success` with `is_test` | A test capture | no |

A notification closes when the next run of the automation succeeds, or when a person edits,
starts, stops, refreshes or deletes the automation.

## Capabilities

### New Capabilities

- `notifications`: the two tables, the email send pass, the switch, and the email sender.
- `automation-failure-notices`: what counts as a failure, when a notification opens and closes,
  who receives it, and the email content.
- `automation-run-outcomes`: the outcome of each automation run, written to its delivery and
  shown on the automations screen.

### Modified Capabilities

None. No shipped spec covers automations today.

## Non-goals

- Email about a connection. Nothing detects a revoked or expired connection on the provider side.
  A revoke from the app is a person's action and disables the provider trigger
  (`api/oss/src/core/gateway/connections/service.py:267-299`, `api/oss/src/core/triggers/service.py:1393-1413`).
- Email when a run waits for a person (v0 requirement A4). See design decision D7.
- Deliveries stuck at `102 claimed`. Nothing sweeps them today. This is a separate bug.
- Adding the taskiq retry middleware. This is a separate bug, because it changes the webhooks,
  channels-inbox and interactions workers too.
- Per-user settings, reminders, recovery emails, digests, grouping.
- Slack, Telegram and in-app channels, and any column only they would use.
- Other notification kinds (for example, low credits).

## Impact

- API: new domain `api/oss/src/core/notifications/` and `api/oss/src/dbs/postgres/notifications/`;
  new code in `api/oss/src/core/triggers/`; two loops in the API lifespan; `emailing.py`;
  `env.py`; two new DAO methods (records, memberships).
- Database: one `core_oss` revision that creates two tables, and one revision that builds an index
  on `trigger_deliveries (created_at)` concurrently. No column is added to `trigger_deliveries`.
- Frontend: `web/packages/agenta-automation-ui` reads `data.outcome`.
- Editions: OSS and EE, from the shared `core_oss` chain.
