# Proposal

## Why

An agent connected to Slack or Telegram can only answer inside the conversation that woke it up. It cannot post to another channel, look back at what a channel said last week, or search what was discussed. People expect a connected coworker to do these things: "post the summary in #releases", "what did #support decide about refunds?".

Status: Draft for Mahmoud's review. Nothing here is implemented. This version replaces the 2026-09-20 draft and follows Mahmoud's decisions of 2026-09-24. The implementation plan is in [plan.md](plan.md).

## What Changes

- Add four Agenta platform tools that a connected agent can use from any run: in a channel thread, in Agenta chat, or in an automation.
  - `list_channel_destinations` lists where the agent may post, as opaque destination IDs.
  - `send_channel_message` posts outside the current conversation, optionally in a thread.
  - `read_channel_messages` reads a channel's recent messages (the last N, up to 200) or one thread's replies.
  - `search_channel_messages` searches the stored messages of every channel the agent may read.
- Make the four tools part of the Agenta tools kit, active when the agent is connected to a bot. The kit specification (`docs/agenta-tools-kit`) owns how tools are added to a run and turned off.
- Make the send tool default to `allow`, so the agent posts without an approval prompt. An author's per-tool `ask` or `deny`, or an agent-wide `ask` mode, still wins.
- Set permissive defaults on Slack. The agent may post to any channel the bot is in and read and search every channel the bot is in. There is no per-channel allow-list in v1.
- Read from what Agenta already stores, with no new table: inbox rows for people's messages and outbox rows for the bot's own posts. On Slack, fetch anything older live from Slack's history API. The hosted app's Slack limit of about one request per minute is accepted and stated in the result. Telegram reads return stored messages only.
- Search the stored inbox messages with a PostgreSQL full-text index. The result states that it "searched messages since the bot joined this channel".
- Describe Telegram as it is. A bot can post only to chats that sent it an update, and it can read only messages it received.
- Add controls under a new **Advanced** section of each connected bot in the Channels settings: "Can post outside the conversation" (on by default) and "Channels it can search and read" (all channels by default; an admin can narrow the list).
- Keep the safety rules of the first draft: opaque destination IDs, the running agent's identity bound on the server, no credentials visible to the model, a durable delivery record with truthful `sent`, `unknown`, or `failed` states, project isolation, and authorization checked again at every call.

**Pending decision: direct messages to people.** The spec still describes person destinations, a `channel_people` table, the "Can message people directly" setting, and a private session for every proactive direct message. The coordinator recommended leaving them out of v1, and Mahmoud has not decided yet. Each of those parts is marked "pending decision", and the rest of the change reads the same either way.

## What this change removes from the first draft

- All scheduling. Posting at a set time and recurring posts belong to the automation and scheduling product. An automation that runs the agent can call `send_channel_message`.
- The per-destination action grants. The bot settings replace them. [design.md](design.md) explains the trade-off.
- `get_channel_delivery`. A send posts inline and returns its final state.
- A new message table, a history backfill worker, and coverage records. The one-time history copy is future work, described in [design.md](design.md#future-work).

## Capabilities

### New Capabilities

- `channel-agent-tool-access`: The tools' place in the Agenta tools kit, the send default, the server-bound caller identity, and the checks every call repeats.
- `channel-agent-tool-settings`: The per-bot controls, their defaults, and where the settings page shows them.
- `channel-destination-discovery`: What `list_channel_destinations` returns on Slack and on Telegram.
- `channel-message-delivery`: `send_channel_message`, the delivery record, and, pending a decision, direct messages with a private session.
- `channel-conversation-reading`: `read_channel_messages` over stored messages, with live Slack history for older ones.
- `channel-message-search`: `search_channel_messages` over stored messages.

### Modified Capabilities

None. The current baseline specifications describe installation, routing, reply identity, and deployment. They do not define agent-facing channel tools.

## Impact

- **SDK**: four new operations in the platform tool catalog (`sdks/python/agenta/sdk/agents/platform/op_catalog.py`) and the send default, expressed the way the Agenta tools kit expresses per-tool defaults.
- **Runner**: one new hidden run-context value, the tool call ID, used to make a send idempotent (`services/runner/src/tools/relay.ts`).
- **API**: new authenticated tool routes under `/channels/tools/`, a tool service under `api/oss/src/core/channels/tools/`, a nullable-thread extension of the outbox table, a `sent_at` column and two expression indexes on the inbox table, and Slack adapter methods for member channels and older history pages. If direct messages stay: a `channel_people` table and direct-conversation opening.
- **Settings UI**: a new Advanced section in `web/packages/agenta-settings-ui/src/channels/ChannelManagePanel.tsx`, shared by the desktop app and `/m`.
- **Slack app**: no new scopes.

No credential, raw Slack ID, raw Telegram ID, project ID, connection ID, or channel-agent ID ever appears in a tool's input or output.
