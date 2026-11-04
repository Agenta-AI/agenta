# Tasks

Parentheses name the spec requirement. Each issue can merge alone, in this order. Issues 1 to 3
change nothing that users see.

## 1. Email sender (backend)

- [ ] 1.1 `send_rendered_email(to_email, subject, html, text)` in `api/oss/src/utils/emailing.py`: SMTP `set_content(text)` plus `add_alternative(html, subtype="html")` with `timeout=30`; SendGrid `Mail(plain_text_content, html_content)` sent with `client.client.mail.send.post(request_body=mail.get(), timeout=30)`; raises with no provider and when the SendGrid client cannot be built. (Email sender)
- [ ] 1.2 Unit tests: both parts present, timeouts passed, raises in both no-op cases; `send_email` unchanged. (Email sender)

## 2. Notifications base (backend)

- [ ] 2.1 `core_oss` revision after `oss000000062`: `notifications` and `notification_deliveries` with the keys and indexes of design 4.1 and 4.2. Run `uv run api/scripts/migration_gate.py <revision.py>`. (Notification storage)
- [ ] 2.2 `api/oss/src/dbs/postgres/notifications/` and `api/oss/src/core/notifications/`: `open` (notification and its notification deliveries in one DAO transaction, with the open index and the resolved-after check), `resolve`, `query_pending` (10 per project, 100 per pass), `mark_sent`, `record_failure`, `mark_skipped`; the `NotificationKind` interface and a registry. (Notification storage; Notification kinds)
- [ ] 2.3 `UsersDAOInterface.fetch_emails(user_ids)` in `api/oss/src/core/users/interfaces.py` and `api/oss/src/dbs/postgres/users/dao.py`; `MembershipsService.fetch_organization_owner_id(organization_id)`. (Send pass; Recipients)
- [ ] 2.4 `NotificationsConfig` in `api/oss/src/utils/env.py` as `env.agenta.notifications`, `AGENTA_NOTIFICATIONS_EMAIL_ENABLED` default `true`. (Email switch)
- [ ] 2.5 `NotificationsService.send_pending`: the skip checks (`check_human`, email, switch, resolved), render, `send_rendered_email`, 5 attempts, id-only logs. `api/oss/src/tasks/asyncio/notifications/send_pass.py` (`send_pass_loop`) holds only the loop and the lease `locks:notifications:send-pass`; started in the `api/entrypoints/routers.py` lifespan. (Send pass)

## 3. Run outcomes (backend and frontend)

- [ ] 3.1 `core_oss` revision: `CREATE INDEX CONCURRENTLY ix_trigger_deliveries_unsettled_created_at_id` (partial, `(created_at, id)`) in an autocommit block, dropping an invalid leftover first; same index in `TriggerDeliveryDBE.__table_args__`. (One pass at a time, bounded)
- [ ] 3.2 `outcome` and `reason_code` on `TriggerDeliveryData`. (Outcome on the trigger delivery)
- [ ] 3.3 `TriggersDAOInterface.query_unsettled_deliveries` (start-time rows oldest first, `202` rows newest first; conditions as literal SQL so the partial index matches) and the guarded `settle_delivery`, which does not change `updated_at`. (Settled once per status; One pass at a time, bounded)
- [ ] 3.4 `RecordsDAOInterface.turn_endings(project_id, keys)` on the tracing engine: the newest `done` per key and the newest `error` code. (Wait for late error records)
- [ ] 3.5 `api/oss/src/core/triggers/outcomes.py` (O1 to O10) and `api/oss/src/tasks/asyncio/triggers/outcome_pass.py` (`outcome_pass_loop`, lease `locks:triggers:outcome-pass` with `acquire_lock`, `renew_lock`, `release_lock`, 20 pages per query), started in the lifespan. This task settles only. (One pass at a time, bounded)
- [ ] 3.6 `deliveryOutcome` reads `data.outcome` on `202` trigger deliveries; new `cancelled` and `waiting` states; regenerate the Fern client; `pnpm lint-fix` in `web`. (Outcome on the automations screen)

## 4. Failure notifications (backend)

- [ ] 4.1 `api/oss/src/core/triggers/failure_notifications.py`: rules A0 to A4 (start-time comparisons, the completed-delivery check), applied before the settle write. (What opens a notification; What resolves a notification; Failures older than the last fix)
- [ ] 4.2 Recipients with `check_human(view_triggers)`, `query_project_members` (all pages), `fetch_organization_owner_id`. (Recipients)
- [ ] 4.3 Resolve in `TriggersService`: `edit_*`, `refresh_subscription`, `delete_*`, and `set_*_active` with `is_active=true`; failures logged with ids only. Pass `NotificationsService` to `TriggersService` in `api/entrypoints/routers.py`. (What resolves a notification)
- [ ] 4.4 The `automation_failing` kind in `failure_notifications.py`: name normalization (Cc, Cf, Zl, Zp), subject, link, reason catalog, HTML escaping, plain text, `view_triggers`; registered in `api/entrypoints/routers.py`. (Email content; Notification kinds)

## 5. Tests

- [ ] 5.1 Unit: O1 to O10 (a turn with two `done` records), A0 to A4 (the timelines in the specs), the recipient steps, the reason catalog (the `paused_` codes and the runner's `access_denied`), name normalization, HTML escaping.
- [ ] 5.2 DAO on Postgres: two concurrent opens; the resolved-after check; the guarded settle after a re-claim; a `500` re-claim clears `data.outcome`; `turn_endings` skips quarantined records and keeps watchdog endings; the partial index is used by the real DAO statement after more than 5 executions (`EXPLAIN`); one large and one small project in the send query.
- [ ] 5.3 Migration: upgrade and downgrade of both revisions; the index revision runs again after an interrupted build.
- [ ] 5.4 Integration on the local stack, OSS and EE, with a recording email sender: 10 failed runs send one email; fail, edit, fail sends two; a success resolves with no email; a `403` sends one; a `409` sends none; a `waiting` run sends none; a creator who left sends to owners and admins; the switch off sends none and records the notification; the first pass after the deploy sends nothing for failures older than 1 hour.

## 6. Docs

- [ ] 6.1 Self-hosting docs and release notes: `AGENTA_NOTIFICATIONS_EMAIL_ENABLED`, default on, and what it sends. Use the `write-docs` skill.

## 7. Owner decisions

D4 to D10 in [design.md](design.md#2-decisions). Each has a default, so work can start. A changed
answer changes one row of a table or one rule, not the shape.
