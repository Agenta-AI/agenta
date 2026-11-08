# Discord socket

## Purpose

Keep one Discord Gateway socket open per active Discord connection, inside the existing `worker-queues` process, and turn every event it receives into a stored inbox row and an enqueued dispatch.

## ADDED Requirements

### Requirement: Socket loop inside worker-queues
`worker-queues` SHALL start the Discord socket loop as a sibling asyncio task when `channels-inbox` is among its selected queues. Agenta SHALL NOT add a new service, a new `AGENTA_WORKER_QUEUES` value or a new `AGENTA_WORKER_STREAMS` value for it.

#### Scenario: channels-inbox selected
- **WHEN** `worker-queues` starts with `AGENTA_WORKER_QUEUES` empty or containing `channels-inbox`
- **THEN** it SHALL run the socket loop next to the `channels-inbox` receiver and `heartbeat.ticker`

#### Scenario: channels-inbox not selected
- **WHEN** `worker-queues` starts without `channels-inbox`
- **THEN** it SHALL NOT start the socket loop

#### Scenario: Shutdown
- **WHEN** `worker-queues` receives SIGTERM
- **THEN** the loop SHALL close its sockets and release its lock

### Requirement: One lock owns all Discord sockets
The loop SHALL hold one Redis lock, namespace `channels` and key `discord:sockets`, through `acquire_lock`, `renew_lock` and `release_lock` in `oss/src/utils/locking.py`, before it opens any socket. Only the holder SHALL open sockets. The loop SHALL renew the lock in a task separate from the connection reload, so a slow reload never delays the renewal. Each renewal call SHALL time out well before the lease expires, and a timeout SHALL count as a lost lock.

#### Scenario: Two replicas
- **WHEN** two `worker-queues` replicas start
- **THEN** exactly one SHALL hold the lock and open sockets, and the other SHALL keep trying to take the lock

#### Scenario: Lock lost
- **WHEN** the holder fails to renew the lock
- **THEN** it SHALL cancel the running reload and close all its Discord sockets before another replica can open them

#### Scenario: Reload blocked when the lease runs out
- **WHEN** a reload waits on the database while the lock expires
- **THEN** the renewal SHALL fail on its own schedule and the holder SHALL close its sockets without waiting for the reload

#### Scenario: Renewal call hangs
- **WHEN** Redis stops answering and a renewal call does not return
- **THEN** the call SHALL time out before the lease expires, and the holder SHALL close its sockets

#### Scenario: Holder dies
- **WHEN** the holder process stops without releasing the lock
- **THEN** another replica SHALL take the lock after it expires and SHALL open the sockets

### Requirement: Connections reload
The loop SHALL read active Discord connections with `ChannelsService.query_active_connections(channel="discord")` on a short interval, and SHALL open, restart or close sockets to match.

#### Scenario: New connection
- **WHEN** an editor connects a new Discord bot
- **THEN** the loop SHALL open its socket on the next reload, without a restart

#### Scenario: Token rotated
- **WHEN** an editor replaces the bot token of a connection
- **THEN** the loop SHALL restart that connection's socket with the new token

#### Scenario: Connection archived or switched off
- **WHEN** a connection is archived or is no longer active
- **THEN** the loop SHALL close its socket on the next reload

### Requirement: Events go through the adapter and the shared step
For each Discord Gateway dispatch, the loop SHALL encode the dispatch as JSON bytes of `{"t": <event name>, "d": <event data>}`, call `adapter.parse_event` with them, and pass each parsed event to `ChannelsService.record_and_enqueue_inbox_event`. The loop SHALL NOT run an agent turn and SHALL NOT dedupe events itself.

#### Scenario: Message arrives
- **WHEN** the socket receives `MESSAGE_CREATE`
- **THEN** the loop SHALL store one inbox row and enqueue one `channels.inbox.dispatch`

#### Scenario: Noise
- **WHEN** `parse_event` returns `None`
- **THEN** the loop SHALL store nothing

### Requirement: One error rule for transient and permanent errors
The loop SHALL classify each error once, as transient or permanent. On a transient error in parse, store or enqueue, the loop SHALL retry the same raw event with backoff for up to 10 minutes, and SHALL keep reading the socket while it retries. After 10 minutes, or on a permanent error, the loop SHALL log the event and drop it.

#### Scenario: Transient errors
- **WHEN** an error is a network or timeout error, a Discord 5xx or 429, `ChannelInboxEnqueueFailed`, a SQLAlchemy `OperationalError`, `InterfaceError` or pool checkout `TimeoutError`, or a `DBAPIError` with an invalidated connection or a Postgres SQLSTATE in classes 08, 53 or 57, or 40001, 40P01 or 25006
- **THEN** the loop SHALL treat it as transient, and every other error as permanent

#### Scenario: Queue outage
- **WHEN** Redis is down for 20 seconds while a message arrives
- **THEN** the loop SHALL retry that event until the enqueue succeeds, and the message SHALL start one turn

#### Scenario: Database outage
- **WHEN** the inbox insert fails while a message arrives
- **THEN** the loop SHALL retry the same event with backoff for up to 10 minutes until it is stored and enqueued, and SHALL log and drop it after that

#### Scenario: Permanent error
- **WHEN** the insert of an event fails with an error a retry cannot heal
- **THEN** the loop SHALL log the event and drop it after one try

#### Scenario: Process crash during the outage
- **WHEN** the process stops while it still retries an event
- **THEN** the message MAY have no row or no turn, which is a documented limit shared with the webhook path

### Requirement: Socket errors
The loop SHALL let `discord.py` handle heartbeat, resume and reconnect. When Discord closes a socket with code `4014`, the loop SHALL log an error that names the connection and SHALL retry with backoff.

#### Scenario: Intent turned off after setup
- **WHEN** the Message Content intent is turned off and Discord closes the socket with `4014`
- **THEN** the loop SHALL log the error and SHALL NOT reconnect in a tight loop

#### Scenario: Other connections unaffected
- **WHEN** one connection's socket fails
- **THEN** the other connections' sockets SHALL stay open

### Requirement: Recovery after a failed resume
On every READY, which Discord sends after a fresh IDENTIFY and never after a successful resume, the loop SHALL start one recovery pass, the first socket of a connection included. The pass SHALL read Discord history after the last stored message of each channel with the adapter's `fetch_messages_after`, oldest first, and pass each message through `parse_event` and `record_and_enqueue_inbox_event`.

#### Scenario: Recovery start
- **WHEN** a READY arrives
- **THEN** the pass SHALL start each channel after the highest message id per `source_channel_id` among the connection's `PUSHED` message rows of the last 24 hours stored before the READY time minus a 5 second clock margin, compared as integers

#### Scenario: History message shape
- **WHEN** the pass reads a REST message object, which has no `guild_id`
- **THEN** the loop SHALL wrap it as `{"t": "MESSAGE_CREATE", "d": {...message, "guild_id": <guild_id>}}` with the channel's `guild_id` from the row's locator, and with no `guild_id` for a DM channel

#### Scenario: Messages missed during the gap
- **WHEN** a socket loses its session, two messages are posted in channel C, and the new socket identifies fresh
- **THEN** the loop SHALL read `GET /channels/C/messages?after=<last stored id>` and SHALL store and enqueue both messages with origin `PUSHED`

#### Scenario: Opening mention is the only recent row in its channel
- **WHEN** the only recent inbox row from channel C is a mention M whose locator has `channel_id` C, `thread_id` M and `source_channel_id` C, and a second mention is posted in C during the gap
- **THEN** the loop SHALL group the rows by `source_channel_id` C, SHALL read the history of C, and SHALL store and enqueue the second mention

#### Scenario: Holder stops or the lock moves
- **WHEN** messages are posted while no replica holds the sockets, and a replica then opens the connection's socket
- **THEN** the loop SHALL recover after that socket's first READY, as after any other gap

#### Scenario: Successful resume
- **WHEN** the socket resumes successfully
- **THEN** the loop SHALL NOT read history, because Discord replays the missed events

#### Scenario: Live message stored right after READY
- **WHEN** a live message is stored on the new socket before recovery reads channel C
- **THEN** recovery SHALL leave it out of the start id, because it was stored after READY, so an earlier missed message is not hidden

#### Scenario: Second gap during a recovery
- **WHEN** the socket identifies fresh again while a recovery pass still runs
- **THEN** the loop SHALL start a second pass for the new READY, and the first pass SHALL keep going

#### Scenario: Message delivered twice
- **WHEN** the socket and recovery both deliver one message, in either order
- **THEN** the unique constraint SHALL drop the second row, and the dispatcher's claim on `(thread_id, event_id)` SHALL stop a second turn if both dispatches run

#### Scenario: Command already routed
- **WHEN** the live socket delivers `!new` and the dispatcher routes it, and recovery then reads the same message
- **THEN** recovery SHALL see that the command's row is attached to a space and SHALL NOT enqueue it, so the command does not run twice. A command whose dispatch failed after routing is not retried by recovery, which is a documented limit

#### Scenario: Ordinary message already stored
- **WHEN** recovery reads an ordinary message whose row exists, routed or not
- **THEN** recovery SHALL pass it through the shared step, which enqueues it, and the turn claim SHALL stop a second turn

#### Scenario: Error during recovery
- **WHEN** a recovered message, the recovery start or a history page fails with a transient error
- **THEN** recovery SHALL retry it with backoff before it moves on, so it never reads past an unstored message, and SHALL stop that channel when the error lasts past 10 minutes

#### Scenario: Permanent error during recovery
- **WHEN** a recovered message fails with a permanent error
- **THEN** recovery SHALL log it, skip only that message, and go on with the next message and the next channel

#### Scenario: Socket closed during an enqueue retry
- **WHEN** the lock is lost or the connection changes while a received event waits for an enqueue retry
- **THEN** the loop SHALL close the socket and SHALL let the retry and any running recovery pass finish

#### Scenario: Order after a gap
- **WHEN** recovery replays missed messages while the new socket also delivers live ones in the same conversation
- **THEN** the agent MAY answer them out of order, which is a documented limit: recovery runs only after a failed resume, and a fix needs per-conversation serialization in the shared inbox dispatcher

#### Scenario: Quiet channel
- **WHEN** a channel has no stored message in the last 24 hours
- **THEN** recovery SHALL skip it, which is a documented limit. A channel whose only stored rows fall inside the 5 second clock margin is also not recovered.
