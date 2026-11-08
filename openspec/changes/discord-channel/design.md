# Design

Status: Proposal, not built. The design source is the reviewed Discord channel design of 2026-11-07 (four review rounds, simplify and naming lenses both Low). The code facts below were read on `main` at `aa9a7354ca`. The Discord facts were read from `discord/discord-api-docs` at commit `da52492ced` and from PyPI on 2026-11-07.

Terms used in this document:

- **connection**: one row in the channels connections table, which is one Discord bot set up in one project. It never means the WebSocket.
- **socket**: the WebSocket our process keeps open to Discord for one connection.
- **Discord Gateway**: Discord's WebSocket service. It is not related to Agenta's `gateway_connections`, `core/gateways` or the MCP gateway.
- **session interaction**: Agenta's interaction row (`ChannelPendingChoice.interaction_id`, a UUID). **Discord interaction**: Discord's `INTERACTION_CREATE` event. Adapter code names its fields `discord_interaction_id` and `discord_interaction_token`.
- **bot token**: the secret the user pastes. **choice token**: the value a pending-choice button carries. **Discord interaction token**: the token Discord sends with each click, used only to acknowledge that click.

## Context

### How Channels works today

Every platform is one adapter behind `ChannelAdapterInterface` (`api/oss/src/core/channels/adapters/interface.py:20`). The registry lists the first-party adapters in one place (`api/entrypoints/channel_adapters.py:54-71`). An adapter folder holds `adapter.py`, `capabilities.py` and `mapping.py`, as WhatsApp does (`api/oss/src/core/channels/adapters/whatsapp/`).

The HTTP ingress has one literal route per platform. The shared body `_ingest` reads the claimed connection with `connection_locator`, checks the request with `verify_signature`, calls `parse_event`, and then calls `_record_and_enqueue` once per parsed event (`api/oss/src/apis/fastapi/channels/ingress.py:660-746`). `_record_and_enqueue` builds a `ChannelInboxEventCreate` with origin `PUSHED`, stores it with `ChannelsService.record_inbox_event`, and enqueues `channels.inbox.dispatch` with `project_id`, `connection_id`, `channel` and `external_id` under a 5 second timeout (`ingress.py:880-919`, timeout at `ingress.py:83`). It enqueues even when the row already existed, so a platform retry recovers from an earlier enqueue failure. When the enqueue fails it raises `HTTPException(503)` itself (`ingress.py:913-919`). `handle_channel_adapter_exceptions` maps only `ChannelNotSupported` to 404 and `ChannelSignatureInvalid` to 401 (`ingress.py:98-121`). The hosted Telegram path calls the same `_record_and_enqueue` (`ingress.py:816-821`).

Duplicates are dropped in the database. `record_inbox_event` returns `None` for a row that already exists (`api/oss/src/core/channels/service.py:2199-2210`), because the insert uses `ON CONFLICT DO NOTHING` (`api/oss/src/dbs/postgres/channels/dao.py:1812-1830`) on the unique constraint `uq_channel_inbox_connection_external` over `(project_id, connection_id, external_id)` (`api/oss/src/dbs/postgres/channels/dbes.py:165-170`).

The dispatch task is registered by `ChannelsInboxWorker` (`api/oss/src/tasks/taskiq/channels/inbox_worker.py:34-68`). The API process passes it to the ingress router as `dispatch_task=_channels_inbox_worker.dispatch_inbox_event` (`api/entrypoints/routers.py:1423-1431`). `ChannelsService` takes no dispatch task today (`service.py:112-130`).

`worker-queues` runs one receiver per selected queue and a `heartbeat.ticker` sibling task (`api/entrypoints/worker_queues.py:640-682`). Its `channels-inbox` builder creates a `ChannelsService` with `_build_channels_service` (`worker_queues.py:307-315`), builds the `InboxDispatcher` with it (`worker_queues.py:428-445`), and constructs a `ChannelsInboxWorker` without keeping a reference (`worker_queues.py:446`).

The shared lock helpers `acquire_lock`, `renew_lock` and `release_lock` live in `api/oss/src/utils/locking.py:76-260`, with a default expiry of 15 seconds (`locking.py:18`). Evaluations use them through small wrappers (`api/oss/src/core/evaluations/runtime/locks.py:176-260`).

### Identity, threads and triggers

`compose_external_key` builds a uuid5 over the fields an adapter declares for each grain. It raises `ChannelConnectionKeyUndeclared` when the connection grain declares no fields, and `ChannelLocatorIncomplete` when a declared field is missing from the locator (`api/oss/src/core/channels/utils.py:36-71`). `create_connection` derives the stored `external_key` from what `verify_connection` returns (`service.py:177-245`). A DM keys its thread on the space (`service.py:2408-2414`); other spaces key the thread on the declared thread fields (`service.py:2415-2420`).

In a shared space a message starts a turn only when it is addressed: a mention or sigil, a command, or an answer to a pending choice (`service.py:3235-3270`, gate at `service.py:2465-2475`). "A follow-up in a thread the agent already answered in is not" a trigger (`service.py:3451-3454`). This rule was approved and shipped in the `channels-mention-only-threads` change (PR #7128).

### Approvals, typing and status

The outbox binds each approval button to the session interaction row. A button value becomes `<interaction UUID>:approve` or `<interaction UUID>:deny` (`api/oss/src/tasks/asyncio/channels/outbox.py:767-775`, labels at `api/oss/src/core/channels/render/render.py:235`). Telegram acknowledges a button press inside `parse_event` with `answer_callback_query` (`api/oss/src/core/channels/adapters/telegram/adapter.py:245-255`).

A capability can declare `rendering.controls.indicator` as `"message"` or `"native"` (`api/oss/src/core/channels/dtos.py:185-192`). With `"native"`, the outbox posts no "Thinking…" message, calls `signal_activity` every 20 seconds, and sends one fixed working message after 30 seconds (`outbox.py:83-89`, `outbox.py:234-252`, `outbox.py:335-380`). The working message text is "Working on it, I'll reply here when I'm done." (`render.py:30`). With `"message"` and `controls.update` true, the outbox posts an indicator and edits progress into it every 2 seconds (`outbox.py:78`, `outbox.py:281-289`). Slack puts a reaction on the user's message through `set_message_status` (`api/oss/src/core/channels/adapters/slack/adapter.py:598-623`), which the outbox calls when a turn changes state (`outbox.py:895-912`). Core splits an answer at the declared `max_chars` before any adapter sees it (`_split_text` in `api/oss/src/core/channels/render/render.py`): at a paragraph, line or word boundary, and a fence cut in half is closed and reopened. Each adapter's mapping keeps only a fixed-width safety net for content that arrives oversize anyway, for example `whatsapp/mapping.py:285` and `telegram/mapping.py:182`. M1 changes the shared split to keep a code block whole when it fits in one message (it starts the next message before the block); this also applies to the other Markdown channels.

### Setup UI today

The /m agent page shows a Channels card built from `CHANNEL_PLATFORMS` (`web/mobile/src/features/agents/AgentChannelsCard.tsx:37-71`). The platforms list and type are `["slack", "telegram", "whatsapp"]` (`web/packages/agenta-settings-ui/src/channels/helpers.ts:16`, `types.ts:9`). The connect flow for a custom Telegram bot is two steps, create a bot, then paste the token (`ChannelConnectFlow.tsx:1243-1280`). A connection row has more states than three: not connected, connected here, connected to another agent, not answering as any agent, revoked, and pending for the hosted bot (`helpers.ts:162-270`). Settings > Channels in /m renders `ChannelsSettingsPage` (`web/mobile/src/features/settings/ChannelsTab.tsx:6`, `:58`).

### Discord facts this design relies on

Each value below was read from Discord's official docs at `discord/discord-api-docs@da52492ced`, or from PyPI.

| Fact | Value | Source |
| --- | --- | --- |
| Message Content intent, application flag | `GATEWAY_MESSAGE_CONTENT` = `1 << 18` (262144). `GATEWAY_MESSAGE_CONTENT_LIMITED` = `1 << 19` (524288). | `developers/resources/application.mdx:166-167` |
| Read the application and its flags | `GET /applications/@me` returns `id`, `name`, `bot` (partial user) and `flags`. | `developers/resources/application.mdx:19-37`, `:248-249` |
| Gateway intents the socket sends | `GUILDS` `1 << 0`, `GUILD_MESSAGES` `1 << 9`, `DIRECT_MESSAGES` `1 << 12`, `MESSAGE_CONTENT` `1 << 15`. A privileged intent that is not turned on closes the socket with code `4014`. | `developers/events/gateway.mdx:304`, `:313`, `:375`, `:390`, `:405` |
| Bot permissions | View Channels `1 << 10`, Send Messages `1 << 11`, Send Messages in Threads `1 << 38`, Create Public Threads `1 << 35`, Read Message History `1 << 16`, Add Reactions `1 << 6`, Attach Files `1 << 15`, Embed Links `1 << 14`. Sum: `309237763136`. | `developers/topics/permissions.mdx:49-81` |
| Invite URL shape | `https://discord.com/oauth2/authorize?client_id=<application_id>&scope=bot&permissions=309237763136` | `developers/topics/oauth2.mdx:330-342` |
| Button acknowledgement | Callback type `6`, `DEFERRED_UPDATE_MESSAGE`, through `POST /interactions/{interaction.id}/{interaction.token}/callback`. The first response must arrive within 3 seconds. Interactions that arrive over the socket must be answered over HTTP. | `developers/interactions/receiving-and-responding.mdx:273`, `:332`, `:351`, `:441` |
| Button `custom_id` limit | 1 to 100 characters. | `developers/components/reference.mdx:81`, `:177` |
| Message length | `content` up to 2000 characters. | `developers/resources/message.mdx:1104` |
| Typing | `POST /channels/{channel.id}/typing`. It expires after 10 seconds. | `developers/resources/channel.mdx:629-631` |
| Reaction | `PUT /channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me` | `developers/resources/message.mdx:1148` |
| Start thread from message | `POST /channels/{channel.id}/messages/{message.id}/threads`. The thread id equals the source message id. | `developers/resources/channel.mdx:654-658`, `developers/topics/threads.mdx:46` |
| Channel history | `GET /channels/{channel.id}/messages` with `after` (snowflake) and `limit` 1 to 100, default 50. `before`, `after` and `around` are exclusive. | `developers/resources/message.mdx:918-937` |
| `MESSAGE_CREATE` fields | A message object plus `guild_id`, `member`, `mentions` and `channel_type`. It has no `parent_id`. A channel's `parent_id` is its category for a text channel and the parent text channel for a thread. | `developers/events/gateway-events.mdx:1138-1150`, `developers/resources/channel.mdx:32-35` |
| Resume | After a successful resume Discord replays missed events. After a fresh IDENTIFY it does not. | `developers/events/gateway.mdx:248`, `:267` |
| Library | `discord.py` 2.7.1, released 2026-03-03, MIT license, needs `aiohttp>=3.7.4,<4`. The API lock already has `aiohttp` 3.14.5. | `https://pypi.org/pypi/discord.py/2.7.1/json`, `api/uv.lock:140-141` |

## Goals / Non-Goals

**Goals:** Let a team answer in its own Discord server and in Discord DMs with an Agenta agent. Reuse the adapter interface, routing, inbox, outbox, approvals, grants and roster unchanged where possible. Add no new service and no new deployment setting. Keep the HTTP channels exactly as they are.

**Non-Goals:** No hosted Agenta bot. No registered slash commands; commands use the in-conversation `!` sigil. No streaming edits. No voice. No sharding. No spreading sockets across replicas. No HTTP interactions endpoint. No files in or out in v1.

## Decisions

### D1. The user brings their own bot

| Option | Trade-off |
| --- | --- |
| **User creates the bot and pastes its token** | Works on every deployment, self-hosted included. Setup takes a few minutes in the Discord Developer Portal. |
| One hosted Agenta bot | One-click install, but needs a bind flow like hosted Telegram, one bot per region, and Discord's privileged intent review once the bot grows. |

OpenClaw, Hermes Agent and n8n all use a bring-your-own bot.

### D2. Messages and clicks come over the Discord Gateway socket

| Option | Trade-off |
| --- | --- |
| **Socket only** | One transport for messages and button clicks. A click is acknowledged over HTTP from `parse_event`. |
| Socket plus an HTTP interactions endpoint | Needs a public route and Ed25519 signature checks, and Discord then stops sending interactions over the socket. No gain for v1. |

### D3. `discord.py` runs the socket only

| Option | Trade-off |
| --- | --- |
| **`discord.py` 2.7.1 for connect, heartbeat, resume and reconnect** | Maintained, MIT, and already used by Hermes Agent. Outbound calls stay on `httpx`, like the other adapters. |
| Own client on `websockets` | No new dependency, but we would own the heartbeat, resume and rate limit code. |

### D4. The socket loop runs inside `worker-queues` under one lock

`worker-queues` starts the loop as a sibling asyncio task when `channels-inbox` is among its selected queues, next to `heartbeat.ticker` (`worker_queues.py:668`). The loop takes one lock with `acquire_lock(namespace="channels", key="discord:sockets", ttl=...)` and renews it with `renew_lock` every 5 seconds, in a task of its own, so a slow connection reload never delays the renewal. Each renewal call has a 5 second timeout, and a timeout counts as a lost lock, so a Redis that stops answering cannot keep the sockets open past the 15 second lease. Only the holder opens sockets. Another replica waits for the lock. A holder that loses the lock cancels the running reload and closes all its sockets. Events it already received keep their enqueue retry, because the retry needs no lock. `AGENTA_WORKER_STREAMS` and `AGENTA_WORKER_QUEUES` are not changed.

| Option | Trade-off |
| --- | --- |
| **Sibling task in `worker-queues`, one lock for all Discord sockets** | No new service and no Helm, compose or Railway change. One process carries every Discord socket, and if it dies all Discord connections pause until another replica takes the lock. |
| New dedicated service | Clear ownership, but it adds a worker type, which the workers consolidation removed on purpose. |
| One lock per connection | Spreads sockets across replicas, but adds lease bookkeeping that today's load does not need. |

### D5. No streaming edits in v1

| Option | Trade-off |
| --- | --- |
| **Typing indicator and a reaction, then the answer as new messages** | No edit rate limits. The capability declares `controls.update: false` and `controls.indicator: "native"`. |
| Edit one message in place | Shows progress, but Discord rate limits edits, and n8n skips it for that reason. |

### D6. One shared store-and-enqueue step in core

`_record_and_enqueue` moves from the ingress class into `ChannelsService.record_and_enqueue_inbox_event`. The HTTP routes and the socket loop both call it. It keeps today's behavior: it enqueues even when the row already exists. On a failed enqueue it raises `ChannelInboxEnqueueFailed`. The HTTP ingress maps that exception to 503 in `handle_channel_adapter_exceptions`, so no `HTTPException` moves into core.

| Option | Trade-off |
| --- | --- |
| **Move the step into `ChannelsService`** | One path for both transports. The service needs the dispatch task. |
| Copy the step into the socket loop | Two copies of the same contract drift apart. |

### D7. Identity keys use Discord's own field names

| Grain | Fields |
| --- | --- |
| connection | `application_id` |
| space | `guild_id`, `channel_id` |
| thread | `guild_id`, `channel_id`, `thread_id` |

`guild_id` is `""` in a DM, as Slack does for a missing team, so `compose_external_key` never raises `ChannelLocatorIncomplete`. `verify_connection` returns `application_id`, so `create_connection` can derive the stored `external_key`.

The locator follows the Slack precedent, where `channel` stays the posted channel and the thread goes in `thread_ts`, with a top-level message keyed by its own ts (`api/oss/src/core/channels/adapters/slack/adapter.py:387-395`):

- `channel_id` is the text channel, which is the space. For a message inside a Discord thread, it is the thread's parent channel, read from the thread's channel object. The adapter reads the channel object of every server channel it meets once, through a small cache per connection, because `MESSAGE_CREATE` carries neither a thread's parent nor the channel's name. It ignores `channel_type`.
- `thread_id` is the Discord thread id. For a top-level message in a server channel, it is the message's own id, because Discord gives the thread started from that message the same id. This holds for every top-level message, not only a mention, as Slack keys a top-level message by its own ts: the adapter does not have to decide what is addressed (sigils and commands are decided in core). It is `""` in a DM.
- `thread_name` is set on a top-level server message only: its first line, at most 100 characters, with the bot's mention shown as its handle. `post_message` uses it to name the thread it starts. It is not an identity key.
- `source_channel_id` is the channel Discord delivered the message in, never rewritten. It is not an identity key.
- `message_id` is the Discord message id.
- `title` is the text channel's name, on server messages only. Core names a new space after it, as for a Telegram group's `title`. A DM has none; the UI already shows a private space as "Direct messages".

The space grain is the text channel, so every mention in a channel, and every thread under it, belongs to one space. A grant on the channel therefore covers every mention in it, because grant matching reads the space id (`api/oss/src/dbs/postgres/channels/dao.py:1215-1231`). Each mention-opened thread is its own thread key, so the first turn and the messages later posted in that thread share one session.

Replies post into `thread_id` when it is set, else into `channel_id`. `post_message` starts the thread from the message when it does not exist yet. The thread start, the reaction (`set_message_status`) and recovery (D9) use `source_channel_id`, because those calls address the original message in the channel Discord delivered it in.

### D8. Approval buttons carry the existing choice token

Each button's `custom_id` is the choice token the outbox already builds, `<interaction UUID>:approve` or `<interaction UUID>:deny`. That is 44 or 41 characters, inside Discord's 100 character limit. Clicks go through `resolve_pending_choice` with its existing authorization and stale-choice checks. No new mapping table.

### D9. Recovery after a failed resume reads inbox rows, not a stored cursor

No cursor is stored. On every READY, which Discord sends after a fresh IDENTIFY and never after a successful resume, the loop starts one recovery pass. The first socket of a connection gets a READY too, so a restart or a lock takeover is covered. The pass reads, for each channel, the highest Discord message id among the connection's inbox rows of the last 24 hours with origin `PUSHED` and kind `message` that were stored before the READY time minus a 5 second clock margin. It reads them through `ChannelInboxEventQuery` and `Windowing` (`oldest`, `newest`, at most 1,000 rows), grouped by `source_channel_id` in `external_locator` and compared as integers. It then reads Discord history after that id for each channel, through the adapter's `fetch_messages_after`, and passes each message through `parse_event` and `record_and_enqueue_inbox_event`. Those rows use origin `PUSHED`, because they are live messages that arrived late.

A live message on the new socket is stored after READY, so it never raises the start id past a missed message. The margin covers a database clock that runs behind the worker, where a live row stored after READY could carry an earlier time. A lower start id reads again messages whose rows already exist. A channel whose only stored rows fall inside the margin is not recovered, which is a documented limit. When the socket identifies fresh again during a pass, the new READY starts its own pass, and the first pass keeps going.

Recovery skips a message whose inbox row the dispatcher already routed. Routing attaches the row to its space (`space_id`), so the existing column says whether a dispatch ran. Without this skip, a command such as `!new` that the live path already ran would run a second time, because the dispatcher handles commands before the `(thread_id, event_id)` turn claim. A row that was stored but never routed, for example after a lost enqueue, goes through the shared step, which enqueues it again. If that dispatch races the live one, the turn claim stops a second turn.

One error rule covers the live path and recovery. A transient error is a network or timeout error, a Discord 5xx or 429, `ChannelInboxEnqueueFailed`, a SQLAlchemy `OperationalError`, `InterfaceError` or pool checkout `TimeoutError`, or a `DBAPIError` with an invalidated connection or a Postgres SQLSTATE a retry can outlast (classes 08, 53 and 57, and 40001, 40P01 and 25006). asyncpg raises a server shutdown or a failover as a plain `DBAPIError` with such a SQLSTATE, often with the connection still open. Every other error is permanent. On a transient error in parse, store or enqueue, the loop retries the same raw event with backoff, for up to 10 minutes. On the live path each event retries in its own task while the socket keeps reading; after 10 minutes, or on a permanent error, the event is logged and dropped. In recovery, a transient error retries that message before the pass moves on, so the cursor never passes an unstored message, and a transient error that lasts past 10 minutes stops that channel's pass. A permanent error skips only that message. A transient failure to read the recovery start or a history page is retried the same way.

Known limits on order. A live message on the new socket can start a turn before recovery stores an earlier message that was missed in the same conversation. Two missed messages in one conversation are stored and enqueued oldest first, but inbox dispatches run in parallel, so the agent can answer the later one first. Both happen only after a failed resume, and a fix needs the shared inbox dispatcher to serialize dispatches per conversation, which is outside this change.

| Option | Trade-off |
| --- | --- |
| **Start ids from inbox rows stored before READY** | One bounded query per READY. Covers only channels active in the last 24 hours. |
| Store a cursor per channel on every message | Covers every channel, but adds a write on every message. |

This is separate from the existing backfill, which records `PULLED` context and enqueues no turns.

### D10. When the agent answers

- DM: every message, as for every other channel (`service.py:3254-3255`).
- Server channel: a mention of the bot. The reply goes into a new thread under that message.
- Messages later posted in that thread follow the shared mention-only rule (decided in Open Question 6): they start a turn only when addressed, and reach the agent as context on the next mention.
- Who may talk to the agent: the existing grants and roster. No separate pairing step.

## Interfaces

Fields and signatures, classified by role as the `design-interfaces` skill asks.

### Capability declaration (`capabilities.py`, the source of truth)

It starts from the Discord declaration in `docs/design/channels-research/v2/channels.md:366-406`, with these v1 changes:

| Path | v1 value | Role | Why |
| --- | --- | --- | --- |
| `addressing.sigils` | `{"agent": "~", "command": "!"}` | protocol | Unchanged from the research. |
| `addressing.commands.native` | `false` | config | No registered slash commands in v1. |
| `addressing.commands.in_conversation` | `true` | config | `!new`, `!sessions`, `!use` work as text. |
| `spaces` | `private: true`, `group: false`, `topic: true` | metadata | Unchanged. Bots cannot join group DMs. |
| `conversation` | `units: ["thread", "space"]`, `default: "thread"` | config | Unchanged. |
| `fill.backfill`, `fill.forwardfill` | supported, `requires_permission: "Message Content Intent"` | metadata | Unchanged. |
| `rendering.controls` | `update: false`, `ephemeral: false`, `indicator: "native"` | config | D5. The research had `update: true` and `ephemeral: true`. |
| `rendering.buttons` | `supported: true`, `max: 5` | config | Unchanged, five per row. |
| `rendering.text` | `format: "markdown"`, `max_chars: 2000` | config | Unchanged. |
| `rendering.files` | `send` and `receive` unsupported | config | No files in v1. The research declared 8 MB both ways. |
| `identity.scope`, `identity.stable` | `"global"`, `true` | metadata | Unchanged. |
| `identity.keys` | D7 | routing | Discord field names. |
| `setup.fields` | one field, `bot_token`, `secret: true`, `required: true` | credentials | The only thing the user pastes. |
| `setup.instructions` | empty in M1; the steps of the setup flow | metadata | Wording is written and approved in M3. |
| `commands` | `["new", "sessions", "use"]` | config | Unchanged. |

### Connection data

| Field | Where | Role | Owner | Changes |
| --- | --- | --- | --- | --- |
| `bot_token` | vault, under the connection's credential secret (new secret kind `ChannelSecretKind.DISCORD`) | credentials | user | on rotation |
| `application_id` | `data.connection_locator`, and the source of `external_key` | routing (identity) | Discord, read by `verify_connection` | never |
| `bot_user_id` | connection data | metadata, used to drop the bot's own messages and to read mentions | Discord | never |
| `bot_username` | connection data, `data.bot_username` | metadata, the handle the connect UI shows (`web/packages/agenta-settings-ui/src/channels/actions.ts:226-231`) | Discord, from `bot.username` | when the user renames the bot |
| `application_name` | connection data | metadata, the default connection name (`_fill_connection_name_and_slug` reads it after `team_name` and `verified_name`) | Discord, from the application `name` | when the user renames the application |

The Message Content intent state is read at setup and is not stored. When neither flag is set, `verify_connection` raises `ChannelConnectionVerificationFailed` (`api/oss/src/core/channels/types.py:165`), as Telegram does for a rejected token (`telegram/adapter.py:139-144`). The exception's message text is user-facing copy and needs Mahmoud's approval in M3; this spec does not fix it. The socket learns it from Discord: close code `4014` means the intent was turned off.

### Inbound locator fields (`external_locator`)

| Field | Message | Click | Role |
| --- | --- | --- | --- |
| `guild_id` | from the event, `""` in a DM | same | routing |
| `channel_id` | the text channel (the space); for a message inside a thread, the thread's parent channel (D7) | same rule, for the message that holds the button | routing (space key) |
| `thread_id` | the Discord thread id; the message's own id for a top-level message in a server channel; `""` in a DM (D7) | same rule | routing (thread key) |
| `source_channel_id` | the channel Discord delivered the message in, never rewritten (D7) | the message's channel | routing (not an identity key) |
| `thread_name` | top-level server message only: its first line, at most 100 characters (D7) | not set | protocol context, names the thread `post_message` starts |
| `title` | the text channel's name, server messages only (D7) | not set | metadata, the name of a new space |
| `message_id` | the message id | the id of the message that holds the button | protocol context, used for the reaction, the thread start and recovery |

`external_id` is the Discord message id for a message and `discord_interaction_id` for a click. `processed.message_ref` is the message id in both cases, so a click points at the message that holds the button.

### New `ChannelsService` methods

```python
async def record_and_enqueue_inbox_event(
    self, *, project_id: UUID, connection_id: UUID, channel: str, inbound: ChannelInboundEvent
) -> None: ...
# Stores the event (origin from `inbound.origin`, PUSHED by default) and enqueues
# channels.inbox.dispatch. Enqueues even when the row already exists.
# Raises ChannelInboxEnqueueFailed when the enqueue fails or times out.

async def query_active_connections(self, *, channel: str) -> List[Tuple[UUID, ChannelConnection]]: ...
# Cross-project read: (project_id, connection) pairs, project_id first, following
# fetch_active_schedules_with_project (api/oss/src/dbs/postgres/triggers/dao.py:1141).
# Active, verified, not archived connections of one channel.
# Credentials are not hydrated; the caller uses fetch_connection per row.
```

The dispatch task is the attribute `ChannelsService.inbox_dispatch_task`, set on the service after construction, as `triggers_service.schedule_dispatch_task` is set at wiring (`routers.py:1144`), because in `routers.py` the service is built before the inbox worker that owns the task (`routers.py:1321` and `routers.py:1423`). Without a dispatch task the method stores the row and enqueues nothing, which matches the ingress today when `dispatch_task` is `None` (`ingress.py:902`).

### New exception

```python
class ChannelInboxEnqueueFailed(ChannelsError):
    """The event is stored, but its dispatch could not be enqueued."""
    # fields: channel: str, external_id: str
```

It lives in `api/oss/src/core/channels/types.py` with the other channels errors (`types.py:7-210`). The HTTP ingress maps it to `503` with the detail it sends today. The socket loop catches it and retries the same parsed event.

## Adapter mapping

| Interface method | Discord behavior |
| --- | --- |
| `fetch_capabilities` | Static declaration above. |
| `verify_connection` | `GET /applications/@me` with the bot token. Refuse when the token is rejected, or when neither `GATEWAY_MESSAGE_CONTENT` nor `GATEWAY_MESSAGE_CONTENT_LIMITED` is set. Both refusals raise `ChannelConnectionVerificationFailed`. Return `application_id`, `bot_user_id`, `bot_username` and `application_name`. |
| `build_setup_document` | The invite URL built from the recorded `application_id` and the permission integer `309237763136`, as `format: "text"` with the URL in both `content` and `link`. |
| `activate_connection` | Not used. The socket loop picks the connection up on its next reload. |
| `connection_locator` | Returns `None`, as `telegram_hosted` does (`telegram_hosted/adapter.py:85-91`). No HTTP route exists. |
| `verify_signature` | Raises `NotImplementedError`. Never called, because the socket is authenticated by the bot token. |
| `parse_event` | `MESSAGE_CREATE` becomes a `MESSAGE` event, and the bot's own messages return `None`. `INTERACTION_CREATE` for a button sends the deferred update, then becomes an `ACTION` event. |
| `post_message` | `POST /channels/{thread_id or channel_id}/messages`, split at 2000 characters with code blocks kept whole. When the thread may not exist yet (the locator opens a thread and this process has not seen it start), start it from the message in `source_channel_id` first; Discord's error `160004` (already started) counts as success. A thread start that times out or gets a 5xx raises a retryable error, because nothing was posted. Buttons go in action rows. The receipt is `{source_channel_id, message_id}`: the channel the posted message sits in. An empty answer posts nothing. |
| `edit_message` | Not offered (`update: false`). |
| `dismiss_choices` | Edits the message named by the receipt's `source_channel_id` and `message_id` to remove its components. |
| `signal_activity` | `POST /channels/{thread_id or channel_id}/typing`, or into `source_channel_id` while the thread may not exist yet. |
| `set_message_status` | Adds a reaction, in `source_channel_id`, to the user's message on `received` and changes it on `completed` or `failed`, as Slack does. |
| `discover_spaces`, `fetch_history` | `discover_spaces` returns nothing. `fetch_history` reads `GET /channels/{channel_id}/messages`. |
| `fetch_messages_after` (Discord only, for recovery) | One page of `GET /channels/{channel_id}/messages?after=<id>&limit=100`, as raw message objects. The socket loop pages forward and feeds each one to `parse_event`. |
| `revoke_installation` | Returns `None`. The user removes the bot in Discord. |

## Risks / Trade-offs

- **One process holds every socket.** If the lock holder dies, all Discord connections pause until another replica takes the lock after the lock expires. The lock expiry is short to keep the pause short.
- **The enqueue retry lives in memory.** A process crash during a queue outage can leave a stored row with no turn. The webhook path has the same limit when the platform stops retrying.
- **Recovery covers only channels active in the last 24 hours.** A missed message in a channel with no stored message in that window is not recovered.
- **Typing refresh is slower than Discord's expiry.** The outbox refreshes the native indicator every 20 seconds (`outbox.py:87`), and Discord's typing indicator expires after 10 seconds. The indicator shows for about half of a long turn. Changing the shared interval also changes WhatsApp, so v1 accepts the gaps.
- **`MESSAGE_CREATE` has no parent channel.** For a message inside a thread, the adapter must read the thread's channel object (Discord's `parent_id` field) to fill `channel_id`, and it reads the text channel for its name. The adapter keeps a small in-memory cache per connection, so each channel costs one read per process. `discord.py` also caches channels from `GUILD_CREATE`, but `parse_event` receives only the event bytes.
- **The Message Content intent can be turned off after setup.** Discord then closes the socket with `4014`. The loop logs it at error level and retries with backoff.
- **Discord's docs and the research disagree on the review threshold for the Message Content intent.** The docs say 100 servers (`application.mdx:166`); the research cites a 10,000 user threshold from June 2026. A bring-your-own bot in one server is below both.

## Migration

No database migration. No new environment variable. No Helm, compose or Railway change. `discord.py` is added to `api/pyproject.toml`, so the API image is rebuilt. The HTTP ingress switches to `record_and_enqueue_inbox_event` with the same behavior, the same status codes and the same dispatch arguments. Rollback is removing the `discord` registry entry; the socket loop then finds no connections to open.

## Open Questions

### Decided by default in the reviewed design

| # | Decision | Default | Alternative |
| --- | --- | --- | --- |
| 1 | Bot ownership | User brings own bot (D1) | One hosted Agenta bot |
| 2 | Interaction transport | Discord Gateway socket (D2) | Also an HTTP interactions endpoint |
| 3 | Library | `discord.py` for the socket only (D3) | Own client on `websockets` |
| 4 | Where the loop runs | `worker-queues`, next to `channels-inbox`, one lock (D4) | New dedicated service |
| 5 | Streaming | Off (D5) | Edit one message in place |

### 6. Does the agent answer later messages in its Discord thread without a mention? DECIDED: B

The design says yes. The code and the approved `channels-mention-only-threads` change say no: in a shared space, a follow-up in a thread the agent already answered in starts no turn (`service.py:3451-3454`).

| Option | Trade-off |
| --- | --- |
| A. Yes, as the design says. The adapter sets `addressed` on a message in a thread the bot started (thread `owner_id` equals `bot_user_id`). | Natural on Discord, where the thread exists only for this conversation. Makes Discord the one shared space that answers without a mention, and every message in the thread starts a paid turn. Needs the thread's channel object. |
| B. No, keep the shipped rule. People mention the bot in the thread too. | One rule for every channel and no extra lookup. Messages in between still reach the agent as context on the next mention. |

Decided: B (default taken 2026-11-07; the reviewed design was wrong here). Recommendation was B, because it keeps one rule that Mahmoud already approved and needs less code. If B is chosen, the `discord-conversation` requirement "Thread follow-ups" changes and nothing else does.

### 7. Should Discord get the 30 second working message? DECIDED: A

With `indicator: "native"`, the shared outbox sends "Working on it, I'll reply here when I'm done." once when a turn runs past 30 seconds (`outbox.py:88`, `render.py:30`). The design does not mention it.

| Option | Trade-off |
| --- | --- |
| A. Keep it, as on WhatsApp | No new code. One extra message on long turns. |
| B. Turn it off for Discord | The typing indicator and the reaction already show the agent is working. Needs a new capability field. |

Decided: A (default taken 2026-11-07), because it needs no code.

## Sources

- Discord API docs, commit `da52492ced`: https://github.com/discord/discord-api-docs/tree/da52492ced82d375981c46618cc3e182daada9a2/developers
- Application flags and Get Current Application: https://discord.com/developers/docs/resources/application
- Permissions: https://discord.com/developers/docs/topics/permissions
- Bot authorization flow: https://discord.com/developers/docs/topics/oauth2#bot-authorization-flow
- Interaction responses: https://discord.com/developers/docs/interactions/receiving-and-responding
- Component reference: https://discord.com/developers/docs/components/reference
- Messages: https://discord.com/developers/docs/resources/message
- Channels and threads: https://discord.com/developers/docs/resources/channel, https://discord.com/developers/docs/topics/threads
- Gateway and gateway events: https://discord.com/developers/docs/events/gateway, https://discord.com/developers/docs/events/gateway-events
- discord.py on PyPI: https://pypi.org/project/discord.py/2.7.1/
