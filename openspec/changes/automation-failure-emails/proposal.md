# Automation failure emails

Status: proposal, not implemented. It replaces the v1 plan discussed in Slack and the v0 plan on
branch `docs/automation-failure-alerts-plan`. [design.md](design.md) lists every fact with its file
and line, and every decision the owner has not confirmed. [review-loop.md](review-loop.md) records
the review rounds.

## Why

An automation (a schedule or an event subscription) can stop working, and nobody is told:

- After a run starts, its trigger delivery stays at `202 dispatched` for good. Nothing records how
  the run ended (`api/entrypoints/worker_queues.py:285-291`). The automations screen shows a failed
  run as pending.
- When the platform pauses an automation (`403`: its agent was deleted, access was denied, or it has
  no principal), only the trigger delivery and the automation's `meta.paused_reason` record it
  (`api/oss/src/tasks/asyncio/triggers/dispatcher.py:651-685`, `api/oss/src/dbs/postgres/triggers/dao.py:69-88`).
- A failed start (`500`) is not retried. The task sets `max_retries=5`, but no retry middleware is
  registered (`api/oss/src/tasks/taskiq/triggers/worker.py:36-40`, `api/oss/src/tasks/taskiq/shared/broker.py:94-99`).
- The email code can send only the invitation template, with no plain-text part and no HTML
  escaping (`api/oss/src/utils/emailing.py:17-45`, `:157`).

## What Changes

- **Run outcomes.** A background pass settles each trigger delivery: it writes how the run ended to
  `data.outcome`. The automations screen shows the real result. This runs whether or not email is on.
- **Failure notifications.** When an automation starts failing, the pass opens one notification for
  it. It stays open until the automation is fixed. While it is open, more failures send nothing.
- **Notifications base.** Two new tables: `notifications` (what happened, one open row per key) and
  `notification_deliveries` (who gets it, on which channel). v1 has one kind, `automation_failing`,
  and one channel, `email`.
- **Email.** A second background pass sends pending notification deliveries, with HTML and plain
  text, escaped values, a 30-second client timeout, and 5 attempts.
- **Switch.** `AGENTA_NOTIFICATIONS_EMAIL_ENABLED` (default `true`) turns email off. Notifications
  are still recorded, and their notification deliveries become `skipped`.

What counts as a failure, one email per automation:

| Trigger delivery | Meaning | Email |
|---|---|---|
| `400 failed` | The run could not be prepared | yes |
| `403 failed` | The platform paused the automation | yes |
| `422 skipped` | The agent's model needs setup | yes |
| `500 failed` | The run could not start | yes, on the first one |
| `202`, the run ended with an error | The run failed, also when the watchdog ended it | yes |
| `202`, the run ended cancelled or waiting for a person | A person stopped it, or it waits | no |
| `409 failed` | A person revoked the subscription | no |
| `200 success` with `is_test` | A test capture | no |

A notification is resolved by the next successful run, or by a person's edit, start, refresh or
delete of the automation.

## Capabilities

### New Capabilities

- `notifications`: the two tables, the kinds, the send pass, the switch and the email sender.
- `automation-failure-notifications`: what opens and resolves a notification, the recipients, and
  the email content.
- `automation-run-outcomes`: the outcome of each automation run on its trigger delivery, and on the
  automations screen.

### Modified Capabilities

None. No shipped spec covers automations.

## Non-goals

- An email about a connection. Nothing detects a revoked or expired connection on the provider side
  (design G9).
- An email when a run waits for a person (design D7).
- The agent's name in the email (design D10).
- Trigger deliveries stuck at `102 claimed`, and the missing taskiq retry middleware. Both are
  separate bugs (design section 11).
- Per-user settings, reminders, recovery emails, digests, grouping, cooldowns, retention.
- Slack, Telegram and in-app channels, and any column only they would use.
- Other notification kinds, for example low credits.

## Impact

- API: new domain `api/oss/src/core/notifications/` and `api/oss/src/dbs/postgres/notifications/`;
  `api/oss/src/core/triggers/outcomes.py` and `failure_notifications.py`; two loops in the API
  lifespan; `emailing.py`; `env.py`; new methods on `RecordsDAOInterface`,
  `TriggersDAOInterface` and `MembershipsService`.
- Database: one `core_oss` revision that creates two tables, and one that builds a partial index on
  `trigger_deliveries` concurrently. No column is added to an existing table.
- Frontend: `web/packages/agenta-automation-ui` reads `data.outcome` on `202` trigger deliveries.
- Editions: OSS and EE, from the shared `core_oss` chain.
- Self-hosting: the release notes and the self-hosting docs name `AGENTA_NOTIFICATIONS_EMAIL_ENABLED`.
