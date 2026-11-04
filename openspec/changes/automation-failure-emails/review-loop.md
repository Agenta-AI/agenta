# Review loop

Each round ran fresh reviewers that got the files, not the author's conclusions. Lenses:
grounding (every fact against the code), simplify, naming and layering, security.

## Round 1

| Lens | Rating | Blockers |
|---|---|---|
| Grounding | 4 blockers, 6 major, 4 minor | settle and apply in one transaction across DAOs is not possible (G49); the first pass emails about the last 24 hours; an older success resolved a newer failure; the records retry bound was wrong (G20) |
| Simplify | Medium | |
| Naming and layering | Medium | |
| Security | 0 high, 5 medium | |

Fixed:

- No transaction crosses DAOs. The rules run before the guarded settle write, and each step is idempotent (D15).
- A failure opens a notification only if it ended less than 1 hour before the pass (D17, rule A0).
- A success resolves only a notification whose failure started earlier (rule A3).
- G20 corrected: a transient records failure is retried with no end. The 5-minute wait is a heuristic (known limit 5).
- The settle candidates use a partial index that leaves out settled rows, and a pass reads at most 10,000 rows.
- The screen reads `data.outcome` only on `202` trigger deliveries, because a merged `data` can keep an old outcome (G8).
- `access_denied` from the dispatcher became `paused_access_denied`, apart from the runner's code (G25).
- Real client timeouts on SMTP and SendGrid replace `asyncio.wait_for` (G41, G42).
- `send_rendered_email` raises in both no-op cases (G39).
- Recipients need `view_triggers` (G32, G33), are checked again at send time, and are read through `MembershipsService` (users are hard-deleted, G36).
- The email does not name the agent (D10, G37).
- Automation names are normalized (control characters, length).
- Logs carry ids and the exception type only.
- The notification keeps a snapshot of what the email needs. `core/notifications` reads no trigger table (D16).
- The switch and the provider check moved to the send pass only.
- Resolve on edit, start, refresh and delete only. No flag for `refresh_schedules` (G27).
- Names: `state`, `attempt_count`, key `(project_id, id)`, `uq_` index names, `waiting` instead of `paused`, `reason_code` everywhere, `resolve` and `settle`, `*_pass.py`, capability `automation-failure-notifications`, `trigger_delivery_id`, a naming table.
- Line numbers and wording of G2, G7, G8, G12, and the proposal.

Not taken:

- One loop for both passes (simplify). A send takes up to 30 s, so 100 sends would hold up settling.
- Dropping `notifications.state` for `resolved_at IS NULL` (simplify). The naming lens asked for `state` like `session_commands.state`. One DAO method writes both.
- Cooldowns, per-recipient caps and per-project fairness (security). They change the agreed rule "fail, fix, fail sends two". The send pass caps all email at 100 per minute. Flapping is known limit 9.
- A retention sweep (security). Known limit 10.

## Round 2

| Lens | Rating | Blockers |
|---|---|---|
| Grounding and logic | 0 blockers, 4 major, 6 minor | none |
| Simplify | Medium | |
| Naming and layering | Medium | |
| Security | Medium | |

Fixed:

- A success no longer hides a newer failure. `resolved_at` is the start of the successful run, or the time of the person's action (D19).
- A failure older than a completed run of the same automation opens nothing (rule A4).
- Waiting `202` rows cannot hold back the pass. Start-time rows and `202` rows are read in two queries, and `202` rows newest first.
- `turn_endings` returns the newest `done`. A `202` row settles once, at its first final `done`. The design does not assume that a continuation reuses the turn (known limit 6).
- Rule A0 uses the time of the status write for `400`, `403`, `422` and `500`.
- The partial index is on `(created_at, id)`, and the DAO writes its conditions as literal SQL so a prepared statement matches it.
- `send_rendered_email` does not reuse the wrappers that log exceptions.
- Email off, then on: documented and specified (known limit 11).
- Membership at send time is decided by `check_human` only. A new `UsersDAOInterface.fetch_emails` reads the address. No second membership reader.
- The send logic is in `NotificationsService.send_pending`. The task files hold only the loop and the lease.
- The `automation_failing` kind (template, reason catalog, `view_triggers`) lives in `core/triggers` and is registered at startup. `core/notifications` imports nothing from `core/triggers`.
- At most 10 notification deliveries per project per send pass (D18). This drops no email.
- Name normalization covers the Unicode categories Cc, Cf, Zl and Zp.
- `completed` replaces `succeeded`, as in `RunnerEnding`.
- `automation_kind` and the impossible project check are removed.
- The notification delivery states and the word `channel` are recorded in the naming section.
- The lease helpers are named (`acquire_lock`, `renew_lock`, `release_lock`).
- Known limit 3 says that a re-claimed row has a new id.

Not taken:

- Renaming `channel` to `medium`. The naming section records an Avoid entry instead. A v2 Slack channel will most likely send through `core/channels`, so the word fits.
- Keeping the partial index small with a deploy-date bound. The candidate queries read only the last 24 hours, so the old entries cost size, not time.

## Round 3

Lenses: a fresh full interrogation (grounding, logic, implementability, consistency,
over-engineering), and the `/code-review` skill at level high on the branch.

| Review | Result |
|---|---|
| Interrogation | 0 blockers, 3 major, 7 minor |
| `/code-review` (high) | 10 findings |

Fixed:

- A newer failure while a notification is open (for example a `403` that pauses the automation) is no longer resolved by an older healthy run. `data.last_failed_at` tracks the newest failure (D21, rule A4).
- A run that ends `waiting` counts as healthy (D20). An automation whose runs always ask for approval no longer keeps a notification open for good.
- A re-claimed `500` whose retry works resolves its own notification (`at or after`, D21).
- The 1-hour limit applies to opens only (rule A5). A healthy run that settles late still resolves.
- The send lease has a TTL of 300 s, is renewed after each send, and stops the pass when lost. No second replica sends the same rows.
- An exception before a send counts as a failed attempt.
- A connection delete from any router is covered by a reconcile step that resolves notifications of automations that no longer exist (D22).
- New index `(project_id, schedule_id, created_at)` for the healthy-run check on schedules (G12).
- The DAO methods that the rules need are named: `exists_healthy_delivery_after`, `query_missing_automations`, `fetch_open`, `note_failure`.
- `UsersDAOInterface` and `UsersDAO` are new files, stated as such (G36).
- `TriggersService` takes the notifications service as an optional argument, so its 11 tests keep working (G31).
- The pending index is `(project_id, created_at) WHERE state = 'pending'`.
- SMTP uses `env.smtp.timeout or 30` and `_get_sender_email`.
- Each page is applied oldest first, so "Failing since" is the first failure.
- `trigger_delivery_id` is removed from `notifications.data` (no reader).
- G8 and G12 citations; G24a, G24b and G31a added; known limits 1, 3, 6, 8 and 12 rewritten.

Not taken:

- The watchdog-then-runner `done` case (`/code-review`). After the watchdog ends a turn, the runner's later records are quarantined and not read (G24a), so this case cannot happen.
- Making edits record their time to remove known limit 1 (`/code-review`). The platform pause writes `updated_at` too (G3), so a fix through `updated_at` would drop real `403` failures. Writing a marker row on every edit adds rows for a rare case. Known limit 1 stays.
- A backoff for the backlog of unfinished runs (`/code-review`). Known limit 12.

## Round 4 (final)

Two reviewers ran in parallel. The final pass ran on Fable, as the owner asked.

| Review | Result |
|---|---|
| Final pass (Fable) | 0 blockers, 1 major, 6 minor. Spot-checked 31 facts: none wrong. Verdict: ready to implement once the major is written in. |
| Round 4 interrogation | 0 blockers, 0 major, 6 minor |
| `/security-review` | No findings. The branch changes Markdown only; the design's security points are covered by the earlier security lenses. |

Fixed:

- Major: the candidate queries page with a keyset cursor on `(created_at, id)`. Without it, a pass read the same 500 rows 20 times.
- A pass settles all pages in memory first, then applies healthy rows, then failed and skipped rows oldest first. A failure and a newer success in the same pass open nothing, and "Failing since" is the oldest failure.
- The A3 resolve, the user resolve and `note_failure` are each one `UPDATE ... WHERE state = 'open'`. `note_failure` uses `GREATEST`. Times in `data` are compared as `timestamptz`.
- The reconcile step also resolves notifications of soft-deleted automations, and checks both trigger tables.
- Both leases pass `ttl=300` and the `owner` token on renew and release. Lease names use the `locking.py` namespace and key form.
- The open SQL names its time `:started_at`.
- The index revision reads `pg_index.indisvalid` in Python and drops an invalid index in the same autocommit block.
- The `resolved_at` index serves rule A5, not A4.
- New scenarios: a run cancelled by a person, a subscription refresh, a failure and a newer success in one pass, pages that move forward.

Not taken: none.

## Round 5: against the existing system (Fable)

The owner asked for a full interrogation on Fable that judges the plan against the existing codebase,
not against the design itself. Two Fable agents ran in parallel:

- A **clean-room design** from the code only, without reading this change.
- An **interrogation** of this change against what the codebase already has.

| Review | Result |
|---|---|
| Interrogation (Fable) | 1 blocker, 3 major, 4 minor. Verdict: not ready until the blocker and the placement are fixed. |
| Clean-room design (Fable) | An independent design. It agreed on the notification base, the recipients, the switch, `send_rendered_email` and the `data` write-back without a new column, and differed on the points below. |

Checked in the code by the author before the edit:

- `settle_execution_ended` runs for every runner `done` with an ending on the ingest route, and `settle` creates the row if missing (`api/oss/src/apis/fastapi/sessions/router.py:1601-1616`, `api/oss/src/dbs/postgres/sessions/executions/dao.py:67-98`, `:183-230`). The clean-room design read only the records worker path, which settles continuations only, and so missed it.
- Cron runs `POST /admin/triggers/schedules/refresh` every minute in docker compose, Railway and Helm (`api/oss/src/crons/triggers.txt`, `hosting/railway/oss/template/template.json:363-365`, `hosting/kubernetes/helm/values.yaml:497-500`).
- The shared stream consumer deletes an entry before it acknowledges it (`api/oss/src/tasks/asyncio/shared/consumer.py:388-398`), so a second consumer group on `streams:sessions` would lose entries.

Fixed:

- Blocker: the outcome of a started run comes from `session_executions` (D23, G24c). The tracing records are read only for a `paused` or `cancelled` turn with no settled execution and for the error code. The 5-minute wait on every run is gone; only a `failed` run waits up to 5 minutes for its error code (O6).
- Major: both passes run behind admin routes that cron calls every minute, like the schedule refresh (D11, G45). No lifespan loops: a lifespan loop runs once per gunicorn worker.
- Major: G21 is corrected. The channels outbox consumes `streams:sessions`, and a second group would lose entries.
- Major: no new users domain. `MembershipsService.fetch_member_emails` reads the address in the memberships DAO, which already reads `users` (G36).
- Notification delivery states follow `ChannelDeliveryState`: `created`, `sent`, `failed`, plus `skipped`.
- The link uses the `web_url` check and path quoting of `current_session_response`, moved to `api/oss/src/utils/links.py` (G24e).
- The zod schema `triggerDeliveryDataSchema` gains `outcome` and `reason_code` (G24f).
- G45 corrected: `attachment_sweep_loop` uses its own Lua helpers, not `locking.py`.
- Client timeouts are 15 s, so a 45-second pass sends at least two emails when the provider hangs.
- The proposal no longer says that nothing records how a run ended.

Not taken (from the clean-room design):

- Writing `200` or `500` into the trigger delivery's `status`. A `500` is re-claimable by a repeated event (G7), so the automation would run again (D24).
- Sending the email inside the producer, with no send pass. It ties the dispatcher and the outcome pass to email latency, and a crash between claim and send would need a sweep anyway.
- Email for `409` and no email for `422`. These are owner decisions D5 and D6, still open. The clean-room view is recorded here for the owner: it sees `409` as "every event fails until re-auth", and `422` as "never set up, not a regression". The design keeps its defaults: a revoke turns the provider trigger off, so `409` is rare (G9); a `422` can follow an admin deleting the model key, which is a regression.
- A hook in the records worker post-commit. The outcome now comes from `session_executions`, which the ingest route writes before the records stream, so no hook is needed.
