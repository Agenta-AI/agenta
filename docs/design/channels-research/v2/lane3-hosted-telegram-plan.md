# Lane 3 plan: hosted (Agenta-owned) Telegram bot

Status: plan revised after a Codex (gpt-astra, xhigh) review on 2026-09-09. The core
model is approved. The plan below is the build-ready version. It still needs a
dedicated hosted bot token and two product confirmations (end of file).

## The problem
A custom bot is one bot per customer, so the connection keys on `bot_id` and the
per-bot webhook path resolves it. The Agenta-owned hosted bot is ONE bot shared by
every project. An inbound update carries only the chat and the user, never the
project. Every hosted connection shares the same bot id, so the bot id cannot
resolve which project an update belongs to.

## Approved core model
One hosted connection per project, plus a chat-to-project binding written when a
user links a chat. The existing inbox, outbox, policy, thread, session, and uuid5
keying stay unchanged. The hosted path is additive.

## Design (revised after review)

### 1. A separate hosted adapter, not a flag on the custom one
Build `HostedTelegramAdapter` and register it under a new channel key
`telegram_hosted`. Give it a fixed `["project"]` connection identity. Share the
Telegram transport, parsing, and rendering code with the custom adapter.

Reason: the registry dispatches by channel key alone, and both `create_connection`
and `install_connection` call `fetch_capabilities(connection=None)`. A flag that
changes the identity key at ingress would not change it at creation, so the second
project would compute the same `bot_id` key and conflict. A distinct channel key
lets creation and the workers select the right adapter with no change to the
registry contract. `ChannelConnectionFlags.is_hosted` stays as ownership metadata,
not as an identity switch. The UI still shows both choices under "Telegram".

### 2. A real routing map (a new small table)
`channel_identity_links` is NOT this map. It maps a sender to the Agenta account
that invokes the agent. It is keyed `(project_id, connection_id, external_user_key)`
and its lookup needs the project and connection already known. It cannot resolve an
unknown chat to a project.

Add a small Telegram-specific binding table for `(bot_id, chat_id) -> project,
connection`. Put a database uniqueness constraint on the chat so one chat has one
active destination. For v1, refuse a bind to a second project until the first
binding is disconnected. Do not let the latest bind silently win.

### 3. Authenticate the first bind without a connection
The first `/start <token>` arrives before any connection row can be found, and the
current ingress rejects a request with no candidate connection. So the hosted path
must verify a deployment-level Telegram webhook secret BEFORE it consumes a token or
writes anything. The bot id in the URL only selects the hosted handler; it does not
authenticate the request.

Use one deployment bot token and one webhook secret. Configure the webhook once per
deployment (ops). Per-project hosted activation is a no-op. The custom
`activate_connection` must NOT run for a hosted connection: it calls setWebhook with
the connection secret and `drop_pending_updates=True`, which would disrupt every
project on the shared bot. The workers read the hosted bot token from deployment
config, never from a per-project vault.

Hosted `verify_signature` must return the PROJECT identity (resolved through the
authenticated update and the binding), not the bot id. The custom adapter returns
the bot id, which the ownership check would reject against a project-only locator.

### 4. One owner for binding
Put the binding orchestration in a new module
`api/oss/src/core/channels/telegram_binding.py` with `issue_bind_link`,
`consume_bind_token`, and `resolve_bound_connection`. Keep token storage and the
identity write out of the adapter. Put the SQL and the atomic write in a
Telegram-specific DAO under `dbs/postgres/channels/`.

Token rules:
- Use a short, opaque, random token. The Telegram deep-link parameter is capped at
  64 characters, so the existing signed OAuth state format does not fit.
- Store the token server-side with its project, its authenticated Agenta user id,
  its target connection, an expiry, and a consumed flag.
- The Agenta user id comes from the authenticated link-generation request. A project
  and a default agent alone cannot create the account link.
- The account-link write must use `compose_external_user_key` with the SAME inputs
  as the inbox worker (the scope id is the Telegram `chat_id`). A different input
  would write a link the worker cannot find, and the worker would fall back to the
  agent creator.
- Consume the token, bind the chat, and link the account in ONE database
  transaction. A duplicate `/start` must keep the completed binding. A failed
  greeting must not undo it.
- Consume `/start <token>` as a setup command before ordinary inbox recording, so
  the token never enters the agent context.

### 5. Prepare the connection and the agent at setup time (recommended)
When the user generates the link, create or reuse the hosted connection and set the
chosen default agent through the existing channel-agent and grant operations. Then
`/start` only completes the chat and account binding. This keeps the public webhook
request small. An abandoned link leaves an unused connection, which needs no new
lifecycle machinery. For v1, use one connection-wide default agent.

## Cut from v1 (scope)
Cut QR generation, per-region bots, hosted groups and topics, project switching
inside Telegram, per-user default agents, and the manual comma-separated allowed-id
list. Keep private-chat binding, and require the incoming sender to match the bound
account. That sender-match check replaces the allowed-id list. Do not remove the
list without adding the sender-match check, because the inbox worker falls back to
the agent creator for an unlinked user.

## Files to touch
- New `api/oss/src/core/channels/adapters/telegram_hosted/` (adapter + capabilities),
  sharing transport/parse/render with the custom adapter.
- New `api/oss/src/core/channels/telegram_binding.py` (issue/consume/resolve).
- New Telegram binding DAO + table under `api/oss/src/dbs/postgres/channels/` plus a
  migration.
- `ingress.py`: a small hosted branch in `ingest_telegram_event` that calls the
  binding service, then feeds the resolved candidate into the common verify/parse/
  record/enqueue path. No DB access inside the synchronous `connection_locator`.
- `env.py`: `TELEGRAM_HOSTED_BOT_TOKEN` and the hosted webhook secret.
- `router.py`: a bind-start endpoint the UI calls to mint the link.
- Register `telegram_hosted` in `api/entrypoints/channel_adapters.py`.

## Tests before "done"
Two projects with different chats. A conflicting bind. Token expiry and replay.
Concurrent token consumption. The callback sender check. Correct invoking-user
attribution. Disconnect behavior. Check that creating the second project connection
never calls setWebhook. Then the live hosted-bot test with the
~/.agenta-telegram-qa.env account.

## Open confirmations for Mahmoud
1. One hosted bot for all projects (assumed for v1) versus per-region bots.
2. The UI chooses the default agent before it generates the link (the design implies
   yes). Confirm.
3. A dedicated hosted bot token is needed to build and to live-test.
