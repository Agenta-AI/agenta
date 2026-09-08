# Lane 3 plan: hosted (Agenta-owned) Telegram bot

Status: ready to build. Needs a dedicated hosted bot token and one product
confirmation (below). Mahmoud approved Option A conceptually.

## The problem
A custom bot is one bot per customer, so the connection keys on `bot_id` and the
per-bot webhook path resolves it. The Agenta-owned hosted bot is ONE bot shared by
every project, so an inbound update carries only the chat and user, never the
project. Every hosted connection would share the same `bot_id`, so `bot_id` cannot
resolve which project an update belongs to.

## Option A (approved): per-project connection + a bind-time chat map
1. Identity. A hosted Telegram connection keys on `["project"]` (like the agenta
   adapter), not `bot_id`. `fetch_capabilities(connection)` returns the project
   key when `connection.flags.is_hosted`, the bot key otherwise. The static
   (connection=None) declaration used at ingress stays the custom shape.
2. Ingress resolution. For the hosted bot, add a small resolution step: the
   incoming `(bot_id, chat_id)` maps to a project via a row recorded at bind time
   (channel_identity_links already exists). The shared ingress calls a
   hosted-resolve seam when the bot id is the Agenta hosted bot; custom bots keep
   the existing path untouched.
3. Account bind (the design's Telegram hosted flow). The connect UI shows a QR and
   a "Continue in Telegram" deep link `https://t.me/<AgentaBot>?start=<token>`.
   The token is one-time, expires ~30 min, and encodes the project (and the agent
   to default). On `/start <token>`, the bot binds this chat/user to that project
   by writing the identity link and (if new) the per-project hosted connection,
   then greets the user.
4. Allowed user ids. A hosted bot is public, so a connection-level "allowed
   Telegram user ids" gate (comma-separated numeric ids) is enforced in the
   adapter's parse/ingress: a message from an id not on the list is dropped.
5. Webhook. The hosted bot's webhook is set once per deployment (ops), pointing at
   `/api/channels/telegram/events/<hosted_bot_id>/`. All hosted traffic shares it.
6. Config. Read the hosted bot token from deployment env (like SLACK_CLIENT_ID),
   e.g. `TELEGRAM_BOT_TOKEN`; `hosted_setup_available()` returns true only when set.

## Files to touch
- capabilities.py: connection-varying identity keys (project vs bot).
- adapter.py: hosted branch in connection_locator/verify_signature (resolve by the
  hosted bot id + the bind map), the bind-token issue/consume, allowed-ids gate.
- ingress.py: a hosted-resolve seam (mirrors _resolve_candidate) for the shared bot.
- service.py: issue/consume the bind token; write the identity link; upsert the
  per-project hosted connection.
- env.py: TELEGRAM_BOT_TOKEN (+ hosted flag).
- router.py: a bind-start endpoint the UI calls to mint the deep link + QR.

## Open confirmation for Mahmoud
- One hosted bot for all projects vs per-region bots: assume one for v1.
- The bind token carries project + default agent; confirm the agent is chosen in
  the UI before generating the link (the design implies yes).

## Testing
Needs a dedicated hosted bot (not the QA custom bot, which owns its own webhook).
Then: mint a link, `/start <token>` from the test account, assert the identity
link + connection, send a message, assert the reply routes to the right project.
Live-verify with the ~/.agenta-telegram-qa.env account.
