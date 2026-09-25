# Status: Automation Failure Alerts

**Updated:** 2026-09-25
**Phase:** Planning. No code written.
**Owner:** Ashraf Chowdury

## Current decisions

| Decision | Reason |
|---|---|
| The platform sends the notice, not the agent | A failed agent cannot report its own failure reliably |
| v0 channel is email only | Email reaches people outside the app; Slack and Telegram are feasible later ([channels-research.md](./channels-research.md)) |
| Record the real outcome first; every alert depends on it | Today every started run stays `202 dispatched` |
| The outcome goes in new `outcome` and `settled_at` columns; `status` keeps today's values | Dedup reads only `status`, so no automation can run twice |
| `outcome` is added with a `not_tracked` default, then the default becomes `NULL` | Postgres stores the default without rewriting the table; only new deliveries are open |
| One polling monitor in the API (60 s, per-pass lease with `acquire_lock`, `renew_lock`, `release_lock` from `utils/locking.py`) | One writer; no hook in the records worker; repairs itself after restarts |
| The dispatcher stores `run_id` and `claimed_at` at claim time | The id and the start time exist even when a run fails before the `202` write |
| Only `done` ends a turn; `done(error)`, or a `done` with an `error` record, is a failure; `done(cancelled)` is cancelled; a `done` counts after a 2-minute grace | Matches how the runner and the watchdog write records; records can commit out of order |
| The deadline is 12 hours from the claim | Above the runner's hard deadline of 11 hours 30 minutes plus a grace |
| v0 does not follow a run after an approval; a paused first turn ends as `awaiting_approval` | Continuations can be lost without records, re-delivered, replaced under new ids, and mixed with a person's input |
| Owner emails are selected by queries over settled deliveries; no health state machine | Every health-state design so far produced new edge cases in review |
| Failure alerts: a recipient list is an address set; one email per list at most once an hour; each automation at most once per 24 hours per audience; reminders only while the newest relevant run still fails, grouped into the list's next email | One cause across many automations sends one email; no reminder after a recovery; one or two reminder emails a day per recipient list |
| No daily summary, recovery email or separate team digest in v0 | Not needed to learn about failures; run history shows recovery |
| Error text in emails comes from a fixed catalog; errors inside the agent's run are the owner's by default | No prompt injection or data leaks; most fixable errors arrive as `runner_error` or without a code |
| Platform failures use the same alert step with the team as the recipient list; a stale cron sends a team email at most once an hour | One mechanism for both audiences; no watermark table |
| `send_message` raises `EmailTransportError` (stop the pass), `EmailDeferred` (temporary refusal of one message: skip this list this pass) or `EmailRejected` (permanent refusal of one message: record and log; two in a row stop the pass) | A broken transport never marks emails as sent; one bad or greylisted message never blocks the others |
| Sent-alert times live in Postgres (`trigger_alerts`); Redis holds only the lease and the cron keys | Redis keys can be evicted |
| Mode `off` skips the alert step; `shadow` redirects every owner email; `live` sends to real recipients | Simple switch; shadow is the real review |
| Settings live in an `AutomationsConfig` class with `AGENTA_AUTOMATIONS_*` names | Matches `env.py` conventions |
| No automatic retries of automation runs in v0 | A retry can repeat side effects such as a sent message |
| Cron scripts use `${AGENTA_API_INTERNAL_URL:-http://api:8000}`; Helm sets the variable on the cron pod | Works on compose, Helm and Railway; no new variable |
| Records retention (`records.sh`) is not part of this plan | It deletes customer data and needs its own decision |

## Superseded decisions

Kept so reviewers of earlier drafts can follow the changes.

| Earlier decision | Now | Why |
|---|---|---|
| New status codes `520`, `504`, `499`, `202 paused` | `outcome` column | Codes collided on `202` and needed compare-and-set between writers |
| Records worker enqueues settle jobs; separate sweeper | Polling monitor | One loop, no new hook |
| Alert state on each delivery | `trigger_alerts` per automation | One slot per delivery lost and duplicated alerts |
| Watchdog as the lock precedent; copy its lock scripts | Reuse `acquire_lock`, `renew_lock`, `release_lock` | The watchdog has no global lock; the helpers already exist |
| Follow approval continuations through `session_executions` | Out of v0 | No start-time column; lost continuations write no records; replacements have no `source_interaction_id` |
| Fail a paused run after 1 hour | `awaiting_approval` is final in v0 | Approvals stay answerable indefinitely |
| `done.stopReason = error` as the only failure signal | `done(error)`, or a `done` with an `error` record | Most failed turns have no stop reason |
| Deadlines from the delivery's `created_at` or the current turn's start | From `claimed_at` | A re-claim keeps `created_at`; continuations are out of v0 |
| A health state machine (`ok` / `failing`) with "Started failing", "New error", reminders and "Back to normal", then with a pending slot, then with "notified" fields, then with confirmation rules | Query-based failure alerts with a 24-hour repeat | Each version produced new review defects: lost kinds, open runs ignored, rows evaluated forever, flaky automations never alerted |
| One email per automation | One email per recipient list, at most once an hour, with reminders grouped | One cause across 50 automations sent 50 emails |
| Per-row send retries, then a global send backoff ladder | The pass stops sending on a transport error; the next pass tries again | Simpler; no extra delay after recovery |
| Row lock held across the send | Short transactions; record after send; rare duplicates accepted | No code in the repo holds a transaction across external I/O |
| Per-project cap plus a total cap, then one total cap | No cap; one email per recipient list per hour | The hourly limit per list bounds volume, and removes a Redis counter |
| An hourly team digest | Platform failures use the same alert step with the team as recipients; a stale cron emails the team at most hourly | A digest needed its own watermark and failure handling |
| Mode `off` advances state as if emails were sent | Mode `off` skips the alert step | Removed an exception that caused wrong recovery lines |
| Split the refresh service result for the heartbeat | Write the heartbeat when the handler runs | Enough to detect a cron that cannot reach the API |
| `platform_rate_limited` for "Too many requests right now" | `rate_limited` is the owner's | That message is produced for any rate-limit text |
| Approval email, alerts broker, retry middleware | Removed | Not needed |
| Daily summary, hourly team digest with a Postgres watermark, `trigger_monitor_state`, project allowlist, organization owner as an extra recipient | Removed from v0 | Over-engineering: the failure alert with a 24-hour repeat meets every v0 goal |

## Open questions

| Question | Proposal |
|---|---|
| Who receives owner emails? | Creator if still a project member; else project owners and admins |
| Is one alert for a single failure of an every-minute schedule acceptable? | Yes in v0 (at most one a day); review in shadow mode |
| Does an empty answer count as a failure? | No in v0 |
| What causes the `/workflows/revisions/resolve` 400 behind the most common local `500`? | Investigate before phase 3; until then it is `start_failed` (platform) |
| Is `rate_limited` always the owner's to fix, or also caused by Agenta's shared starter key? | Owner in v0; review in shadow mode |
| Should v0 already follow runs after an approval? | No; plan it after v0 with the continuation facts in research.md |
| Cloud only, or OSS too? | Code ships in both; mode defaults to `off` |
| Shadow exit numbers | Zero false alarms and zero missed failures over the last 5 days |

## Blockers

These need production access. None of them blocks phase 2.

| Check | How | Needed for |
|---|---|---|
| Does email work in cloud? | Invite a teammate on cloud. If the email arrives, email works, and its sender is the alert sender. | Phase 3 (shadow mode) |
| Does the cloud cron reach the API? | Search the cloud cron logs for `Could not resolve host` | Phase 1 scope |
| Real volume and failure rate | Run [sizing.sql](./sizing.sql) (core, then tracing) | Monitor query cost, expected email volume, catalog priorities |

## Next steps

1. Team review of this plan; answer the open questions.
2. Run the three production checks.
3. Phase 1 as its own small change.
4. Phase 2 with mode `off`.

## Related bugs found during research

Not part of this feature; track them separately.

- `records.sh` is never scheduled, so records retention never runs. Turning it on deletes
  customer data, so it needs a product decision.
- The schedule refresh answers HTTP 200 when it failed, and `triggers.sh` then logs a success.
- An edit request without `flags` re-enables a revoked subscription.
- A revoked connection keeps running its subscriptions.
- The ORM model lacks `ix_trigger_deliveries_schedule_id_created_at`.
