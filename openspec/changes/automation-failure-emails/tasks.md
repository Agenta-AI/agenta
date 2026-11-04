# Tasks

Parentheses name the spec requirement. Each issue can merge alone in this order. Issues 1 and 2
change no behavior that users see.

## 1. Email sender (backend)

- [ ] 1.1 `send_rendered_email(to_email, subject, html, text)` in `api/oss/src/utils/emailing.py`: SMTP with `set_content(text)` and `add_alternative(html, subtype="html")`, SendGrid with `plain_text_content` and `html_content`; raises when no provider is set up. (Email sender)
- [ ] 1.2 `send_email` renders its template and calls the shared send path; keeps its no-op `True` with no provider. Unit test both. (Email sender)

## 2. Notifications foundation (backend)

- [ ] 2.1 `core_oss` revision after `oss000000062`: `notifications` and `notification_deliveries` with the indexes in design 4.1 and 4.2. Run `uv run api/scripts/migration_gate.py <revision.py>`. (Notification storage)
- [ ] 2.2 `api/oss/src/dbs/postgres/notifications/` (`dbes.py`, `dao.py`, `mappings.py`) and `api/oss/src/core/notifications/` (`dtos.py`, `interfaces.py`, `service.py`): `open` (insert with the unique open index and the resolved-after check, plus deliveries, in the caller's transaction), `close`, `query_pending`, `mark_sent`, `record_failure`, `mark_skipped`. (Notification storage)
- [ ] 2.3 `NotificationsConfig` in `api/oss/src/utils/env.py` as `env.agenta.notifications`, `AGENTA_NOTIFICATIONS_EMAIL_ENABLED` default `true`. (Email switch)
- [ ] 2.4 Send pass `api/oss/src/tasks/asyncio/notifications/send_loop.py` with a Redis lease, 100 per pass, 30 s timeout, 5 attempts; a template registry keyed by `kind`; started in the `api/entrypoints/routers.py` lifespan. (Send pass)

## 3. Run outcomes (backend)

- [ ] 3.1 `core_oss` revision: `CREATE INDEX CONCURRENTLY ix_trigger_deliveries_created_at` in an autocommit block, dropping an invalid leftover first. (Outcome on the delivery)
- [ ] 3.2 `outcome` and `outcome_code` on `TriggerDeliveryData`. (Outcome on the delivery)
- [ ] 3.3 `TriggersDAO.query_undecided_deliveries` and the guarded `settle_delivery`, which can take the caller's transaction. (Decided once per status)
- [ ] 3.4 `RecordsDAO.turn_endings(project_id, keys)` on the tracing engine: `done` presence, `stopReason`, `created_at`, newest `error` code; skips deleted and quarantined records; includes watchdog endings. (Late error records)
- [ ] 3.5 `api/oss/src/core/triggers/outcomes.py`: decision table O1 to O10. Outcome loop `api/oss/src/tasks/asyncio/triggers/outcome_loop.py` with its own lease, started in the lifespan. This task writes outcomes only and opens no notification. (One pass at a time)
- [ ] 3.6 `deliveryOutcome` reads `data.outcome`; new `cancelled` and `waiting` states; regenerate the Fern client. Run `pnpm lint-fix` in `web`. (Outcome on the automations screen)

## 4. Failure notices (backend)

- [ ] 4.1 Apply rules A1 to A4 in `outcomes.py`, in the same transaction as the settle write. (What opens a notification; What closes a notification; Failures older than the last fix)
- [ ] 4.2 Recipients: `MembershipsService.is_member`, `query_project_members` (all pages, `owner` and `admin`, not deleted), new `MembershipsDAO.fetch_organization_owner`. (Recipients)
- [ ] 4.3 Close on user actions in `TriggersService`: `edit_*`, `set_*_active` (not from `refresh_schedules`), `refresh_subscription`, `delete_*`; a close failure is logged only. Wire `NotificationsService` in `api/entrypoints/`. (What closes a notification)
- [ ] 4.4 `automation_failing` template: subject, body, link, reason catalog, HTML escaping, plain text. (Email content)

## 5. Tests

- [ ] 5.1 Unit: rows O1 to O10, rules A1 to A4, the recipient steps, the reason catalog fallback, HTML escaping.
- [ ] 5.2 DAO on Postgres: the unique open index under two concurrent opens; the resolved-after check; the guarded settle write after a status change; a `500` re-claim clears `data.outcome`; `turn_endings` skips quarantined records and keeps watchdog endings.
- [ ] 5.3 Migration: upgrade and downgrade of both revisions; the index revision runs again after an interrupted build.
- [ ] 5.4 Integration on the local stack (OSS and EE), with a recording email sender: 10 failed runs send one email; fail, edit, fail sends two; a success closes with no email; a `403` sends one; a `409` sends none; a `paused` run sends none; the creator left sends to owners and admins; switch off sends none and records the notification.

## 6. Owner decisions to confirm before task 4

D4 to D9 in [design.md](design.md#2-decisions). Each has a default, so work can start. A changed
answer changes one row of the decision table or one rule, not the shape.
