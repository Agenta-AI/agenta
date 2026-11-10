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

### Round 5 verification (Fable)

A Fable pass checked the round 5 edit against the code. It confirmed G24c end to end (the ingest route settles first turns; the watchdog settles first turns too; the key matches the delivery's `run_id`), the admin auth on `/admin/` routes, and that no stale term was left. It found 0 blockers, 2 major and 4 minor.

Fixed:

- Major: `session_executions.terminal_outcome` also takes `continued` (an approval was answered) and `not_running` (a Stop found the turn gone). New rows O9a (`continued` → `waiting`) and O9b (any unknown value → `cancelled` with a warning), and O9 covers `not_running`. Without O9a, a run whose approval was answered before the pass would never settle.
- Major: the cron tasks name the real image files: the `COPY` lines and crontab loops in the OSS and EE `Dockerfile.gh` and `Dockerfile.dev`, and the dev compose mounts. The Railway cron image is built from the API image and needs no change. The settle script is named `deliveries.sh`, because `triggers.sh` finds its interval by matching its own name.
- D11 says why cron fits (it matches the schedule refresh and keeps trigger work out of the API worker lifecycle), not that lifespan loops cannot work.
- G45 says why a 45-second request is safe: gunicorn's `--timeout 60` is a heartbeat check for uvicorn workers, and `curl --max-time 60` is above the budget.
- O7 reads `session_executions.error.code` first, so an access refusal gets its code without the 5-minute wait.
- The requirement "One open notification per automation" is named in task 4.1.

## Review of 2026-11-05 (owner side)

An outside review of the plan raised six points and a note on size. Each was checked in the code.

Taken:

- **Expired provider logins are silent.** True: the Composio adapter can read a connection's status, but only a person's refresh calls it (G9a). Known limit 14, and follow-up 1 in design section 12 (a daily connection health check, with "no event in N days" as the fallback).
- **Outage brake.** Added (D25, rule A6, a spec requirement with three scenarios). Platform-reason failures from more than 10 projects in one pass open nothing for 15 minutes. Known limit 15 records the cost.
- **The email names the project.** Added (D26). The subject no longer says "Your". The memberships DAO already reads `project_name` (G35a).
- **Per-user opt-out** and **an email for runs that wait for approval** (D7): named as follow-ups 2 and 3.
- **The cloud deployment repository** (`agenta_cloud`) is not reachable from this session. Task 6.2 asks its owner to confirm that its cron image picks up the two new cron files.

On size: the settle table (O1 to O11 with O9a and O9b) maps each existing status and execution outcome to one value, which the owner decision "write each run's result back" needs. Rules A3 to A5 each fix a timeline a review found: without them, a long healthy run resolves a newer `403` pause (a paused automation with no email), or a run that started before a fix emails after it. The parts that only buy precision in rare cases are O6 (wait for the error code), O9b (unknown values), the healthy-delivery check in A5, and the reconcile step. They are kept, and listed here so the choice is explicit.

### Size cuts (owner: "fix if it makes sense")

Cut, because each only bought precision in a rare case:

- The check for a newer healthy run before an open (rule A5), with its index `(project_id, schedule_id, created_at)` and the DAO method `exists_healthy_delivery_after`. An older overlapping run that fails after a newer success now sends one email; the next healthy run resolves it (known limit 2). Within one pass, failures now apply before healthy runs, so a failure and a newer success in the same pass open and resolve before the send pass reads them.
- The reconcile step for hard-deleted automations (D22), with `query_missing_automations`. Such an automation writes no more trigger deliveries, so its notification only stays as a row (known limit 8).
- The 5-minute wait for a late error code (O6). The execution's own `error.code` is read first; a late record gives `runner_error` (known limit 5).

Kept: O9b (one row; without it an unknown outcome value leaves the row unsettled for 24 hours), the 1-hour open limit, the start-time comparisons and `last_failed_at` (each fixes a found timeline), and the outage brake.

### Owner cuts (2026-11-05)

An outside cut list proposed 13 cuts. The author's assessment was shared first; the owner then
decided:

- **Made:** one cron job, one admin route and one lock that settles first (at most 30 s) and then sends with the time left (D11); no lock renewal, a 120-second TTL with the pass ending within about 60 s; no shared link helper, the link is built and quoted in the template; no kind registry, the template and permission are a constructor argument (D16); `stopped`, `not_running` and any later value merged into one `cancelled` row (O9), with `continued` kept as its own healthy row (O9a).
- **Made against the author's advice:** the check against an earlier resolve when a notification opens is dropped (D19). A run that started before a fix and fails after it sends one more email (known limit 1).
- **Already made earlier:** the newer-healthy-run check and its index, and the reconcile step.
- **Kept:** the per-project send cap (D18), keyset paging, `last_failed_at` and the start-time guard (D21), the tracing read for `paused` and the error code, and the reason catalog.

## Round 6: over-engineering (Fable, two reviewers)

A simplify-lens review and a minimum-v1 critic, after the owner cuts. The owner decided to drop the
cuts below and fix every inconsistency.

Dropped:

- `notifications.resolved_at`: no reader after D19; `updated_at` keeps the time.
- `link` in `notifications.data`: the template builds it; `organization_id` is stored instead.
- The 20-page cap: the 30-second settle deadline bounds the pass.
- The `pg_index.indisvalid` read: revision 2 runs `DROP INDEX CONCURRENTLY IF EXISTS` before the create.
- `fetch_open`: `note_failure` returns its row count, and 0 means "open a new one".
- `done.created_at` in `turn_signals` and the "Ended at" of rows that never open.
- Reading the automation for every row: only before an open.

Kept: the send-time permission check, resolve on delete, the unique index on notification deliveries, and `sent_at`.

Fixed:

- The 30-second deadline is checked between pages and between rows, and rows are applied page by page, so the request cannot outlive gunicorn's timeout with no time left to send.
- `note_failure` also keeps the earliest start in `failed_at` (`LEAST`), so "Failing since" is right when an older failure comes in a later page.
- The outage brake blocks only the open, after `note_failure` (it contradicted the spec).
- D11 and the diagram: no new send after 45 s, the request ends within about 60 s. Known limit 12: 30 s.
- D17, D23, the "lease" wording, G45 (the curl timeout is the change's choice, not a fact), the template spec (it also reads `web_url`), task 6.2 (`deliveries.*`), and two task citations.

## Round 7: correctness and over-engineering (Opus), and the clean rewrite

Two Opus reviewers, after round 6. The owner decided to apply every fix and cut except one, and
asked for a clean plan at the end. All five files were rewritten from scratch.

Blocker and majors fixed:

- **Blocker:** the runner's fallback writes a failed acquire as a `done` with no `stopReason`, which
  the ingest route settles `completed` (G18). A runner fix is now task 1.1 (D28): the fallback keeps
  `stopReason: "error"`. This also fixes every other reader of `session_executions`.
- The outage brake counts after each page, before its rules, across the pass, and only failures
  from the last hour (5.4).
- The guard lock TTL is 600 s. The send timeouts apply to each socket operation (G41), so a request
  is bounded by the lock, not by a 60-second claim.

Smaller fixes: rows are applied per automation within a page, with the deadline between automations
(a failure and a newer success of one automation in one page send no email); `fetch_project_name`;
`resolve(..., started_at=None)`; the proposal's index count; a new known limit for a recipient who
leaves before the send.

Cut: the separate cron files (one more line in `triggers.txt`, G45); `reason_code` in the zod schema;
the "Failures across a fix" requirement (merged into "What resolves"); duplicate scenarios (email
off, deleted automation, provider hangs, the 300-automation example, four name scenarios merged);
facts no rule cited (G24e, half of G12); merged known limits; history notes in the decision table.

Kept: `LEAST` on `failed_at`.

In the rewrite, settle rows are now O1 to O10 and rules A1 to A6, numbered in order. Decision and
fact ids were kept, so some numbers are missing.

### Final gate (Opus)

The final check of the clean rewrite confirmed the names, numbers, task citations, the runner fix,
the cron line and the brake order, and found 0 blockers, 2 majors and 5 minors. All were fixed:

- The error code is the newest `error` record that **has** a code: the runner's fallback adds a
  codeless record after a coded acquire failure.
- `runner_error` is in the outage brake's list, because a sandbox-provider outage settles as a
  codeless acquire failure. No new runner error code was added.
- Task 4.5 says it settles outcomes and opens nothing until task 5; task 1.1 names the runner test
  assertion it changes; the spec's SMTP timeout matches the design (`SMTP_TIMEOUT`, else 15 s); the
  start-time query is applied before the run query; the brake flag uses `set_cache`/`get_cache`
  (no brake when caching is off); the cron line's form is spelled out.

The reviewer's verdict: with the two majors fixed, the plan is ready to implement.

## Round 8: simplification (Fable), decided without the owner

The owner asked for a Fable review aimed at simplification, and for the author to decide and apply
without waiting. Fable judged eight candidates and found seven more.

Applied:

- **Count limits instead of timers.** At most 4 pages of 500 settled and 100 emails sent per request,
  and the send loop stops at the first provider error, so a hung provider cannot keep a request past
  the 600-second lock. No 30-second or 45-second deadline.
- **One candidate query**, newest first, with each page sorted oldest first in memory. The
  per-automation grouping is gone: within a sorted page, a failure and a newer success still open
  and resolve before the send step.
- **No second permission check at send time.** The check runs once, at the open, in `core/triggers`;
  `NotificationsService` takes only the template. Known limit 14.
- **Six reason rows** instead of eleven; "out of credits" stays. The screen already shows the pause
  cause.
- **`fetch_project_summary`** reads the project name, organization id and owner id from the existing
  summary columns, instead of two separate methods.
- **No `LEAST` on `failed_at`** (known limit 15), **no per-project send cap** (D18, known limit 16),
  **no re-run after a lost open race**, **no resolve on refresh**.
- Tests trimmed: the EXPLAIN test, the two re-claim tests and the "Status changes during a pass"
  scenario are gone; integration cases go from 11 to 7.

Not taken:

- Control characters only in name normalization. Python's email policy rejects a subject with
  U+2028 or U+2029, so the full set (Cc, Cf, Zl, Zp) is needed.
- A plain `created_at` index. `data` is `JSON`, so a plain index would make each pass parse a full
  day of rows.
- Dropping resolve on delete. It is one call and stops an email about a deleted automation.
- Dropping the outage brake. That needs the owner to flip D4 (platform failures open nothing); the
  option is recorded in D4.

## Round 9: outside review of `b285405ee9`

The review confirmed the runner bug, the single cron line and the lock and cache helpers in the
code, and found three spec issues. All three were checked against the plan and are real:

- **Refresh.** The proposal, D14 and the architecture diagram still said a refresh resolves a
  notification; the spec, design 5.5 and task 5.4 said it does not (cut in round 8). All now say it
  does not.
- **The brake counted one pass only.** An outage that spreads over several minutes (for example 8
  new projects a minute) never passed 10 in one pass. The count is now a rolling 15-minute map of
  project ids in the cache, read once per request and written after each page. One request runs at
  a time, so the read-modify-write cannot race. New scenario "Outage that spreads over several
  minutes".
- **The brake holds failures for good.** A failure settled while the flag is set is never looked at
  again; only a later failure sends an email. Known limit 13 now says so, and a new scenario covers
  an automation that rarely fires.

Still open: owner decisions D4 to D10.

## Round 10: outside review, seven findings

All seven were checked against the code and are real. All were fixed.

1. **A `202` with no outcome for good.** Trigger dispatch does not pass `strict_start`
   (`api/entrypoints/worker_queues.py:274-284`), so an error first frame counts as a start
   (`api/oss/src/core/workflows/service.py:1115-1143`); channels pass it for this reason
   (`api/oss/src/tasks/asyncio/channels/inbox.py:1508-1511`). New task 1.2 and D29: trigger dispatch
   passes `strict_start=True`, and the dispatcher writes `500`.
2. **An edit resolved a paused automation.** An edit sends the current `is_active`
   (`api/oss/src/core/triggers/service.py:1188`), so a rename of a paused automation resolved its
   notification while it stayed paused. An edit now resolves only when the automation is active
   after the save.
3. **Archived agents and D8.** Automations bound through an environment are not paused by the
   archive (`api/oss/src/dbs/postgres/triggers/dao.py:642-672`); their next fire writes
   `403 agent_deleted` and sends an email. D8 and G14 now state both cases; the email for the second
   case is kept, because that automation really is paused.
4. **Brake list.** `sandbox_capacity`, `runner_capacity`, `harness_init_timeout` and
   `upstream_error` are real runner codes (`services/runner/src/engines/sandbox_agent/errors.ts:158-189`)
   and are now in the list.
5. **Slow provider.** A provider that is slow but succeeds could keep a request past the lock. The
   send step now starts no new send 5 minutes after the request began.
6. **Wiring.** Section 3 now lists every DAO and service the route needs and which engine each uses;
   task 4.5 wires them.
7. **Screen.** `runDotClass` and `runOutcomeLabel` fall to a "Running" default
   (`web/packages/agenta-automation-ui/src/runModel.ts:157-184`). Task 4.6 now names both switches,
   `RunStatusFilter`, the grouping and the unit test, and a spec scenario covers it.

## Final decision on the outage brake

The owner removed the brake after the last council review. It could hide real failures, and one open
notification per automation already limits volume. `design.md` is the source of truth, so earlier
mentions of the brake in this file are history.
