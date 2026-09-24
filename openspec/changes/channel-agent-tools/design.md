# Design

Status: Draft for review. Nothing is implemented. This design replaces the 2026-09-20 draft and follows Mahmoud's decisions of 2026-09-24. Code references point at `main` at commit `2f9cf635ca2ddda65dbd3702d98df88a4ea2a93f`.

## Context

See the [proposal](proposal.md) for the user outcome and the six capability specifications for required behavior. The implementation order and tests are in [plan.md](plan.md).

What exists on `main` today:

- **Replies are tied to an inbound thread.** The outbox worker finds a `ChannelThread` by session ID before it posts (`ChannelsOutboxWorker._fetch_thread_for_session` in `api/oss/src/tasks/asyncio/channels/outbox.py`). `ChannelsService.enqueue_output` and `ChannelsService.deliver` in `api/oss/src/core/channels/service.py` still raise `NotImplementedError`.
- **The outbox already records deliveries truthfully.** `channel_outbox_events` rows move through `created`, `sent`, and `failed`. A post whose outcome is unknown is marked `failed` with status code `delivery_uncertain` and is never retried (`_outcome_unknown` and `_deliver` in `outbox.py`). Every row requires a `thread_id`.
- **Adapters can post, edit, list, and fetch.** The Slack adapter (`api/oss/src/core/channels/adapters/slack/adapter.py`) posts with `chat.postMessage`, lists public and private channels with `conversations.list`, and reads one page of `conversations.history` or `conversations.replies` (at most `AGENTA_CHANNELS_BACKFILL_LIMIT`, default 50). It drops `message_changed` and `message_deleted` events. The Telegram adapter (`api/oss/src/core/channels/adapters/telegram/adapter.py`) returns no candidates from `discover_spaces` and raises from `fetch_history`, because the Bot API has neither.
- **Every Slack message in a channel the bot is in is already stored.** The manifest subscribes to `message.channels`, `message.groups`, `message.im`, and `message.mpim` (`adapters/slack/manifest.py`). Ingress records each one as a `channel_inbox_events` row, and the dispatcher attaches it to its space even when no turn starts (`ChannelsService.resolve`).
- **A space row is not an authorization.** `ChannelsService.resolve` creates a never-seen space on first contact and says so: "the row's existence stopped being what authorises an agent to answer there; the grant is."
- **Platform tools already hide self-targeting fields.** A `PlatformOp` (`sdks/python/agenta/sdk/agents/platform/op_catalog.py`) declares `context_bindings`, which the runner fills from the run context and removes from the model's schema (`assembleBody` in `services/runner/src/tools/direct.ts`). The run context carries the workflow artifact, variant, and revision (`RunContextWorkflow` in `sdks/python/agenta/sdk/agents/dtos.py`), and the runner adds `session.id` (`services/runner/src/engines/sandbox_agent/run-turn.ts`). There is no tool call ID in the run context yet, but the relay has one (`req.toolCallId` in `services/runner/src/tools/relay.ts`).
- **Tool permission is already solved.** `effective_permission` in `sdks/python/agenta/sdk/agents/tools/models.py` lets a `read_only` op run under `allow_reads` and makes every other op ask, unless the author set `allow` or `ask` explicitly.
- **A connected bot answers as one agent.** The settings UI binds a connection to an app with `ChannelAgent.data.references = {application: {id}}` (`web/packages/agenta-settings-ui/src/channels/actions.ts`). The references can also use the `workflow` family (`RESOLVABLE_AGENT_REFERENCE_KEYS` in `api/oss/src/core/channels/dtos.py`).
- **The manage panel has no Advanced section today.** `ChannelManagePanel.tsx` shows "Answers in", "Behavior" (two switches stored as kind-level grants), "Allowed users" (Telegram only), credentials, and Disconnect. The Advanced section is new.
- **Permissions.** `Permission.RUN_CHANNELS` exists (`api/oss/src/core/access/permissions/types.py`) and is used only by the channel-adapter entrypoint. The configuration routes use `VIEW_CHANNELS` and `EDIT_CHANNELS`.

## Goals / Non-Goals

**Goals:** Let a connected agent list where it can post, post there, read a channel's recent history, and search what its channels said. Default to what a Slack workspace admin expects from a bot they invited. Keep credentials, provider IDs, and tenant IDs away from the model. Report delivery outcomes truthfully. Keep a proactive direct message out of any shared session.

**Non-Goals:** Scheduling of any kind. Semantic or vector search. Telegram history backfill or chat enumeration. Slack group DMs as destinations. Slack Enterprise Grid org-wide installs. A per-person or per-channel posting allow-list (future work). Exactly-once delivery where the provider has no idempotency key. Reading or searching direct messages.

## Decisions

### 1. Four endpoint-mode platform operations

Add four catalog entries. Each is an endpoint-mode `PlatformOp` over a new authenticated route. None is a gateway tool or a handler.

| Operation | Route | Model input | Hint |
| --- | --- | --- | --- |
| `list_channel_destinations` | `POST /api/channels/tools/destinations/query` | Optional `type` (`channel` or `person`), `query` (name filter), `limit`, `cursor` | Read-only |
| `send_channel_message` | `POST /api/channels/tools/messages/send` | `destination_id`, `text`, optional `thread_id` | Write |
| `read_channel_messages` | `POST /api/channels/tools/messages/read` | `destination_id`, optional `thread_id`, `limit`, `cursor` | Read-only |
| `search_channel_messages` | `POST /api/channels/tools/messages/search` | `query`, optional `destination_ids`, `from_person_id`, `after`, `before`, `limit`, `cursor` | Read-only |

Every operation binds `$ctx.workflow.artifact.id`. The send also binds `$ctx.session.id` and a new `$ctx.tool.call_id`. The runner fails a call closed when a bound value is missing (`assembleBody`), so the ops bind only what every agent run has. A playground draft can lack a revision ID, so the revision is not bound. The project comes from the caller's credential, as for every other route. The routes require `RUN_CHANNELS` on the caller.

The tools are platform tools the agent author adds to the agent's tool list, like `create_schedule` today. Connecting a bot does not change the agent's configuration. With the runner's default `allow_reads` mode, list, read, and search run without a prompt and send asks. An author can set the send tool to `allow`, which an unattended automation needs.

Why not publish Slack and Telegram gateway actions: that would copy bot credentials into the tool gateway, skip the Channels settings, and expose provider-shaped IDs. Why not let the model pass a `channel_agent_id` or `connection_id`: holding an internal ID is not authorization.

### 2. The server resolves which bots the run speaks for

The tool service matches the bound artifact ID against every active `ChannelAgent` in the project. A `ChannelAgent` that references an `application` or `workflow` matches on that ID. One that references a variant or a revision matches on the artifact that variant or revision belongs to, which the service looks up. The connection must be active, verified, and not archived.

One run can match several connections, for example a Slack workspace and a Telegram bot. The list tool returns destinations from all of them. If two active `ChannelAgent` rows on the same connection match the same run, the settings would be ambiguous, so the tool refuses with a configuration error rather than guess.

A run that matches no connection gets an empty destination list and a clear refusal from send, read, and search. It is not an error for the agent to have the tools configured before a bot is connected.

### 3. Three settings on the bot replace per-destination grants

Store the settings on the connected bot, in a new `tools` block of `ChannelAgentData`:

| Field | Default | Meaning |
| --- | --- | --- |
| `can_post_outside_conversation` | `true` | The send tool may post anywhere. When `false`, send refuses every destination, and the list reports `can_post: false`. |
| `can_message_people` | `true` | The send tool may post to a person. It needs `can_post_outside_conversation` too. When either is `false`, the list omits people. |
| `readable_space_ids` | `null` | `null` means every channel the bot is in. A list narrows read and search to those channels. An empty list turns read and search off. |

The settings page edits these through the existing `PUT /channels/agents/{agent_id}` route (`edit_channel_agent`), which layers a partial `data` edit onto the stored row (`ChannelAgentDataEdit` and `_layer_agent_edit`). No new configuration route is needed.

**What this drops, and why.** The first draft added four actions (`reply`, `search`, `send`, `direct_message`) to `ChannelGrant`, evaluated per destination and per space kind, plus an editor step that authorized each direct-message recipient. Mahmoud decided that on Slack the agent may post to every channel the bot is in, message anyone, and read every channel, with no allow-list in v1. Per-destination grants would then hold the same "allow" on every row. That adds a table's worth of state, a migration of the grant evaluation in `resolve_policy`, and a UI to edit it, all to express a default. Three settings on the bot express the same policy, are easy to show on one screen, and leave room for the future allow-list as a fourth setting. The existing grants keep their current job, which is deciding where the agent answers.

The read list is the one setting that names channels, because Mahmoud asked that an admin can narrow it. It stores space IDs, so it survives a channel rename.

### 4. Destinations are space rows and person rows

A destination ID is an opaque string that encodes one of two row types. The model must treat it as opaque, and the server treats it only as a lookup key. Every call re-resolves it inside the caller's project and the matched connections and then checks the settings again.

- **A channel destination** is a `ChannelSpace` row of kind `group` or `topic`.
  - On Slack, the list first syncs the channels the bot is a member of. The adapter pages `users.conversations` with `types=public_channel,private_channel`, and the service creates missing space rows without joining anything (`get_or_create_space`). The sync runs on demand with a short time-to-live, stored on the connection. Group DMs (`mpim`) are left out.
  - On Telegram, channel destinations are the group and supergroup chats that already have a space row. That means chats that sent the bot an update or were bound to it.
- **A person destination** is a row in a new `channel_people` table: project, connection, a composed external user key (`compose_external_user_key` in `api/oss/src/core/channels/identity.py`), display name, handle, and flags. It also links the person's private space once one exists.
  - On Slack, the list syncs the workspace directory with `users.list` (the `users:read` scope is already requested), skipping bots, deleted users, and Slackbot. It also creates a row whenever a message arrives from a sender it has not seen. Large workspaces rely on the `query` filter and cursor paging.
  - On Telegram, a person row exists only for someone who has a private chat with the bot. That covers people who sent it a direct message and people bound through the hosted bot's `/start` link. A Telegram bot cannot start a chat, so nobody else can be listed.

Direct-message spaces (kind `private`) are never listed as channel destinations. They are reached through their person.

Why not signed provider locators: a signed Slack ID still leaks provider identity, and revocation would need a deny list. Why not open a DM for every workspace member up front: it creates provider state for people the agent may never contact.

### 5. The send posts inline and records the delivery

`send_channel_message` extends the existing outbox rather than adding a new delivery table:

- `channel_outbox_events.thread_id` becomes nullable, and the table gains `space_id` and `origin` (`turn` or `tool`). Turn replies keep writing `thread_id`, so their queries do not change.
- The row `key` for a tool send is `uuid5(session_id + tool_call_id)`. The existing unique constraint `uq_channel_outbox_key` on `(project_id, key)` makes a retried call return the same row instead of posting twice.
- The route re-checks authorization, creates or reuses the row, claims it with the same claim-and-fence logic the worker uses, posts through the adapter, and writes the receipt. It returns `sent`, `failed` with a sanitized reason, or `unknown`. `unknown` is the existing `delivery_uncertain` outcome: the post may have reached the chat, so Agenta never retries it. A row found still claimed by a request that died is also reported as `unknown`.
- To share the claim, post, and receipt code with turn replies, move it from `ChannelsOutboxWorker._deliver` into `ChannelsService.deliver`. The worker then calls the service. This fills in the `deliver` stub that exists today.

The response includes a `message_id` and, when the provider threads, a `thread_id`. The agent can pass that `thread_id` to a later send or read.

There is no background retry for tool sends. The agent gets a truthful state in the same call and decides what to do. Slack's `chat.postMessage` takes no idempotency key, so a lost receipt can never be made exactly-once. The design reports it as unknown instead of claiming more.

The sender identity comes from the connection, as for replies. Nothing in the tool schema can set a name, an avatar, or a token.

### 6. A proactive direct message gets its own private session

A send to a person resolves the person's private space:

- **Slack:** if the person has no private space yet, open one with `conversations.open` (`im:write` is already requested) and create the space row.
- **Telegram:** the private space already exists, because the person wrote first.

The send then uses an active `ChannelThread` for that agent and private space, or creates one with a fresh session ID, the same way `ChannelsService.resolve` does. The outbox row records that thread. When the recipient answers, normal routing finds the thread and continues the private session. On Slack, a reply inside the posted message's thread lands in this session. A new top-level direct message follows the existing direct-message routing, which may start another private session. It never goes back to the source session.

The source session is never moved, copied, or linked. Only the text the agent chose to send crosses over. So that the private session knows what was said, `compose_input` includes the thread's tool-origin outbox rows that the session has not seen yet as the agent's own earlier message.

### 7. One local message history serves read and search

Add a `channel_messages` table. It holds one row per provider message in a readable channel: project, connection, space, provider message key, thread key, parent message ID, sender (person ID when known, display name), text, provider timestamp, state (`live`, `edited`, `deleted`), origin (`pushed`, `pulled`, `sent`), and a generated `tsvector` column with a GIN index for search.

The table is written from three places:

1. **Ingress.** After `resolve` attaches an inbox event to its space, the service upserts the message if the space is readable. This runs even when no turn starts.
2. **Tool and reply sends.** A sent receipt writes the agent's own message, so reads show both sides of the conversation.
3. **The history worker.** It writes pulled pages during backfill.

Slack edits and deletions start being processed. A new adapter method parses `message_changed` and `message_deleted` into a message update that goes only to the history table. The existing `parse_event` still drops them, so an edit never starts a turn. That rule was added to stop a bot-echo loop and stays as it is.

Why a projection and not `channel_inbox_events`: inbox rows are the turn log. They exclude the bot's own posts, include button clicks, and are append-only. Reading a conversation needs both sides of it, in order, with edits applied.

### 8. Slack backfill is bounded and rate-aware

When a Slack channel becomes readable, the service queues a backfill job on a new `queues:channels-history` Taskiq queue. A channel becomes readable when the bot is added, the admin re-adds it to the list, or the first destination sync finds it.

- The job pages `conversations.history` backwards up to a bound: `AGENTA_CHANNELS_HISTORY_BACKFILL_DAYS` (default 90) or `AGENTA_CHANNELS_HISTORY_BACKFILL_MESSAGES` (default 1,000) per channel, whichever comes first. It then fetches `conversations.replies` for threads inside that window, up to `AGENTA_CHANNELS_HISTORY_BACKFILL_THREADS` (default 200) per channel.
- On HTTP 429 it waits for `Retry-After` and resumes from a stored cursor. A worker restart resumes from the same cursor.
- Progress and coverage live in a new `history` block on `ChannelSpaceData`: state (`pending`, `running`, `complete`, `partial`, `refused`), oldest and newest covered times, the cursor, and the last error. This is separate from the existing `is_backfilled` flag, which guards the one-time fill before a first turn.
- If the read tool asks for a thread whose replies were not fetched, the service fetches that one thread inline (one page, bounded), stores it, and serves it.

All bounds are read from `env.channels.history` in `api/oss/src/utils/env.py`, not from `os.getenv`.

Telegram has no backfill. Its coverage is always "observed only". It starts at the first message Agenta stored for that chat. In groups where the bot's privacy mode is on, that is only messages addressed to the bot.

### 9. Read and search re-check access at query time

Read and search accept only channel destinations that are readable at call time. That is `readable_space_ids` (or every channel when it is `null`), on an active connection, for a matched bot. Rows stored before an admin narrowed the list are filtered out immediately. A cleanup job then deletes history for spaces that left the list or whose connection was archived.

Direct messages are never readable or searchable through these tools. A shared-channel run must not pull a private conversation into its context.

Search uses PostgreSQL full-text search with the `simple` configuration, so no language or embedding model is assumed. Results are ordered by rank, then provider timestamp, then row ID. The cursor encodes that triple, so equal timestamps never skip or repeat. Every response carries coverage for each channel searched.

### 10. Settings UI

Add a collapsible **Advanced** section at the end of `ChannelManagePanel`, below "Behavior" and the Telegram allow-list:

- Two switches, "Can post outside the conversation" and "Can message people directly". The second is disabled while the first is off.
- "Channels it can search and read", with "All channels the bot is in" selected by default. Choosing "Only these channels" shows a checklist of the bot's member channels. On Slack these come from discovery with `membership == member`. On Telegram they are the known group chats.
- Telegram help text under each control says what Telegram allows: "People who have messaged the bot" and "Only messages the bot has seen since it joined".

The panel is shared by desktop and `/m`, so both get the controls. An existing test (`web/packages/agenta-settings-ui/tests/unit/channelManagePanel.test.tsx`, "shows no read-only settings: no Advanced defaults and no Status row") forbids the word "Advanced". It records an earlier decision to stop showing read-only defaults. The new section keeps that rule: it holds only the three editable controls, and the test changes to say so. New `ChannelsActions` methods read and write `ChannelAgentData.tools` through the existing edit-agent client call.

## Interface roles

- **Data:** message text, search query, name filter, and time bounds.
- **Routing:** destination ID, thread ID, message ID, and cursor. All are opaque.
- **Policy:** the three bot settings and the tool permission. They are never model input.
- **Protocol context:** caller credential, workflow references, session ID, and tool call ID. The runner and server bind them.
- **Metadata:** delivery state, coverage, and timestamps.
- **Credentials:** bot tokens stay in the connection's secret store. They never appear in a tool schema, a tool result, a delivery row, or a log line.

## What was dropped from the first draft

| Dropped | Why |
| --- | --- |
| `channel-message-scheduling`: `schedule_channel_message`, `list_scheduled_channel_messages`, `cancel_scheduled_channel_message`, due-delivery wake-up, exact-schedule rows | Scheduling belongs to the automation and scheduling product (decision 1). An automation that runs the agent calls `send_channel_message`. |
| Per-destination action grants (`reply`, `search`, `send`, `direct_message`) | Replaced by three bot settings. See decision 3. |
| Editor-authorized direct-message recipients | Slack agents may message anyone by default (decision 3). A per-person allow-list is future work. |
| `get_channel_delivery` | The send posts inline and returns a final state. |
| A separate `ChannelDeliveryIntent` table | The outbox already has keys, claims, receipts, and the `delivery_uncertain` rule. A nullable thread and two columns reuse all of it. |
| A separate audit table | Tool calls are already recorded as trace spans, and sends leave a durable outbox row. |
| Provider permalinks in results | Each Slack permalink costs an API call. Opaque message and thread IDs are enough to reply or read on. |

## Risks / Trade-offs

- **Slack's history limits for distributed apps.** Since 2025, Slack caps `conversations.history` and `conversations.replies` at about one request per minute and 15 messages per page for commercially distributed apps that are not in the Slack Marketplace. Internal (customer-built) apps keep the normal tier. If the hosted Agenta app falls in the capped group, a 1,000-message backfill takes over an hour per channel. The bounds are configurable, and coverage reports `partial` honestly. The hosted app's status needs checking before release.
- **Private channel content reaches wider audiences.** By default an agent can read a private channel it was invited to and post what it learned to a public channel. That is Mahmoud's chosen default. The admin control is the read list.
- **Directory sync on large workspaces.** `users.list` is a Tier 2 method. Sync is paged, cached with a time-to-live, and filtered by `query`. It never runs on every call.
- **Lost receipts.** A Slack or Telegram post can succeed after the request times out. The send reports `unknown` and never retries. The agent may tell the user it is unsure.
- **Stored private text.** History rows stay in the project database until cleanup. Query-time checks make them unreachable at once. Deletion follows within the cleanup interval.
- **Telegram privacy mode.** In groups where privacy mode is on, the bot sees only messages addressed to it, so reads and searches return little. The settings help text and every Telegram coverage block say so.
- **People cannot reply to a Slack DM.** If the app's messages tab is off, a person can read the proactive message but cannot answer. The custom-app manifest in `adapters/slack/manifest.py` sets no `app_home` block today. The plan adds it and checks the hosted app.
- **Ambiguous bot bindings.** Two bots on one connection bound to the same agent make the settings ambiguous. The tools refuse rather than pick one.

## Migration Plan

1. Add `ChannelAgentData.tools`, the `channel_people` table, and the outbox columns in one additive migration (`oss000000036`). Existing rows read `tools` as the defaults. Existing outbox rows get `origin = turn` and their `space_id` from their thread.
2. Add `channel_messages` and the history queue (`oss000000037`).
3. Ship the routes and catalog entries. Nothing changes for an agent until its author adds the tools.
4. Rollback removes the catalog entries and stops the history worker. Outbox rows and history rows stay readable. No external message is deleted.

## Verification Plan

Unit tests cover settings defaults, reference matching, destination encoding, every refusal path, the send's idempotency and unknown outcome, the private-session rule, cursor ordering, and coverage reporting. Integration tests against PostgreSQL cover the new tables, the outbox extension, full-text search, and query-time filtering. Adapter tests use the existing fake Slack server. Live QA uses a fresh Slack workspace and a fresh Telegram bot. [plan.md](plan.md) lists every test and command.

## Effort

| Component | Engineer-days |
| --- | ---: |
| Destinations, people directory, bot settings, list tool | 3-4 |
| Send tool, outbox extension, tool call ID, private DM session | 4-5 |
| Settings UI (Advanced section) | 1-2 |
| Message history, Slack edits, backfill worker, read tool | 4-6 |
| Search index and search tool | 2-3 |
| Live QA on Slack and Telegram, fixes | 2-3 |
| Total | 16-23 |

This excludes Slack Marketplace review time, the native Slack handle change, and the future per-person allow-list.

## Future work

- An allow-list of people the agent may message directly, as a fourth bot setting.
- A per-channel posting allow-list, if admins ask for one.
- Semantic search over the same history table.
