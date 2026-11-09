# Tasks

Parentheses name the spec requirement. Each issue can merge alone, in this order. Issues 1 to 3
change nothing that users see, except that the runner fix makes failed acquires read as failed.

## 1. Runner fix

- [x] 1.1 `services/runner/src/server.ts`: `persistTerminal` keeps `stopReason` when it is `cancelled` or `error`; the settled fallback passes `userStopped ? "cancelled" : "error"`, and the catch fallback passes `stoppedBeforeTerminal ? "cancelled" : "error"`. Unit tests through `createAgentServer` with a fake engine: an acquire failure writes `done` with `stopReason: "error"`; a Stop before the turn writes `cancelled`. Update the existing assertion in `services/runner/tests/unit/server.test.ts:1333` to expect `stopReason: "error"`. Run `pnpm test` and `pnpm run typecheck`. (Runner fallback records a failure)

- [x] 1.2 `api/entrypoints/worker_queues.py`: `_dispatch_detached_run` passes `strict_start=True` to `invoke_workflow_detached`, as `api/oss/src/tasks/asyncio/channels/inbox.py` does. Unit test in the dispatcher tests: an error first frame writes `500 failed`; the needs-setup rejection still writes `422`. (Strict start for trigger runs)

## 2. Email sender

- [x] 2.1 `send_rendered_email(to_email, subject, html, text)` in `api/oss/src/utils/emailing.py`: SMTP `set_content(text)` and `add_alternative(html, subtype="html")`, `_get_sender_email`, `timeout=env.smtp.timeout or 15`; both provider calls in `asyncio.to_thread`; SendGrid `Mail(plain_text_content, html_content)` sent with `client.client.mail.send.post(request_body=mail.get(), timeout=15)`; raises with no provider and when the SendGrid client cannot be built; no `log.exception` with the address. Unit tests, including that `send_email` is unchanged. (Email sender)

## 3. Notifications base

- [x] 3.1 `core_oss` revision after `oss000000062`: `notifications` and `notification_deliveries` with the keys and indexes of design 4.1 and 4.2. Run `uv run api/scripts/migration_gate.py <revision.py>`. (Notification storage)
- [x] 3.2 `api/oss/src/dbs/postgres/notifications/` and `api/oss/src/core/notifications/`: `open` (the notification and its deliveries in one DAO transaction, with the open index), `resolve(project_id, dedup_key, started_at=None)`, `note_failure` (returns its row count; `GREATEST` on `last_failure_started_at`), `query_created` (100 per call, oldest first), `mark_sent`, `record_send_failure`, `mark_skipped`; the template as a constructor argument. (Notification storage; One open notification per automation; Template of a kind)
- [x] 3.3 `MembershipsService.fetch_member_emails(user_ids)` and `fetch_project_summary(project_id)` (project name, organization id, organization owner id from the existing summary columns), in the memberships DAO. (Recipients; Send step; Email content)
- [x] 3.4 `NotificationsConfig` in `api/oss/src/utils/env.py` as `env.agenta.notifications`, `AGENTA_NOTIFICATIONS_EMAIL_ENABLED` default `true`. (Email switch)
- [x] 3.5 `NotificationsService.send_created()`: the skip checks (resolved, no email, switch, provider), render, `send_rendered_email`, 5 attempts (an error before the send counts as one), stop at the first provider-wide error; a rejected recipient goes on, no new send 5 minutes after the request began, ids-only logs. (Send step)

## 4. Run outcomes

- [x] 4.1 `core_oss` revision: in an autocommit block, `DROP INDEX CONCURRENTLY IF EXISTS` then `CREATE INDEX CONCURRENTLY ix_trigger_deliveries_unsettled_created_at_id`; the same index in `TriggerDeliveryDBE.__table_args__`. (One bounded pass at a time)
- [x] 4.2 `outcome` and `reason_code` on `TriggerDeliveryData`. (Outcome on the trigger delivery)
- [x] 4.3 `TriggersDAOInterface.query_unsettled_deliveries` (one query, newest first, keyset paging on `(created_at, id)`, at most 4 pages, conditions as literal SQL) and the guarded `settle_delivery`. (Settled once per status; One bounded pass at a time)
- [x] 4.4 `RecordsDAOInterface.turn_signals(project_id, keys)` on the tracing engine: the newest `done`'s `stopReason` and the code of the newest `error` record that has one, without deleted and quarantined records. (Outcome on the trigger delivery)
- [x] 4.5 `api/oss/src/core/triggers/outcomes.py`: the settle table O1 to O10 with `query_settled` and `turn_signals`, and `settle_pass` page by page, each page sorted oldest first, at most 4 pages. `POST /admin/triggers/deliveries/settle` on the triggers admin router: `acquire_lock(namespace="triggers", key="settle-pass", ttl=600)`, released with the owner token in `finally`; it runs `settle_pass`, then `send_created` even when `settle_pass` raises. Each row runs in its own `try`: an exception logs ids and the exception type, leaves the row unsettled, and the pass goes on. One more line in `api/oss/src/crons/triggers.txt`, in the form given in design section 3 (Cron). Wire the route's dependencies in `api/entrypoints/routers.py` as design section 3 (Wiring) lists: `OutcomesService` with the triggers, session executions, records (tracing engine) and notifications DAOs or services, and `NotificationsService`. This task settles outcomes and already calls `send_created`, which has nothing to send until task 5 opens notifications. (One bounded pass at a time; Send step)
- [x] 4.6 `deliveryOutcome` reads `data.outcome` on `202` trigger deliveries and returns new `cancelled` and `needed_approval` values; give them their own branch in `runDotClass` and `runOutcomeLabel` (`web/packages/agenta-automation-ui/src/runModel.ts`), add them to `RunStatusFilter` and the status grouping (`runListView.ts`), and extend `web/mobile/tests/unit/automationSkippedRun.test.ts`, so they never fall to the "Running" default; `outcome` in `triggerDeliveryDataSchema`; regenerate the Fern client; `pnpm lint-fix` in `web`. (Outcome on the automations screen)

## 5. Failure notifications

- [x] 5.1 `api/oss/src/core/triggers/failure_notifications.py`: rules A1 to A5, applied to each page sorted oldest first, before each settle write; the automation read only before an open. (What opens a notification; One open notification per automation; What resolves a notification)
- [x] 5.2 Recipients with `check_human(view_triggers)`, `query_project_members` (all pages), the organization owner from `fetch_project_summary`. (Recipients)
- [x] 5.3 Resolve in `TriggersService`: `edit_*` only when the automation is active after the save, `delete_*`, and `set_*_active` with `is_active=true`; failures logged with ids only. Pass `NotificationsService` to `TriggersService` in `api/entrypoints/routers.py` as an optional argument. (What resolves a notification)
- [x] 5.4 The `automation_failing` template: name normalization, subject, link, reason catalog, HTML escaping, plain text; passed to `NotificationsService` in `api/entrypoints/routers.py`. (Email content; Template of a kind)

## 6. Tests

- [x] 6.1 Unit: O1 to O10 (`continued`, `stopped`, `not_running`, an unknown value, a watchdog `lost` then a thawed runner `done`, an error code stored late, an access refusal with `error.code`, a coded acquire error followed by a codeless fallback error); A1 to A5 with the timelines in the specs; a row that raises while the other rows settle and the send step runs; recipients; the reason catalog; name normalization; HTML escaping.
- [x] 6.2 DAO on Postgres: two concurrent opens; `note_failure` row count and `GREATEST`; `turn_signals` skips quarantined and codeless records; `query_settled` returns first-turn executions.
- [x] 6.3 Migration: upgrade and downgrade of both revisions; the index revision after an interrupted build.
- [ ] 6.4 Integration on the local stack, OSS and EE, with a recording email sender: 10 failed runs send one email; fail, edit, fail sends two; a success resolves with no email; an acquire failure sends one; a `403` sends one; the switch off sends none and records the notification; a failure older than 1 hour sends none.

## 7. Docs

- [x] 7.1 Self-hosting docs and release notes: `AGENTA_NOTIFICATIONS_EMAIL_ENABLED`, default on, and what it sends. Use the `write-docs` skill.
- [ ] 7.2 Confirm with the owner of the cloud deployment repository (`agenta_cloud`, not reachable from this session) that its cron image builds its crontab from `triggers.txt`, so the new line runs there.

## 8. Owner decisions

D4 to D10 in [design.md](design.md#2-decisions). Each has a default, so work can start.
