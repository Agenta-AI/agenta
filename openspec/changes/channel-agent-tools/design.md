# Design

Status: approved on 2026-09-24 and implemented on branch `feat/channel-agent-tools`, which targets `release/v0.121.2`. Code references in [Context](#context) describe `main` at commit `2f9cf635ca2ddda65dbd3702d98df88a4ea2a93f`, before this change.

## Context

See the [proposal](proposal.md) for the user outcome and the six capability specifications for required behavior. The implementation tasks and tests are in [plan.md](plan.md).

Two related specifications are written separately. Neither was approved or built when this change was implemented, so the assumptions made about them are stated where they apply:

- **Agenta tools kit** (branch `docs/agenta-tools-kit`). It will own how always-on Agenta tools are added to a run and how they are turned off.
- **Channel message retention** (branch `docs/channel-message-retention`). It owns how long stored channel messages are kept.

What existed on `main` before this change:

- **Replies are tied to an inbound thread.** The outbox worker finds a `ChannelThread` by session ID before it posts (`ChannelsOutboxWorker._fetch_thread_for_session` in `api/oss/src/tasks/asyncio/channels/outbox.py`). `ChannelsService.enqueue_output` and `ChannelsService.deliver` in `api/oss/src/core/channels/service.py` raise `NotImplementedError`.
- **The outbox already records deliveries truthfully.** `channel_outbox_events` rows move through `created`, `sent`, and `failed`. A post whose outcome is unknown is marked `failed` with status code `delivery_uncertain` and is never retried. Every row requires a `thread_id`. A sent row keeps the provider receipt (Slack `channel` and `ts`) and the final content, including later edits.
- **Every message the bot receives is already stored.** The Slack manifest subscribes to `message.channels`, `message.groups`, `message.im`, and `message.mpim` (`adapters/slack/manifest.py`). Ingress records each message as a `channel_inbox_events` row, and the dispatcher attaches it to its space even when no turn starts (`ChannelsService.resolve`). The text sits in the `data` column, which has type `json`, at `data.processed.content[0].text`. The sender is at `data.processed.sender`. The Slack thread is at `data.external_locator.thread_ts`. The provider's own timestamp is not stored as its own field.
- **Stored rows do not follow edits or deletions.** The Slack adapter drops `message_changed` and `message_deleted` before routing, to stop a bot-echo loop (`parse_event` in `adapters/slack/adapter.py`). The Telegram adapter ignores edited messages.
- **A small history fetch already exists.** Before a thread's first turn, `run_backfill` in `api/oss/src/core/channels/fill.py` fetches one page of history (at most `AGENTA_CHANNELS_BACKFILL_LIMIT`, default 50) into `PULLED` inbox rows, once per space (`ChannelSpaceFlags.is_backfilled`). It passes the space's stored locator, which is the locator of the message that created the space and can include that message's `thread_ts`. So it can fetch one thread's replies instead of the channel history. That bug is left for the follow-up in [Future work](#future-work).
- **Adapters can post, list, and fetch.** The Slack adapter posts with `chat.postMessage`, lists channels with `conversations.list`, and reads one page of `conversations.history` or `conversations.replies`. The Telegram adapter returns no candidates from `discover_spaces` and raises from `fetch_history`, because the Bot API has neither.
- **A space row is not an authorization.** `ChannelsService.resolve` creates a never-seen space on first contact and says so: "the row's existence stopped being what authorises an agent to answer there; the grant is."
- **Platform tools hide self-targeting fields.** A `PlatformOp` (`sdks/python/agenta/sdk/agents/platform/op_catalog.py`) declares `context_bindings`, which the runner fills from the run context and removes from the model's schema (`assembleBody` in `services/runner/src/tools/direct.ts`). The run context carries the workflow artifact, variant, and revision (`RunContextWorkflow` in `sdks/python/agenta/sdk/agents/dtos.py`). The runner adds `session.id` (`services/runner/src/engines/sandbox_agent/run-turn.ts`). There was no tool call ID in the run context, but the relay has one (`req.toolCallId` in `services/runner/src/tools/relay.ts`).
- **Every run has a session ID.** The triggers dispatcher mints one per delivery (`session_id = uuid4().hex` in `api/oss/src/tasks/asyncio/triggers/dispatcher.py`). The runner falls back to a generated ID when a request names none (`resolveRunSessionId` in `services/runner/src/protocol.ts`), and `run-turn.ts` binds `session.id` from it. So a tool that binds `$ctx.session.id` works in automation runs too.
- **Permissions.** `effective_permission` in `sdks/python/agenta/sdk/agents/tools/models.py` lets a `read_only` op run under `allow_reads` and makes every other op ask, unless the author set a permission. The runner mirrors it in `defaultPermission` (`services/runner/src/permission-plan.ts`). `Permission.RUN_CHANNELS` exists (`api/oss/src/core/access/permissions/types.py`).
- **A connected bot answers as one agent.** The settings UI binds a connection to an app with `ChannelAgent.data.references = {application: {id}}` (`web/packages/agenta-settings-ui/src/channels/actions.ts`).
- **The manage panel had no Advanced section.** `ChannelManagePanel.tsx` showed "Answers in", "Behavior", "Allowed users" (Telegram only), credentials, and Disconnect. An existing test forbade the word "Advanced" (see decision 8).
- **Pull request #7128** (`fix(channels): answer in threads and groups only when addressed`) adds `ChannelInboxEventFlags.is_consumed`, set on an answer that an approval consumed. It is merged into `release/v0.121.2`, and read and search use the flag (decision 6).

## Goals / Non-Goals

**Goals:** Let a connected agent list the channels where it can post, post there, read a channel's recent history, and search what its channels said. Default to what a Slack workspace admin expects from a bot they invited. Keep credentials, provider IDs, and tenant IDs away from the model. Report delivery outcomes truthfully.

**Non-Goals:** Scheduling of any kind. Direct messages to people. A new message table or a history copy job in v1. Semantic search, Slack's own search APIs, or searching the bot's own posts. Telegram history beyond what the bot received. Slack group DMs as destinations. Slack Enterprise Grid org-wide installs. A per-channel posting allow-list. Exactly-once delivery where the provider has no idempotency key. Reading or searching direct messages.

## Decisions

### 1. Four platform operations, added to every run of a connected agent

Add four endpoint-mode `PlatformOp` entries, each over a new authenticated route. None is a gateway tool or a handler.

| Operation | Route | Model input | Hint |
| --- | --- | --- | --- |
| `list_channel_destinations` | `POST /api/channels/tools/destinations/query` | Optional `type` (only `channel`), `query` (name filter), `limit` (at most 100), `cursor` | Read-only |
| `send_channel_message` | `POST /api/channels/tools/messages/send` | `destination_id`, `text` (at most 40,000 characters), optional `thread_id` | Write |
| `read_channel_messages` | `POST /api/channels/tools/messages/read` | `destination_id`, optional `thread_id`, `limit`, `cursor` | Read-only |
| `search_channel_messages` | `POST /api/channels/tools/messages/search` | `query`, optional `destination_ids`, `after`, `before`, `limit`, `cursor` | Read-only |

Every operation binds `$ctx.workflow.artifact.id`. The send also binds `$ctx.session.id` and a new `$ctx.tool.call_id`, which the runner fills from the relayed tool call on a direct call. The runner fails a call closed when a bound value is missing (`assembleBody`), so the ops bind only what every agent run has. A playground draft can lack a revision ID, so the revision is not bound. The project comes from the caller's credential. Every route requires `run_channels` on the caller.

**How the tools reach a run.** The agent runtime adds the channel tools to every run of a connected agent. It does not change the saved configuration, and it works in every run type: playground, API, channel turns, and automations.

- **Which tools.** `POST /api/channels/tools/availability` returns `{"available": bool, "tools": [...]}`. `ChannelToolsService.available_tools(project_id, artifact_id)` computes the list from the bots the artifact matches (decision 2): `list_channel_destinations` while any bot is connected, `send_channel_message` while any bot has "Can post outside the conversation" on, and `read_channel_messages` and `search_channel_messages` while any bot's readable list is not empty. An ambiguous binding still gets the list tool, so its calls surface the configuration error.
- **Where they are added.** The SDK agent handler calls the route before each run (`_with_channel_tools` in `sdks/python/agenta/sdk/agents/handler.py`, through `read_channel_tools` in `sdks/python/agenta/sdk/agents/platform/channel_tools.py`). It runs under the same bounded deadline as the session context (`run_optional` with `session_context_timeout()`). A slow or failed check adds nothing and logs a warning, and the run goes on.
- **Author entries win.** When the author already lists `{"type": "platform", "op": "<name>"}` for one of the ops, that entry stays as written, permission included, and the op is not added a second time.
- **The channel group.** `CHANNEL_TOOL_OPS` in the SDK op catalog lists the four ops, in the order they are added.

So the bot settings (decision 3) decide which tools the agent has: posting off removes the send tool, and reading off removes read and search. The settings also gate every call, so a tool the author lists in the configuration is refused the same way.

This is a stand-in. The Agenta tools kit (branch `docs/agenta-tools-kit`, not built) will own how always-on tools reach a run, read the same route, and replace `_with_channel_tools`.

**The web app knows the four ops.** The chat renders them as platform tools (`web/packages/agenta-chat/src/skin/registry.ts`), the tool permission control lists them in `PLATFORM_OPS` (`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/toolPermission.ts`), and the agent build kit copy names them (`agentTemplate/buildKitDescriptors.tsx`).

**The send tool defaults to `allow`.** By default the agent posts without an approval prompt:

- `PlatformOp` has an optional `default_permission` field. `send_channel_message` sets it to `allow`.
- The SDK's platform resolver (`platform_tools.py`) uses the author's permission when one is set. Otherwise it uses `op.default_permission`, but only when the agent-wide mode is `allow_reads`. `ToolResolver.resolve` passes that mode on.
- The runner's ladder in `effectivePermission` (`permission-plan.ts`) does not change. The operator kill switch comes first and the spec permission next.

So a per-tool `ask` or `deny` set by the author wins. An agent-wide `ask` or `deny` mode wins. The operator kill switch wins. The other three ops are read-only and already run without a prompt.

Why not publish Slack and Telegram gateway actions: that would copy bot credentials into the tool gateway, skip the Channels settings, and expose provider-shaped IDs. Why not let the model pass a `channel_agent_id` or `connection_id`: holding an internal ID is not authorization.

### 2. The server resolves which bots the run speaks for

The tool service matches the bound artifact ID against every active `ChannelAgent` in the project. A `ChannelAgent` that references an `application` or `workflow` matches on that ID. One that references a variant or a revision matches on the artifact that variant or revision belongs to, which the service looks up. The connection must be active, verified, and not archived.

One run can match several connections, for example a Slack workspace and a Telegram bot. The list tool returns destinations from all of them. If two active `ChannelAgent` rows on the same connection match the same run, the settings would be ambiguous, so the tool refuses with a configuration error rather than guess.

A run that matches no connection gets an empty destination list and a clear refusal from send, read, and search.

**Error mapping.** A refusal returns HTTP 409 with a message written for the model. Refusals cover: no bot connected, an ambiguous binding, posting off, reading off, and a direct-message space. An unknown or foreign reference returns HTTP 404 and reveals nothing about it. Request bodies are closed (`extra="forbid"`), so an extra field returns HTTP 422.

### 3. Settings on the bot replace per-destination grants

Store the settings on the connected bot, in a new `tools` block of `ChannelAgentData`:

| Field | Default | Meaning |
| --- | --- | --- |
| `can_post_outside_conversation` | `true` | The send tool may post to any channel destination. When `false`, send refuses every destination, and the list reports `can_post: false`. |
| `readable_space_keys` | `null` | `null` means every channel the bot is in. A list narrows read and search to those channels. An empty list turns read and search off. |

`readable_space_keys` holds space keys (the composed `external_key` of a space), not space row IDs. The settings page picks from the Slack channels the bot is in, and a channel can have no space row until the bot first sees a message there or the list tool syncs it. A key names the channel either way. So that the page can store keys, the discovery candidates of `POST /channels/spaces/discover` now carry `external_key`.

The settings page edits these through the existing `PUT /channels/agents/{agent_id}` route (`edit_channel_agent`), which layers a partial `data` edit onto the stored row (`ChannelAgentDataEdit` and `_layer_agent_edit`). No new configuration route is needed.

**What this drops, and why.** The first draft added four actions (`reply`, `search`, `send`, `direct_message`) to `ChannelGrant`, evaluated per destination and per space kind. Mahmoud decided that on Slack the agent may post to every channel the bot is in and read every channel, with no allow-list in v1. Per-destination grants would then hold the same "allow" on every row. That adds state, a change to the grant evaluation in `resolve_policy`, and a UI to edit it, all to express a default. Settings on the bot express the same policy on one screen and leave room for a future allow-list. The existing grants keep their job, which is deciding where the agent answers.

### 4. Channel destinations are space rows

A destination ID is an opaque string that encodes a space row ID (`dst_<space id>`). The model must treat it as opaque, and the server treats it only as a lookup key. Every call re-resolves it inside the caller's project and the matched connections and then checks the settings again. Direct-message spaces (kind `private`) are never destinations.

Thread IDs, message IDs, and read cursors are opaque too. Each packs the space ID with the provider reference (Slack `ts`, Telegram `message_id`), base64-encoded. A thread ID from another destination is refused without a lookup.

**Slack.** A channel destination is a public or private channel the bot is a member of.

- The Slack adapter has a new method, `list_member_spaces`. It pages `users.conversations` with `types=public_channel,private_channel`, so group DMs and direct messages are left out. The service creates missing space rows without joining anything (`get_or_create_space`).
- The default adapter method raises `ChannelNotSupported`. That exception is the capability signal. The plan's `ChannelDirectory` capability was not added, because it would say the same thing twice.
- The member list is cached in the API process for 120 seconds per connection (`_MEMBER_CACHE` in `api/oss/src/core/channels/tools/service.py`). There is no stored sync time on the connection and no environment variable. The cache only spares Slack a listing call, so losing it on restart or not sharing it across API processes costs one extra call, nothing more.

**Telegram.** `list_member_spaces` raises `ChannelNotSupported`, so the service falls back to the group and supergroup chats that already have a space row: chats that sent the bot an update or were bound to it. The group name comes from the chat title, which the Telegram adapter now records in the event locator (`title`). The hosted Telegram bot lists only chats currently bound to the project's connection.

Paging uses an offset over a total order, carried in the cursor.

Why not signed provider locators: a signed Slack ID still leaks provider identity, and revocation would need a deny list.

### 5. The send posts inline and records the delivery

`send_channel_message` extends the existing outbox rather than adding a delivery table. Migration `oss000000036`:

- makes `channel_outbox_events.thread_id` nullable,
- adds a `space_id` column, backfilled from each row's thread, with an index on `(project_id, space_id, created_at)`.

The outbox worker now writes `space_id` on new turn rows. There is no `origin` column: a tool send is the row with no thread. For a tool send, `turn_id` holds the tool call ID.

The row `key` for a tool send is a uuid5 over `session_id:tool_call_id`. The existing unique constraint `uq_channel_outbox_key` on `(project_id, key)` makes a retried call find the same row instead of posting twice. Every run has a session ID (see [Context](#context)), so this protection applies to automation runs as well.

The send path:

1. Re-check authorization and the posting setting, and check that a given `thread_id` belongs to the destination.
2. Return the stored state if a row for the same key exists.
3. Insert the row with a fresh nonce in `data.processed.attempt`. Only the request whose nonce comes back, the one whose insert created the row, posts. A concurrent retry gets the same row back with another nonce and reports its state.
4. Post inline through the adapter.
5. Record the outcome with `transition_outbox_event`.

It returns `sent` with a `message_id` and, when the provider threads, a `thread_id`; `failed` with a sanitized reason; or `unknown`. `unknown` means the post may have reached the chat, so Agenta never retries it. A retry with the same tool call returns the stored state; a row whose first request never recorded an outcome reports `unknown`. So a tool call gets exactly one post attempt, whatever time passes between a request and its retry. Slack's `internal_error` and `fatal_error` answers come with HTTP 200 but may still have posted, so the Slack adapter reports them as an uncertain delivery, for replies and sends alike.

The plan moved the claim, post, and receipt code into `ChannelsService.deliver` so the worker and the tool would share it. That was dropped, and the send does not use the worker's claim either: the worker's claim can be taken over after it expires, which suits a retried reply but would let a slow tool call post twice. The send path above is short and uses the same DAO calls the worker uses. The one rule both must agree on, when an exception means the outcome is unknown, moved to `delivery_outcome_unknown` in `api/oss/src/core/channels/utils.py`, and both call it. The outbox worker is otherwise unchanged, which kept its test suite and behavior intact.

There is no background retry. The sender identity comes from the connection, as for replies.

### 6. Read serves stored messages first, then live Slack history

`read_channel_messages` builds its answer from messages Agenta already stores. It adds no table. The default limit is 50 and the maximum is 200.

**Provider time.** Migration `oss000000037` adds a nullable `sent_at` column to `channel_inbox_events`, backfilled from `created_at`, with an index on `(project_id, space_id, sent_at, id)`. Every new row gets `sent_at`: the provider's time when the adapter has it, else the arrival time. Adapters record `processed.sent_at` and `processed.message_ref`: Slack `ts`, Telegram `date` and `message_id`.

**Stored messages.** For a channel destination, the service merges two sources:

- inbox rows of that space, for what people posted (`PUSHED` rows, plus any `PULLED` rows the existing first-turn fetch already stored). `action` events (button clicks) are left out.
- sent outbox rows of that space, for the bot's own posts, found through the new `space_id` column. Only final posts count. A running turn's "Thinking..." indicator is not something the bot said, so stored reads never show it. The same holds for answers an approval consumed. Live Slack pages are Slack's own history and are shown as Slack holds them; a documented limit rather than a second filter over provider messages.

Inbox rows sort by `(sent_at, id)` and outbox rows by `(created_at, id)`, the orders their queries read in, and the merge and the cursor use the same pairs. So a page boundary never repeats a message or skips one that shares its second, which matters on Telegram, whose times have one-second precision. A bot post that appears in both sources (a `PULLED` copy of one of its own posts) is kept once, from the outbox, which holds its final text: the inbox query itself leaves out a `PULLED` row whose message reference matches a sent outbox receipt in the same space. The same filter (`_not_a_copy_of_a_bot_post` in `api/oss/src/dbs/postgres/channels/dao.py`) leaves out inbox rows with `flags.is_consumed`: an answer that an approval consumed went to the waiting approval, not to the conversation. So the two sources never overlap and each pages on its own order; dropping duplicates after paging would move the page boundary past unread messages.

**Live Slack history for anything older.** On Slack, when the stored messages do not fill the page, the service makes one live `conversations.history` call with `latest` set to the oldest stored time. That fills in messages from before the bot joined and messages that retention has deleted. Live messages are returned to the agent and are not stored. Slack's `has_more` decides whether a cursor is returned, because a short page (the hosted app gets about 15 messages) is not the end of the history. A live channel page lists only top-level messages, because Slack's channel history shows thread replies only inside their thread. The result says so and tells the agent to read a thread with its `thread_id`.

**Threads are read live.** Slack pages `conversations.replies` forward from the root, so a thread read on Slack asks Slack for the thread and pages with Slack's own cursor, carried inside the read cursor. The answer includes the bot's posts and current text. When Slack answers with a rate limit or refuses on the first page, the read falls back to the stored part of the thread, found by `data.external_locator.thread_ts` within the space's index, and says it is partial. On a later page it returns no messages and hands the same cursor back, so a retry resumes where it stopped. There is no expression index on the thread path; the stored fallback in a very busy channel reads slower.

**Cursor.** A read cursor is opaque. For a channel it encodes the space and the `(time, row id)` of the oldest message returned; for a thread, Slack's cursor.

**Slack's limit for the hosted app.** Since 2025, Slack limits `conversations.history` and `conversations.replies` for commercially distributed apps that are not in the Slack Marketplace. The limit is about one request per minute and 15 messages per page. This is accepted. On HTTP 429 the read returns the stored messages and a note built from `Retry-After`: "Slack limits this app to about one history request per minute. Try again in N seconds." Customer-built apps keep Slack's normal limits.

**Edits and deletions.** Stored inbox rows show a message as it was first received: Slack edits and deletions are not applied to them. The bot's own posts come from the outbox, which holds their final text. Live Slack pages show the current text, and deleted messages are missing. So an edited message can read differently in the stored part and the live part of the same history. The result says that stored messages may not reflect later edits or deletions.

**Telegram** has stored messages only. The result says: "Telegram does not let bots read chat history, so this shows only messages the bot received. In groups where the bot's privacy mode is on, that is only messages addressed to the bot."

**Retention.** Assumption, until the retention specification is approved: it deletes stored inbox and outbox rows older than a configured period, judged by `sent_at`. After that, a Slack read serves those messages live, and a Telegram read no longer has them.

### 7. Search covers stored messages only

`search_channel_messages` searches the inbox rows of the channels the agent may read at call time. The default limit is 20 and the maximum is 50. It uses a PostgreSQL full-text index. It does not use Slack's `search.messages` API, which needs a user token that the bot does not have.

**Index shape.** The text lives in the `json` column `data` at `processed.content[0].text`, and adapters write exactly one text part. Migration `oss000000038` adds the GIN expression index `ix_channel_inbox_events_search` on `to_tsvector('simple', coalesce(data #>> '{processed,content,0,text}', ''))`. It is created `CONCURRENTLY` in an autocommit block, so it does not lock the table. `#>>` works on `json` and is immutable, so the expression can be indexed. A generated column was rejected: a stored generated column rewrites the whole table and keeps a second copy of every message's text. The expression index adds no row data. Its cost is that every query must repeat the exact expression, so the DAO spells it once, as `_SEARCH_VECTOR`. The `simple` configuration assumes no language.

**Scope.** Search covers readable channel spaces only. It excludes direct messages, rows with no space, `action` events, fetched copies of the bot's own posts, and answers that an approval consumed (`flags.is_consumed`), through the same filter as read. It does not search the bot's own posts in v1. It makes no Slack history or search call. It may refresh the Slack member channel list (decision 4) to know which channels are readable.

**Ordering and paging.** Results are ordered by rank, then provider time, then row ID. That is a total order, and the cursor carries an offset over it. The limit: a message stored between two pages can shift a later page by one row.

**What was searched.** Each result set has a `searched` list with one entry per channel, each with a `coverage` statement:

- Slack: "Searched messages since the bot joined this channel."
- Telegram: "Searched only the messages the bot received in this group."

Once retention has deleted older messages, the wording follows the retention specification. The assumption is: "Searched messages from the last N days."

### 8. Settings UI

`web/packages/agenta-settings-ui/src/channels/ChannelAdvancedSection.tsx` adds a collapsed **Advanced** section to the manage panel. It sits after "Behavior" and the Telegram allow-list, above the Disconnect footer.

- "Can post outside the conversation" is a switch, on by default. It saves when flipped.
- "Channels it can search and read" defaults to "All channels the bot is in". Choosing "Only these channels" shows a checklist and a Save button. On Slack the checklist holds the discovered channels whose membership is `member`. On Telegram it holds the stored group spaces.
- Telegram help text says what Telegram allows.
- A failed save shows the error and re-reads the stored value.

The panel is shared by desktop and `/m`. An existing test (`web/packages/agenta-settings-ui/tests/unit/channelManagePanel.test.tsx`, "shows no read-only settings: no Advanced defaults and no Status row") forbade the word "Advanced". It recorded an earlier decision to stop showing read-only defaults. The new section keeps that rule: it holds only editable controls, and the test now says so.

## Interface roles

- **Data:** message text, search query, name filter, and time bounds.
- **Routing:** destination ID, thread ID, message ID, and cursor. All are opaque.
- **Policy:** the bot settings and the tool permission. They are never model input.
- **Protocol context:** caller credential, workflow artifact, session ID, and tool call ID. The runner and server bind them.
- **Metadata:** delivery state, notes, coverage statements, and timestamps.
- **Credentials:** bot tokens stay in the connection's secret store. They never appear in a tool schema, a tool result, a delivery row, or a log line.

## What was dropped, and why

| Dropped | Why |
| --- | --- |
| Scheduling (`schedule_channel_message`, `list_scheduled_channel_messages`, `cancel_scheduled_channel_message`, exact-schedule rows) | It belongs to the automation and scheduling product. An automation that runs the agent calls `send_channel_message`. |
| Per-destination action grants and editor-authorized DM recipients | Replaced by bot settings (decision 3). |
| Direct messages to people in v1 | Left for a follow-up (see [Future work](#future-work)). |
| `get_channel_delivery` and a separate delivery-intent table | The send posts inline and returns a final state. The outbox already has keys, claims, receipts, and the unknown-outcome rule. |
| Moving delivery into `ChannelsService.deliver` | The send uses the worker's DAO calls directly and shares only the unknown-outcome rule (decision 5). |
| A new `channel_messages` table, a backfill worker, and coverage records | Read and search use the inbox and outbox rows Agenta already stores, and read falls back to live Slack history. The history copy moves to [Future work](#future-work). |
| A `ChannelDirectory` capability, a stored directory sync time, and a TTL environment variable | `ChannelNotSupported` from `list_member_spaces` is the capability signal, and an in-process cache is enough to spare Slack (decision 4). |
| An `origin` column on the outbox | A tool send is the row with no thread. |
| A thread expression index on the inbox | A thread read filters within its space's index (decision 6). |
| A separate audit table and provider permalinks | Tool calls are already trace spans, and sends leave outbox rows. Each Slack permalink costs an API call. |

## Risks / Trade-offs

- **An agent can post without a human seeing it first.** The send tool defaults to `allow`, and the tools are added to every run of a connected agent, including automations. A bad prompt or a prompt injection can post to any channel the bot is in with no approval card. Mitigations: the posting setting, an author's per-tool `ask` or `deny`, an agent-wide `ask` mode, the operator kill switch, and the outbox record of every post.
- **Slack's history limit for the hosted app.** Reading older history on the hosted app is slow: about one live page of 15 messages per minute. The read result says so. Customer-built apps are not affected.
- **Search sees only what Agenta stored.** Messages from before the bot joined are not searchable in v1. The result says so on every call. The history copy in Future work closes this gap.
- **Stored text can be stale.** Edits and deletions made in Slack after Agenta stored a message do not reach the stored row. So a deleted message can still be found by search and shown by read. The read result says so.
- **Private channel content reaches wider audiences.** By default an agent can read a private channel it was invited to and post what it learned to a public channel. The admin control is the read list.
- **Telegram privacy mode.** In groups where privacy mode is on, the bot receives only messages addressed to it, so reads and searches return little. The result and the settings help text say so.
- **Lost receipts.** A post can succeed after the request times out. The send reports `unknown` and never retries.
- **Ambiguous bot bindings.** Two bots on one connection bound to the same agent make the settings ambiguous. The tools refuse rather than pick one.
- **Offset paging.** A message stored between two search pages can shift a later page by one row.
- **Slow thread reads in busy channels.** A thread whose messages are old, in a very busy channel, reads slower without a thread index.
- **A failed availability check drops the tools for one run.** When the check is slow or fails, the run goes on without the channel tools and the handler logs a warning. The next run checks again.
- **The retention specification is not approved.** The retention assumptions above must be checked when it lands.

## Migration Plan

1. Add `ChannelAgentData.tools` (JSON, no migration).
2. `oss000000036`: make the outbox `thread_id` nullable and add `space_id`, backfilled from each row's thread, with its index.
3. `oss000000037`: add `channel_inbox_events.sent_at`, backfilled from `created_at`, with its index.
4. `oss000000038`: add the full-text expression index, created concurrently.
5. Ship the routes, the catalog entries, and the run-time injection. Every connected agent gains the tools on its next run. To hold posting back, an admin turns off posting in the Advanced section before the release.
6. Rollback removes the catalog entries and the injection. Stored rows and indexes stay. No external message is deleted.

## Verification Plan

Unit tests cover settings defaults, reference matching, which tools each run gets and how the handler adds them, destination and reference encoding, every refusal path and its status code, the send's idempotency and unknown outcome, the default permission's precedence, the stored-then-live read merge, the rate-limit note, and search scoping. Integration tests against PostgreSQL cover the outbox extension, the new column and indexes, the read merge, and full-text search. Adapter tests use the existing fake Slack server. Live QA uses a fresh Slack workspace, the hosted Slack app, and fresh Telegram bots. [plan.md](plan.md) lists every test and command.

## Future work

### One-time history copy when a channel becomes readable

Goal: make search cover recent history from before the bot joined. The approach is settled, and it adds no table:

- **Reuse the inbox table.** Copy Slack history into `channel_inbox_events` as `PULLED` rows, generalizing the existing `run_backfill` in `fill.py` and the adapter's `fetch_history`. The unique key `(project_id, connection_id, external_id)` makes the copy and live events deduplicate. `PULLED` rows are never dispatched, so they never start a turn.
- **When it runs.** It runs when the bot joins a channel or a channel is added to the read list. It no longer waits for the first turn.
- **Resumable background job.** It runs on its own queue and waits for Slack's `Retry-After`. It keeps a cursor and a state in the space's `data`, so a restart resumes where it stopped. Taking hours on the hosted app is accepted.
- **How far back.** At most 14 days (`AGENTA_CHANNELS_HISTORY_COPY_DAYS`, default 14), and never further back than the retention period, whichever is shorter. A per-channel message cap (`AGENTA_CHANNELS_HISTORY_COPY_MESSAGES`, default 5,000) is a safety limit against unusually busy channels.
- **Fix the locator bug.** The existing fetch reads the locator of the message that created the space, so it can read one thread instead of the channel. The copy must build a channel-level locator.
- **Keep turns clean.** A thread's first turn reads the space log from the start, including `PULLED` rows, and then keeps only rows with the same thread key. Later turns read only rows after the last `PUSHED` trigger. So copied rows do not enter a turn's messages unless they belong to the same Slack thread. But a first turn still loads the whole space log before filtering. The copy must add a thread filter to that range read before it adds thousands of rows.

### Other follow-ups

- Direct messages to people.
- Replace the run-time injection with the Agenta tools kit once it ships.
- Apply Slack edits and deletions to stored rows.
- Search the bot's own posts.
- Check Slack's search API for AI apps (`assistant.search.context`) as a live search source that does not need a user token.
- A per-channel posting allow-list, if admins ask for one.
- Semantic search over stored messages.
