# Status: Automation Failure Alerts

**Updated:** 2026-09-25
**Phase:** Planning. No code written.
**Owner:** Ashraf Chowdury

## Current decisions

| Decision | Reason |
|---|---|
| The platform sends the notice, not the agent | A failed agent cannot report its own failure reliably |
| v0 channel is email only; no in-app notifications, "Needs attention", Slack or webhooks | Email reaches people outside the app; the rest can reuse the same decisions later |
| Record the real outcome first; every alert depends on it | Today every started run stays `202 dispatched` |
| The outcome goes in a new `outcome` column; `status` keeps today's values | One writer per field; dedup reads only `status`, so no automation can run twice |
| One polling monitor in the API (60 s, per-pass Redis lease like `attachment_sweep.py`) settles runs, evaluates alerts and sends emails | One writer; no hook in the records worker; repairs itself after restarts |
| The dispatcher creates `run_id` before the claim and stores it at claim time | The id must exist even when a run fails before the `202` write |
| A turn is finished by a `done`, or by an `execution_lost` error with no `done` | Only `done` ends a turn; the abandon path writes no `done` |
| `done(cancelled)` means cancelled even with an `error` record | An aborted sandbox start by a person writes both |
| Approvals have no deadline; `awaiting_approval` never becomes a failure by itself | The product keeps approvals answerable indefinitely |
| One `trigger_alerts` row per automation holds what the owner was last told | Alert memory on deliveries allowed only one alert per delivery; edits replace schedule and subscription rows whole |
| Owner emails only for failures the owner can fix; platform failures go to an hourly team digest | Customers get actionable email; our incidents do not flood their inboxes |
| Email state is written only after a successful send | A failed send is retried on the next pass with no extra states |
| Error text in emails comes from a fixed Python catalog | Prompt injection, data leaks, stable fingerprints |
| No automatic retries of automation runs in v0 | A retry can repeat side effects such as a sent message |
| Cron scripts use `${AGENTA_API_INTERNAL_URL:-http://api:8000}`; Helm sets the variable on the cron pod | Works on compose, Helm and Railway; no new variable |
| Records retention (`records.sh`) is not part of this plan | It deletes customer data and needs its own decision |
| Shadow mode before live | Real emails with no customer exposure |

## Superseded decisions

Kept so reviewers of earlier drafts can follow the changes.

| Earlier decision | Now | Why |
|---|---|---|
| New status codes `520`, `504`, `499`, `202 paused` | `outcome` column | Codes collided on `202` and needed compare-and-set between writers |
| Records worker enqueues settle jobs; dispatcher and sweeper as extra sources | Polling monitor | The hook needed new dependencies and failure handling |
| Separate sweeper | Deadlines inside the monitor | One loop |
| No new table; alert state on deliveries | `trigger_alerts` table | One slot per delivery caused lost and duplicate alerts |
| Watchdog cited as the lock precedent | `attachment_sweep.py` | The watchdog has no global lock |
| Fail a paused run after 1 hour | No deadline | Approvals stay answerable indefinitely |
| `done.stopReason = error` as a failure signal | Any non-quarantined `error` record | Most failed turns have no stop reason |
| Alerts broker, `send_alert` task, retry middleware | Send inside the monitor | At most 20 emails an hour; the next pass is the retry |
| Per-automation limit of 3 emails an hour | Removed | The fingerprint list and reminder rule limit emails |

## Open questions

| Question | Proposal |
|---|---|
| Who receives owner emails? | Creator if still a project member; else project owners and admins plus the organization owner |
| Send "Waiting for your approval"? | Yes, at most once per 24 hours per automation |
| Does an empty answer count as a failure? | No in v0 |
| What causes the `/workflows/revisions/resolve` 400 behind the most common local `500`? | Investigate before phase 3; until then it is a platform kind |
| Reminder interval | 24 hours |
| Send "Back to normal"? | Yes |
| Cloud only, or OSS too? | Code ships in both; mode defaults to `off` |
| Shadow exit numbers | Zero false alarms and zero missed failures over the last 5 days |

## Blockers

These need production access. None of them blocks phases 1 and 2.

| Check | How | Needed for |
|---|---|---|
| Does email work in cloud? | Invite a teammate on cloud. If the email arrives, email works, and its sender is the alert sender. | Phase 4 |
| Does the cloud cron reach the API? | Search the cloud cron logs for `Could not resolve host` | Phase 1 scope |
| Real volume and failure rate | Run [sizing.sql](./sizing.sql) (core, then tracing) | Cap, monitor query cost, catalog priorities |

## Next steps

1. Team review of this plan; answer the open questions.
2. Run the three production checks.
3. Phase 1 as its own small change.
4. Phase 2 with mode `off`.

## Related bugs found during research

Not part of this feature; track them separately.

- `records.sh` is never scheduled, so records retention never runs. Turning it on deletes
  customer data, so it needs a product decision.
- The schedule refresh handler always answers HTTP 200, even when the refresh failed.
- An edit request without `flags` re-enables a revoked subscription.
- A revoked connection keeps running its subscriptions.
- The ORM model lacks `ix_trigger_deliveries_schedule_id_created_at`.
