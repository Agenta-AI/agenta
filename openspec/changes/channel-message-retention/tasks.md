# Tasks

These tasks describe future implementation. All remain unchecked. Mahmoud asked for the behavior to be reviewed before any implementation. Each numbered group ships as its own pull request. [plan.md](plan.md) gives the files, tests, and commands for every task.

## 1. Periodic cleanup

- [ ] 1.1 Add `env.channels.retention` with `message_retention_days` (default 30), `disconnect_purge_days` (default 7), `batch_size` (default 1,000) and `time_budget_seconds` (default 600); verify the defaults, `0`, and that a negative value fails startup.
- [ ] 1.2 Extract the "counts as an offset" predicate that `fetch_latest_trigger` uses into one shared function; verify `fetch_latest_trigger` behaves exactly as before.
- [ ] 1.3 Add the retention DAO with batched, project-scoped deletes of old received messages, replies and triggers; verify against PostgreSQL the cutoff, the batch limit, project isolation, the starting-point rule for every trigger state, STARTED triggers, replies in flight and the open-choice card.
- [ ] 1.4 Add `ChannelsRetentionService.sweep` with the per-project loop and the time budget; verify with an in-memory DAO that it stops at the budget, skips the cleanup when the period is `0`, and returns counts.
- [ ] 1.5 Verify end to end that a new mention in a thread whose last turn is older than the period receives only the messages after that turn.
- [ ] 1.6 Bound every copy of platform history at the retention cutoff: add an `oldest` argument to the adapter's `fetch_history` and pass the cutoff from `run_backfill`; verify Slack sends `oldest`, imported rows are cleaned up like live ones, and no bound is sent when the cleanup is off.
- [ ] 1.7 Add the admin route `POST /admin/channels/messages/sweep`; verify it refuses a request without the `Access` key and returns the counts.
- [ ] 1.8 Add `channels.sh` and `channels.txt`, register them in the four API Dockerfiles and both dev compose files; verify the generated crontab lists the job.
- [ ] 1.9 Document both variables in the Channels section of the self-host configuration reference.

## 2. Disconnect purge and space deletion

- [ ] 2.1 Add the index `ix_channel_outbox_events_connection (project_id, connection_id, id)` in a new migration; verify upgrade and downgrade.
- [ ] 2.2 Add the connection purge to the retention DAO; verify against PostgreSQL that it deletes routed and unrouted messages, replies, triggers and threads, keeps settings and identity links, keeps replies in flight, and touches no other connection.
- [ ] 2.3 Select archived connections past the grace period in `sweep` and record `messages_purged_at`; verify restore inside the window, purge after it, a second disconnect, and `disconnect_purge_days = 0`.
- [ ] 2.4 Verify that after a purge, a reconnect restores agents, spaces and grants, starts a new thread and session, and does not import history again.
- [ ] 2.5 Purge a space's messages, threads, triggers and replies when the space is deleted; verify other spaces keep theirs.

## 3. What people see

- [ ] 3.1 Add the read-only `message_retention_days` and `disconnect_purge_days` fields to the connection response; verify they follow the environment.
- [ ] 3.2 Regenerate the TypeScript client; add the retention sentence to the disconnect confirmation and the retention line to the Channels settings page, with wording approved by Mahmoud; verify both show the deployment's values and the `0` case.
