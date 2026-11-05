# Automation failure emails

Status: proposal, not implemented. It replaces the v1 plan discussed in Slack and the v0 plan on
branch `docs/automation-failure-alerts-plan`. [design.md](design.md) gives every fact with its file
and line, and the decisions the owner has not confirmed. [review-loop.md](review-loop.md) records the
review rounds.

## Why

An automation (a schedule or an event subscription) can stop working, and nobody is told:

- After a run starts, its trigger delivery stays at `202 dispatched` for good
  (`api/entrypoints/worker_queues.py:285-291`). The run's outcome is recorded in `session_executions`
  (`api/oss/src/apis/fastapi/sessions/router.py:1601-1616`), but nothing copies it to the trigger
  delivery, so the automations screen shows a failed run as pending.
- When a run fails before the agent loop (for example, no sandbox), the runner records it as
  completed (`services/runner/src/server.ts:1145-1153`, `:1215-1226`).
- When the platform pauses an automation (`403`: its agent was deleted, access was denied, or it has
  no principal), only the trigger delivery and the automation's `meta.paused_reason` show it
  (`api/oss/src/tasks/asyncio/triggers/dispatcher.py:651-685`).
- A failed start (`500`) is not retried: no taskiq retry middleware is registered
  (`api/oss/src/tasks/taskiq/shared/broker.py:94-99`).
- The email code can send only the invitation template, with no plain-text part
  (`api/oss/src/utils/emailing.py:17-45`, `:157`).

## What Changes

- **Runner fix.** A run that fails before the agent loop is recorded as failed, not completed.
- **Run outcomes.** One admin route, called by cron every minute, copies how each run ended from
  `session_executions` to the trigger delivery's `data.outcome`. The automations screen shows the
  real result. This runs whether or not email is on.
- **Failure notifications.** When an automation starts failing, the same route opens one
  notification for it. It stays open until the automation is fixed. While it is open, more failures
  send nothing.
- **Notifications base.** Two new tables: `notifications` (one open row per automation) and
  `notification_deliveries` (one row per recipient and channel). v1 has one kind,
  `automation_failing`, and one channel, `email`.
- **Email.** After settling, the same request sends the new deliveries, with HTML and plain text,
  escaped values, timeouts and 5 attempts.
- **Outage brake.** When platform failures come from more than 10 projects, they open no
  notification for 15 minutes, so an outage does not email every customer at once.
- **Switch.** `AGENTA_NOTIFICATIONS_EMAIL_ENABLED` (default `true`) turns email off. Notifications
  are still recorded.

What counts as a failure, one email per automation:

| Trigger delivery | Meaning | Email |
|---|---|---|
| `400 failed` | The run could not be prepared | yes |
| `403 failed` | The platform paused the automation | yes |
| `422 skipped` | The agent's model needs setup | yes |
| `500 failed` | The run could not start | yes, on the first one |
| `202`, the run failed | The run failed, also when the watchdog ended it | yes |
| `202`, the run was cancelled or waits for a person | A person stopped it, or it waits | no |
| `409 failed` | A person revoked the subscription | no |
| `200 success` with `is_test` | A test capture | no |

A notification is resolved by the next run that completes or reaches an approval, or by a person's
edit, start or delete of the automation.

## Capabilities

### New Capabilities

- `notifications`: the two tables, the template of a kind, the send step, the switch
  and the email sender.
- `automation-failure-notifications`: what opens and resolves a notification, the outage brake, the
  recipients, and the email content.
- `automation-run-outcomes`: the runner fix, the outcome of each run on its trigger delivery, and the
  automations screen.

### Modified Capabilities

None. No shipped spec covers automations.

## Non-goals

- An email about a connection. Nothing detects an expired provider login (design G9a); a daily
  connection health check is follow-up 1.
- An email when a run waits for a person (D7), and the agent's name in the email (D10).
- Trigger deliveries stuck at `102 claimed`, and the missing taskiq retry middleware (separate bugs,
  design section 11).
- Per-user settings, reminders, recovery emails, digests, cooldowns, retention.
- Slack, Telegram and in-app channels, and any column only they would use.
- Other notification kinds, for example low credits.

## Impact

- Runner: `services/runner/src/server.ts` (the fallback `done` keeps `stopReason: "error"`).
- API: new `api/oss/src/core/notifications/` and `api/oss/src/dbs/postgres/notifications/`;
  `api/oss/src/core/triggers/outcomes.py` and `failure_notifications.py`; one admin route,
  `POST /admin/triggers/deliveries/settle`; `emailing.py`; `env.py`; new methods on
  `RecordsDAOInterface`, `TriggersDAOInterface` and `MembershipsService`.
- Cron: one more line in `api/oss/src/crons/triggers.txt`. No new cron file.
- Database: one `core_oss` revision that creates two tables, and one that builds one partial index
  on `trigger_deliveries` concurrently. No column is added to an existing table.
- Frontend: `web/packages/agenta-automation-ui` reads `data.outcome` on `202` trigger deliveries;
  the zod schema gains `outcome`.
- Editions: OSS and EE, from the shared `core_oss` chain.
- Self-hosting: the release notes and the self-hosting docs name `AGENTA_NOTIFICATIONS_EMAIL_ENABLED`.
