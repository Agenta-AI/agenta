# Channel message retention

## Purpose

Limit how long Agenta keeps the Slack and Telegram messages a connected bot receives and the replies it posts, without breaking replies in flight or the context of the next turn.

## ADDED Requirements

### Requirement: Retention period
Agenta SHALL keep stored channel messages for a retention period set by `AGENTA_CHANNELS_MESSAGE_RETENTION_DAYS`. The default SHALL be 30 days. The value `0` SHALL turn the periodic cleanup off. A negative or non-numeric value SHALL fail API startup. The period SHALL apply to every project and every connection of the deployment.

#### Scenario: Default period
- **WHEN** the variable is not set
- **THEN** the retention period SHALL be 30 days.

#### Scenario: Cleanup turned off
- **WHEN** an operator sets `AGENTA_CHANNELS_MESSAGE_RETENTION_DAYS=0`
- **THEN** the periodic cleanup SHALL delete nothing
- **AND** the disconnect purge and the space deletion purge SHALL still run.

#### Scenario: Invalid value
- **WHEN** an operator sets `AGENTA_CHANNELS_MESSAGE_RETENTION_DAYS=-1`
- **THEN** the API SHALL refuse to start and name the variable.

### Requirement: Periodic cleanup
A job SHALL run every hour. It SHALL delete, in every project, received messages (`channel_inbox_events`), bot replies (`channel_outbox_events`) and turn triggers (`channel_inbox_triggers`) whose `created_at` is before the cutoff, which is the current time minus the retention period. It SHALL NOT delete thread rows, spaces, grants, agents, connections or identity links. It SHALL delete in batches of at most 1,000 rows per statement, commit after each batch, and stop after 10 minutes, leaving the rest for the next run.

#### Scenario: Old message deleted
- **WHEN** a received message was stored 31 days ago and the period is 30 days
- **THEN** the next run SHALL delete it.

#### Scenario: Recent message kept
- **WHEN** a received message was stored 29 days ago and the period is 30 days
- **THEN** the next run SHALL NOT delete it.

#### Scenario: Unrouted message
- **WHEN** a received message older than the period was never routed to a space
- **THEN** the next run SHALL delete it.

#### Scenario: Thread row kept
- **WHEN** every message, reply and trigger of a thread is older than the period
- **THEN** the run SHALL keep the thread row, so the next mention in that thread continues the same agent session.

#### Scenario: Large backlog
- **WHEN** 50,000 rows are older than the period
- **THEN** the run SHALL delete them in batches of at most 1,000 rows
- **AND** SHALL stop after 10 minutes and continue on the next run.

#### Scenario: Projects stay separate
- **WHEN** the job runs
- **THEN** each delete SHALL be scoped to one project, and no batch SHALL touch rows of two projects.

### Requirement: Imported history follows the same rules
Messages copied from a platform's history (origin PULLED) SHALL be subject to the same retention period and the same cleanup as live messages, measured from when Agenta stored them. Any copy of platform history SHALL NOT import a message the platform timestamps before the retention cutoff. When the cleanup is turned off, this bound SHALL NOT apply, and only the copy's own limits apply.

#### Scenario: Imported message deleted like any other
- **WHEN** a message imported from Slack history was stored 31 days ago and the period is 30 days
- **THEN** the next run SHALL delete it.

#### Scenario: Copy stops at the cutoff
- **WHEN** the retention period is 5 days and a history copy runs for a channel with 14 days of messages
- **THEN** the copy SHALL import only messages posted in the last 5 days.

#### Scenario: Copy with its own shorter limit
- **WHEN** the retention period is 30 days and a history copy is limited to 14 days back
- **THEN** the copy SHALL import only messages posted in the last 14 days.

### Requirement: The next turn's starting point survives
The periodic cleanup SHALL NOT delete, for any thread, the trigger that `fetch_latest_trigger` would return for a new message in that thread: the trigger with the highest `event_id` among the triggers that count as an offset. It SHALL NOT delete a trigger in state STARTED. The trigger kept MAY point to a received message that was deleted.

#### Scenario: Quiet thread mentioned again
- **WHEN** a thread's last turn was 40 days ago, three unaddressed replies were posted 35, 20 and 5 days ago, and someone now mentions the bot, with a 30-day period
- **THEN** the turn SHALL receive the replies from 20 and 5 days ago and the mention
- **AND** SHALL NOT receive again any message from before the thread's last turn.

#### Scenario: Refused trigger is not the starting point
- **WHEN** a thread's newest trigger is REFUSED and older than the period, and the trigger before it is SETTLED
- **THEN** the run SHALL keep the SETTLED trigger, because it is the starting point.

#### Scenario: Unsettled turn
- **WHEN** a trigger in state STARTED is older than the period
- **THEN** the run SHALL NOT delete it.

### Requirement: Replies in flight survive
No cleanup SHALL delete a reply row unless its state is SENT, FAILED or ABANDONED and its status code is neither `sending` nor `delivery_uncertain`. No cleanup SHALL delete the reply row that an active thread's open choice points to.

#### Scenario: Pending reply
- **WHEN** a reply row in state CREATED is older than the period
- **THEN** the run SHALL NOT delete it.

#### Scenario: Claimed reply
- **WHEN** a reply row holds a `sending` claim
- **THEN** no cleanup SHALL delete it.

#### Scenario: Unknown outcome
- **WHEN** a reply row is FAILED with status code `delivery_uncertain`
- **THEN** no cleanup SHALL delete it.

#### Scenario: Open approval card
- **WHEN** an active thread has an open choice whose card is a reply row older than the period
- **THEN** the run SHALL keep that reply row.

### Requirement: Cleanup on disconnect
When a connection has been archived for longer than `AGENTA_CHANNELS_DISCONNECT_PURGE_DAYS` (default 7 days), the hourly job SHALL delete every received message of the connection, every reply, every trigger, and every thread row in the connection's spaces, subject only to the rule for replies in flight. It SHALL keep the connection, its agents, spaces, grants and identity links. It SHALL record on the connection when the purge ran, and SHALL purge a connection again only if it was archived again after that time. The value `0` SHALL turn the disconnect purge off.

#### Scenario: Restore within the grace period
- **WHEN** an admin disconnects a bot and restores it 3 days later, by unarchive, Slack reinstall or Telegram reconnect
- **THEN** no purge SHALL have run
- **AND** every message, reply and thread SHALL still be there, and each thread SHALL continue its session.

#### Scenario: Purge after the grace period
- **WHEN** a bot has been disconnected for 8 days with a 7-day grace period
- **THEN** the next run SHALL delete its messages, replies, triggers and threads.

#### Scenario: Reconnect after the purge
- **WHEN** an admin reconnects a bot whose messages were purged
- **THEN** the bot SHALL come back with its agent, its spaces and its grants
- **AND** the next message in any conversation SHALL start a new thread and a new agent session
- **AND** Agenta SHALL NOT import the channel's history again.

#### Scenario: Disconnected twice
- **WHEN** a purged connection is restored, then disconnected again
- **THEN** the job SHALL purge it again 7 days after the second disconnect.

#### Scenario: Grace purge turned off
- **WHEN** an operator sets `AGENTA_CHANNELS_DISCONNECT_PURGE_DAYS=0`
- **THEN** disconnecting SHALL delete nothing, and only the periodic cleanup SHALL apply.

#### Scenario: Queued message of a purged bot
- **WHEN** a dispatch task for a purged message runs
- **THEN** the dispatcher SHALL find no message and do nothing.

### Requirement: Cleanup when a space is deleted
Deleting a space SHALL delete, in the same request, the space's received messages, its thread rows, and those threads' triggers and replies, subject only to the rule for replies in flight.

#### Scenario: Space deleted from settings
- **WHEN** an admin deletes the space for #support
- **THEN** its stored messages, threads, triggers and replies SHALL be deleted
- **AND** a later message in #support SHALL create a new space and start fresh.

#### Scenario: Other spaces untouched
- **WHEN** an admin deletes one space of a connection
- **THEN** the messages of the connection's other spaces SHALL stay.

### Requirement: Sessions are out of scope
No channel cleanup SHALL delete agent sessions, session records, traces, queued follow-ups or runner state.

#### Scenario: Session after cleanup
- **WHEN** the periodic cleanup deletes a thread's old messages
- **THEN** the thread's agent session and its history SHALL stay readable in Agenta.

### Requirement: Admin route
The job SHALL be reachable at `POST /admin/channels/messages/sweep`, accepted only with the platform `Access` key. It SHALL return the number of rows it deleted per table and the number of connections it purged. The cron service SHALL call it every hour.

#### Scenario: Called without the key
- **WHEN** a request without the `Access` key calls the route
- **THEN** the API SHALL refuse it and delete nothing.

#### Scenario: Counts returned
- **WHEN** the cron service calls the route
- **THEN** the response SHALL hold the counts of deleted received messages, replies, triggers and threads, and of purged connections.

### Requirement: People can see the retention
The connection response SHALL include the read-only fields `message_retention_days` and `disconnect_purge_days`. The disconnect confirmation SHALL state that stored platform messages are deleted after the grace period. The Channels settings page SHALL state the retention period. Both SHALL show the deployment's values, and SHALL say that messages are kept when the matching value is `0`.

#### Scenario: Disconnect confirmation
- **WHEN** an admin clicks Disconnect on a Slack bot with the defaults
- **THEN** the confirmation SHALL say that the stored messages are deleted 7 days after disconnecting.

#### Scenario: Self-hosted operator changed the period
- **WHEN** the deployment sets the retention period to 90 days
- **THEN** the settings page SHALL show 90 days.
