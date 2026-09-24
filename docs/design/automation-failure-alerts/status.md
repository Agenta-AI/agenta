# Status: Automation Failure Alerts

**Updated:** 2026-09-25
**Phase:** Planning. No code written.
**Owner:** Ashraf Chowdury

## Current decisions

| Date | Decision | Reason |
|---|---|---|
| 2026-09-24 | The platform sends the notice, not the agent | A failed agent cannot report its own failure reliably |
| 2026-09-24 | v0 channel is email only. No in-app notifications, Slack or webhooks in v0 | Email reaches people outside the app; the other channels can reuse the same decisions later |
| 2026-09-24 | Record the true outcome first; every channel depends on it | Today every started run stays `202 dispatched` |
| 2026-09-24 | Shadow mode before live: all emails go to one internal inbox for 1 to 2 weeks | We see real emails with no customer exposure |
| 2026-09-24 | No new table | The deliveries already hold the history; alert state lives on the delivery that caused it |
| 2026-09-24 | Do not store alert state on the schedule or subscription row | An edit replaces `meta`, `data` and `flags` whole |
| 2026-09-25 | Link a delivery to its turns through the existing `run_id`, plus `parent_execution_id` for approval continuations | `run_id` is already the runner `turn_id` (20 of 20 local runs) |
| 2026-09-25 | A run failed if it has an `error` record or `done.stopReason = error` | Both occur in real data; the abandon path writes no `done` |
| 2026-09-25 | The result goes in a new `outcome` column; `status` keeps today's values | One writer per field; dedup reads `status`, so no automation can run twice |
| 2026-09-25 | One polling monitor (API lifespan, 60 s, Redis lock) settles runs, evaluates health and queues emails | Removes the records-worker hook, the settle queue, the separate sweeper and every writer race |
| 2026-09-25 | Emails follow automation health (level), not single run events | Overlapping runs, the recovery hold, and emails held by the cap all resolve on the next pass |
| 2026-09-25 | Alert sends retry through `SmartRetryMiddleware` on a new alerts broker only | The triggers broker's retry labels would start re-running automations |
| 2026-09-25 | Error text for the email comes from a fixed Python catalog; the app reads `outcome.kind` | Prompt injection, data leaks, consistent fingerprints; no list shared across languages |
| 2026-09-25 | No automatic retries of automation runs in v0 | A retry can repeat side effects such as a sent email or a Slack post |
| 2026-09-25 | Cron scripts reuse `AGENTA_API_INTERNAL_URL` | No second variable for the same address |
| 2026-09-25 | Records retention (`records.sh`) is not part of this plan | It deletes customer data and needs its own decision |

## Superseded decisions

Kept so reviewers of earlier drafts can follow the change.

| Earlier decision | Replaced by | Why |
|---|---|---|
| New final status codes `520`, `504`, `499` and `202 paused` in `status` | The `outcome` column | The codes overloaded `status`, collided on `202`, and needed compare-and-set between two writers |
| Records worker enqueues settle jobs on a new queue; dispatcher and sweeper are two more sources | The polling monitor | The hook needed new dependencies, its own turn selection and enqueue-failure handling |
| Separate sweeper loop | Deadlines in the monitor's settle step | One loop instead of two |
| Per-event incident decisions under an advisory lock; recovery email held by the sweeper | Health evaluation on each pass | Event order caused false emails; state evaluation does not depend on order |
| Pending, failed and deferred send states re-sent by the sweeper | Broker retries plus re-evaluation | taskiq retries work once the middleware is on the right broker |
| Per-automation limit of 3 emails per hour | Removed | The health rules already limit emails |

## Open questions

| Question | Proposal |
|---|---|
| Who receives the email? | Creator if still a project member, else project admins |
| Send an email for "needs approval"? | Yes, because nobody watches automation runs |
| Does an empty answer count as a failure? | No in v0; record it as success |
| Reminder interval | 24 hours |
| Send a "back to normal" email? | Yes |
| Cloud only, or OSS too? | Code ships in both; mode defaults to `off`; self-hosters opt in |
| Shadow exit numbers | Zero false alarms and zero missed failures over the last 5 days |

## Blockers

These need production access. None of them blocks phase 1 or phase 2 of the plan.

| Check | How | Needed for |
|---|---|---|
| Does email work in cloud? | Invite a teammate on cloud. If the email arrives, SendGrid works, and its sender is the alert sender. | Shadow email |
| Does the cloud cron reach the API? | Search cloud cron logs for `Could not resolve host` | Trusting schedule results |
| Real volume and failure rate | Run [sizing.sql](./sizing.sql) (core, then tracing) | Storm cap, monitor query cost, catalog priorities |

## Next steps

1. Team review of this plan; answer the open questions.
2. Run the three production checks.
3. Start phase 1 (cron host fix) as its own small change.
4. Start phase 2 (record the outcome) with mode `off`.

## Related bugs found during research

Track these separately; they are not part of this feature:

- Cron scripts hard-code `http://api:8000` (all cron jobs fail on Helm). Phase 1 fixes it.
- `records.sh` is never scheduled, so records retention never runs. Turning it on deletes
  customer data (for example everything older than 7 days on free), so it needs its own
  product decision and change.
- An edit without `flags` re-enables a revoked subscription.
- A revoked connection keeps running its subscriptions.
- The ORM model lacks `ix_trigger_deliveries_schedule_id_created_at`.
