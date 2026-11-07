# Proposal

## Why

Many teams and communities talk on Discord, not Slack or Telegram. Today an Agenta agent can answer in Slack, Telegram and WhatsApp, but a team cannot put the same agent in its Discord server or let people message it directly on Discord.

Discord also works differently from every channel Agenta supports today. Each current channel delivers messages to Agenta as HTTP webhooks, and the ingress route stores them and enqueues a turn (`api/oss/src/apis/fastapi/channels/ingress.py:660-746`). Discord delivers normal chat messages only over the Discord Gateway, which is a WebSocket the bot must keep open. So Discord needs one new piece of long-running code in addition to a new adapter.

Status: Proposal, not built. The design passed four rounds of design review (simplify and naming lenses both rated Low on round 4). The five decisions with defaults, and two questions found while writing this spec, are listed in [design.md](design.md) under Open Questions.

## What Changes

- Add Discord as a Channels platform, next to Slack, Telegram and WhatsApp. A connection is one Discord bot that the user creates in the Discord Developer Portal and pastes into one project.
- Setup on the agent page in /m. The user creates an application and a bot, turns on the Message Content intent, and pastes the bot token. Agenta checks the token and the intent, then shows an invite link with the exact permissions the bot needs.
- In a direct message the agent answers every message. In a server channel the agent answers a mention of the bot, and the reply goes into a new thread under that message.
- Answers are split at Discord's 2,000 character limit, with code blocks kept whole. The agent shows Discord's typing indicator and a reaction on the user's message while it works. There are no streaming edits in v1.
- Tool approvals use Discord buttons that carry the existing choice token.
- `worker-queues` runs one socket loop next to its `channels-inbox` consumer. One Redis lock makes sure only one process holds the Discord sockets. The loop reloads the list of Discord connections on a short interval, so setup changes take effect without a restart.
- The store-and-enqueue step that the HTTP ingress runs today moves into `ChannelsService`, so the HTTP routes and the socket loop share one path. HTTP behavior does not change.
- After a socket reconnects without a successful resume, the loop reads recent channel history from Discord and passes each missed message through the same path. The existing unique constraint drops messages that already arrived.

## Capabilities

### New Capabilities

- `discord-connection`: Pasting a bot token, the token check, the Message Content intent check, the invite link, the three connection states on the agent page, and disconnect.
- `discord-conversation`: When the agent answers, threads, message splitting, the typing indicator and reaction, approval buttons, and which Discord ids identify events and conversations.
- `discord-socket`: The socket loop in `worker-queues`, the lock, the connection reload, the retry of a failed enqueue, and recovery of missed messages after a failed resume.

### Modified Capabilities

- `channel-inbox-ingest`: Storing an inbound event and enqueueing its dispatch moves from the HTTP ingress class into core as `ChannelsService.record_and_enqueue_inbox_event`. A failed enqueue raises the channels-domain exception `ChannelInboxEnqueueFailed`, and the HTTP ingress maps it to the same 503 it returns today. The HTTP behavior of every existing channel is unchanged. No baseline spec exists for this step in `openspec/specs/`, so the delta is written as ADDED requirements.

## Impact

Backend: a new `discord` adapter under `api/oss/src/core/channels/adapters/discord/` (`adapter.py`, `capabilities.py`, `mapping.py`) and its registry entry, the new `ChannelsService` methods `record_and_enqueue_inbox_event` and `query_active_connections`, the new exception `ChannelInboxEnqueueFailed`, the socket loop in `worker-queues`, and the `discord.py` dependency (MIT license). Frontend: Discord as a fourth platform in `@agenta/settings-ui` and a Discord setup flow on the /m agent page. Docs: a "Connect Discord" guide and the Discord section of the channels research document.

No change to Helm, docker-compose or Railway, because the loop runs inside the existing `worker-queues` process. No new environment variable. No change to Slack, Telegram or WhatsApp behavior. No hosted Agenta bot, no registered slash commands, no streaming edits, no voice, no sharding, and no HTTP interactions endpoint in this change.
