# Design

## Context

Channels stores what it receives and what it posts in PostgreSQL. All channels tables were created in `oss000000034_add_channels.py` and `oss000000035_add_telegram_hosted_bind.py`. Every one of them has a single foreign key, to `projects.id` with `ON DELETE CASCADE`. The links between channels tables (a message to its connection, a thread to its space) are plain UUID columns with no foreign key. So deleting a connection or a space removes only that one row, and nothing else follows.

Nothing deletes channel rows today, except project deletion:

- Disconnect (`POST /channels/connections/{id}/archive`) sets `deleted_at` on the connection and its agents. `ChannelsService.archive_connection` says so on purpose: "leaves spaces, grants, threads and the event log untouched".
- Slack's `app_uninstalled` and `tokens_revoked` events only set `flags.is_active` to false.
- `DELETE /channels/spaces/{id}` removes the space row. Its messages keep the old `space_id`, and a later message in the same channel creates a new space row with a new ID. The old messages are never read again.
- `ChannelsDAO.delete_connection` removes the connection row. Only the create path uses it, to roll back a connection that failed to register.

### What is stored

| Table | What it holds | Message text or personal data | Link to the connection | Link to the space |
| --- | --- | --- | --- | --- |
| `channel_inbox_events` | One row per received message, including messages that never triggered a turn and messages imported by the one-time backfill. | Yes. `data.processed.content` is the message text and files. `data.processed.sender` is the platform user. `data.external_locator` holds the channel, thread and message IDs. | `connection_id` | `space_id`. It is null until the message is routed, and it stays null for messages that are never routed. |
| `channel_outbox_events` | One row per reply the bot posts, edited in place while the reply streams. | Yes. `data.processed.content` is the posted text. `data.external_locator` is the platform's receipt. `status` holds the delivery claim or the unknown-outcome marker. | `connection_id` | Through `thread_id`, then the thread's `space_id`. |
| `channel_inbox_triggers` | One row per turn a message opened. | No text. It holds the message ID (`event_id`), the turn ID, the state and an error status. | Through `thread_id`. | Through `thread_id`. |
| `channel_threads` | One row per conversation. It maps the conversation to its agent session (`session_id`). | Little. `data.external_locator` holds the thread ID. `data.pending_choice` holds the labels of an open approval or choice, written by the agent. | Through `space_id`. | `space_id` |
| `channel_spaces` | One row per Slack channel, Slack DM or Telegram chat the bot has been used in. | Channel and chat IDs, and for a DM the platform's DM ID. No message text. | `connection_id` | It is the space. |
| `channel_grants`, `channel_agents`, `channel_connections` | Settings: which agent answers, where, and with which rules. The connection holds the workspace name and a reference to the credential secret. | No message text. | Direct. | `channel_grants.space_id` for a per-space rule. |
| `channel_identity_links` | A platform user linked to an Agenta account. | Personal data (who is who). No message text. | `connection_id` | None. |
| `channel_telegram_bind_tokens`, `channel_telegram_chat_bindings` | Hosted Telegram: one-time bind codes, and which Telegram chat belongs to which project. | Chat IDs. No message text. Disconnect already releases the chat bindings. | `connection_id` | None. |

Redis holds no message text for Channels:

- `queues:channels-inbox` carries one dispatch task per received message. The task holds only `project_id`, `connection_id`, `channel` and `external_id`. The dispatcher reads the message from `channel_inbox_events`, and it does nothing if the row is gone. The stream is capped at about 100,000 entries (approximate `MAXLEN`), so old entries are trimmed by length.
- `streams:sessions` carries `turn_started` and `turn_ended` events with `project_id`, `session_id` and `turn_id`. The outbox worker in the `worker-sessions-channels-outbox` group consumes it. It is capped at about 100,000 entries in the same way.

### What lives outside Channels

A channel turn also writes the conversation to places this change does not touch:

| Where | What it holds | Retention today |
| --- | --- | --- |
| `records` (tracing database) | The session history: every message and tool call of every turn. It is what "Past conversations stay in Agenta" refers to. | Agenta Cloud: deleted per plan by `api/ee/src/crons/records.sh` (7, 31 or 92 days). Self-hosted: kept. |
| Trace spans | Inputs and outputs of each run. | Agenta Cloud: deleted per plan by `spans.sh`. Self-hosted: kept. |
| `session_inputs` | A follow-up sent while a turn was running, as the full composed input. | Kept. |
| `session_streams`, `session_turns` | Session and turn bookkeeping: IDs, harness kind, sandbox ID, trace ID. No text. | Kept. |
| The harness transcript in the sandbox | The harness's own session files. | Deleted with the sandbox, by default 30 minutes after it stops (`AGENTA_RUNNER_DAYTONA_AUTODELETE_MINUTES`). |
| The runner's continuity store | In-memory state rebuilt from `session_turns`. No text. | Process lifetime. |

### How turns read stored messages

`compose_input` calls `select_forwardfill_range` in `api/oss/src/core/channels/fill.py`. It asks `fetch_latest_trigger` for the thread's latest trigger, then reads the space's messages after that trigger's `event_id`. With no trigger, it reads the space from the beginning. PR #7128 keeps this shape. It skips REFUSED triggers and FAILED triggers whose start never reached the workflow service (`never_sent`), orders by `event_id`, and stops the range at the mention.

Two facts follow:

1. The offset is a value, not a reference. `query_events_since` compares message IDs with `>`. If the message the latest trigger points at is deleted, the comparison still works.
2. Losing the latest trigger is dangerous. The next turn would read the space from the beginning: every message still stored in that channel. `compose_input` then keeps only the thread's own messages (`_filter_thread_events`), so the agent would receive again every stored message of its thread, including the ones it already answered, and the read would scan the whole channel.

## Goals / Non-Goals

**Goals**

- Stored channel messages are deleted after a retention period.
- A disconnected bot's stored messages are deleted after a grace period.
- A deleted space's messages are deleted.
- No cleanup ever breaks a reply in flight, a pending delivery, or the next turn's starting point.

**Non-Goals**

- Retention for sessions, traces, queued follow-ups or sandboxes.
- A per-project or per-connection retention setting.
- A user-facing "delete this conversation now" action.
- Deleting identity links or settings on disconnect.
- Deleting messages on the platform (Slack or Telegram) itself.

## Decisions

### 1. Retention period: 30 days, one deployment-wide variable

Example: a Slack channel where the bot was mentioned on 1 March. With a 30-day period, the message and the bot's reply are deleted by the first hourly run after 31 March.

Options:

- **A. One deployment-wide variable, default 30 days (recommended).** `AGENTA_CHANNELS_MESSAGE_RETENTION_DAYS` in `env.channels.retention`. `0` turns the cleanup off. Simple, and a self-hosting operator controls it. Agenta Cloud uses the default for every plan.
- **B. Per plan, like traces and session records.** Hobby 7 days, Pro 31, Business 92, through the EE entitlements. Consistent with Cloud's other retention, but EE-only. Self-hosted would keep messages forever unless we add A anyway. It also makes a short plan lose conversation context sooner than its sessions do.
- **C. A per-project or per-connection setting.** Most flexible. Needs a column or a settings field, an API, a UI control, and a rule for how it combines with the deployment default. Nobody has asked for it yet.

Why A: the stored copy exists only to feed the next turn the messages since the last one. 30 days covers a thread that goes quiet for weeks. The value is short enough to be a real limit. A per-plan or per-project setting can be added on top later without changing the behavior of A.

Why 30 and not 7: a Slack thread can stay idle for two weeks and then get a new mention. With 7 days, the agent would miss the unaddressed replies posted in between. Its session still remembers its own earlier turns, but it would not see what people said without mentioning it.

### 2. What the periodic cleanup deletes: whole rows, but not the conversation records

Example: a thread with 40 messages, 3 bot replies and 3 turns, all older than 30 days. The cleanup deletes the 40 message rows, the 3 reply rows and 2 of the 3 trigger rows. It keeps the thread row and the newest trigger.

Options:

- **A. Delete whole message, reply and trigger rows. Keep thread rows and each thread's starting-point trigger (recommended).** The text is gone. The conversation stays linked to its agent session, so the next mention in that thread continues the same session.
- **B. Blank the text only.** Keep every row but clear `data.processed.content`, `data.processed.sender` and the receipt. Row counts never shrink, and every reader must handle a blank message. It adds work and keeps the growth problem.
- **C. Delete whole rows, including threads.** The thread row holds almost no text. Deleting it cuts the conversation off from its session, and the next mention starts a new session. That goes beyond deleting stored messages.

Why A: it removes all message text and gives the database back its space. It changes nothing a user can notice except that very old unaddressed messages are no longer passed to the agent.

What A keeps, in detail:

- **Thread rows.** Periodic cleanup never deletes them. Their `pending_choice` holds only button labels, and it is replaced or cleared when the choice is answered.
- **The starting-point trigger of each thread**: the row `fetch_latest_trigger` would return for a new mention. Section "Safety rules" gives the exact rule.
- **Trigger rows in state STARTED**, whatever their age. A STARTED row is a turn that has not settled.
- **Reply rows that are not final**: state CREATED, a live `sending` claim, or `delivery_uncertain`.
- **The reply row an open choice points to** (`pending_choice.outbox_event_id`), so answering the choice can still update the card.

Age is measured from when Agenta stored the row (`created_at`), not from when it was posted on the platform.

**Imported history follows the same rules.** Messages copied from the platform's history (origin PULLED) are stored in `channel_inbox_events` like live messages. The cleanup treats them the same way: same period, same age rule, no exception. Today the one-time backfill in `run_backfill` imports a bounded number of recent messages. A planned follow-up will copy a channel's older Slack history once, when the bot joins, capped at about 7 to 14 days back. This change adds one rule for any such copy: it never imports a message posted before the retention cutoff (now minus the retention period). A copy would otherwise store text that the next hourly run deletes, or, measured from import time, keep it longer than the period promises. With the default 30 days, the follow-up's own 7 to 14 day cap is the tighter limit. With a shorter period, for example 5 days, the copy goes back only 5 days.

### 3. Disconnect: delete after a 7-day grace period

Example: an admin disconnects the Slack bot on Monday by mistake and reinstalls it on Wednesday. Everything comes back as it was, including the conversations. If she reinstalls it three weeks later, the bot comes back with its agent, its channels and its rules, but the old messages are gone and every thread starts a new conversation.

Options:

- **A. Delete right away, inside the disconnect request.** Clear and immediate. But the restore paths stop being restores: `unarchive_connection`, a Slack reinstall (`install_connection`), a Telegram reconnect (`_reuse_existing_identity`) and a hosted Telegram reconnect all bring the connection back by design. A reply still streaming when the admin clicks Disconnect would recreate its row after the delete. A large connection would make the request slow.
- **B. Delete after a grace period, default 7 days (recommended).** The hourly job purges connections that have been archived for longer than `AGENTA_CHANNELS_DISCONNECT_PURGE_DAYS`. A restore inside the window clears `deleted_at`, so nothing is purged. A turn in flight has long finished.
- **C. Never delete on disconnect; rely on the periodic cleanup.** Simplest. The messages would still be gone after 30 days. But a customer who disconnects to "remove the bot" keeps a full copy for another month, which is what this change is meant to fix.

Why B: it keeps every restore path working and removes the race with replies in flight. It still deletes the data within a week.

What the purge deletes: every received message of the connection (routed or not), every reply, every trigger, and every thread row in the connection's spaces. It keeps the connection, its agents, spaces, grants and identity links, so a later reconnect restores the setup. The purge records the time it ran on the connection. A connection that is restored and then disconnected again is purged again after a new grace period.

The space's `is_backfilled` flag stays set after a purge. A later reconnect therefore does not import the channel's history again. That is intended: the admin removed that history.

A Slack uninstall (`app_uninstalled`, `tokens_revoked`) does not archive the connection. It only sets `flags.is_active` to false. This design does not purge on uninstall, and the periodic cleanup covers those messages within 30 days. If Mahmoud wants uninstall to count as a disconnect, the same purge can key on the time the flag was set.

### 4. Ongoing conversations older than the period

Example: a Slack thread started on 1 March. People reply in it, without mentioning the bot, until 20 April. On 22 April someone mentions the bot. The replies from before 23 March are gone. The agent receives the replies from 23 March onward, plus the mention. Its session still holds its own turns since 1 March.

Options:

- **A. Delete by age only. Keep each thread's starting point (recommended).** A long conversation loses only its oldest unaddressed messages.
- **B. Keep everything in an active thread.** PR #7128 closes a thread only on `!new`, so most threads stay active forever. With B, almost nothing would ever be deleted.
- **C. Keep a thread's rows while it had a turn in the last N days.** Closer to what people expect of an ongoing conversation. It costs a join per batch, and a busy thread could keep its oldest messages forever.

Why A: the agent's memory of the conversation lives in its session, not in these rows. These rows only fill the gap between two turns. A gap longer than the retention period is rare, and losing its oldest part is the intended effect of a retention period.

### 5. Sessions and traces are out of scope

Example: after 30 days, the Slack messages of a thread are deleted, but the session in Agenta still shows the whole conversation, including the text of each mention.

Options:

- **A. Out of scope. Point to the existing retention (recommended).** On Agenta Cloud, session records and traces already expire per plan. Self-hosted deployments keep them.
- **B. Delete the sessions of channel threads with the channel messages.** Makes "delete after 30 days" true across the product for channel conversations. But it would delete sessions people read in Agenta, it breaks the disconnect copy "Past conversations stay in Agenta", and it needs deletes across two databases (core and tracing) plus the runner's turn ledger.
- **C. A follow-up change for session retention on self-hosted deployments.** The right home for B, if we want it.

Why A: this change removes the duplicate copy that nobody reads. Session retention is a product question that covers the playground and automations too, not just Channels. It should be decided once, in its own change.

### 6. What people see

Example: an admin opens the Slack bot in Channels settings and clicks Disconnect.

Options:

- **A. One sentence in the disconnect confirmation and one line on the Channels settings page (recommended).** Today the confirmation says "Past conversations stay in Agenta." It would also say that the messages Agenta stored from the platform are deleted 7 days after disconnecting. The settings page would say that stored messages are kept for 30 days. Both read the values from the API, so a self-hosted operator's setting shows correctly.
- **B. Documentation only.** No UI change. Admins would not find out until messages are missing.
- **C. A retention control in settings.** Only makes sense with decision 1C.

Why A: it is the least UI that tells the truth at the moment it matters. The wording is Mahmoud's call. The plan leaves the exact text as a placeholder rather than inventing it.

To serve the values, the connection response gains two read-only fields: `message_retention_days` and `disconnect_purge_days`.

### 7. How and where the job runs

Options:

- **A. A cron script that calls an admin route (recommended).** This is how `gateways.sh`, `triggers.sh` and `queries.sh` work in OSS, and how `spans.sh`, `records.sh` and `events.sh` work in EE. `channels.sh` runs every hour and POSTs to `/admin/channels/messages/sweep` with the `Access` key. The route is admin-only by its mount point.
- **B. An asyncio loop inside `worker-streams` or `worker-queues`.** No new cron entry, but every replica would run it, so it would need a lock. None of the existing retention jobs work this way.
- **C. A taskiq schedule.** The API has no taskiq scheduler today. Adding one for a single job is not worth it.

Why A: it reuses a pattern with six working examples, runs once per deployment, and is visible in the cron container's logs.

### 8. How the deletes run

- **Per project.** The job lists the projects that have a channel connection, archived ones included. That list is short. For each project, it deletes by primary key range.
- **By ID and time.** Channel IDs are UUIDv7 (`IdentifierDBA` uses `uuid.uuid7`), so an ID is ordered by creation time. `dbes.py` already relies on this ("uuid7 id IS arrival order"). The delete bounds the ID by the smallest UUIDv7 of the cutoff instant, which uses the `(project_id, id)` primary key, and also checks `created_at < cutoff`, so a row with a hand-made ID is never deleted early.
- **In batches.** Each statement deletes at most 1,000 rows (`DELETE ... WHERE (project_id, id) IN (SELECT ... LIMIT 1000)`) and commits. The job stops after a time budget of 10 minutes and continues on the next run.
- **Indexes.** Periodic cleanup uses only primary keys. The disconnect purge finds received messages through `uq_channel_inbox_connection_external`, spaces through `uq_channel_spaces_connection_external_key`, threads through `ix_channel_threads_current`, and triggers through `ix_channel_inbox_triggers_latest`. Replies have no index on `connection_id`, so one new index is added: `ix_channel_outbox_events_connection (project_id, connection_id, id)`.
- **Order.** Triggers first, with the starting-point rule, then replies, then received messages. There are no foreign keys, so the order only matters for the starting-point rule, which must see all of a thread's triggers.

## Safety rules

These rules hold for every delete in this change. The specification states each one as a requirement with scenarios.

1. **The starting point survives.** Periodic cleanup never deletes, for any thread, the trigger with the highest `event_id` among the triggers that count as an offset. With PR #7128 merged, a trigger counts unless it is REFUSED, or FAILED with status code `never_sent`. Without PR #7128, every trigger counts. The rule is written against the same predicate `fetch_latest_trigger` uses, and a test pins that the two agree.
2. **A dangling offset is fine.** The starting-point trigger may point to a message that was deleted. `query_events_since` compares IDs by value, so the range is still correct.
3. **A reply in flight survives.** A reply row is deleted only if its state is SENT, FAILED or ABANDONED, and its status is neither a `sending` claim nor `delivery_uncertain`. The disconnect purge follows the same rule. With a 7-day grace period, no such row is left in practice.
4. **An open choice keeps its card.** A reply row that an active thread's `pending_choice.outbox_event_id` points to is not deleted.
5. **Redeliveries stay harmless.** Deleting a received message frees its `(connection_id, external_id)` key. A platform redelivery of the same message would be stored again. Slack retries within minutes and Telegram within 24 hours, both far inside 30 days. The disconnect purge only runs on archived connections, and the ingress refuses those.
6. **A queued dispatch finds nothing and stops.** If a dispatch task in `queues:channels-inbox` runs after its message was purged, `InboxDispatcher.dispatch` logs "no logged event" and returns.

## Interface roles

| Field | Role | Owner | Changes when |
| --- | --- | --- | --- |
| `AGENTA_CHANNELS_MESSAGE_RETENTION_DAYS` | Policy | Deployment operator | Rarely, at deploy time. |
| `AGENTA_CHANNELS_DISCONNECT_PURGE_DAYS` | Policy | Deployment operator | Rarely, at deploy time. |
| `connection.data.messages_purged_at` | State | The retention job | Once per disconnect. |
| `message_retention_days`, `disconnect_purge_days` on the connection response | Read-only data for the UI | The API | With the environment. |
| `POST /admin/channels/messages/sweep` response `{inbox, outbox, triggers, threads, connections}` | Counts for logs | The retention job | Every run. |

## Risks / Trade-offs

- **An old quiet thread loses context.** The agent no longer sees unaddressed messages older than 30 days. Mitigation: the period is configurable, and the session keeps the agent's own turns.
- **The web "Agenta" channel conversation view** (`/channels/agenta/conversations/{id}`) reads the same tables. It will show only the retention window. The session view in Agenta still has the whole conversation.
- **The starting-point rule couples to `fetch_latest_trigger`.** If someone changes which triggers count, the cleanup must change too. Mitigation: both use one shared predicate, and a test checks the cleanup keeps exactly the row `fetch_latest_trigger` returns.
- **The first run on a large deployment** deletes a backlog. Batches and the time budget spread it over several hours.
- **Hard-coded retention with no per-customer override.** A customer who needs a shorter period on Agenta Cloud cannot get it without decision 1B or 1C.

## Migration Plan

1. Add the index in a new migration after the current head of `api/oss/databases/postgres/migrations/core_oss/versions/`. Channels tables are small today, so a plain `CREATE INDEX` is fine.
2. Deploy the API with the new route and variables. The cron entry ships in the same image.
3. The first hourly run deletes the backlog older than 30 days, in batches.

Rollback: set `AGENTA_CHANNELS_MESSAGE_RETENTION_DAYS=0` and `AGENTA_CHANNELS_DISCONNECT_PURGE_DAYS=0` to stop all deletes. Deleted rows cannot be restored.

## Verification Plan

- Unit tests for the retention service with an in-memory DAO: cutoffs, the time budget, the disabled setting.
- Integration tests against PostgreSQL for each DAO delete: the starting-point rule (with every trigger state), replies in flight, the open-choice card, batches, project isolation, and the disconnect purge with restore before and after the grace period.
- A test that runs `select_forwardfill_range` after a cleanup and checks that a new mention in an old thread reads only the messages after its last turn.
- Live check on the local stack: post in a Slack thread, back-date the rows in PostgreSQL, call the admin route with the `Access` key, then mention the bot and read the turn input.

## Effort

About 6 to 8 engineer-days, in three pull requests:

1. Periodic cleanup: DAO, service, route, cron, variables and docs. 3 to 4 days.
2. Disconnect purge and space deletion: DAO purge, index migration, the space delete path. 2 to 3 days.
3. Settings copy: two read-only fields and two sentences in the settings UI. 1 day.
