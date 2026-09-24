# Proposal

## Why

An agent connected to Slack or Telegram can only answer inside the conversation that woke it up. It cannot post to another channel, look back at what a channel said last week, or search what was discussed. People expect a connected coworker to do these things: "post the summary in #releases", "what did #support decide about refunds?".

Status: approved on 2026-09-24 and implemented on branch `feat/channel-agent-tools`. The implementation plan is in [plan.md](plan.md).

## What Changes

- Add four Agenta platform tools that a connected agent can use from any run: in a channel thread, in Agenta chat, or in an automation.
  - `list_channel_destinations` lists the channels where the agent may post or read, as opaque destination IDs.
  - `send_channel_message` posts to a channel outside the current conversation, optionally in a thread.
  - `read_channel_messages` reads a channel's recent messages (the last N, up to 200) or one thread's replies.
  - `search_channel_messages` searches the stored messages of every channel the agent may read.
- Give the Agenta tools kit what it needs to add these tools on its own. This change builds the condition the kit reads (`POST /api/channels/tools/availability`) and the kit's channel group (`CHANNEL_TOOL_OPS` in the SDK op catalog). The kit itself is a separate specification (`docs/agenta-tools-kit`), not yet approved or built. Until it ships, an author adds the tools to an agent's tools as `{"type": "platform", "op": "<name>"}`, and they work.
- Make the send tool default to `allow`, so the agent posts without an approval prompt. An author's per-tool `ask` or `deny`, or an agent-wide `ask` mode, still wins.
- Set permissive defaults on Slack. The agent may post to any channel the bot is in and read and search every channel the bot is in. There is no per-channel posting allow-list in v1.
- Read from what Agenta already stores, with no new table: inbox rows for people's messages and outbox rows for the bot's own posts. On Slack, fetch anything older live from Slack's history API. The hosted app's Slack limit of about one request per minute is accepted and stated in the result. Telegram reads return stored messages only.
- Search the stored inbox messages with a PostgreSQL full-text index. Each result states what it searched, for example "Searched messages since the bot joined this channel."
- Describe Telegram as it is. A bot can post only to chats that sent it an update, and it can read only messages it received.
- Add controls under a new **Advanced** section of each connected bot in the Channels settings: "Can post outside the conversation" (on by default) and "Channels it can search and read" (all channels by default; an admin can narrow the list).
- Keep the safety rules of the first draft: opaque destination IDs, the running agent's identity bound on the server, no credentials visible to the model, a durable delivery record with truthful `sent`, `unknown`, or `failed` states, project isolation, and authorization checked again at every call.

Direct messages to people are not part of v1. They are a follow-up.

## What this change removes from the first draft

- All scheduling. Posting at a set time and recurring posts belong to the automation and scheduling product. An automation that runs the agent can call `send_channel_message`.
- The per-destination action grants. The bot settings replace them. [design.md](design.md) explains the trade-off.
- `get_channel_delivery`. A send posts inline and returns its final state.
- A new message table, a history backfill worker, and coverage records. The one-time history copy is future work, described in [design.md](design.md#future-work).

## Capabilities

### New Capabilities

- `channel-agent-tool-access`: The condition the Agenta tools kit reads, the send default, the server-bound caller identity, and the checks every call repeats.
- `channel-agent-tool-settings`: The per-bot controls, their defaults, and where the settings page shows them.
- `channel-destination-discovery`: What `list_channel_destinations` returns on Slack and on Telegram.
- `channel-message-delivery`: `send_channel_message` and the delivery record.
- `channel-conversation-reading`: `read_channel_messages` over stored messages, with live Slack history for older ones.
- `channel-message-search`: `search_channel_messages` over stored messages.

### Modified Capabilities

None. The current baseline specifications describe installation, routing, reply identity, and deployment. They do not define agent-facing channel tools.

## Impact

- **SDK**: four new operations in the platform tool catalog (`sdks/python/agenta/sdk/agents/platform/op_catalog.py`), grouped as `CHANNEL_TOOL_OPS`, and an optional `PlatformOp.default_permission` that carries the send tool's `allow` default.
- **Runner**: one new hidden run-context value, `$ctx.tool.call_id`, used to make a send idempotent (`services/runner/src/tools/relay.ts`).
- **API**: new authenticated tool routes under `/api/channels/tools/`, a tool service under `api/oss/src/core/channels/tools/`, three migrations (`oss000000036` to `oss000000038`: a nullable-thread outbox with a `space_id` column, a `sent_at` column on the inbox table, and a full-text expression index), and two Slack adapter methods, for member channels and for older history pages.
- **Settings UI**: a new Advanced section (`web/packages/agenta-settings-ui/src/channels/ChannelAdvancedSection.tsx`) in the manage panel shared by the desktop app and `/m`.
- **Slack app**: no new scopes.

No credential, raw Slack ID, raw Telegram ID, project ID, connection ID, or channel-agent ID ever appears in a tool's input or output.
