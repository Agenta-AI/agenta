# Tasks

Parentheses name the spec requirement. Each issue can merge alone, in this order. Issues 1 to 3
change nothing that users see, except that the runner fix makes failed acquires read as failed.

## 1. Runner fix

- [ ] 1.1 `services/runner/src/server.ts`: `persistTerminal` keeps `stopReason` when it is `cancelled` or `error`; the settled fallback passes `userStopped ? "cancelled" : "error"`, and the catch fallback passes `stoppedBeforeTerminal ? "cancelled" : "error"`. Unit tests through `createAgentServer` with a fake engine: an acquire failure writes `done` with `stopReason: "error"`; a Stop before the turn writes `cancelled`. Run `pnpm test` and `pnpm run typecheck`. (Runner fallback records a failure)

## 2. Email sender

- [ ] 2.1 `send_rendered_email(to_email, subject, html, text)` in `api/oss/src/utils/emailing.py`: SMTP `set_content(text)` and `add_alternative(html, subtype="html")`, `_get_sender_email`, `timeout=env.smtp.timeout or 15`; SendGrid `Mail(plain_text_content, html_content)` sent with `client.client.mail.send.post(request_body=mail.get(), timeout=15)`; raises with no provider and when the SendGrid client cannot be built; no `log.exception` with the address. Unit tests, including that `send_email` is unchanged. (Email sender)

## 3. Notifications base

- [ ] 3.1 `core_oss` revision after `oss000000062`: `notifications` and `notification_deliveries` with the keys and indexes of design 4.1 and 4.2. Run `uv run api/scripts/migration_gate.py <revision.py>`. (Notification storage)
- [ ] 3.2 `api/oss/src/dbs/postgres/notifications/` and `api/oss/src/core/notifications/`: `open` (the notification and its deliveries in one DAO transaction, with the open index), `resolve(project_id, dedup_key, started_at=None)`, `note_failure` (returns its row count; `GREATEST` on `last_failed_at`, `LEAST` on `failed_at`), `query_created` (100 per call, 10 per project), `mark_sent`, `record_failure`, `mark_skipped`; the template and permission as a constructor argument. (Notification storage; One open notification per automation; Template and permission of a kind)
- [ ] 3.3 `MembershipsService.fetch_member_emails(user_ids)`, `fetch_organization_owner_id(organization_id)` and `fetch_project_name(project_id)`, in the memberships DAO. (Recipients; Send step; Email content)
- [ ] 3.4 `NotificationsConfig` in `api/oss/src/utils/env.py` as `env.agenta.notifications`, `AGENTA_NOTIFICATIONS_EMAIL_ENABLED` default `true`. (Email switch)
- [ ] 3.5 `NotificationsService.send_pending(deadline)`: the skip checks, render, `send_rendered_email`, 5 attempts (an error before the send counts as one), ids-only logs, no new send after the deadline. (Send step)

## 4. Run outcomes

- [ ] 4.1 `core_oss` revision: in an autocommit block, `DROP INDEX CONCURRENTLY IF EXISTS` then `CREATE INDEX CONCURRENTLY ix_trigger_deliveries_unsettled_created_at_id`; the same index in `TriggerDeliveryDBE.__table_args__`. (One bounded pass at a time)
- [ ] 4.2 `outcome` and `reason_code` on `TriggerDeliveryData`. (Outcome on the trigger delivery)
- [ ] 4.3 `TriggersDAOInterface.query_unsettled_deliveries` (start-time rows oldest first, `202` rows newest first, keyset paging on `(created_at, id)`, conditions as literal SQL) and the guarded `settle_delivery`. (Settled once per status; One bounded pass at a time)
- [ ] 4.4 `RecordsDAOInterface.turn_signals(project_id, keys)` on the tracing engine: the newest `done`'s `stopReason` and the newest `error` code, without deleted and quarantined records. (Outcome on the trigger delivery)
- [ ] 4.5 `api/oss/src/core/triggers/outcomes.py`: the settle table O1 to O10 with `query_settled` and `turn_signals`, and `settle_pass` page by page with the 30-second deadline between pages and automations. `POST /admin/triggers/deliveries/settle` on the triggers admin router: `acquire_lock(namespace="triggers", key="settle-pass", ttl=600)`, released with the owner token; it runs `settle_pass`, then `send_pending` with a deadline 45 seconds after the start. One more line in `api/oss/src/crons/triggers.txt` that calls the route with `curl --max-time 75`. This task settles and sends nothing until task 5. (One bounded pass at a time; Send step)
- [ ] 4.6 `deliveryOutcome` reads `data.outcome` on `202` trigger deliveries; new `cancelled` and `waiting` states; `outcome` in `triggerDeliveryDataSchema`; regenerate the Fern client; `pnpm lint-fix` in `web`. (Outcome on the automations screen)

## 5. Failure notifications

- [ ] 5.1 `api/oss/src/core/triggers/failure_notifications.py`: rules A1 to A6, applied per page and per automation (failed and skipped rows oldest first, then healthy rows), before each settle write; the automation read only before an open. (What opens a notification; One open notification per automation; What resolves a notification)
- [ ] 5.2 The outage brake: the per-pass count of projects after each page, the Redis flag for 15 minutes, one error log, rule A4. (Outage brake)
- [ ] 5.3 Recipients with `check_human(view_triggers)`, `query_project_members` (all pages), `fetch_organization_owner_id`. (Recipients)
- [ ] 5.4 Resolve in `TriggersService`: `edit_*`, `refresh_subscription`, `delete_*`, and `set_*_active` with `is_active=true`; failures logged with ids only. Pass `NotificationsService` to `TriggersService` in `api/entrypoints/routers.py` as an optional argument. (What resolves a notification)
- [ ] 5.5 The `automation_failing` template: name normalization, subject, link, reason catalog, HTML escaping, plain text; passed with `view_triggers` to `NotificationsService` in `api/entrypoints/routers.py`. (Email content; Template and permission of a kind)

## 6. Tests

- [ ] 6.1 Unit: O1 to O10 (`continued`, `stopped`, `not_running`, an unknown value, a watchdog `lost` then a thawed runner `done`, an error code stored late, an access refusal with `error.code`); A1 to A6 with the timelines in the specs; the outage brake count; recipients; the reason catalog; name normalization; HTML escaping.
- [ ] 6.2 DAO on Postgres: two concurrent opens; `note_failure` row count, `GREATEST` and `LEAST`; the guarded settle after a re-claim; a `500` re-claim clears `data.outcome`; `turn_signals` skips quarantined records; `query_settled` returns first-turn executions; the partial index is used by the real DAO statement after more than 5 executions (`EXPLAIN`); one large and one small project in the send query.
- [ ] 6.3 Migration: upgrade and downgrade of both revisions; the index revision after an interrupted build.
- [ ] 6.4 Integration on the local stack, OSS and EE, with a recording email sender: 10 failed runs send one email; fail, edit, fail sends two; a success resolves with no email; an acquire failure sends one; a `403` sends one; a `409` sends none; a `waiting` run sends none; a creator who left sends to owners and admins; the switch off sends none and records the notification; the first pass after the deploy sends nothing for failures older than 1 hour; an outage across 11 projects opens nothing.

## 7. Docs

- [ ] 7.1 Self-hosting docs and release notes: `AGENTA_NOTIFICATIONS_EMAIL_ENABLED`, default on, and what it sends. Use the `write-docs` skill.
- [ ] 7.2 Confirm with the owner of the cloud deployment repository (`agenta_cloud`, not reachable from this session) that its cron image builds its crontab from `triggers.txt`, so the new line runs there.

## 8. Owner decisions

D4 to D10 in [design.md](design.md#2-decisions). Each has a default, so work can start.
