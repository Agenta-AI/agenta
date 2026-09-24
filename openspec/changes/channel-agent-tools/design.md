# Design

Status: Draft for review. Nothing is implemented. This design follows Mahmoud's decisions of 2026-09-24. Code references point at `main` at commit `2f9cf635ca2ddda65dbd3702d98df88a4ea2a93f`.

## Context

See the [proposal](proposal.md) for the user outcome and the six capability specifications for required behavior. The implementation order and tests are in [plan.md](plan.md).

Two related specifications are being written separately. When this design was written, neither branch had been published, so the assumptions made about them are stated where they apply:

- **Agenta tools kit** (branch `docs/agenta-tools-kit`). It owns how always-on Agenta tools are added to a run and how they are turned off. The four channel tools are part of that kit.
- **Channel message retention** (branch `docs/channel-message-retention`). It owns how long stored channel messages are kept.

What exists on `main` today:

- **Replies are tied to an inbound thread.** The outbox worker finds a `ChannelThread` by session ID before it posts (`ChannelsOutboxWorker._fetch_thread_for_session` in `api/oss/src/tasks/asyncio/channels/outbox.py`). `ChannelsService.enqueue_output` and `ChannelsService.deliver` in `api/oss/src/core/channels/service.py` still raise `NotImplementedError`.
- **The outbox already records deliveries truthfully.** `channel_outbox_events` rows move through `created`, `sent`, and `failed`. A post whose outcome is unknown is marked `failed` with status code `delivery_uncertain` and is never retried (`_outcome_unknown` and `_deliver` in `outbox.py`). Every row requires a `thread_id`. A sent row keeps the provider receipt (Slack `channel` and `ts`) and the final content, including later edits.
- **Every message the bot receives is already stored.** The Slack manifest subscribes to `message.channels`, `message.groups`, `message.im`, and `message.mpim` (`adapters/slack/manifest.py`). Ingress records each message as a `channel_inbox_events` row, and the dispatcher attaches it to its space even when no turn starts (`ChannelsService.resolve`). The text sits in the `data` column, which has type `json`, at `data.processed.content[0].text`. The sender is at `data.processed.sender`. The Slack thread is at `data.external_locator.thread_ts`. The provider's own timestamp is not stored as its own field.
- **Stored rows do not follow edits or deletions.** The Slack adapter drops `message_changed` and `message_deleted` before routing, to stop a bot-echo loop (`parse_event` in `adapters/slack/adapter.py`). The Telegram adapter ignores edited messages.
- **A small history fetch already exists.** Before a thread's first turn, `run_backfill` in `api/oss/src/core/channels/fill.py` fetches one page of history (at most `AGENTA_CHANNELS_BACKFILL_LIMIT`, default 50) into `PULLED` inbox rows, once per space (`ChannelSpaceFlags.is_backfilled`). It passes the space's stored locator, which is the locator of the message that created the space and can include that message's `thread_ts`. So it can fetch one thread's replies instead of the channel history. That bug is left for the follow-up in [Future work](#future-work).
- **Adapters can post, list, and fetch.** The Slack adapter posts with `chat.postMessage`, lists channels with `conversations.list`, and reads one page of `conversations.history` or `conversations.replies`. The Telegram adapter returns no candidates from `discover_spaces` and raises from `fetch_history`, because the Bot API has neither.
- **A space row is not an authorization.** `ChannelsService.resolve` creates a never-seen space on first contact and says so: "the row's existence stopped being what authorises an agent to answer there; the grant is."
- **Platform tools hide self-targeting fields.** A `PlatformOp` (`sdks/python/agenta/sdk/agents/platform/op_catalog.py`) declares `context_bindings`, which the runner fills from the run context and removes from the model's schema (`assembleBody` in `services/runner/src/tools/direct.ts`). The run context carries the workflow artifact, variant, and revision (`RunContextWorkflow` in `sdks/python/agenta/sdk/agents/dtos.py`). The runner adds `session.id` (`services/runner/src/engines/sandbox_agent/run-turn.ts`). There is no tool call ID in the run context yet, but the relay has one (`req.toolCallId` in `services/runner/src/tools/relay.ts`).
- **Permissions.** `effective_permission` in `sdks/python/agenta/sdk/agents/tools/models.py:142` lets a `read_only` op run under `allow_reads` and makes every other op ask, unless the author set a permission. The runner mirrors it in `defaultPermission` (`services/runner/src/permission-plan.ts:329`). `Permission.RUN_CHANNELS` exists (`api/oss/src/core/access/permissions/types.py`).
- **A connected bot answers as one agent.** The settings UI binds a connection to an app with `ChannelAgent.data.references = {application: {id}}` (`web/packages/agenta-settings-ui/src/channels/actions.ts`).
- **The manage panel has no Advanced section today.** `ChannelManagePanel.tsx` shows "Answers in", "Behavior", "Allowed users" (Telegram only), credentials, and Disconnect. An existing test forbids the word "Advanced" (see decision 9).
- **Open pull request #7128** (`fix(channels): answer in threads and groups only when addressed`) changes how `compose_input` picks a turn's messages and adds `ChannelInboxEventFlags.is_consumed`. It does not change how `PULLED` rows are read. This design does not touch `compose_input`.

## Goals / Non-Goals

**Goals:** Let a connected agent list where it can post, post there, read a channel's recent history, and search what its channels said. Default to what a Slack workspace admin expects from a bot they invited. Keep credentials, provider IDs, and tenant IDs away from the model. Report delivery outcomes truthfully. Keep a proactive direct message out of any shared session.

**Non-Goals:** Scheduling of any kind. A new message table or a history copy job in v1. Semantic search, Slack's own search APIs, or searching the bot's own posts. Telegram history beyond what the bot received. Slack group DMs as destinations. Slack Enterprise Grid org-wide installs. A per-person or per-channel posting allow-list. Exactly-once delivery where the provider has no idempotency key. Reading or searching direct messages. Adding tools to a run, which the Agenta tools kit owns.

## Decisions

### 1. Four platform operations in the Agenta tools kit

Add four endpoint-mode `PlatformOp` entries, each over a new authenticated route. None is a gateway tool or a handler.

| Operation | Route | Model input | Hint |
| --- | --- | --- | --- |
| `list_channel_destinations` | `POST /api/channels/tools/destinations/query` | Optional `type` (`channel` or `person`), `query` (name filter), `limit`, `cursor` | Read-only |
| `send_channel_message` | `POST /api/channels/tools/messages/send` | `destination_id`, `text`, optional `thread_id` | Write |
| `read_channel_messages` | `POST /api/channels/tools/messages/read` | `destination_id`, optional `thread_id`, `limit`, `cursor` | Read-only |
| `search_channel_messages` | `POST /api/channels/tools/messages/search` | `query`, optional `destination_ids`, `after`, `before`, `limit`, `cursor` | Read-only |

Every operation binds `$ctx.workflow.artifact.id`. The send also binds `$ctx.session.id` and a new `$ctx.tool.call_id`. The runner fails a call closed when a bound value is missing (`assembleBody`), so the ops bind only what every agent run has. A playground draft can lack a revision ID, so the revision is not bound. The project comes from the caller's credential. The routes require `RUN_CHANNELS` on the caller.

**How the tools reach a run.** The channel tools are part of the Agenta tools kit. They are active when the agent is connected to a bot. The kit specification owns how the tools are added to a run, how an author's own entry for the same tool is handled, and how an author turns a tool off. This change provides the condition the kit reads: `ChannelToolsService.is_available(project_id, artifact_id)`, which is true when the artifact matches an active, verified bot (decision 2). Assumption, until the kit specification is published: the kit adds the tools to every run of such an agent, whether the run is a channel turn, a playground turn, or an automation. It does not change the saved agent configuration.

The bot settings (decision 3) gate every call whether or not the kit is active. They are the channel-side way to switch a capability off: posting off refuses every send, and an empty read list refuses every read and search.

**The send tool defaults to `allow`.** By default the agent posts without an approval prompt. The default is expressed the way the kit expresses per-tool defaults. If the kit has no such mechanism yet, this design proposes the smallest one:

- Add an optional `default_permission` field to `PlatformOp`, next to `read_only` (`op_catalog.py:191`). Set it to `allow` on `send_channel_message`.
- The SDK's platform resolver applies it (`platform_tools.py:130`). It uses the author's permission when one is set. Otherwise it uses `op.default_permission`, but only when the agent-wide mode is `allow_reads`. `ToolResolver.resolve` already holds that mode and would pass it on at `sdks/python/agenta/sdk/agents/tools/resolver.py:340`.
- The runner's ladder in `effectivePermission` (`permission-plan.ts:147`) does not change. The operator kill switch comes first and the spec permission next.

Whichever way the default is expressed, the precedence must hold. A per-tool `ask` or `deny` set by the author wins. An agent-wide `ask` or `deny` mode wins. The operator kill switch wins. The other three ops are read-only and already run without a prompt.

Why not publish Slack and Telegram gateway actions: that would copy bot credentials into the tool gateway, skip the Channels settings, and expose provider-shaped IDs. Why not let the model pass a `channel_agent_id` or `connection_id`: holding an internal ID is not authorization.

### 2. The server resolves which bots the run speaks for

The tool service matches the bound artifact ID against every active `ChannelAgent` in the project. A `ChannelAgent` that references an `application` or `workflow` matches on that ID. One that references a variant or a revision matches on the artifact that variant or revision belongs to, which the service looks up. The connection must be active, verified, and not archived.

One run can match several connections, for example a Slack workspace and a Telegram bot. The list tool returns destinations from all of them. If two active `ChannelAgent` rows on the same connection match the same run, the settings would be ambiguous, so the tool refuses with a configuration error rather than guess.

A run that matches no connection gets an empty destination list and a clear refusal from send, read, and search.

### 3. Settings on the bot replace per-destination grants

Store the settings on the connected bot, in a new `tools` block of `ChannelAgentData`:

| Field | Default | Meaning |
| --- | --- | --- |
| `can_post_outside_conversation` | `true` | The send tool may post anywhere. When `false`, send refuses every destination, and the list reports `can_post: false`. |
| `can_message_people` | `true` | Pending decision (decision 5). The send tool may post to a person. It needs `can_post_outside_conversation` too. When either is `false`, the list omits people. |
| `readable_space_ids` | `null` | `null` means every channel the bot is in. A list narrows read and search to those channels. An empty list turns read and search off. |

The settings page edits these through the existing `PUT /channels/agents/{agent_id}` route (`edit_channel_agent`), which layers a partial `data` edit onto the stored row (`ChannelAgentDataEdit` and `_layer_agent_edit`). No new configuration route is needed.

**What this drops, and why.** The first draft added four actions (`reply`, `search`, `send`, `direct_message`) to `ChannelGrant`, evaluated per destination and per space kind, plus an editor step that authorized each direct-message recipient. Mahmoud decided that on Slack the agent may post to every channel the bot is in and read every channel, with no allow-list in v1. Per-destination grants would then hold the same "allow" on every row. That adds state, a change to the grant evaluation in `resolve_policy`, and a UI to edit it, all to express a default. Settings on the bot express the same policy on one screen and leave room for a future allow-list. The existing grants keep their job, which is deciding where the agent answers.

### 4. Channel destinations are space rows

A destination ID is an opaque string that encodes a row type and a row ID. The model must treat it as opaque, and the server treats it only as a lookup key. Every call re-resolves it inside the caller's project and the matched connections and then checks the settings again.

A channel destination is a `ChannelSpace` row of kind `group` or `topic`.

- On Slack, the list first syncs the channels the bot is a member of. The adapter pages `users.conversations` with `types=public_channel,private_channel`, and the service creates missing space rows without joining anything (`get_or_create_space`). The sync runs on demand with a short time-to-live stored on the connection. Group DMs (`mpim`) are left out.
- On Telegram, channel destinations are the group and supergroup chats that already have a space row. That means chats that sent the bot an update or were bound to it.

Direct-message spaces (kind `private`) are never channel destinations.

Why not signed provider locators: a signed Slack ID still leaks provider identity, and revocation would need a deny list.

### 5. Direct messages to people: pending decision

**Pending decision.** The coordinator recommended leaving direct messages to people, and the `channel_people` table, out of v1. Mahmoud has not decided. This section describes the design if they stay. Everything else in this design reads the same either way. If they are left out: the list returns only channel destinations, the send tool accepts only channel destinations, the "Can message people directly" setting and `can_message_people` field are not built, and tasks 1.2, 2.5 and the person parts of 1.3 and 1.6 are dropped (see [plan.md](plan.md)).

If they stay:

- **A person destination** is a row in a new `channel_people` table: project, connection, a composed external user key (`compose_external_user_key` in `api/oss/src/core/channels/identity.py`), display name, handle, flags, and the person's private space once one exists.
  - On Slack, the list syncs the workspace directory with `users.list` (the `users:read` scope is already requested), skipping bots, deleted users, and Slackbot. Large workspaces rely on the `query` filter and cursor paging.
  - On Telegram, a person row exists only for someone who has a private chat with the bot, because a Telegram bot cannot start a chat.
- **A send to a person gets its own private session.** On Slack, the service opens the conversation with `conversations.open` (`im:write` is already requested) if needed and creates the private space row. On Telegram the private space already exists. The send uses the agent's active `ChannelThread` in that private space, or creates one with a fresh session ID, as `ChannelsService.resolve` does. The source session is never moved, copied, or linked. Only the sent text crosses over. So that the private session knows what was said, its next turn includes the thread's tool-origin outbox rows it has not seen yet.
- **People must be able to answer.** The custom-app manifest sets no `app_home` block today. The plan enables the messages tab.

### 6. The send posts inline and records the delivery

`send_channel_message` extends the existing outbox rather than adding a delivery table:

- `channel_outbox_events.thread_id` becomes nullable, and the table gains `space_id` and `origin` (`turn` or `tool`). Turn replies keep writing `thread_id`, so their queries do not change.
- The row `key` for a tool send is `uuid5(session_id + tool_call_id)`. The existing unique constraint `uq_channel_outbox_key` on `(project_id, key)` makes a retried call return the same row instead of posting twice.
- The route re-checks authorization, creates or reuses the row, claims it with the same claim-and-fence logic the worker uses, posts through the adapter, and writes the receipt. It returns `sent`, `failed` with a sanitized reason, or `unknown`. `unknown` is the existing `delivery_uncertain` outcome: the post may have reached the chat, so Agenta never retries it. A row found still claimed by a request that died is also reported as `unknown`.
- To share the claim, post, and receipt code with turn replies, move it from `ChannelsOutboxWorker._deliver` into `ChannelsService.deliver`. This fills in the stub that exists today.

The response includes a `message_id` and, when the provider threads, a `thread_id`. There is no background retry. The sender identity comes from the connection, as for replies.

### 7. Read serves stored messages first, then live Slack history

`read_channel_messages` builds its answer from messages Agenta already stores. It adds no table.

**Stored messages.** For a channel destination, the service merges two sources, ordered by the provider's time:

- inbox rows of that space, for what people posted (`PUSHED` rows, plus any `PULLED` rows the existing first-turn fetch already stored). Rows marked consumed by pull request #7128 and `action` events are left out.
- sent outbox rows of that space, for the bot's own posts. Turn replies are found through their thread's space, and tool sends through the new `space_id` column.

To order them, adapters start recording the provider's timestamp and message reference: Slack `ts`, Telegram `message_id` and `date`. They go in a new nullable `sent_at` column on `channel_inbox_events` and in `data.processed.message_ref`. Rows stored before this change fall back to `created_at`. A bot message that appears in both sources (a `PULLED` copy of one of its own posts) is shown once, matched on the message reference. A thread read filters on `data.external_locator.thread_ts`. An expression index on that path, next to `(project_id, space_id, sent_at)`, keeps both reads cheap.

**Live Slack history for anything older.** When the agent asks for more than the stored messages hold, the service fetches the rest from Slack. That happens for messages from before the bot joined, and for messages that retention has already deleted. The service calls `conversations.history`, or `conversations.replies` for a thread, with `latest` set to the oldest stored timestamp. It makes one Slack call per tool call. Live messages are returned to the agent and are not stored. Their message IDs are opaque references that the service can resolve again.

**Slack's limit for the hosted app.** Since 2025, Slack limits `conversations.history` and `conversations.replies` for commercially distributed apps that are not in the Slack Marketplace. The limit is about one request per minute and 15 messages per page. This is accepted. When the limit applies, a read returns the stored messages plus at most one live page. On HTTP 429 it returns the stored messages and a note: "Slack limits this app to about one history request per minute. Try again in N seconds." Customer-built apps keep Slack's normal limits.

**Edits and deletions.** Stored inbox rows show a message as it was first received: Slack edits and deletions are not applied to them. The bot's own posts come from the outbox, which holds their final text. Live Slack pages show the current text, and deleted messages are missing. So an edited message can read differently in the stored part and the live part of the same history. The result says that stored messages may not reflect later edits or deletions.

**Telegram** has stored messages only. The result says: "Telegram does not let bots read chat history, so this shows only messages the bot received." In groups where the bot's privacy mode is on, that is only messages addressed to the bot.

**Retention.** Assumption, until the retention specification is published: it deletes stored inbox and outbox rows older than a configured period, judged by `sent_at` when it is present. After that, a Slack read serves those messages live, and a Telegram read no longer has them.

### 8. Search covers stored messages only

`search_channel_messages` searches the inbox rows of the channels the agent may read at call time. It uses a PostgreSQL full-text index. It does not use Slack's `search.messages` API, which needs a user token that the bot does not have.

**Index shape.** The text lives in the `json` column `data` at `processed.content[0].text`, and adapters write exactly one text part today. The index is an expression GIN index: `to_tsvector('simple', coalesce(data #>> '{processed,content,0,text}', ''))`. `#>>` works on `json` and is immutable, so the expression can be indexed. A generated column was rejected: a stored generated column rewrites the whole table and keeps a second copy of every message's text. The expression index adds no row data. The cost of the expression index is that every query must repeat the exact expression, so the DAO keeps it in one helper. The `simple` configuration assumes no language.

**Scope and wording.** Search covers readable channel spaces only. It excludes direct messages, rows with no space, consumed rows, and `action` events. It does not search the bot's own posts in v1. Results are ordered by rank, then provider time, then row ID, and the cursor encodes that triple. Each result set states, for each channel it searched: "Searched messages since the bot joined this channel." Once retention has deleted older messages, the wording follows the retention specification. The assumption is: "Searched messages from the last N days."

### 9. Settings UI

Add a collapsible **Advanced** section at the end of `ChannelManagePanel`, below "Behavior" and the Telegram allow-list:

- "Can post outside the conversation" (a switch, on by default).
- "Can message people directly" (a switch, on by default, disabled while posting is off). Pending decision 5: if direct messages leave v1, this switch is not built.
- "Channels it can search and read", with "All channels the bot is in" selected by default. Choosing "Only these channels" shows a checklist of the bot's member channels.
- Telegram help text says what Telegram allows.

The panel is shared by desktop and `/m`. An existing test (`web/packages/agenta-settings-ui/tests/unit/channelManagePanel.test.tsx`, "shows no read-only settings: no Advanced defaults and no Status row") forbids the word "Advanced". It records an earlier decision to stop showing read-only defaults. The new section keeps that rule: it holds only editable controls, and the test changes to say so.

## Interface roles

- **Data:** message text, search query, name filter, and time bounds.
- **Routing:** destination ID, thread ID, message ID, and cursor. All are opaque.
- **Policy:** the bot settings and the tool permission. They are never model input.
- **Protocol context:** caller credential, workflow artifact, session ID, and tool call ID. The runner and server bind them.
- **Metadata:** delivery state, the history note, and timestamps.
- **Credentials:** bot tokens stay in the connection's secret store. They never appear in a tool schema, a tool result, a delivery row, or a log line.

## What was dropped, and why

| Dropped | Why |
| --- | --- |
| Scheduling (`schedule_channel_message`, `list_scheduled_channel_messages`, `cancel_scheduled_channel_message`, exact-schedule rows) | It belongs to the automation and scheduling product. An automation that runs the agent calls `send_channel_message`. |
| Per-destination action grants and editor-authorized DM recipients | Replaced by bot settings (decision 3). |
| `get_channel_delivery` and a separate delivery-intent table | The send posts inline and returns a final state. The outbox already has keys, claims, receipts, and the unknown-outcome rule. |
| A new `channel_messages` table, a backfill worker, and coverage records | Read and search use the inbox and outbox rows Agenta already stores, and read falls back to live Slack history. The history copy moves to [Future work](#future-work). |
| A tool-injection hook in the SDK handler | Adding tools to a run belongs to the Agenta tools kit. |
| A separate audit table and provider permalinks | Tool calls are already trace spans, and sends leave outbox rows. Each Slack permalink costs an API call. |

## Risks / Trade-offs

- **An agent can post without a human seeing it first.** The send tool defaults to `allow`, and the kit makes the tools available in every run of a connected agent, including automations. A bad prompt or a prompt injection can post to any channel the bot is in with no approval card. Mitigations: the posting setting, an author's per-tool `ask` or `deny`, an agent-wide `ask` mode, the operator kill switch, and the outbox record of every post.
- **Slack's history limit for the hosted app.** Reading older history on the hosted app is slow: about one live page of 15 messages per minute. The read result says so. Customer-built apps are not affected.
- **Search sees only what Agenta stored.** Messages from before the bot joined are not searchable in v1. The result says so on every call. The history copy in Future work closes this gap.
- **Stored text can be stale.** Edits and deletions made in Slack after Agenta stored a message do not reach the stored row. So a deleted message can still be found by search and shown by read. The read result says so. Applying Slack edits and deletions to stored rows is a follow-up.
- **Private channel content reaches wider audiences.** By default an agent can read a private channel it was invited to and post what it learned to a public channel. The admin control is the read list.
- **Telegram privacy mode.** In groups where privacy mode is on, the bot receives only messages addressed to it, so reads and searches return little. The result and the settings help text say so.
- **Lost receipts.** A post can succeed after the request times out. The send reports `unknown` and never retries.
- **Ambiguous bot bindings.** Two bots on one connection bound to the same agent make the settings ambiguous. The tools refuse rather than pick one.
- **Dependent specifications are unpublished.** The kit and retention assumptions above must be checked when those specifications land.

## Migration Plan

1. Add `ChannelAgentData.tools` (JSON, no migration). If direct messages stay in v1, add the `channel_people` table.
2. Extend the outbox (`thread_id` nullable, `space_id`, `origin`).
3. Add `channel_inbox_events.sent_at`, the thread expression index, and the full-text expression index. All three are additive.
4. Ship the routes and catalog entries. Once the kit activates the channel tools, every connected agent gains them on its next run. Admins who want to hold posting back should turn off posting in the Advanced section before that release.
5. Rollback removes the catalog entries. Stored rows and indexes stay. No external message is deleted.

## Verification Plan

Unit tests cover settings defaults, reference matching, destination encoding, every refusal path, the send's idempotency and unknown outcome, the default permission's precedence, the stored-then-live read merge, the rate-limit note, and search scoping. Integration tests against PostgreSQL cover the outbox extension, the new column and indexes, the read merge, and full-text search. Adapter tests use the existing fake Slack server. Live QA uses a fresh Slack workspace, the hosted Slack app, and fresh Telegram bots. [plan.md](plan.md) lists every test and command.

## Effort

| Component | Engineer-days |
| --- | ---: |
| Destinations, bot settings, list tool (people directory if DMs stay: +1) | 2-3 |
| Send tool, outbox extension, tool call ID, default `allow` (private DM session if DMs stay: +1) | 3-4 |
| Settings UI (Advanced section) | 1-2 |
| Read: stored messages plus live Slack history | 2-3 |
| Search: full-text index and search tool | 1-2 |
| Live QA on Slack and Telegram, fixes | 2-3 |
| Total without DMs | 11-17 |
| Total with DMs | 13-19 |

This excludes the Agenta tools kit, the retention work, the history copy, Slack Marketplace review time, and the native Slack handle change.

## Future work

### One-time history copy when a channel becomes readable

Goal: make search cover recent history from before the bot joined. The approach is settled, and it adds no table:

- **Reuse the inbox table.** Copy Slack history into `channel_inbox_events` as `PULLED` rows, generalizing the existing `run_backfill` in `fill.py` and the adapter's `fetch_history`. The unique key `(project_id, connection_id, external_id)` makes the copy and live events deduplicate. `PULLED` rows are never dispatched, so they never start a turn.
- **When it runs.** It runs when the bot joins a channel or a channel is added to the read list. It no longer waits for the first turn.
- **Resumable background job.** It runs on its own queue and waits for Slack's `Retry-After`. It keeps a cursor and a state in the space's `data`, so a restart resumes where it stopped. Taking hours on the hosted app is accepted.
- **How far back.** At most 14 days (`AGENTA_CHANNELS_HISTORY_COPY_DAYS`, default 14), and never further back than the retention period, whichever is shorter. A per-channel message cap (`AGENTA_CHANNELS_HISTORY_COPY_MESSAGES`, default 5,000) is a safety limit against unusually busy channels.
- **Fix the locator bug.** The existing fetch reads the locator of the message that created the space, so it can read one thread instead of the channel. The copy must build a channel-level locator.
- **Keep turns clean.** On `main` and in pull request #7128, a thread's first turn reads the space log from the start, including `PULLED` rows, and then keeps only rows with the same thread key. Later turns read only rows after the last `PUSHED` trigger. So copied rows do not enter a turn's messages unless they belong to the same Slack thread. But a first turn still loads the whole space log before filtering. The copy must add a thread filter to that range read before it adds thousands of rows.

### Other follow-ups

- Apply Slack edits and deletions to stored rows.
- Search the bot's own posts.
- Check Slack's search API for AI apps (`assistant.search.context`) as a live search source that does not need a user token.
- An allow-list of people the agent may message directly, if direct messages stay.
- A per-channel posting allow-list, if admins ask for one.
- Semantic search over stored messages.
