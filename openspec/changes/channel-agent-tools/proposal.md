# Proposal

## Why

Connected agents can answer only inside a channel thread that already produced an inbound event. They cannot independently list permitted destinations, search channel knowledge, send to another destination, or schedule an exact message through the Channels stack.

Status: Draft for Mahmoud's review. This change is specified, not implemented. The channels stack has not shipped to production.

## What Changes

- Expose optional Agenta platform tools that let a connected agent list its permitted Slack and Telegram destinations, search indexed messages, send a message, and manage an exact scheduled message.
- Bind the running workflow identity and project authorization on the server. Do not let the model choose another channel agent, connection, project, credential, or raw platform locator.
- Separate tool execution permission from destination-level Channels grants for reply, search, proactive send, and direct-message initiation.
- Add a durable delivery intent that can target an authorized destination without an inbound event, existing `ChannelThread`, or source-session transfer.
- Add permission-aware message indexing with explicit coverage. Slack can backfill selected conversations. Telegram search covers only messages observed after connection.
- Use the existing scheduler for recurring agent runs that generate fresh content. Store exact one-time messages as cancellable Channels delivery intents so the model does not regenerate approved text at delivery time.
- Treat a proactive direct message as a separate private channel session. Do not move or expose the source session.

## Capabilities

### New Capabilities

- `channel-agent-tool-access`: Optional tool exposure, bound caller identity, layered authorization, project isolation, and auditing.
- `channel-destination-discovery`: Safe discovery of destinations the running agent can use.
- `channel-message-delivery`: Durable proactive channel and direct-message delivery outside an originating thread.
- `channel-message-search`: Permission-aware search over indexed Slack and observed Telegram messages with coverage reporting.
- `channel-message-scheduling`: Exact one-time delivery intents plus integration with recurring generated agent runs.

### Modified Capabilities

None. These tools add capabilities that the current baseline does not define.

## Impact

Backend work affects platform operation definitions, run-context bindings, authenticated Channels routes, grants and effective policy, destination resolution, inbox indexing, delivery storage, outbox execution, and Slack and Telegram scopes and adapters. The agent editor and Channels settings need controls for tool exposure, destination grants, direct-message access, and scheduled deliveries. The existing trigger service remains the scheduler for recurring generated runs.

No adapter credential becomes agent-visible. No tool can use an arbitrary raw Slack channel ID, Slack user ID, Telegram chat ID, connection ID, or project ID. This change does not add Slack semantic search, Telegram history backfill, cross-project installations, Telegram chat discovery, or a general-purpose message scheduler outside Channels.
