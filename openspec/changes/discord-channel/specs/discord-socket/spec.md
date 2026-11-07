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
The loop SHALL hold one Redis lock, namespace `channels` and key `discord:sockets`, through `acquire_lock`, `renew_lock` and `release_lock` in `oss/src/utils/locking.py`, before it opens any socket. Only the holder SHALL open sockets.

#### Scenario: Two replicas
- **WHEN** two `worker-queues` replicas start
- **THEN** exactly one SHALL hold the lock and open sockets, and the other SHALL keep trying to take the lock

#### Scenario: Lock lost
- **WHEN** the holder fails to renew the lock
- **THEN** it SHALL close all its Discord sockets before another replica can open them

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
For each Discord Gateway dispatch, the loop SHALL encode the event dict as JSON bytes, call `adapter.parse_event` with them, and pass each parsed event to `ChannelsService.record_and_enqueue_inbox_event`. The loop SHALL NOT run an agent turn and SHALL NOT dedupe events itself.

#### Scenario: Message arrives
- **WHEN** the socket receives `MESSAGE_CREATE`
- **THEN** the loop SHALL store one inbox row and enqueue one `channels.inbox.dispatch`

#### Scenario: Noise
- **WHEN** `parse_event` returns `None`
- **THEN** the loop SHALL store nothing

### Requirement: Retry of a failed enqueue
When `record_and_enqueue_inbox_event` raises `ChannelInboxEnqueueFailed`, the loop SHALL retry the same parsed event, with the same `external_id`, with backoff, and SHALL keep reading the socket while it retries.

#### Scenario: Queue outage
- **WHEN** Redis is down for 20 seconds while a message arrives
- **THEN** the loop SHALL retry that event until the enqueue succeeds, and the message SHALL start one turn

#### Scenario: Process crash during the outage
- **WHEN** the process stops while it still retries an event
- **THEN** the stored row MAY have no turn, which is a documented limit shared with the webhook path

### Requirement: Socket errors
The loop SHALL let `discord.py` handle heartbeat, resume and reconnect. When Discord closes a socket with code `4014`, the loop SHALL log an error that names the connection and SHALL retry with backoff.

#### Scenario: Intent turned off after setup
- **WHEN** the Message Content intent is turned off and Discord closes the socket with `4014`
- **THEN** the loop SHALL log the error and SHALL NOT reconnect in a tight loop

#### Scenario: Other connections unaffected
- **WHEN** one connection's socket fails
- **THEN** the other connections' sockets SHALL stay open

### Requirement: Recovery after a failed resume
When a socket closes, the loop SHALL take a snapshot of the highest message id per `source_channel_id` among the connection's `PUSHED` message rows of the last 24 hours. If the next socket starts with a fresh IDENTIFY, the loop SHALL read Discord history after each snapshot id and pass each message through `parse_event` and `record_and_enqueue_inbox_event`.

#### Scenario: Messages missed during the gap
- **WHEN** a socket loses its session, two messages are posted in channel C, and the new socket identifies fresh
- **THEN** the loop SHALL read `GET /channels/C/messages?after=<snapshot id>` and SHALL store and enqueue both messages with origin `PUSHED`

#### Scenario: Opening mention is the only recent row in its channel
- **WHEN** the only recent inbox row from channel C is a mention M whose locator has `channel_id` C, `thread_id` M and `source_channel_id` C, and a second mention is posted in C during the gap
- **THEN** the loop SHALL group the snapshot by `source_channel_id` C, SHALL read the history of C, and SHALL store and enqueue the second mention

#### Scenario: Successful resume
- **WHEN** the socket resumes successfully
- **THEN** the loop SHALL NOT read history, because Discord replays the missed events

#### Scenario: Snapshot taken before live events
- **WHEN** a live message is stored on the new socket before recovery reads channel C
- **THEN** recovery SHALL still use the snapshot taken at socket close, so the earlier missed message is not hidden

#### Scenario: Message delivered twice
- **WHEN** recovery reads a message the socket already delivered
- **THEN** the unique constraint SHALL drop it and no second turn SHALL start

#### Scenario: Quiet channel
- **WHEN** a channel has no stored message in the last 24 hours
- **THEN** recovery SHALL skip it, which is a documented limit
