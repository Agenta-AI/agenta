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
