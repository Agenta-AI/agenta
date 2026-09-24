# Proposal

## Why

An agent connected to Slack or Telegram can only answer inside the conversation that woke it up. It cannot post to another channel, message a person, look back at what a channel said last week, or search what was discussed. People expect a connected coworker to do all four: "post the summary in #releases", "tell Dana the build is green", "what did #support decide about refunds?".

Status: Draft for Mahmoud's review. Nothing here is implemented. This version replaces the 2026-09-20 draft and follows Mahmoud's decisions of 2026-09-24. The implementation plan is in [plan.md](plan.md).

## What Changes

- Add four Agenta platform tools that a connected agent can use from any run: in a channel thread, in Agenta chat, or in an automation.
  - `list_channel_destinations` lists the channels and people the agent may message, as opaque destination IDs.
  - `send_channel_message` posts to a channel or to a person, outside the current conversation, optionally in a thread.
  - `read_channel_messages` reads a channel's recent messages (the last N, up to 200) or one thread's replies.
  - `search_channel_messages` searches the messages of every channel the agent may read.
- Set permissive defaults on Slack. The agent may post to any channel the bot is in, message any person in the workspace, and read and search every channel the bot is in. There is no per-channel or per-person allow-list in v1.
- Describe Telegram as it really is. A bot can message only chats that have sent it an update and people who wrote to it first. Reading and searching cover only messages Agenta observed after the bot joined.
- Add three controls under a new **Advanced** section of each connected bot in the Channels settings: "Can post outside the conversation" (on by default), "Can message people directly" (on by default), and "Channels it can search and read" (all channels by default; an admin can narrow the list).
- Keep a local copy of channel messages so the read and search tools can serve them. On Slack, backfill a bounded amount of history for every readable channel and respect Slack's rate limits. On Telegram, keep only what the bot observed.
- Keep the safety rules of the first draft: opaque destination IDs, the running agent's identity bound on the server, no credentials visible to the model, a durable delivery record with truthful `sent`, `unknown`, or `failed` states, a private session for every proactive direct message, project isolation, and authorization checked again at every call.
- Add the four tools automatically to every run of an agent that is bound to an active bot, whether the run is a channel turn, a playground turn, or an automation. The saved agent configuration does not change. A tool the author listed explicitly keeps the author's settings.
- Make the send tool default to `allow`, so the agent posts without an approval prompt. An author who sets it to `ask` or `deny`, or sets the whole agent to `ask`, still gets that behavior.

## What this change removes from the first draft

- All scheduling. Posting at a set time, exact one-time messages, and recurring posts belong to the separate automation and scheduling product. The `channel-message-scheduling` capability and every schedule, cancel, and list-scheduled tool, table, and task are gone. An automation that runs the agent can call `send_channel_message` like any other run.
- The per-destination action grants (`reply`, `search`, `send`, `direct_message`). The three settings above replace them. [design.md](design.md) explains the trade-off.
- The editor-only step that authorized each Slack direct-message recipient. Mahmoud's decision is that an agent may message anyone in the workspace.
- `get_channel_delivery`. A send posts inline and returns its final state, so there is nothing left to poll.

## Capabilities

### New Capabilities

- `channel-agent-tool-access`: Which runs may use the channel tools, how the server binds the caller's identity, and the checks every call repeats.
- `channel-agent-tool-settings`: The three per-bot controls, their defaults, and where the settings page shows them.
- `channel-destination-discovery`: What `list_channel_destinations` returns on Slack and on Telegram.
- `channel-message-delivery`: `send_channel_message`, the delivery record, and the private session for proactive direct messages.
- `channel-conversation-reading`: `read_channel_messages`, the local message history, Slack backfill, and Telegram's observed-only history.
- `channel-message-search`: `search_channel_messages` over the local message history.

### Modified Capabilities

None. The current baseline specifications describe installation, routing, reply identity, and deployment. They do not define agent-facing channel tools.

## Impact

- **SDK**: four new operations in the platform tool catalog (`sdks/python/agenta/sdk/agents/platform/op_catalog.py`), an optional per-operation default permission, and a hook in the agent handler (`sdks/python/agenta/sdk/agents/handler.py`) that adds the channel tools to a connected agent's run.
- **Runner**: one new hidden run-context value, the tool call ID, used to make a send idempotent (`services/runner/src/tools/relay.ts`).
- **API**: new authenticated tool routes under `/channels/tools/`, a tool service under `api/oss/src/core/channels/tools/`, new tables for people and messages, a nullable-thread extension of the outbox table, a history backfill worker, and Slack adapter methods for membership, people, direct conversations, paged history, and message edits.
- **Settings UI**: a new Advanced section in `web/packages/agenta-settings-ui/src/channels/ChannelManagePanel.tsx`, shared by the desktop app and `/m`.
- **Slack app**: no new scopes. The current bot scopes already include `users:read`, `im:write`, and the history scopes. The app manifest may need its messages tab enabled so people can answer a proactive direct message.

No credential, raw Slack ID, raw Telegram ID, project ID, connection ID, or channel-agent ID ever appears in a tool's input or output. This change adds no semantic search, no Telegram history backfill, no Slack group-DM destinations, no per-person allow-list, and no scheduling.
