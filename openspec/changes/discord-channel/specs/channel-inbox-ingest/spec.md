# Channel inbox ingest

## Purpose

Define the one step that stores a parsed inbound event and enqueues its dispatch, shared by the HTTP ingress routes and the Discord socket loop. Today this step is the private method `ChannelsIngressRouter._record_and_enqueue` (`api/oss/src/apis/fastapi/channels/ingress.py:880-919`). No baseline spec exists for it, so this delta is written as ADDED requirements. The HTTP behavior of every existing channel does not change.

## ADDED Requirements

### Requirement: Shared store-and-enqueue step in core
`ChannelsService.record_and_enqueue_inbox_event(project_id, connection_id, channel, inbound)` SHALL store the event with `record_inbox_event` and SHALL then enqueue `channels.inbox.dispatch` with `project_id`, `connection_id`, `channel` and `external_id`. Every HTTP ingress route and the Discord socket loop SHALL call it.

#### Scenario: New event
- **WHEN** a parsed event arrives that is not stored yet
- **THEN** the method SHALL store one row and enqueue one dispatch

#### Scenario: Event already stored
- **WHEN** the row already exists and `record_inbox_event` returns `None`
- **THEN** the method SHALL still enqueue the dispatch, as `_record_and_enqueue` does today, so a retried delivery recovers from an earlier enqueue failure

#### Scenario: No dispatch task wired
- **WHEN** `inbox_dispatch_task` is not set
- **THEN** the method SHALL store the row and enqueue nothing, as the ingress does today

### Requirement: Enqueue failure is a domain exception
When the enqueue fails or exceeds its 5 second timeout, the method SHALL raise `ChannelInboxEnqueueFailed`. Core SHALL NOT raise `HTTPException`. The HTTP ingress SHALL map `ChannelInboxEnqueueFailed` to the same 503 response it returns today, in `handle_channel_adapter_exceptions`.

#### Scenario: Webhook during a queue outage
- **WHEN** a Telegram, Slack or WhatsApp webhook arrives and the enqueue fails
- **THEN** the route SHALL answer 503 with the detail "Failed to enqueue channel inbox event", as it does today, and the row SHALL stay stored

#### Scenario: Socket during a queue outage
- **WHEN** the Discord socket loop calls the method and the enqueue fails
- **THEN** the loop SHALL receive `ChannelInboxEnqueueFailed` and no HTTP type

### Requirement: HTTP ingress behavior unchanged
The HTTP ingress routes SHALL keep their status codes, their responses, their dispatch arguments and their order of steps after the move.

#### Scenario: Existing ingress tests
- **WHEN** the existing ingress unit tests under `api/oss/tests/pytest/unit/channels/` run after the move
- **THEN** they SHALL pass with only the import or wiring changes the move needs

#### Scenario: Hosted Telegram
- **WHEN** a hosted Telegram update is parsed
- **THEN** it SHALL be stored and enqueued through the same method with channel `telegram_hosted`

### Requirement: Dispatch task wiring
The API process and `worker-queues` SHALL set `ChannelsService.inbox_dispatch_task` to the `channels.inbox.dispatch` task registered by `ChannelsInboxWorker`, after both objects exist, as `triggers_service.schedule_dispatch_task` is set, because the inbox worker's dispatcher needs the service first.

#### Scenario: API process
- **WHEN** `api/entrypoints/routers.py` builds the channels objects
- **THEN** `channels_service.inbox_dispatch_task` SHALL be `_channels_inbox_worker.dispatch_inbox_event`, the same task the ingress router receives today

#### Scenario: worker-queues
- **WHEN** `worker-queues` builds the `channels-inbox` broker
- **THEN** the service the socket loop uses SHALL hold the task of the `ChannelsInboxWorker` that process builds

### Requirement: Cross-project read of active connections
`ChannelsService.query_active_connections(channel)` SHALL return a list of `(project_id, connection)` pairs, project_id first as `fetch_active_schedules_with_project` does, for every connection of that channel across projects that is active, verified and not archived. It SHALL NOT hydrate credentials.

#### Scenario: Archived and inactive rows
- **WHEN** a project has one active Discord connection and one archived one
- **THEN** the method SHALL return one pair, that project's id and the active connection

#### Scenario: Credentials
- **WHEN** the socket loop needs a bot token
- **THEN** it SHALL call `fetch_connection` with the pair's project id and connection id, which hydrates the credential
