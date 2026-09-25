# Telegram channel: requirements (v2)

Status: draft for review. Author: Claude, 2026-09-08, on Mahmoud's behalf.
Companions: `takeover-2026-09-08.md` (Slack-first-cut decisions), `decisions.md`
(D1–D11, the carried-forward and reversed calls this builds on).

Grounded in the code actually read in this worktree:
`api/oss/src/core/channels/adapters/interface.py` (the contract),
`.../adapters/slack/*` (the reference adapter), `.../channels/dtos.py`,
`.../channels/service.py`, `.../channels/identity.py`,
`api/oss/src/apis/fastapi/channels/ingress.py`, and
`api/oss/src/tasks/asyncio/channels/{inbox,outbox}.py`.

---

## 1. Summary and goal

Add Telegram as the second platform adapter behind the existing channels
feature, so an Agenta agent can answer Telegram messages the same way it
already answers Slack. Telegram must be installable in two modes — a one-click
**hosted** Agenta bot (the default) and a step-by-step **custom** bot the
customer owns — and must appear on both Agenta surfaces (the `/m` app under
`web/mobile` and the desktop app under `web/oss`/`web/ee`). The adapter must
satisfy the frozen `ChannelAdapterInterface` contract, declaring honestly the
two places Telegram is weaker than Slack (no history read, no chat
enumeration).

---

## 2. Scope for v1 vs later

**In scope (v1):**

- A `TelegramAdapter` implementing the full `ChannelAdapterInterface`.
- **Custom bot** install (BotFather token → verified connection → webhook).
  This fits the existing connection-keying seam cleanly.
- **Hosted bot** install (QR + `t.me` deep-link account binding), the default
  UX, *subject to the connection-identity decision in §11 O1* — the shared-bot
  model does not map onto the Slack-shaped ingress without one small addition.
- Private (DM), group/supergroup, and forum-topic spaces.
- Webhook transport with `secret_token` header verification.
- Outbound send, "Working…" placeholder edit, threaded replies, approval inline
  keyboards (`callback_query`), text length splitting.
- Account binding via a one-time `start` deep-link token → `channel_identity_links` row.
- Optional "Allowed Telegram user IDs" DM gate.
- The two user-facing behavior switches: **Direct messages Allow/Deny** and
  **Group chats Allow/Deny** (both default Allow).
- Desktop (`web/oss`/`web/ee`) and `/m` (`web/mobile`) connect UIs for both modes.

**Explicitly out (later):**

- **Backfill / reading chat history** — the Telegram Bot API has no method to
  read a chat's past messages (see §6). Declared unsupported; forwardfill still
  works from stored events.
- **Space pre-discovery pick-list** — bots cannot enumerate the chats they are
  in; spaces self-register on first inbound message (see §4, `discover_spaces`).
- **Long polling (`getUpdates`)** as a transport — incompatible with the
  push-only ingress today; see §6.
- **Advanced policy surfaces** (triggers, session_scope, backfill, forwardfill)
  — hidden behind defaults per the product decision; not exposed in v1 UI.
- **Multiple user-exposed agents per hosted connection** — v1 exposes a single
  default agent per workspace/chat scope (many may attach technically).
- **Reactions** — Telegram has no bot-facing reaction webhook parity with
  Slack; `ChannelTriggerKind.ACTION` is served only by inline-button callbacks.
- **File send/receive** — declare real limits but leave delivery off in v1
  unless trivially free (decision O5).
- **Native `/command` registration via BotFather** as a first-class surface —
  Agenta's in-message `!`-commands work as on Slack; native slash commands are a
  nicety, deferred.

---

## 3. Install modes

Both modes end at the same place: a verified `ChannelConnection` row whose
`data["connection_locator"]` holds the identity-key subset, a bot token reachable
for outbound calls, and a webhook registered with Telegram pointing at our
ingress. They differ only in *who owns the bot* and *where the token lives*
(mirrors Slack's hosted-vs-own-app split: hosted secrets live in deployment env,
custom secrets live on the connection as a `CHANNEL_SECRET`).

### 3a. Hosted (default) — QR + deep-link bind flow

Offered only when the deployment configured the Agenta bot
(`hosted_setup_available()` → `env.channels.telegram.enabled`), exactly as
Slack gates its hosted button on `env.channels.slack.enabled`.

1. In Settings → Channels (desktop or `/m`), the user picks **Telegram →
   Connect (hosted)**. This is the default option.
2. Agenta creates/loads the hosted connection for this workspace (see §8 and
   §11 O1 for how the connection is keyed), mints a **one-time bind token**
   (random, ~30 min TTL, single-use) mapping `token → {project, connection,
   issuing Agenta user}`, and renders:
   - a **QR code** encoding `https://t.me/<AgentaBot>?start=<token>`, and
   - a **"Continue in Telegram"** button with the same deep link.
3. Opening the link starts a chat with the Agenta bot; Telegram delivers a
   `/start <token>` message to the hosted webhook.
4. The bot posts a **"Welcome — link your account"** message (optionally with a
   **Link Account** inline button). On receiving the start token the adapter
   resolves `token → {project, connection, Agenta user}`, writes a
   `ChannelIdentityLink` binding the Telegram `from.id` to that Agenta account
   under the connection, and marks the token consumed.
5. The bot confirms the link. Subsequent DMs from that Telegram user resolve via
   the identity link and run as that user (D2); unlinked users fall back to the
   agent's creator, and — if the allowlist is set — are refused (see §8).
6. Expired / unknown / already-consumed tokens get a plain "this link has
   expired, generate a new one" reply and write nothing.

### 3b. Custom — bot token, step by step

Mirrors Slack's own-app paste flow (`ChannelSetupCredentialsForm` +
`SlackOwnAppSection`), walked as numbered instructions from the capability
declaration's `setup.instructions`:

1. In Telegram, open **@BotFather** → **/newbot**, choose a name and username.
2. Copy the **bot token** BotFather returns (`123456:ABC-...`).
3. (Groups) In BotFather → **/setprivacy**, decide whether the bot sees all
   group messages (privacy OFF) or only mentions/commands/replies (privacy ON,
   the default). See §10 — privacy ON matches the v1 mention default.
4. Paste the bot token into Agenta's custom-bot form and submit.
5. Agenta verifies the token (`getMe`), stores it as a `CHANNEL_SECRET`, then
   registers the webhook (`setWebhook` with a generated `secret_token`) pointing
   at this connection's per-bot ingress URL. **Order matters** — see §6 and the
   `verify_connection` note in `interface.py`: the webhook call writes state on
   Telegram's side, so it must run *after* the connection row exists, not as
   part of the pre-store verification.
6. One bot equals one agent (the connected agent tracks its latest revision).

---

## 4. Adapter contract mapping

Every member of `ChannelAdapterInterface` and how Telegram satisfies it.
"Gap" flags where Telegram is weaker than Slack and the degradation taken.

| Member | Kind | Telegram mapping | Gap / note |
|---|---|---|---|
| `channel` (attr) | attr | `"telegram"` | registry key in `channel_adapters.py` |
| `fetch_capabilities` | abstract | returns the static Telegram declaration (§5); hosted variant may flip `commands.native`/fill like Slack does | No per-install scope-revocation story (Telegram has no granular scopes) — declaration is effectively fixed |
| `build_setup_document` | default→None | **custom:** None (no manifest to generate; the doc is just instructions). **hosted:** no document either — returns None; the QR/deep-link is a UI concern built from the bind token, not a `ChannelSetupDoc` | Unlike Slack (JSON manifest), Telegram has nothing to pre-generate |
| `verify_connection` | default→{} | **custom:** call `getMe` (read-only) with the pasted token; discover `bot_id`, `bot_username`; raise `ChannelConnectionVerificationFailed` on a bad token. **hosted:** `getMe` on the deployment bot token. `setWebhook` is NOT done here (it writes) | **Gap / order inversion:** `interface.py` already flags this — `setWebhook` must run store→call→verify, but `create_connection` verifies *before* storing. See §6 + §11 O2 |
| `hosted_setup_available` | default→False | `env.channels.telegram.enabled` (bot token + secret token present) | mirrors `hosted_app_configured()` |
| `connection_locator` | abstract | reads the **per-bot routing token from `request.path`** (the ingress URL is `/telegram/events/<routing_token>/`) and returns e.g. `{"bot_id": ...}` or `{"routing_token": ...}`. Telegram updates carry no bot id, so the path is the only carrier | **Gap:** Slack reads the locator from the body; Telegram must read it from the path. `ChannelRequestContext.path` exists for exactly this. **Hosted single-bot has no per-project path** → §11 O1 |
| `verify_signature` | abstract | compare the `X-Telegram-Bot-Api-Secret-Token` header (constant-time) against the connection's stored `webhook_secret`; return the verified `bot_id` as the identity. Raise `ChannelSignatureInvalid` on mismatch | No HMAC like Slack; the secret token is a shared bearer value. The returned id must then pass `_connection_owns_identity` (ingress) |
| `parse_event` | abstract | normalise `update.message` / `update.channel_post` → `MESSAGE`; `update.callback_query` → `ACTION`; drop everything else (edited posts, `my_chat_member`, service messages, bot-authored). Set `addressed` from @mention / `/command` / reply-to-bot / DM | See §6 for the normalisation detail; bot-echo and edit drops mirror Slack |
| `detect_deactivation` | default→False | True when `update.my_chat_member` shows the bot's new status is `kicked` or `left` (removed/blocked) | Telegram analog of `app_uninstalled`/`tokens_revoked` |
| `revoke_installation` | default→None | **custom:** best-effort `deleteWebhook` for that bot + notice. **hosted:** do NOT `deleteWebhook` (one shared bot — it would break every workspace); just return a notice and let core drop the rows | **Gap:** shared hosted bot cannot be "uninstalled" per-workspace; only the links/spaces are removed |
| `post_message` | abstract | `sendMessage(chat_id, text, parse_mode, reply_parameters / message_thread_id, reply_markup)`; return receipt `{"chat_id", "message_id"}`; split text > 4096 (mirror `split_for_max_chars`); dedupe on `idempotency_key` | Receipt shape is `(chat_id, message_id)` — exactly the example the interface docstring gives |
| `edit_message` | abstract | `editMessageText(chat_id, message_id, text, reply_markup)`; offered because the declaration says `rendering.controls.update = True` | Same "indicator becomes the answer" path as Slack `chat.update` |
| `discover_spaces` | abstract | return `[]` — Telegram bots cannot list the chats they belong to | **Gap:** no pick-list. Spaces self-register on first inbound message (the service get-or-creates a space at ingress). UI must not show a discovery list for Telegram |
| `fetch_history` | abstract | never called (the dispatcher checks `capabilities.fill.backfill.supported` first — confirmed in `inbox.py::_run_backfill`); implement as `raise NotImplementedError` | **Gap:** no history API at all (§6). Safe to raise because the capability gate precedes the call |

Plus one member with **no Slack analog** that Telegram needs:

- **`answerCallbackQuery`** — after a button click arrives as a `callback_query`,
  Telegram requires the bot to acknowledge it or the button shows a spinner on
  the user's client. This is an extra outbound call the outbox/adapter must make
  when it processes an `ACTION` event. Propose: the adapter fires it inside
  `parse_event`'s sibling path or the ingress acks it; simplest is for the
  adapter to call it eagerly when it recognises a `callback_query` (the ack is
  idempotent and carries no content). Flagged in §7 and §11 O3.

---

## 5. Capability declaration for Telegram

Concrete values for `TELEGRAM_CAPABILITIES` (normalised by
`normalise_capabilities`, the same path Slack uses). Rationale inline.

```python
TELEGRAM_CAPABILITIES = {
    "channel": "telegram",
    "protocol": {"versions": ["0.1.0"]},
    "addressing": {
        # Mirror Slack's in-message sigils so `~agent` / `!new` parse identically.
        # Telegram does not rewrite text, so the same regexes work.
        "sigils": {"agent": "~", "command": "!"},
        "mention": True,                      # @botusername in groups
        # Native /commands via BotFather DO work in groups and DMs (unlike Slack
        # slash commands in threads), but v1 does not register them.
        "commands": {"native": False, "in_conversation": True},
    },
    "spaces": {"private": True, "group": True, "topic": True},
    # thread grain exists only in forum topics / reply chains; elsewhere it
    # degenerates to the space (like the Slack DM, D1). Default "thread" matches
    # the product default session_scope, and the locator omits the thread field
    # where absent (mirrors Slack build_locator / thread_ts fallback).
    "conversation": {"units": ["thread", "space"], "default": "thread"},
    "fill": {
        # NO history read on Telegram — backfill is a capability gap, not a
        # permission question (D10). Forwardfill works from stored PUSHED events
        # and needs no Telegram permission.
        "backfill": {"supported": False, "requires_permission": None},
        "forwardfill": {"supported": True, "requires_permission": None},
    },
    "rendering": {
        "controls": {"update": True, "ephemeral": False},  # editMessageText; no ephemeral bot msgs
        "buttons": {"supported": True, "max": 8},           # inline keyboard; degrade above max
        # 4096 is Telegram's hard message ceiling. Format: see O4 — recommend HTML.
        "text": {"format": "html", "max_chars": 4096},
        "files": {                                          # real limits; delivery deferred (O5)
            "send": {"supported": False, "max_bytes": 52428800},     # 50 MB bot send cap
            "receive": {"supported": False, "max_bytes": 20971520},  # 20 MB bot download cap
        },
    },
    "identity": {
        # Telegram user ids are GLOBALLY unique and permanent, so the raw id is
        # the key (scope "global"/absent → compose_external_user_key uses the
        # id alone). stable=True means there is no rebind path.
        "scope": "global",
        "stable": True,
        "keys": {
            "connection": ["bot_id"],               # custom: the bot. hosted: see O1
            "space": ["chat_id"],                   # the chat is the space
            "thread": ["chat_id", "message_thread_id"],  # forum topic sub-thread
        },
    },
    "setup": {
        "instructions": [ ... custom-bot BotFather steps from §3b ... ],
        "fields": [
            {"name": "bot_token", "label": "Bot Token", "secret": True,
             "required": True, "help": "From @BotFather after /newbot"},
        ],
        # hosted_available is filled by the service from hosted_setup_available()
    },
    "commands": ["new", "sessions", "use"],  # same in-message command set as Slack
}
```

Notes:

- `identity.scope = "global"` is the deliberate difference from Slack's
  `"workspace"`: a Telegram user id does not need a scope id embedded, so
  `compose_external_user_key` keys on the raw id. The link row is still scoped
  per `connection_id` in the table, so two connections never collide.
- Only `bot_token` is asked of the custom user; `bot_id`/`bot_username` are
  discovered by `getMe` (like Slack discovering `team_id`/`bot_user_id` from
  `auth.test`), and `webhook_secret` is generated by us, never typed.

---

## 6. Inbound

### Transport choice

- **Hosted → webhook.** Agenta owns a single always-on public endpoint and the
  bot; `setWebhook` with a `secret_token` is registered once. This is the only
  sensible choice for a shared bot.
- **Custom → webhook** as well. Reason: the ingress is **push-only** — there is
  no `getUpdates` polling worker anywhere in the stack, and adding one would be a
  per-connection long-lived loop that contradicts the stateless,
  ingress-pushes-one-row architecture (`ingress.py` verifies and writes one row,
  then enqueues). We register the customer's bot webhook at our per-bot URL on
  their behalf.
- **Long polling is the documented alternative** for air-gapped/self-hosted
  custom deployments that cannot expose an inbound URL; deferred because it needs
  a worker the push model does not have. Call it out, do not build it.

### Verification

- Telegram has **no signing secret and no HMAC**. Instead, `setWebhook` accepts
  a `secret_token`; Telegram echoes it on every delivery in the
  **`X-Telegram-Bot-Api-Secret-Token`** header. `verify_signature` does a
  constant-time compare against the connection's stored `webhook_secret` and
  returns the `bot_id`. This is the direct analog of `verify_slack_signature`;
  put it in `telegram/verification.py`.
- **No `url_verification` handshake.** Slack's ingress echoes an unsigned
  challenge (`_slack_url_verification_challenge`) because Slack *probes* the URL
  before you can save it. Telegram instead has *us* call `setWebhook`, so there
  is nothing to echo — the Telegram ingress route needs no handshake branch.
- **Order inversion (gap):** because `setWebhook` writes state on Telegram,
  registering it before the connection row exists would leave Telegram pointing
  at a connection that isn't there. `interface.py::verify_connection` already
  documents this. Recommendation: keep `verify_connection` read-only (`getMe`),
  and add a post-store "activate" step in the service that calls `setWebhook`
  (store → call → verify). See §11 O2.

### Event normalisation → `ChannelInboundEvent`

For each Telegram `Update`:

- `message` / `channel_post` (text) → `ChannelEventKind.MESSAGE`.
  - `external_id`: `f"{chat_id}:{message_id}"` (stable dedupe key, like Slack's
    `client_msg_id` fallback).
  - `space_kind`: from `chat.type` — `private` → `PRIVATE`, `group`/`supergroup`
    → `TOPIC` if it's a forum with a `message_thread_id` else `GROUP`/`TOPIC`
    (D8: a supergroup is a named persistent place = `topic`; an ad-hoc group is
    `group`). Mirror `classify_space_kind`.
  - `external_locator`: `{"chat_id": ..., "message_thread_id": ...?}` — omit
    `message_thread_id` when absent so the thread grain falls back to the space
    (exactly Slack's `thread_ts`-absent behavior in `build_locator`).
  - `processed.content`: `[{"type": "text", "text": ...}]`.
  - `processed.sender`: `{"id": str(from.id)}`.
  - `addressed`: True when the text @mentions the bot, is a `/command`, is a
    reply to the bot's own message, **or** the chat is a DM (private). Matches
    the Slack rule (`app_mention` / sigil) plus the DM-is-always-addressed rule
    from the takeover notes.
  - Drop bot-authored updates (`from.is_bot` and `from.id == our bot id`) and
    `edited_message`/`edited_channel_post` (no edit-processing path; same
    cascade risk Slack guards in `parse_event`).
- `callback_query` (button click) → `ChannelEventKind.ACTION`.
  - `external_id`: the `callback_query.id` (the click's own identity, not the
    message's — same reasoning as Slack `parse_block_action`).
  - content `[{"type": "text", "text": callback_data}]` (the token),
    sender `{"id": from.id}`, locator from `callback_query.message.chat.id`
    (+ `message_thread_id`), `addressed=True`.
  - **Must** trigger `answerCallbackQuery` (see §7).
- `my_chat_member` with status `kicked`/`left` → handled by `detect_deactivation`,
  never reaches `parse_event`.
- Everything else (service messages, `poll`, `edited_*`, joins) → `None`
  (platform noise).

The ingress then writes one `ChannelInboxEventCreate` and enqueues, unchanged
from the Slack path.

---

## 7. Outbound

Driven by `ChannelsOutboxWorker` (`outbox.py`) exactly as Slack is — the worker
is channel-agnostic and only calls `post_message` / `edit_message` and reads the
capability declaration.

- **Send:** `sendMessage` with `chat_id` (from the thread/receipt locator),
  `text`, `parse_mode` (§O4), `message_thread_id` for forum topics, and
  `reply_parameters.message_id` when threading under a specific message
  elsewhere. Receipt = `{"chat_id", "message_id"}`.
- **Threading / session scope:** forum-topic threads carry `message_thread_id`
  on both inbound and outbound. In plain groups and DMs Telegram has no thread
  id; per D1 the thread degenerates to the space and replies go top-level (the
  Slack-DM behavior). `reply_to_message` can optionally quote the triggering
  message for readability but does not define a session.
- **Placeholder edit:** on `turn_started` the worker posts the `INDICATOR_TEXT`
  ("Working…") via `sendMessage`; on `turn_ended` it `editMessageText`s that
  same message into the answer. `controls.update = True` makes the worker take
  the edit path (`outbox.py::_send`), identical to Slack.
- **Approval inline keyboard:** `render_turn_result` already emits a `card` part
  plus `button` parts with tokens (`approve`/`deny`) and a `choice`. The adapter
  renders buttons as `reply_markup.inline_keyboard`, with each button's
  `callback_data` = the token. Telegram `callback_data` is capped at **1–64
  bytes**; Agenta's tokens (`approve`, `deny`, numbered positions) fit. On the
  click, the `callback_query` ACTION event answers the parked interaction through
  the existing sessions respond path (the inbound side that the takeover notes
  confirm is done). **Additionally** the adapter must call `answerCallbackQuery`
  to clear the client spinner — the one outbound call with no Slack analog.
- **Degradation:** above `buttons.max` (8), degrade to a numbered text list and
  resolve by numbered reply — the `render_buttons_or_degrade` pattern already
  present for Slack. Same for when buttons are unsupported (they aren't here).
- **Limits:** split text at 4096 chars (`split_for_max_chars` analog); the last
  chunk's receipt is what `edit_message` targets, as on Slack.

---

## 8. Identity and account binding

- **Identity keys** (§5): connection `["bot_id"]` (custom) / project-derived
  (hosted, O1); space `["chat_id"]`; thread `["chat_id","message_thread_id"]`.
  The identity-key subset of the locator is recorded under
  `data["connection_locator"]`, the only place `_connection_owns_identity`
  looks (ingress).
- **External user key:** `compose_external_user_key(caps, str(telegram_user_id))`
  — scope `"global"` means the raw id is the key, no scope id embedded. Stored on
  a `ChannelIdentityLink` (`project_id`, `connection_id`, `user_id`,
  `external_user_key`).
- **Bind token deep link (the core of hosted onboarding):**
  - *Issue:* when a workspace user starts a hosted connect, mint a random token,
    store `{token → project_id, connection_id, agenta_user_id, expires_at}` with
    **~30 min TTL** and **one-time** semantics. Surface it as a QR and a
    `https://t.me/<AgentaBot>?start=<token>` deep link.
  - *Consume:* the `/start <token>` message reaching the hosted webhook resolves
    the token, creates the `ChannelIdentityLink` (Telegram `from.id` → Agenta
    user under the connection), and marks it consumed. Expired/unknown/consumed
    → plain refusal, no write.
  - This is new surface with no exact Slack analog; `slack/oauth.py` (the signed
    state + short TTL) is the nearest shape to copy. Put it in `telegram/bind.py`.
- **Allowed Telegram user IDs gate (recommended):** a per-connection,
  comma-separated numeric list stored in `connection.data`. When set, a DM from a
  Telegram id not on the list is dropped in `parse_event` (return `None`) so it
  never opens a turn. The UI field explains: find your id by messaging
  **@userinfobot**. This is anti-abuse for an otherwise open bot; placement
  (adapter vs a grant-layer check) is a minor decision (O6).

---

## 9. Policy and behavior defaults

Layered inheritance is unchanged (capability > channel > agent > space > grant;
"no opinion"/`None` defers to the next level — `ChannelPolicy` /
`resolve_effective_policy`). v1 **hides** the advanced fields behind these
defaults (same as the Slack cut):

- `triggers` = mention in group chats (DMs and held-thread replies are admitted
  by the resolve step itself, per D2/D3 in the takeover notes, not by a trigger
  kind).
- `session_scope` = `thread` (degenerates to space in DMs/plain groups; real
  sub-threads only in forum topics).
- `backfill` = off (and unsupported by the platform anyway — §6).
- `forwardfill` = on.

**User-facing switches on an agent (the only two exposed):**

- **Direct messages: Allow / Deny** (default Allow) → a `private`-kind grant.
- **Group chats: Allow / Deny** (default Allow) → a `group`/`topic`-kind grant.

These map to `ChannelGrant` rows keyed by `ChannelSpaceKind` (the existing
kind-level grant mechanism), never to raw policy JSON in the UI.

**Agent model:** hosted = ONE default agent per workspace/chat scope for v1
(addressing is unambiguous because the single shared bot fronts one default
agent); custom = one bot equals one agent. The connected agent always tracks its
latest revision. No revision/slug/id is ever shown in the UI.

---

## 10. Security and privacy notes

- **Bot privacy mode.** By default ("privacy ON", a BotFather setting) a bot in a
  group only receives messages that mention it, are commands, or reply to it.
  This is *aligned* with the v1 mention-trigger default, but it means forwardfill
  in groups only accumulates those messages, not the whole conversation. Turning
  privacy OFF (BotFather `/setprivacy`) lets the bot hear everything (fuller
  fill) at a privacy cost. Recommendation: **hosted bot = privacy ON** (minimal
  data, matches the mention default); custom owners choose. Decision O7.
- **Allowed ids** (§8) bound who can DM an open hosted bot.
- **`secret_token`** (the `setWebhook` value): 1–256 chars from `A–Z a–z 0–9 _
  -`; generate ≥32 random chars per connection; it is the only thing standing
  between the public ingress URL and a forged update, so store it as a secret.
- **Token storage.** Custom bot token and the generated `webhook_secret` live in
  the vault as a `CHANNEL_SECRET` (add `ChannelSecretKind.TELEGRAM`); the hosted
  bot token + secret token live in deployment env (`env.channels.telegram`),
  never on a row — same split as Slack. `_REDACTED_CREDENTIAL_FIELDS` in
  `dtos.py` **already lists `bot_token` and `webhook_secret`**, so log redaction
  is covered.

---

## 11. Open questions for Mahmoud

- **O1 — Hosted connection identity (the big one).** A single shared Agenta bot
  has no per-workspace installation identity the way a Slack app install has a
  `team_id`. The Slack-shaped ingress resolves a connection purely from
  request-carried fields, but a Telegram update to the shared bot carries only
  the chat/user, not the project. Two paths:
  - (a) Model hosted as **per-project connections keyed on `["project"]`** (like
    the `agenta` adapter) and add a small ingress resolution step that maps an
    inbound `(bot_id, chat_id)` — recorded at bind time — to the connection.
    This is a minimal, contained extension of `_resolve_candidate`.
  - (b) Model hosted as **one deployment-singleton connection** (like the
    bridge) and route to the target project via the account-binding identity
    link. Changes the "one connection per project" assumption.
  Recommendation: (a). Needs your call before hosted can ship.
- **O2 — `setWebhook` store/verify inversion.** Confirm adding a post-store
  "activate connection" step (store → `setWebhook` → verify) rather than calling
  it inside `verify_connection`. `interface.py` already anticipates this.
- **O3 — `answerCallbackQuery`.** Confirm the adapter eagerly acks button clicks
  (vs threading the ack through the outbox). Eager is simplest and idempotent.
- **O4 — Text format.** `html` parse_mode (robust, small tag set) vs `MarkdownV2`
  (must escape `_ * [ ] ( ) ~ \` > # + - = | { } . !` — fragile against
  arbitrary agent output). Recommendation: **HTML**, with a translation from the
  render layer's markdown-ish parts.
- **O5 — Files.** Ship v1 with file send/receive off (declared but `supported:
  false`), or include send (50 MB) now?
- **O6 — Allowed-ids enforcement point.** Adapter `parse_event` drop (simple) vs
  a grant-layer check (more uniform). Also: connection-level or agent-level?
- **O7 — Hosted bot privacy mode.** Privacy ON (mention-only, privacy-respecting)
  vs OFF (full fill) for the Agenta-owned bot.
- **O8 — Mobile surface scope.** `web/mobile` has **no** Channels settings
  surface today (§12). Confirm v1 builds the full Telegram connect UI on `/m`, or
  ships desktop-first with `/m` as a fast-follow (the product decision says both;
  flagging the build cost).

---

## 12. Implementation checklist

Mirrors the Slack layout (`api/oss/src/core/channels/adapters/slack/*`).

**API — adapter package** `api/oss/src/core/channels/adapters/telegram/`:

- `__init__.py`
- `adapter.py` — `TelegramAdapter(ChannelAdapterInterface)`, `channel =
  "telegram"`; implements every member per §4. Holds an `httpx` client against
  `https://api.telegram.org/bot<token>/`.
- `capabilities.py` — `TELEGRAM_CAPABILITIES` dict (§5) + `fetch_telegram_capabilities()`.
- `verification.py` — `verify_telegram_secret_token(headers, secret)` (analog of
  `slack/signature.py`).
- `mapping.py` — `classify_space_kind`, `build_locator` (omit
  `message_thread_id` when absent), `parse_callback_query`, button render +
  degrade, 4096-char split (analog of `slack/mapping.py`).
- `api.py` (or inline in adapter) — `get_me`, `set_webhook`, `delete_webhook`,
  `send_message`, `edit_message_text`, `answer_callback_query`.
- `bind.py` — issue/consume the one-time `start` bind token (§8); nearest model
  is `slack/oauth.py`.
- (No `manifest.py` — nothing to generate.)

**API — wiring & shared:**

- `api/entrypoints/channel_adapters.py` — register `"telegram": TelegramAdapter()`.
- `api/oss/src/apis/fastapi/channels/ingress.py` — add a Telegram route. Custom
  bots use a **per-bot path** `"/telegram/events/{routing_token}/"` so
  `connection_locator` can read the path (`ChannelRequestContext.path` exists for
  this). No `url_verification` handshake branch. Resolve O1 for the hosted route.
- `api/oss/src/utils/env.py` — `ChannelsTelegramConfig` (`TELEGRAM_BOT_TOKEN`,
  `TELEGRAM_SECRET_TOKEN`, `TELEGRAM_BOT_USERNAME`) with an `enabled` property;
  add `telegram` onto the channels config (beside `slack`).
- `api/oss/src/core/secrets/enums.py` — `ChannelSecretKind.TELEGRAM = "telegram"`
  (the `CHANNEL_SECRET` discriminator; `ChannelSecretDTO` is already generic).
- `api/oss/src/core/channels/service.py` — post-store "activate" step calling
  `setWebhook` (O2); `install_connection` for hosted keyed per O1; bind-token
  issue/consume service methods; expose a route to mint a hosted bind token.

**Frontend — desktop** `web/oss/src/components/pages/settings/Channels/components/`:

- `TelegramHostedAppSection.tsx` — QR + "Continue in Telegram" deep link + bind
  status (mirror `SlackHostedAppSection.tsx`).
- `TelegramOwnAppSection.tsx` — BotFather step-by-step + token form (mirror
  `SlackOwnAppSection.tsx`, reuse `ChannelSetupCredentialsForm.tsx`).
- The two agent switches (DM Allow/Deny, Group Allow/Deny) reuse the existing
  grant-by-kind UI; no advanced policy fields shown.
- No space discovery drawer for Telegram (`discover_spaces` returns `[]`).

**Frontend — `/m`** `web/mobile/`:

- Build the Channels settings surface (does **not** exist yet) with the same two
  Telegram flows, following `mobile-app-structure` conventions. Scope gated by O8.

**Tests:**

- Adapter unit + contract tests mirroring the Slack suite (parse of message /
  callback_query / my_chat_member; secret-token verify; send/edit receipts;
  degrade; 4096 split; bind token issue/consume/expiry).
- Ingress test for the per-bot path routing and the no-handshake behavior.

**Docs:** keep `takeover-*`, `capabilities-v2.md`, and the interface inventory in
sync when the contract gains the hosted-resolution step (O1) or the activate hook
(O2), per the `keep-docs-in-sync` rule.
