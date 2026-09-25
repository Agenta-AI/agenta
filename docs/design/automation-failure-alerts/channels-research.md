# Research: Automation Failure Alerts Through Slack and Telegram

This file answers one question: can the automation monitor in [plan.md](./plan.md) post a
failure alert into Slack or Telegram, as a new message that does not reply to an existing
conversation? All paths are relative to `api/` unless they start with `web/` or `docs/`.

Labels used in this file:

- **Connection**: one row in `channel_connections`. It is one installed Slack app or one
  Telegram bot for one project.
- **Space**: one row in `channel_spaces`. It is one place on the platform: a Slack channel, a
  Slack DM, or a Telegram chat.
- **Locator**: a dict of platform fields that names a place or a message. Slack uses
  `{team, channel, thread_ts}`. Telegram uses `{chat_id}`.
- **Receipt**: the locator of a posted message, which `edit_message` needs. Slack returns
  `{channel, ts}`. Telegram returns `{chat_id, message_id}`.
- **Proactive post**: a new top-level message that Agenta starts, with no inbound message
  before it.

## 1. Short answer

- The adapters can already make a proactive post. `post_message` needs only a destination id:
  `{"channel": "<id>"}` for Slack and `{"chat_id": "<id>"}` for Telegram.
- Nothing calls them that way today. The only caller is the channels outbox worker, and it
  sends only replies to a session turn in an existing `channel_threads` row.
- No destination for alerts exists. No table stores "where to send alerts" for a project,
  agent or automation.
- The monitor can add Slack and Telegram as a second sender next to email, with the same
  decisions. The work is a destination setting, a small sender, error handling and a UI. The
  estimate is 7 to 10 engineer-days on top of v0 (section 5).

## 2. What exists today

### 2.1 Components

| Component | File | Role |
|---|---|---|
| Adapter interface | `oss/src/core/channels/adapters/interface.py:17` | One class per platform: setup, ingress, egress, discovery |
| Registry | `entrypoints/channel_adapters.py:47-62` | Registers `slack`, `telegram`, `telegram_hosted`, `mock`, `bridge`, `agenta` |
| Service | `oss/src/core/channels/service.py:90` | Connections, agents, spaces, grants, threads, routing |
| Inbox worker | `oss/src/tasks/asyncio/channels/inbox.py` | Inbound event to agent turn |
| Outbox worker | `oss/src/tasks/asyncio/channels/outbox.py:87` | Session turn events to platform messages |
| Router | `oss/src/apis/fastapi/channels/router.py:193-516` | CRUD for connections, agents, spaces, grants; Slack install; Telegram bind link |
| Ingress | `oss/src/apis/fastapi/channels/ingress.py` | Platform webhooks |
| Identity links | `oss/src/core/channels/identity.py:106` | Maps a platform user to an Agenta user |
| Hosted Telegram bind | `oss/src/core/channels/telegram_binding.py:124` | Maps a Telegram chat to a project |

The API process builds a `ChannelsService` with the adapter registry and the vault
(`entrypoints/routers.py:1214-1221`). The monitor runs in the API process, so it can use this
service directly.

### 2.2 Tables

| Table | Key columns | Source |
|---|---|---|
| `channel_connections` | `project_id`, `id`, `channel` (registry key), `external_key` (global unique), `slug`, `data`, `flags` (`is_active`, `is_verified`, `is_hosted`) | `oss/src/dbs/postgres/channels/dbes.py:22`, `dbas.py:24-41`, `oss/src/core/channels/dtos.py:278-286` |
| `channel_agents` | `connection_id`, `slug`, `data.references` (the bound workflow), `flags.is_default` | `dbes.py:46`, `dtos.py:368-369` |
| `channel_spaces` | `connection_id`, `kind` (`private`, `group`, `topic`), `external_key`, `data.external_locator` | `dbes.py:69`, `dbas.py:60-76`, `dtos.py:25-28`, `dtos.py:400-401` |
| `channel_grants` | `agent_id`, `effect` (`allow`, `deny`), `kind` or `space_id`, `flags.is_default` | `dbes.py:85`, `dbas.py:79-98` |
| `channel_threads` | `space_id`, `agent_id`, `external_key`, `session_id`, `data.external_locator` | `dbes.py:134`, `dbas.py:101-115`, `dtos.py:433-435` |
| `channel_inbox_events`, `channel_inbox_triggers` | Inbound log and turn triggers | `dbes.py:153`, `dbes.py:176` |
| `channel_outbox_events` | `connection_id`, `thread_id` (NOT NULL), `turn_id` (NOT NULL), `key`, `state`, `data.external_locator` (the receipt) | `dbes.py:199`, `dbas.py:159-177` |
| `channel_identity_links` | `connection_id`, `user_id` (Agenta user), `external_user_key` | `identity_dbes.py:7`, `identity_dbas.py:11-20` |
| `channel_telegram_bind_tokens` | `token`, `project_id`, `user_id`, `connection_id`, `expires_at`, `consumed_at` | `telegram_bind_dbas.py:7-19` |
| `channel_telegram_chat_bindings` | `bot_id`, `chat_id` (unique pair), `project_id`, `connection_id` | `telegram_bind_dbas.py:22-31` |

Local data: all 11 `channel_*` tables are empty in `agenta_ee_core` (0 connections, 0 spaces,
0 agents, 0 threads, 0 identity links, 0 Telegram bindings, 0 outbox rows). The same database
has 19 `trigger_schedules` and 4 `trigger_subscriptions`. No local evidence shows how real
connections look.

### 2.3 How a connection is made, and where credentials live

- **Slack, hosted app**: OAuth. `build_authorize_url` asks for `SLACK_BOT_SCOPES`
  (`oss/src/core/channels/adapters/slack/oauth.py:40-47`). `exchange_code` trades the code for a
  bot token (`oauth.py:63-98`). The callback stores the granted scopes in `data.scopes`
  (`router.py:791-800`). `install_connection` upserts on the identity
  (`service.py:379-398`).
- **Slack, customer-owned app**: the user pastes `bot_token`, `signing_secret` and
  `api_app_id` (`slack/capabilities.py:44-80`).
- **Telegram, customer bot**: the user pastes a bot token. `verify_connection` calls `getMe`
  (`telegram/adapter.py:114-154`). The service mints a `webhook_secret`
  (`service.py:146-153`). `activate_connection` calls `setWebhook` after the row exists
  (`telegram/adapter.py:156-195`).
- **Telegram, hosted bot**: one Agenta bot for all projects. The bot token and webhook secret
  are deployment settings (`env.channels.telegram`, `telegram_hosted/adapter.py:111-118`). A
  project gets one connection (`service.py:779-809`). A user opens a deep link with a one-time
  token and sends `/start <token>` (`telegram_binding.py:150-222`). Hosted Telegram accepts
  private chats only (`ingress.py:337-342`).
- **Credential storage**: the service writes the pasted or exchanged credentials to the vault
  as a `CHANNEL_SECRET` (`service.py:1052-1080`). The row keeps only
  `data.credential_secret_id`. `fetch_connection` resolves it back into `data.bot_token` and
  similar fields (`service.py:596-656`). The hosted Slack signing secret is a deployment
  setting (`slack/adapter.py:85-102`).

### 2.4 Outbound sending

Signatures (`interface.py:168-193`):

```python
async def post_message(self, *, connection, locator: Dict, content: List[Dict], idempotency_key: UUID) -> Dict
async def edit_message(self, *, connection, external_locator: Dict, content: List[Dict], idempotency_key: UUID) -> Dict
```

`content` is a list of parts such as `{"type": "text", "text": "..."}`.

**Slack** (`slack/adapter.py:434-487`):

- `post_message` calls `chat.postMessage` with `channel = locator["channel"]` and
  `thread_ts = locator.get("thread_ts")`.
- `_call` drops every `None` parameter (`slack/adapter.py:724`). A locator with no `thread_ts`
  therefore posts a new top-level message.
- Long text is split into chunks. A failure after the first chunk raises
  `ChannelDeliveryUncertain`.
- The receipt is `{channel, ts}` of the last chunk.
- `edit_message` calls `chat.update` with that receipt.

**Telegram** (`telegram/adapter.py:314-362`):

- `post_message` calls `sendMessage` with `chat_id = locator["chat_id"]` and HTML parse mode.
  It sends no reply parameter, so every post is already a new message in the chat.
- The receipt is `{chat_id, message_id}`.
- The hosted adapter only swaps the token (`telegram_hosted/adapter.py:111-118`).

**What stops a proactive post today.** The adapters do not stop it. Three things around
them do:

1. The outbox worker acts only on session turn events. It looks up the `channel_threads` row
   by `session_id` and returns when there is none (`outbox.py:128-133`).
2. The first post of a turn takes its destination from `thread.data.external_locator`
   (`outbox.py:652-661`).
3. `channel_outbox_events.thread_id` and `turn_id` are NOT NULL (`dbas.py:172-173`), so an
   alert cannot use the outbox table without a thread.

**Service stubs.** `ChannelsService.enqueue_output` and `ChannelsService.deliver` raise
`NotImplementedError` (`service.py:2309-2313`). The outbox worker docstring confirms that it
does not call them and uses `channels_dao` directly (`outbox.py:94-98`).

### 2.5 Destinations Agenta knows

- **Slack channels**: `discover_spaces` lists public and private channels through
  `conversations.list` (`slack/adapter.py:539-577`). It does not list DMs. It reports
  membership per channel. `join_space` joins a public channel and refuses a private one with an
  "invite the bot" message (`slack/adapter.py:579-632`). A space row exists only after an
  operator adds the channel or a user sends a message there.
- **Slack DMs**: a DM becomes a `private` space only after a user writes to the bot
  (`service.py:1772-1788`). No code opens a DM. No code calls `conversations.open` or
  `users.lookupByEmail` (repository search). The scopes for both are already requested:
  `im:write`, `users:read`, `users:read.email` (`slack/manifest.py:18-36`).
- **Telegram, customer bot**: a bot cannot list its chats. `discover_spaces` returns `[]`
  (`telegram/adapter.py:458-465`). A chat is known only after someone writes to the bot.
- **Telegram, hosted bot**: `channel_telegram_chat_bindings` holds every bound private chat
  per connection. The bind also writes a `channel_identity_links` row with the Agenta
  `user_id` that minted the link (`dbs/postgres/channels/telegram_bind_dao.py:199-211`). So
  for hosted Telegram, Agenta knows the private chat of a specific Agenta user.
- **Stored locator caveat**: a space created by an inbound message stores the event locator
  as is (`service.py:1783-1787`). For Slack that locator carries the `thread_ts` of the first
  message (`slack/adapter.py:369-371`). A sender must post with `{channel}` only, or the alert
  goes into that old thread.
- **Default destination**: none. `channel_agents.flags.is_default` and
  `channel_grants.flags.is_default` choose which agent answers in a space
  (`dtos.py:288-305`). They do not name a place to post.

### 2.6 How an Agenta user maps to a platform identity

- `channel_identity_links` maps `(connection_id, external_user_key)` to `user_id`
  (`identity.py:22-26`). `compose_external_user_key` builds the key from the platform user id
  and, when the platform scopes ids, a scope id (`identity.py:40-60`).
- The inbox uses the link to decide which Agenta user a turn runs as (`inbox.py:227-277`).
- Only the hosted Telegram bind creates links. No Slack path creates one (repository search
  for `create_link`). For a Slack user Agenta has no link to an Agenta user.

### 2.7 How channels relate to automations

- A connection belongs to a project (`channel_connections.project_id`, `dbes.py:26-27`). It is
  not tied to a user.
- A channel agent binds a connection to a workflow through `data.references`
  (`dtos.py:368-369`). Grants decide in which spaces that agent answers.
- A schedule or subscription also binds a workflow through `references`
  (`oss/src/core/triggers/dtos.py:264-267`, `dtos.py:330-332`). Local schedules use every
  reference family: `workflow`, `workflow_variant`, `workflow_revision`, `application`,
  `application_variant`, `application_revision`.
- So "the channel of this agent" can be computed: find the `channel_agents` rows whose
  references resolve to the same workflow, then their `allow` grants. The result can be zero,
  one or many spaces, and a grant can be per kind (`kind`) instead of per space
  (`dbas.py:93-98`). No code does this today.
- The mobile app manages channels per agent (`web/mobile/src/features/agents/useAgentChannels.ts`,
  `web/packages/agenta-settings-ui/src/channels/actions.ts`).

### 2.8 Failure handling in the outbox

- A Telegram HTTP 401 raises `ChannelCredentialRevoked` (`telegram/adapter.py:496-501`). The
  outbox marks the row `failed` with `credential_revoked` and switches the connection off
  (`outbox.py:663-683`).
- Slack raises `_SlackApiError` for every `ok: false` (`slack/adapter.py:740-745`). It never
  raises `ChannelCredentialRevoked`. Slack reports uninstall and token revoke as inbound
  events (`slack/adapter.py:73`, `interface.py:147-153`).
- A post that may have landed (timeouts, 5xx, a partial chunked post) is marked
  `delivery_uncertain` and never retried (`outbox.py:684-708`, `outbox.py:1030-1047`).
- Any other error marks the row `failed` with `delivery_failed` and raises
  (`outbox.py:709-722`). The stream consumer leaves the entry pending and retries it until it is
  10 minutes old, then drops it (`outbox.py:78-81`, `outbox.py:935-950`). No dead-letter table
  exists.
- A missing space or connection drops the event (`outbox.py:1004-1015`).
- No code handles a rate limit (`Retry-After`, Slack `ratelimited`, Telegram `retry_after`).
  A 4xx counts as "known not posted" (`outbox.py:1041-1043`).
- No code refreshes a token. Slack bot tokens from this flow carry no refresh token
  (`oauth.py:50-60` keeps only `access_token`).
- The outbox does not check `flags.is_active` before it posts (repository search).

### 2.9 Mock adapter and tests

- `MockAdapter` (`oss/src/core/channels/adapters/mock/adapter.py:34-186`) records every post
  and edit, dedupes on `idempotency_key`, and returns receipts `{"mock_id": "<n>"}`.
  `inspect_posted(locator)` reads what it posted. It needs no network or credentials.
- It is also registered in the production registry (`entrypoints/channel_adapters.py:55`).
- Unit tests live in `oss/tests/pytest/unit/channels/` (44 test files at the top level, 77 with subfolders), including
  `test_channels_outbox_worker.py` and `test_channel_adapter_interface.py`.

## 3. What is possible

### 3.1 Feasibility

A proactive post is feasible with today's adapters and no adapter change:

- Slack channel: `post_message(locator={"channel": "C123"})`.
- Telegram chat (custom or hosted bot): `post_message(locator={"chat_id": 123})`.
- An edit later, if a future version updates an alert in place: `edit_message` with the
  stored receipt.

Conditions from the platforms. These come from Slack and Telegram documentation, not from this
code, and are not verified here:

- Slack: the bot must be a member of a private channel. `chat:write` posts to a public channel
  only after the bot joins it (`join_space` does that). A Slack user id as `channel` posts into
  the app's DM with that user. `chat.postMessage` allows about one message per second per
  channel.
- Telegram: a bot cannot start a chat with a user who never wrote to it (HTTP 403). A user who
  blocks the bot also gives 403. Limits are about 1 message per second per chat and 30 per
  second per bot.

### 3.2 Minimal changes

1. **Destination setting.** A new table, for example `automation_alert_destinations`:
   `project_id`, `id`, `connection_id`, `locator` (`{channel}` or `{chat_id}`), `display_name`,
   `scope` (`project` or one automation id), `flags.is_active`, `status` (last error). Start with
   one destination per project. A per-automation override can come later.
2. **Destination choice.** The UI offers:
   - Slack: channels from `POST /spaces/discover` with membership `member` or `joinable`. Strip
     `thread_ts`.
   - Hosted Telegram: the chats in `channel_telegram_chat_bindings` for the project's
     connection, labeled with the linked Agenta user.
   - Custom Telegram: the project's `private` and `group` spaces.
3. **Sender.** A `ChannelAlertSender` next to the email sender. It calls
   `channels_service.fetch_connection` (hydrated), refuses a connection that is archived,
   inactive or unverified, and calls `adapter.post_message`. It builds `content` from the
   catalog text and the run history link only.
4. **Delivery record.** Store the channel send on `trigger_alerts`, for example
   `channel_started_at` and `channel_receipt`. The receipt would allow an in-place edit later.
   v0 email records after the send and accepts a rare duplicate; a channel sender can do the
   same, so the start marker is optional.
5. **Error mapping.**
   - Telegram 401, Slack `invalid_auth`, `token_revoked`, `account_inactive`: mark the
     destination broken. Do not switch the connection off from the monitor; the conversation
     flow owns that.
   - Slack `not_in_channel`, `channel_not_found`, `is_archived`; Telegram 403 or
     "chat not found": mark the destination broken and log it (v0 has no team digest).
   - Timeouts and 5xx: stop posting for this pass and try again on the next pass, like the email
     sender; a rare duplicate post is accepted.
   - Slack `ratelimited` or 429: stop posting for this pass and try again on the next pass, as
     the email sender does for a transport error.
6. **Tests.** Use `MockAdapter` with a recorder for the sender and the pass-level tests.

### 3.3 How it plugs into the monitor

- The due rule in plan.md 4.8 stays the same. The grouping differs: email groups by address set,
  which can span projects, while a channel post groups by project destination. A channel sender
  therefore needs its own grouping and its own alert time per automation, next to
  `owner_alerted_at`.
- Each owner alert then goes to email (plan.md 4.9) and, when a destination is set and active,
  to that project's channel.
- Each sender keeps its own alert time, so an email failure does not block the Slack post and a
  Slack failure does not resend the email. Like email, the channel sender records after the post
  and accepts a rare duplicate; the start marker described in 3.2 is optional.
- Modes apply to both senders. In `shadow` a channel alert goes to an internal Slack
  destination (a new setting, for example `AGENTA_AUTOMATIONS_ALERTS_REDIRECT_CHANNEL`), or it
  is logged.
- Rate: channel posts follow the same rule as email, one message per destination at most once an
  hour.
- Team alerts stay email only.

### 3.4 Options for "where to post"

| Option | What Agenta knows today | Gap |
|---|---|---|
| A Slack channel the user picks | Discovered channels, membership | Destination table and UI |
| The owner's Slack DM | Nothing: no Slack identity link | `users.lookupByEmail` then post to the user id; the owner's Agenta email must match Slack |
| The owner's hosted Telegram chat | Chat binding plus identity link to `user_id` | Join the two tables; filter to the automation owner |
| A custom Telegram chat | Spaces created by inbound messages | Destination table and UI |
| "The channel of the agent" | Channel agents and grants by workflow reference | Resolve references, pick one of many spaces, handle `kind` grants |

## 4. Open questions

1. **Where to post by default?** One project channel is simple and visible. A DM to the owner
   matches the email design better but needs identity mapping for Slack.
2. **Who configures it?** Setting a destination posts into a shared place. It should need
   both the channel permission (`EDIT_CHANNELS`,
   `oss/src/core/access/permissions/types.py:180`) and the automation edit permission.
3. **Privacy in shared channels.** A channel has people who are not project members. The alert
   must carry only catalog text, the automation name and a link, never the raw error. Is the
   automation name itself acceptable in a shared channel?
4. **Agent channel or separate channel?** Posting failure alerts into the same channel where
   users talk to the agent mixes operations noise with conversations. Replies to an alert in that
   channel would also start an agent turn if the agent is addressed there.
5. **Hosted Telegram credential failure.** A 401 on the shared hosted bot token would make the
   outbox switch off that project's connection (`outbox.py:663-683` with
   `telegram_hosted/adapter.py:111-118`), although the cause is the deployment. The alert sender
   should not repeat this. Should the outbox change too? UNKNOWN whether this has happened.
6. **Customer-owned Slack apps.** A customer app built from an older manifest may lack
   `im:write` or `users:read.email`. Hosted connections store granted scopes in `data.scopes`;
   customer connections do not. The sender must handle `missing_scope`.
7. **Edit or new message on recovery?** An edit keeps the channel quiet but nobody sees it. A
   new message is noisy. This is a product choice.
8. **Real data.** Local tables are empty, so the share of projects with a Slack or Telegram
   connection is UNKNOWN. A production count of `channel_connections` by `channel` and
   `flags.is_hosted` should decide whether this is worth doing before v0 ships.

## 5. Effort estimate

Engineer-days for one person who knows the codebase, including tests. It assumes v0 phases 3
and 4 (decisions and email) exist.

| Work | Days |
|---|---|
| Destination table, migration, DAO, API endpoints | 2 |
| `ChannelAlertSender`, error mapping, delivery fields on `trigger_alerts`, fan-out in the monitor | 2 to 3 |
| Tests with `MockAdapter` and pass-level cases | 1 to 2 |
| UI in `web/mobile` and `web/packages`: pick a destination per project | 2 to 3 |
| **Total for a project channel** | **7 to 10** |
| Add: owner Slack DM through `users.lookupByEmail` | 2 to 3 more |
| Add: owner hosted Telegram chat through bindings and identity links | 1 to 2 more |
