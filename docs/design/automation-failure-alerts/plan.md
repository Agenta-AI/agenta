# Plan: Automation Failure Notices (v0)

**Status:** Draft for team review.
**Owner:** Ashraf Chowdury

Read the files in this order:

1. [requirements.md](./requirements.md): what v0 must do, agreed. Rules below cite them as R1,
   A4, and so on.
2. [research.md](./research.md): the code facts, each with a file and line. Rules below cite them
   as F1, F2, and so on.
3. This file: the design.

## 1. What users get

- When an automation fails or cannot start, its creator gets **one** email. There is no new email
  until the automation works again or someone changes it (R1, R2, R4, R5).
- When an automation's run stops to wait for a person, the creator gets **one** "needs attention"
  email. There is no new one until someone answers or someone changes the automation (A4).
- Each email says what happened and what to do, in plain words, with a link to the automation
  (R8, A6).
- The feature is off until an admin turns it on (R9).

## 2. How it works

One loop in the API, the **notice monitor**, runs every 60 seconds on one API replica at a time.
Each pass has three steps:

```text
trigger_deliveries (core DB) ──┐
                               ├─► 1. Settle: decide how each recent run ended
records (tracing DB) ──────────┘        writes trigger_deliveries.outcome
                                        │ same transaction
                                        ▼
                                   2. Apply: update the automation's notice state
                                        writes trigger_notices
                                        │
                                        ▼
                                   3. Send: send the notices that are due
                                        NoticeChannel ─► EmailNoticeChannel ─► SMTP or SendGrid
```

Why one polling loop and not hooks where things happen:

- A failure is known only some time after the run's `done` record arrives, because the `error`
  record can arrive later (F32). A hook in the records worker would have to wait. A loop just
  looks again on the next pass.
- A delivery stuck at `102 claimed` has no event at all (F20). Only a check of its age finds it.
- One writer is easier to make correct than hooks in two processes (`worker-queues` and
  `worker-streams`).
- The API already runs loops like this under a Redis lease (F52, F53).

## 3. Components

| Component | Where | New or changed |
|---|---|---|
| Edit time fix | `api/oss/src/dbs/postgres/triggers/mappings.py` | changed: edits set `updated_at` (bug F5) |
| Delivery outcome columns | migration `core_oss` on `trigger_deliveries` | new columns and index |
| Delivery status writes | `TriggersDAO.write_delivery`, `write_subscription_delivery_if_live`, `update_delivery`; `SessionStreamsDAO.claim_trigger_delivery` | changed: every status write also clears `outcome` (4.2) |
| Notice state table | migration `core_oss`, new DBE in `api/oss/src/dbs/postgres/triggers/` | new table `trigger_notices` |
| Database access | DAO methods and interfaces in 5.5 | new methods |
| Settle and apply | `api/oss/src/core/triggers/notices.py` (`TriggerNoticesService`) | new |
| Notices foundation | `api/oss/src/core/notifications/` (`Notice`, `NoticeChannel`, `EmailNoticeChannel`, message catalog) | new |
| Email sender | `api/oss/src/utils/emailing.py` | changed: add `send_html_email`; `send_email` uses it |
| Monitor loop | `api/oss/src/tasks/asyncio/triggers/notice_monitor.py`, started in `api/entrypoints/routers.py` lifespan | new |
| Switch | `AutomationsConfig` in `api/oss/src/utils/env.py`, as `env.agenta.automations` | new |

## 4. Data changes

### 4.1 Edits record their time (bug fix)

`map_subscription_dto_to_dbe_edit` and `map_schedule_dto_to_dbe_edit` set
`updated_at = now()` next to `updated_by_id`. Every change passes through these two functions,
including play/pause, revoke/refresh and the end-time deactivation (F4). This makes A2 ("any
change") measurable.

The **edit time** of an automation below means `coalesce(updated_at, created_at)`. Rows edited
before this fix have `updated_at = NULL`, so their edit time is their create time.

### 4.2 `trigger_deliveries`: two columns and one index

| Column | Type | Meaning |
|---|---|---|
| `outcome` | `VARCHAR`, nullable | `succeeded`, `failed`, `cancelled`, `needs_attention`, `not_tracked`. `NULL` = not decided yet. |
| `outcome_code` | `VARCHAR`, nullable | The reason code of a failure (section 6). `NULL` for other outcomes. |

Index `ix_trigger_deliveries_created_at` on `(created_at)`. The monitor reads the last 24 hours
across all projects, and today's indexes all start with `project_id`, `subscription_id` or
`schedule_id` (F63).

The outcome is stored on the delivery so the records of a decided run are not read again. It is
also the missing "how did the run end" field (F16), which the run history can show later.

An outcome belongs to the status it was decided from. A delivery can change status after the
monitor decided it: a slow start moves from `102` to `202`, and a repeated event claims a `500`
row again (F18). So every write that changes `status` also sets `outcome` and `outcome_code` to
`NULL`:

| Write | Source |
|---|---|
| `TriggersDAO.write_delivery` (upsert) | `api/oss/src/dbs/postgres/triggers/dao.py:387-433` |
| `TriggersDAO.write_subscription_delivery_if_live` (upsert) | `triggers/dao.py:435-510` |
| `TriggersDAO.update_delivery` | `triggers/dao.py:512-530` |
| `SessionStreamsDAO.claim_trigger_delivery` (re-claim of a `500`) | `api/oss/src/dbs/postgres/sessions/streams/dao.py:227-234` |

The monitor then decides the delivery again from its new status, and the real run's outcome
reaches the notice state.

Existing rows keep `outcome = NULL`. The monitor never reads rows older than 24 hours, so they
are never decided and never cause an email.

### 4.3 New table `trigger_notices`

One row per automation that has had a decided run while the feature was on.

| Column | Type | Meaning |
|---|---|---|
| `project_id` | `UUID`, not null | FK `projects.id`, `ON DELETE CASCADE` |
| `automation_id` | `UUID`, not null | the schedule id or the subscription id |
| `automation_kind` | `VARCHAR`, not null | `schedule` or `subscription` |
| `last_result_at` | `TIMESTAMPTZ`, nullable | `created_at` of the newest `failed` or `succeeded` delivery applied |
| `failing_since` | `TIMESTAMPTZ`, nullable | `created_at` of the first failed run of the current failing state |
| `failure_code` | `VARCHAR`, nullable | reason code of that run |
| `failure_notified_at` | `TIMESTAMPTZ`, nullable | when the failure email was sent |
| `failure_send_attempts` | `INTEGER`, not null, default 0 | failed sends of the current failure email |
| `attention_since` | `TIMESTAMPTZ`, nullable | `created_at` of the run that first stopped to wait for a person |
| `attention_session_id` | `VARCHAR`, nullable | that run's `session_id` |
| `attention_notified_at` | `TIMESTAMPTZ`, nullable | when the "needs attention" email was sent |
| `attention_send_attempts` | `INTEGER`, not null, default 0 | failed sends of the current "needs attention" email |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | lifecycle |

Primary key `(project_id, automation_id)`. There is no foreign key to the automation, because the
id points to one of two tables.

The row holds two independent notices, **failure** and **attention**. Each has its own
`*_since`, `*_notified_at` and `*_send_attempts`. A notice is **due** when its `*_since` is set
and its `*_notified_at` is `NULL`. Clearing a notice sets its fields back to `NULL` and its
attempts to 0.

Why a new table and not columns on the automation tables: there are two automation tables, and
every edit locks and rewrites the whole automation row (F4). The monitor must not write to rows
that users edit.

## 5. The monitor pass

The pass runs every 60 seconds when the switch is on (section 8). It holds a Redis lease with the
shared helpers `acquire_lock`, `renew_lock` and `release_lock` (F54): namespace
`triggers-notice-monitor`, TTL 300 seconds, renewed after each page and each send. If the lease
is lost, the pass stops. A replica without the lease skips the pass.

### 5.1 Step 1: Settle

Candidates:

```sql
SELECT project_id, id, schedule_id, subscription_id, status, data, created_at
FROM trigger_deliveries
WHERE created_at > now() - interval '24 hours'
  AND outcome IS NULL
  AND (created_at, id) > (:last_created_at, :last_id)  -- next page
ORDER BY created_at, id
LIMIT 500;
```

The pass reads every page until the window is done. Runs that are still going stay undecided and
come first in each pass, so a single page could fill up with them and hide newer deliveries.
Paging reads past them.

For deliveries with status `202`, the monitor reads the run's endings in one query per project:
`RecordsDAO.turn_endings(project_id, keys)` with keys `(data.session_id, data.result.run_id)`
(F13, F22). It returns the `done` and `error` records of those turns, without deleted or
quarantined rows (F33), with `record_type`, `attributes.stopReason`, `attributes.code`,
`timestamp` and `created_at`. It uses the index `ix_records_project_id_session_id_turn_id`, like
`settled_turns` (F62). The key is correct for trigger runs: the SDK does not replace their
`run_id` (F58, F59).

Decision table. The first matching row wins.

| # | Delivery status | Condition | Outcome | `outcome_code` |
|---|---|---|---|---|
| D1 | `200` | (test capture, F67) | `not_tracked` | |
| D2 | `400` | | `failed` | `bad_request` |
| D3 | `409` | | `failed` | `subscription_invalid` |
| D4 | `500` | | `failed` | `start_failed` |
| D5 | `102` | created less than 30 minutes ago | wait | |
| D6 | `102` | created 30 minutes ago or more | `failed` | `start_stuck` |
| D7 | `202` | no `done` record | wait | |
| D8 | `202` | `done` stored less than 5 minutes ago (`created_at`) | wait | |
| D9 | `202` | `done.stopReason = paused` | `needs_attention` | |
| D10 | `202` | `done.stopReason = cancelled` | `cancelled` | |
| D11 | `202` | `done.stopReason = error`, or at least one `error` record | `failed` | `code` of the `error` record with the latest `timestamp`; `runner_error` if none has a code |
| D12 | `202` | none of the above | `succeeded` | |
| D13 | any other status | | `not_tracked` | |

Notes:

- D8 waits 5 minutes because an `error` record can be stored after its `done` (F32). A failed
  records batch is retried after 30 seconds, several times.
- D9 and D10 come before D11 because the runner writes these stop reasons on purpose (F25).
- D11 covers the failures that end with a plain `done` (F26, F27).
- A `202` delivery without `done` after 24 hours leaves the window with `outcome = NULL`. Runs
  that never finish are out of scope.
- The 24-hour window is longer than any run: the runner's hard deadline ends every run within
  11 hours 30 minutes by default (F66), and the watchdog ends runs whose runner died (F27). A
  deployment that sets `AGENTA_RUNNER_TURN_HARD_DEADLINE_MS` above 24 hours must also raise the
  window; otherwise its failures after 24 hours send no email.

The write is guarded, so a delivery that changed since it was read is left for the next pass:

```sql
UPDATE trigger_deliveries
SET outcome = :outcome, outcome_code = :code
WHERE project_id = :project_id AND id = :id
  AND outcome IS NULL
  AND status->>'code' = :status_code_read;
```

If 0 rows change, the monitor skips the Apply step for this delivery. This covers a `102` that
became `202`, and a `500` that a new attempt claimed again, which also changes the row's `id`
(F18). Such a row has `outcome = NULL` again (4.2), so a later pass decides it from its new
status.

### 5.2 Step 2: Apply

The Settle write and the Apply step for one delivery `D` run in one database transaction, so
both are saved or neither is (5.5). Deliveries are applied in `created_at` order:

1. Read the automation `A` with `fetch_schedule_including_deleted` or
   `fetch_subscription_including_deleted` (`api/oss/src/dbs/postgres/triggers/dao.py:147`, `:795`).
   This read is outside the transaction.
2. In the transaction: write the outcome (5.1). If the guarded write changes 0 rows, end the
   transaction and go to the next delivery.
3. In the same transaction: create the `trigger_notices` row if missing, lock it as `S`, apply the
   rules below, and save `S`.

Rules, in order. The first "stop" ends the rules for `D`.

| # | Rule | Why |
|---|---|---|
| P1 | If `D.outcome = not_tracked`: stop. | Test captures are not runs. |
| P2 | If `A` is missing or deleted: stop. | Nobody to tell. |
| P3 | If `D.created_at < edit time of A`: stop. | The run used the version before the last change (A2). |
| P4 | If `S.failing_since < edit time of A`: clear the failure notice. If `S.attention_since < edit time of A`: clear the attention notice. | Any change ends the failing state and the waiting state (R5, A2, A4). |
| P5 | `needs_attention`: if `attention_since` is `NULL`, set `attention_since = D.created_at`, `attention_session_id = D.data.session_id`. Stop. | One email per automation until someone answers or changes it (A4). The run's age does not matter: an older run that waits still needs a person. |
| P6 | `cancelled`: stop. | A cancel is not a failure (A3). |
| P7 | `failed` or `succeeded`: if `S.last_result_at` is set and `D.created_at < S.last_result_at`: stop. Else set `S.last_result_at = D.created_at`. | Whether the automation works is decided by its newest run. Runs can overlap and end in any order. |
| P8 | `failed`: if `failing_since` is `NULL`, set `failing_since = D.created_at`, `failure_code = D.outcome_code`. | First failure only (R4). |
| P9 | `succeeded`: clear the failure notice. | A success ends the failing state (R5). No email (R6). |

The two notices are independent. A waiting run does not change the failure notice, and a failure
or success does not change the attention notice. Only failed and succeeded runs take part in the
"newest run" order (P7).

P7 uses a strict `<`, so a delivery that is decided again after a status change (4.2) is applied
again with its new outcome.

### 5.3 Step 3: Send

First, close answered waits. Read all rows with `attention_since` set, then check their sessions
in `session_interactions` (F40-F42) with one query per project:

```sql
SELECT DISTINCT session_id FROM session_interactions
WHERE project_id = :project_id
  AND session_id = ANY(:attention_session_ids)
  AND status IN ('responded', 'resolved');
```

For each session returned, clear that row's attention notice. The next run that waits sends a
new email. `cancelled` does not count as an answer. If the runner dropped the row (F43), the wait
never counts as answered, and the next email comes only after a change to the automation (P4).

Then send the due notices, oldest `*_since` first, at most 100 per pass. For each due notice:

1. Read `A` again. If `A` is missing or deleted, or its edit time is after the notice's
   `*_since`, clear that notice's fields and do not send.
2. Find the recipient (5.4).
3. Build a `Notice` and call each channel in the channel list (v0: only email), with a 30-second
   timeout (`asyncio.wait_for`).
4. On success: set that notice's `*_notified_at = now()` and `*_send_attempts = 0`, only if its
   `*_since` still has the value that was read.
5. On failure: log the error and add 1 to that notice's `*_send_attempts`. At 10 attempts, set its
   `*_notified_at = now()` and log an error that the notice was dropped.
6. Renew the lease. If renewal fails, stop the pass.

The email is sent outside any database transaction. If the process dies between the send and the
write in item 4, the next pass sends the email again. This is rare and accepted.

### 5.4 Recipient

| Case | Recipient |
|---|---|
| `A.created_by_id` is a user with `deleted_at IS NULL` and a `project_members` row for the project with `deleted_at IS NULL` | the creator (F2, F6, F7, F60) |
| otherwise (no creator, creator deleted, or creator not in the project) | the organization owner: `organizations.owner_id` of the project's organization (A1, F8, F64), with `get_organization_owner` |
| the owner has `deleted_at` set or no email (`get_organization_owner` does not check this, F61) | no email; log a warning; the notice counts as sent |

### 5.5 Code layout and transactions

The core service depends only on DAO interfaces, as `api/AGENTS.md` requires (Router, Service,
DAO interface, DAO implementation).

| Interface (core) | Implementation (db) | Methods |
|---|---|---|
| `TriggersDAOInterface` (`core/triggers/interfaces.py:93`) | `TriggersDAO` | `query_undecided_deliveries(created_after, after, limit)`; `settle_delivery(project_id, delivery_id, status_code, outcome, outcome_code, transaction)` returns whether a row changed |
| `TriggerNoticesDAOInterface` (new, `core/triggers/interfaces.py`) | `TriggerNoticesDAO` (new, `dbs/postgres/triggers/notices_dao.py`) | `lock_notice(project_id, automation_id, automation_kind, transaction)`; `save_notice(state, transaction)`; `query_waiting()`; `query_due(limit)`; `clear_attention(project_id, automation_id)`; `mark_sent(...)`; `record_send_failure(...)` |
| `RecordsDAOInterface` (`core/sessions/records/interfaces.py:14`) | `RecordsDAO` | `turn_endings(project_id, keys)` |
| `SessionInteractionsDAOInterface` (`core/sessions/interactions/interfaces.py:14`) | `SessionInteractionsDAO` | `answered_sessions(project_id, session_ids)` |

The methods that take `transaction` run on the caller's session instead of opening their own.
`TriggerNoticesService` opens one session per delivery and passes it to `settle_delivery`,
`lock_notice` and `save_notice`. This is the pattern `SessionExecutionsDAO` already uses
(`api/oss/src/dbs/postgres/sessions/executions/dao.py:42-65`, `:183-227`).

## 6. Email content

### 6.1 Template

A new function `send_html_email(to_email, subject, html_content)` in `emailing.py` picks SMTP or
SendGrid, like `send_email` does today (F45). It calls the existing `_send_smtp_email` and
`_send_sendgrid_email`, which run the blocking provider call in a thread (`asyncio.to_thread`,
`emailing.py:128`, `:195`). So a slow provider does not block the event loop, and the 30-second
timeout and the lease renewal in 5.3 keep working. `send_email` renders its invite template and then
calls it. Every value in a notice email is HTML-escaped (the current template does not escape,
F44).

Failure email:

```text
Subject: Automation "{automation}" failed

Your automation "{automation}" in project "{project}" failed.

First failure: {failing_since, UTC}
What happened: {reason}
What to do: {action}

[Open the automation]  {web_url}/m/w/{workspace_id}/p/{project_id}/automations/{automation_id}

You get one email when an automation starts failing. You get a new one only if it fails again
after it works or after someone changes it.
```

"Needs attention" email:

```text
Subject: Automation "{automation}" is waiting for a person

A run of "{automation}" in project "{project}" started at {attention_since, UTC} and stopped to
wait for a person: an approval, an answer, or a tool that runs in the browser. The run cannot
finish until someone responds.

[Open the automation]  {same link}

You get one email for this. You get a new one only after someone answers or someone changes the
automation.
```

The link format is from F50 and F51. An automation without a name shows as "Untitled automation".
The raw error text is never used (R8, F17, F37).

### 6.2 Reason catalog

`Owner` means the automation's owner can fix it. `Platform` means the problem is on Agenta's side
(R7). Both send the same email. Every `Platform` failure is also logged at error level for the
team.

| Code | Source | Side | What happened | What to do |
|---|---|---|---|---|
| `bad_request` | delivery `400` (F14) | Owner | The automation could not prepare the run. For example, it has no agent, or its input mapping failed. | Open the automation and check its agent and inputs. |
| `subscription_invalid` | delivery `409` (F11) | Owner | The app connection this automation listens to was revoked or is out of sync. | Reconnect the app connection used by this automation. |
| `start_failed` | delivery `500` (F15) | Platform | Agenta could not start the run. | Nothing to change in your automation. If it keeps failing, contact support. |
| `start_stuck` | delivery `102` for 30 minutes (F20) | Platform | Agenta tried to start the run, but it did not start. | Nothing to change in your automation. If it keeps failing, contact support. |
| `starter_credits_exhausted` | runner (F36) | Owner | The free starter credits are used up. | Add your own model key to the project. |
| `starter_credits_program_paused` | runner | Owner | The free starter credits are paused. | Add your own model key to the project. |
| `starter_credits_unavailable` | runner | Platform | The free starter credits service was not available. | Nothing to change. If it keeps failing, add your own model key or contact support. |
| `credential_delivery_failed` | runner | Platform | Agenta could not pass the model key to the agent. | Nothing to change in your automation. If it keeps failing, contact support. |
| `rate_limited` | runner | Owner | The model provider refused the request because of a rate or quota limit. | Check your limits and plan with the model provider. |
| `subscription_login_required` | runner | Owner | The model sign-in that this agent uses has expired. | Sign in to the model provider again. |
| `subscription_login_refreshed` | runner | Platform | The model sign-in was renewed while the run was working. | Nothing to change. The next run uses the new sign-in. |
| `sandbox_gone` | runner | Platform | The machine that ran the agent stopped. | Nothing to change in your automation. If it keeps failing, contact support. |
| `execution_lost` | runner or watchdog (F27) | Platform | The agent stopped responding and the run was closed. | Nothing to change in your automation. If it keeps failing, contact support. |
| `runner_error` and any unknown code | runner | Owner | The agent's run ended with an error. | Open the automation to see the run and its error. |

## 7. Foundation for more channels (R10)

`api/oss/src/core/notifications/` holds only what every channel shares:

- `Notice`: kind (`automation_failed` or `automation_needs_attention`), recipient (user id and
  email), project, automation (id, kind, name), reason code, time, link.
- `NoticeChannel`: an interface with one method, `async send(notice) -> None`, that raises on
  failure.
- `EmailNoticeChannel`: renders section 6 and calls `send_html_email`.
- The reason catalog (6.2).

The trigger rules (what counts as a failure, when a notice is due) stay in
`core/triggers/notices.py`. To add in-app notices in v1, add an `InAppNoticeChannel` and put it
in the channel list. Slack or Telegram follow the same way.

v0 keeps one `*_notified_at` per notice, not one per channel. With one channel this is exact.
When v1 adds a second channel, one channel can fail while the other succeeds, so v1 must move
"sent" to one row per channel.

## 8. Switch and settings

`AutomationsConfig` in `env.py`, attached as `env.agenta.automations`. No config class for
automations exists today (F57, F65).

| Setting | Env variable | Default |
|---|---|---|
| `notices_enabled` | `AGENTA_AUTOMATIONS_NOTICES_ENABLED` | `false` |

At API startup:

- `notices_enabled` false: the monitor does not start. Nothing is written or sent.
- `notices_enabled` true, but `env.smtp.enabled` and `env.sendgrid.enabled` are both false (F46):
  log one warning and do not start the monitor (A7).
- Both true: start the monitor.

The other values are constants in code, not settings: pass every 60 s, window 24 h, page size 500,
wait after `done` 5 min, start limit 30 min, 100 sends per pass, send timeout 30 s, 10 attempts,
lease TTL 300 s.

When the switch goes from off to on, the first pass settles the last 24 hours in `created_at`
order. P7 makes the newest run decide the failure state, so an automation that already works again gets
no email. An automation whose newest decided run failed gets one email.

## 9. Scenarios

Each scenario lists the expected result and the rules that give it.

| # | Scenario | Expected result | Rules |
|---|---|---|---|
| S1 | A run succeeds. | No email. | D12, P9 |
| S2 | A run fails for the first time. | One failure email, about 6 minutes after `done`. | D8, D11, P8, send |
| S3 | The next run fails too. | No email. | P8 |
| S4 | Fail, then success, then fail. | Two failure emails. (Flapping risk, see requirements.md.) | P8, P9 |
| S5 | Fail, then a user edits, then fail. | Two failure emails. | P4, P8 |
| S6 | A run that started before an edit fails after the edit. | No email for that run. | P3 |
| S7 | The sandbox cannot start (`error` + plain `done`). | Failure email with the `error` record's code. | D11 |
| S8 | The runner dies; the watchdog closes the run. | Failure email, `execution_lost`, platform wording. | D11 |
| S9 | A user stops the run. | No email, state unchanged. | D10, P6 |
| S10 | The subscription's connection is revoked (`409`). | Failure email, `subscription_invalid`. | D3, P8 |
| S11 | The automation has no agent reference (`400`). | Failure email, `bad_request`. | D2 |
| S12 | The start call fails (`500`). | Failure email, `start_failed`. | D4 |
| S13 | A delivery stays `102` for 30 minutes. | Failure email, `start_stuck`. | D6 |
| S14 | A run stops to wait for an approval. | One "needs attention" email. | D9, P5 |
| S15 | The next run also waits, and nobody answered. | No email. | P5 |
| S16 | Someone answers, then a later run waits. | A new "needs attention" email. | answered check, P5 |
| S17 | The runner dropped the waiting row (F43). | First email sent. No new one until someone changes the automation. | answered check, P4 |
| S18 | Two runs overlap: the newer one succeeds and is decided first, then the older one fails. | No email. | P7 |
| S19 | The `error` record is stored 1 minute after `done`. | Failure email. | D8, D11 |
| S20 | The `error` record is stored more than 5 minutes after `done`. | Read as success, no email. Known limit. | D8, D12 |
| S21 | The creator was removed from the project. | Email to the organization owner. | 5.4 |
| S22 | The automation has no creator id. | Email to the organization owner. | 5.4 |
| S23 | The email provider is down for 3 minutes. | Sends fail, are retried on the next passes, and succeed. | send 5 |
| S24 | Every send fails for 10 passes. | Notice dropped, error logged. | send 5 |
| S25 | The automation is deleted before its notice is sent. | No email. | send 1 |
| S26 | The automation is paused before its notice is sent. | No email (pause is a change). | send 1 |
| S27 | A platform outage fails 300 automations. | 300 emails, at most 100 per pass, over about 3 minutes. | send |
| S28 | A test subscription captures an event (`200`). | Nothing. | D1, P1 |
| S29 | A run never ends (no `done` in 24 hours). | No email. Out of scope. | D7 |
| S30 | Two API replicas run. | Only the lease holder runs a pass. | 5 |
| S31 | The switch is off. | No monitor, no writes, no email. | 8 |
| S32 | The switch is on, but no email provider is set up. | One warning at startup, no monitor. | 8 |
| S33 | The switch is turned on after a month off. | Only the last 24 hours are read. | 5.1, 8 |
| S34 | The run after an approval (the continuation) fails. | No email. Known limit. | 10 |
| S35 | A `500` delivery is claimed again by a repeated event and then runs. | The failure email was already sent (known limit). The row is decided again from its new status; if the run succeeds, the failing state ends. | D4, 4.2, P7, P9 |
| S36 | Two runs overlap: the newer one succeeds and is decided first, then the older one stops to wait for a person. | One "needs attention" email. | P5 |
| S37 | A delivery waits at `102` for 30 minutes, then starts and succeeds. | One `start_stuck` email (known limit). The row is decided again as `succeeded`, and the failing state ends. | D6, 4.2, P7, P9 |
| S38 | The failure email always fails while the attention email of the same automation sends. | The failure email is dropped after its own 10 attempts. | send 4, 5 |

## 10. Known limits of v0

Accepted on purpose. Each one is also in the scenario table.

1. **The run after an approval is not followed (S34).** The delivery tracks only the first turn
   (F22). The continuation has a new `turn_id` and is not linked to the delivery.
2. **Runs that never end are not reported (S29).** Out of scope in requirements.md.
3. **An `error` record more than 5 minutes late reads as success (S20).**
4. **A dropped waiting row is never "answered" (S17).**
5. **A `500` that later runs still sent a failure email (S35).** This needs the same event to
   arrive again (F18, F19). The run's real outcome is still read (4.2). If the new claim happens
   before the `500` is decided, the row is `102` with its old `created_at` (F63), so it can read
   as `start_stuck` first.
6. **A start slower than 30 minutes sends a `start_stuck` email (S37).** The run's real outcome
   is still read afterwards (4.2).
7. **A crash between a send and its write sends the email again.**
8. **The scaling risks in requirements.md** ("Note for reviewers") are not handled beyond the
   100 sends per pass.

## 11. Phases and estimates

Estimates are for one engineer who knows the codebase, and include tests.

| Phase | Work | Days |
|---|---|---|
| 1. Data | Edit-time fix (4.1), migration for 4.2 and 4.3, outcome reset on status writes, DBE, DAO interfaces (5.5) | 2 |
| 2. Settle | `RecordsDAO.turn_endings`, decision table D1-D13, guarded write | 2.5 |
| 3. Apply | Rules P1-P9, shared transaction, notices DAO, answered check | 2 |
| 4. Notices | `core/notifications`, email templates, reason catalog, `send_html_email`, recipient rule | 2.5 |
| 5. Monitor | Loop, lease, switch, startup checks, lifespan wiring, local end-to-end test | 1.5 |
| 6. Integration tests | Scenarios S1-S38 on the local stack (section 12) | 2 |
| 7. Rollout | Turn on in cloud, watch logs and emails for one week | 1 |
| **Total** | | **13.5** |

Phase 1 can ship alone. The edit-time fix is useful without the rest.

## 12. Tests

- **Unit:** each row D1-D13 and P1-P9; the recipient cases in 5.4; the catalog maps every code in
  F36 plus the platform codes; HTML escaping.
- **DAO:** `turn_endings` excludes deleted and quarantined records; the guarded settle write
  changes 0 rows after a status change; every status write in 4.2 clears `outcome`; the edit
  mappings set `updated_at`; `answered_sessions` returns only answered sessions.
- **Integration:** scenarios S1-S38 against the local stack, with the email channel replaced by a
  recording channel.

## 13. Separate bug tickets

Found during research. Not part of v0.

| Bug | Fact |
|---|---|
| The detached start call has no read timeout, so a hung service keeps a delivery at `102` and a worker slot busy. | F20 |
| Nothing sweeps deliveries stuck at `102`. (v0 reports them; it does not fix them.) | F20 |
| `retry_on_error=True` has no effect, because no retry middleware is registered. | F19 |
| The SendGrid client has no timeout, and a failed client build is cached for the process life. | F47, F48 |

## 14. Open items for reviewers

1. **Session link in the "needs attention" email.** The web app has a session page
   (`/m/w/{workspace_id}/p/{project_id}/sessions/{session_id}`). It is not verified that a person
   can answer an automation's waiting request there. v0 links to the automation (A6).
2. **Production volume.** The number of deliveries per 24 hours decides the cost of the Settle
   query and of the new index. This needs a count on production before phase 2.
3. **Product question** in requirements.md: block or warn when an automation's agent needs a
   person.
