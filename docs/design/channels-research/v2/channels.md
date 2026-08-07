# Channels: the integrations

Everything platform-specific, in one place, so the other documents stay neutral.
All claims here are verified against official platform documentation; the few
that are not are marked. Working notes and citations are in `../scratchpad.md`.

---

## 1. Use cases, in one vocabulary

Written channel-neutrally so the same sentence means the same thing everywhere.

- **U1 — "In my DM it remembers everything."** One ongoing session per person.
- **U2 — "In my DM every message is independent."** Fresh session per message.
- **U3 — "Address it in the group; it answers in a thread that keeps context."**
  Addressed once to start, then no further addressing inside the conversation.
  The universal default — every vendor studied ships exactly this.
- **U4 — "In this space it hears everything."** Messages enter the session
  without addressing. Note it still only *answers* when addressed (D9).
- **U5 — "Each mention is its own task."** No accumulation.
- **U6 — "Let me start fresh."** A user gesture, not a timer.

**U3 is two settings, not one**: addressed at the space to start, unaddressed
within the conversation thereafter. A single invocation enum cannot express it.

## 2. What each channel can express

| | U1 | U2 | U3 unit | U4 | U5 | U6 |
| --- | --- | --- | --- | --- | --- | --- |
| Slack | yes | yes | `thread_ts` | needs `channels:history` | yes | no slash command in threads |
| Telegram | yes | yes | forum topics, else reply chain | privacy off + re-add, or bot as admin | yes | commands cannot scope to a topic |
| Discord | yes | yes | thread is a channel | needs Message Content intent | yes | slash commands work |
| Teams | yes | yes | thread id inside `conversation.id` | needs RSC consent | yes | no native gesture |
| WhatsApp | yes | yes | no unit exists | inherent | yes | text only |
| Linear | n/a | n/a | the issue; context pushed | n/a | yes | n/a |

## 3. Per channel

### Slack

**Containers** — four: DM (`is_im`), group DM (`is_mpim`, documented as an
"unnamed private conversation between multiple users"), private channel, public
channel. A thread is **not** a container: `thread_ts` is orthogonal to `channel`.
Slack Connect is a property of a channel (`is_shared`), not a fifth type.

**Addressing** — `@mention` is destroyed before delivery: the client rewrites it
into an opaque token. This is the reason a text sigil is needed at all, and it is
Slack-specific. The adapter declares `~` and `!`.

**Follow-ups** — `message.channels` with `channels:history` delivers *every*
message in the channel; you filter by `thread_ts` yourself. `app_mention` is
opt-in narrowing, not the only path. **There is no thread-scoped permission**, so
U3 and U4 need the same grant.

**Fill** — `conversations.replies`, same scope. The May 2025 rate-limit change
splits sharply by **how the app is registered**, and the split runs the opposite way
to what one might assume:

| app kind | `conversations.history` / `.replies` | `limit` max |
| --- | --- | --- |
| commercially distributed, not Marketplace-approved | **1 request/minute** | **15 objects** |
| internal customer-built | not impacted | — |
| custom | 50+ requests/minute | 1,000 objects |

So the crippled tier hits **a shared Agenta-distributed app**, not self-hosting
customers. A customer who registers their own Slack app — the bring-your-own-app
posture `architecture.md` §8 calls the genuinely strong story — gets 1,000 messages
per call at 50+ calls per minute. Backfill is comfortable there and awkward for us.

**Consequence for the declaration:** `backfill` limits are therefore **per
connection, not per channel**. The same Slack adapter faces a 66× difference in
page size depending on how the operator registered their app, which is D10's line
exactly — a capability we cannot know in advance, discovered from the install. The
adapter declares `backfill.supported: true` and core attempts it; the page size is
whatever that install allows.

So how much to ask for is **configuration**: `AGENTA_CHANNELS_BACKFILL_LIMIT`,
default **50**, clamped by the adapter to whatever the install permits. A short page
is a normal outcome, not an error (`capabilities.md` §fill).

*Deployment checklist for that variable* — the four places a new env var has to
land: the self-host configuration mdx docs, `.env.example`, the Helm values, and
the compose files.

**The case that matters works.** The bot has been in the channel for months, a
thread starts, three messages happen, then someone mentions it.
`conversations.replies` fetches that thread by its parent timestamp, gated by
scope and channel membership rather than by any per-message watermark — and the
bot was a member throughout. Nothing withholds those three messages.

**The narrow edge that is unverified** is different: messages predating the bot's
*invitation to the channel*. Dust documents those as inaccessible; the official
docs say neither way. It only bites when someone mentions the bot in an old
thread shortly after installing it, and it does not affect the ordinary flow.

**Reset** — slash commands **cannot be invoked in threads**: *"Slash commands
created by developers cannot, however, be invoked in message threads."* Only
built-ins and Giphy work there, and the slash payload carries no `thread_ts`. So
reset must be a text convention.

**Declaration** — the capability document this adapter answers with
(`capabilities.md`):

```json
{
  "channel": "slack",
  "protocol": { "versions": ["0.1.0"] },

  "addressing": {
    "sigils": { "agent": "~", "command": "!" },
    "mention": true,
    "commands": { "native": true, "in_conversation": false }
  },

  "spaces": { "private": true, "group": true, "topic": false },

  "conversation": { "units": ["thread", "space"], "default": "thread" },

  "fill": {
    "backfill":    { "supported": true, "requires_permission": "channels:history" },
    "forwardfill": { "supported": true, "requires_permission": "channels:history" }
  },

  "rendering": {
    "controls": { "update": true, "ephemeral": true },
    "buttons": { "supported": true, "max": 5 },
    "text": { "format": "markdown", "max_chars": 4000 },
    "files": {
      "send":    { "supported": true, "max_bytes": 1073741824 },
      "receive": { "supported": true, "max_bytes": 1073741824 }
    }
  },

  "identity": {
    "scope": "workspace",
    "stable": true,
    "keys": {
      "space":  ["team", "channel"],
      "thread": ["team", "channel", "thread_ts"]
    }
  },

  "commands": ["new", "sessions", "use"]
}
```

`spaces.topic` is `false`: Slack has no forum-style subdivision of a channel — the
only subdivision unit is the thread, already captured in `conversation.units`.
`buttons.max: 5` is the **legacy attachments** cap (`actions_max_length = 5`,
[Slack legacy interactive messages](https://docs.slack.dev/legacy/legacy-messaging/legacy-interactive-message-field-guide/)) —
current Block Kit `actions` blocks allow up to 25 interactive elements per block
([Block Kit reference](https://docs.slack.dev/block-kit/)). Which number belongs
here is itself unsettled, not just unconfirmed — see the table and the schema-fit
note below.
`text.max_chars: 4000` is Slack's documented **client-side recommendation** for a
plain message, not a hard server limit; the server disconnects above 16 KB of
raw payload, and Block Kit's own per-block ceilings are lower still (3000 for a
section block, 12000 for a single markdown block, 40000 total —
[truncating long messages](https://api.slack.com/changelog/2018-04-truncating-really-long-messages),
[`bolt-js` #2509](https://github.com/slackapi/bolt-js/issues/2509)). `files.max_bytes`
is 1 GiB (1,073,741,824) on every plan including Free — [Slack file size limits](https://filesize.org/limits/slack/) —
though the Free plan's 90-day *access* window is a retention fact, not an upload
cap, so it does not belong in this field.

| field | value used | why it is uncertain |
| --- | --- | --- |
| `rendering.buttons.max` | `5` | Two real numbers exist for "max buttons": 5 (legacy attachments, matches the schema's worked example) and 25 (modern Block Kit `actions` block). The declaration cannot express both without a version-scoped field — see *Where Slack does not fit the schema cleanly* below. |
| `rendering.text.max_chars` | `4000` | This is Slack's own *client-should-limit-to* guidance, not an enforced ceiling; the enforced ceilings (3000/12000/40000, byte-based 16 KB) are all different numbers again. Whichever the adapter actually renders against should be re-verified against the specific Block Kit block type it emits. |
| `identity.scope` | `workspace` | True for the common case. On **Enterprise Grid**, a user's id is a single global id shared across every workspace in the org ([Enterprise Grid apps](https://api.slack.com/enterprise/developing)) — `tenant`-like, not `workspace`-like. The schema's three-value enum (`global \| workspace \| tenant`) has no way to say "workspace-scoped normally, tenant-scoped under Enterprise Grid," so a Grid install may need a different declared value than a standalone workspace, which today's per-*channel* (not per-*install*) declaration cannot express. |
| history of messages predating channel invite | not modelled | `channels.md` already flags this as unverified by official docs (see above); it does not map to any capability field, since `fill.backfill.supported` is binary and this is a sub-case of "supported" that behaves like "not supported." |

**Where Slack does not fit the schema cleanly:**

- **`buttons.max` conflates two eras of one platform's own API.** The legacy
  attachments cap (5) and the current Block Kit cap (25) are not the same
  feature at two versions loosely — they are two live, independently-callable
  APIs today, and an adapter must pick one to build against. A single scalar
  `max` cannot represent "5 if you render this way, 25 if you render that way";
  the schema implicitly assumes one rendering surface per platform, which
  Slack does not have.
- **`identity.scope` is a per-install fact, not a per-channel one.** Whether a
  Slack workspace sits inside an Enterprise Grid changes what a user id means,
  but the capability declaration is fetched once per *channel* (`"channel":
  "slack"`), not per *connection*. The schema's model — one static declaration
  per platform — cannot express an identity scope that depends on which kind of
  install this particular connection is talking to.

### Telegram

**Containers** — `private`, `group`, `supergroup`, `channel` (broadcast, out of
scope). Forum topics are a flag on a supergroup (`is_forum`), not a distinct
type.

**Addressing** — text arrives unmodified; `MessageEntity` is offset/length
metadata over untouched text, so a sigil survives intact. But privacy mode's
pass-through list does **not** include bare mentions — only `/command@botname` —
so addressing here is effectively command-shaped.

**Follow-ups** — **free**. Privacy mode, enabled by default, still delivers
*"replies to any messages implicitly or explicitly meant for this bot"*. U3 works
with no permission change at all, which is the reverse of Slack.

**U4** — needs privacy mode disabled **and the bot re-added to existing groups**
for the change to take effect, or the bot made a group admin (admins always
receive everything). Both are meaningfully invasive.

**Fill** — **impossible**. No history method exists in the Bot API, confirmed by
exhaustive search. Worse, updates are not retained beyond 24 hours, so even the
forward buffer is capped. A bot added to an existing group starts from zero,
permanently.

**Units** — `ForumTopic.message_thread_id` is a genuinely stable identifier
assigned at topic creation (General is always `id=1`) and reused on every message
— structurally unlike Slack's `thread_ts`, which is a parent message's timestamp.
Enabling topics needs the `can_manage_topics` admin right, not Premium.

**Reset** — `BotCommandScope` has seven variants and **none address a topic**, so
the command menu cannot differ per topic even though a received command carries
its topic.

**Declaration** — the capability document this adapter answers with
(`capabilities.md`):

```json
{
  "channel": "telegram",
  "protocol": { "versions": ["0.1.0"] },

  "addressing": {
    "sigils": { "agent": "~", "command": "!" },
    "mention": true,
    "commands": { "native": true, "in_conversation": true }
  },

  "spaces": { "private": true, "group": true, "topic": true },

  "conversation": { "units": ["thread", "space"], "default": "thread" },

  "fill": {
    "backfill":    { "supported": false, "requires_permission": null },
    "forwardfill": { "supported": true, "requires_permission": null }
  },

  "rendering": {
    "controls": { "update": true, "ephemeral": true },
    "buttons": { "supported": true, "max": 100 },
    "text": { "format": "markdown", "max_chars": 4096 },
    "files": {
      "send":    { "supported": true, "max_bytes": 52428800 },
      "receive": { "supported": true, "max_bytes": 20971520 }
    }
  },

  "identity": {
    "scope": "global",
    "stable": true,
    "keys": {
      "space":  ["chat"],
      "thread": ["chat", "message_thread_id"]
    }
  },

  "commands": ["new", "sessions", "use"]
}
```

`fill.backfill.requires_permission: null` — not a missing value but the correct
one: there is no permission to name, since no history endpoint exists in the Bot
API at all (`channels.md` above; exhaustive search). `fill.forwardfill`'s
permission is also `null` here for a different reason — follow-ups arrive free
under default privacy mode (`channels.md` §Telegram), so U3 needs no grant, and
U4 needs privacy-mode-off plus re-adding the bot, which is an operator action on
the *group*, not a scope the Bot API exposes to name. `addressing.commands.in_conversation: true`
because a `/command` (unlike a bare mention) passes privacy mode's filter
regardless of where it is sent — but `channels.md` above already notes the
command menu cannot be scoped to a topic, so "works in conversation" and "can be
made topic-aware" are different claims.

`rendering.buttons.max: 100` is the **total inline-keyboard button count**, not a
per-row count: rows hold up to 8 ([Bot API 7.0 keyboard limits](https://core.telegram.org/bots/api)),
capped at 100 buttons across the whole keyboard, each with a `callback_data` payload
capped at 64 bytes. `text.max_chars: 4096` is the plain `sendMessage` limit; a
media **caption** is capped lower, at 1024 characters (4096 for Telegram Premium
senders) — a different ceiling for what is still "one message" from an adapter's
point of view, which the schema's single `text.max_chars` field cannot
distinguish by message shape. `files.max_bytes: 52428800` (50 MB) is the Bot
API's **upload** cap; **download** is capped lower, at 20 MB
([Bot API file limits, `tdlib/telegram-bot-api` #683](https://github.com/tdlib/telegram-bot-api/issues/683)) —
`files.receive`/`files.send` are booleans in the schema and cannot carry two
different byte ceilings for the two directions, so `max_bytes` here is stated
as the larger (send) number and the smaller receive ceiling is a fact the
declaration loses.

`rendering.controls.ephemeral: true` reflects **Bot API 10.2** (July 2026), which added
`receiver_user_id` and dedicated `editEphemeralMessage*`/`deleteEphemeralMessage`
methods for messages visible only to one user and the bot inside a group — see
the [Bot API changelog](https://core.telegram.org/bots/api-changelog). This is
very recent: most existing tooling and prior art still treats Telegram as
having no ephemeral concept, unlike Slack's long-standing `chat.postEphemeral`.
Flagged for re-verification since it postdates most secondary documentation.

| field | value used | why it is uncertain |
| --- | --- | --- |
| `rendering.controls.ephemeral` | `true` | Confirmed present in the Bot API 10.2 changelog, but this is a brand-new (July 2026) feature; behavioural detail beyond the changelog summary (e.g. exact `Message` shape, whether `sendMessage`'s ephemeral path supports the full render pipeline the way `postEphemeral` does on Slack) could not be confirmed against a stable reference. |
| `rendering.files.max_bytes` | `52428800` (50 MB, send) | The **download** ceiling is 20 MB, half the send number, and the schema has only one field for both directions. Whichever the adapter needs first should be re-checked against which side of the exchange is load-bearing. |
| `rendering.buttons.max` | `100` | Practically constrained by the 8-per-row visual limit before the 100 hard cap is ever reached; whether "max" should mean the hard API ceiling or the sane render ceiling is a modelling choice the schema does not disambiguate (same tension as Slack's two button caps). |

**Where Telegram does not fit the schema cleanly:**

- **`fill.backfill.requires_permission` has no non-null value to give**, because
  the capability itself is `false` — the field exists in the schema's shape
  regardless, and `null` is the only honest answer. This is not a Telegram
  problem so much as a schema shape that always allocates the field even when
  `supported: false` makes it moot; harmless here, but worth naming since it
  is the one platform where it is maximally moot (no history API, ever, by
  design — not merely unpermissioned today).
- **One `text.max_chars` cannot hold two real ceilings.** A plain message and a
  media caption are different limits (4096 vs 1024/4096-Premium) for what the
  schema treats as one `rendering.text` block. An adapter emitting a captioned
  photo needs the caption ceiling, not the message ceiling declared here — the
  declaration is silently wrong for that render path.
- **`files.max_bytes` is one field for two directions with different caps**
  (50 MB send / 20 MB receive) — the schema's `files.receive`/`files.send`
  booleans gate *whether* each direction works, but `max_bytes` is singular,
  so it can only describe one of the two faithfully.
- **Ephemeral visibility is genuinely new** and the schema's `rendering.controls.ephemeral`
  boolean has no way to note *when* a platform gained the capability — relevant
  here because an adapter written against Bot API < 10.2 would correctly declare
  `false`, and the declared value is a fact about the *adapter's* API version
  floor as much as the platform.

### Discord

**Containers** — everything is a channel, including threads, each with its own
snowflake and a `parent_id`. Forum posts are threads. Bots **cannot join group
DMs** at all.

**Addressing** — tokenisation fires only when the user picks from the `@`
autocomplete; freehand text is untouched. So a sigil survives.

**Follow-ups and fill** — both need the **Message Content intent**. Without it,
`content`, `embeds`, `attachments`, `components` and `poll` arrive empty except
for the app's own messages, DMs, messages mentioning it, and context-menu
targets. **Thread membership is not an exception**: a message in a thread the bot
created, without a mention, still arrives empty.

**Correction worth stating**, because the opposite is widely assumed: REST
history reads are **not** exempt. The intent applies *"across the APIs"*, so
`GET /channels/{id}/messages` paginates fine but returns empty content without
it. Its failure is therefore **silent** — a successful call with empty fields,
not a 403 — so the adapter must detect this itself.

Backfill also needs `VIEW_CHANNEL` and `READ_MESSAGE_HISTORY`.

**Escape hatch** — slash-command interactions deliver their typed options
regardless of the intent, so a `/ask agent:… prompt:…` flow works with no
privileged grant. Slack has no equivalent. Autocomplete is dynamic and not
confined to predefined choices, so an agent roster can be offered live.

**Limits** — 5 buttons per row, 40 components per message, 80-character labels,
100-character `custom_id`, select menus up to 25 options. Approval rendering is
unconstrained here.

**Declaration** — the capability document this adapter answers with
(`capabilities.md`):

```json
{
  "channel": "discord",
  "protocol": { "versions": ["0.1.0"] },

  "addressing": {
    "sigils": { "agent": "~", "command": "!" },
    "mention": true,
    "commands": { "native": true, "in_conversation": true }
  },

  "spaces": { "private": true, "group": false, "topic": true },

  "conversation": { "units": ["thread", "space"], "default": "thread" },

  "fill": {
    "backfill":    { "supported": true, "requires_permission": "Message Content Intent" },
    "forwardfill": { "supported": true, "requires_permission": "Message Content Intent" }
  },

  "rendering": {
    "controls": { "update": true, "ephemeral": true },
    "buttons": { "supported": true, "max": 5 },
    "text": { "format": "markdown", "max_chars": 2000 },
    "files": {
      "send":    { "supported": true, "max_bytes": 8388608 },
      "receive": { "supported": true, "max_bytes": 8388608 }
    }
  },

  "identity": {
    "scope": "global",
    "stable": true,
    "keys": {
      "space":  ["guild", "channel"],
      "thread": ["guild", "channel", "thread"]
    }
  },

  "commands": ["new", "sessions", "use"]
}
```

`spaces.private` is `true`: a bot can be DMed 1:1 by a user, the Discord
analogue of Slack's `is_im`. `spaces.group` is `false` for the opposite
reason — bots **cannot join group DMs** at all (`channels.md` above), so the
multi-person-DM container that `group` names for Slack (`is_mpim`) simply has
no bot-reachable Discord counterpart; an ordinary multi-user guild channel is
not "group" in this sense; it is the platform's baseline space, present
whether or not `group` is true. `spaces.topic` is `true`: forum channels are
a distinct channel type whose posts are threads (`channels.md` above), a
closer structural match to Slack/Telegram's `topic` than a plain thread is.

`rendering.buttons.max: 5` matches `channels.md`'s own figure directly (**per
row**, not per message — 40 components total across up to 5 action rows,
[Discord message components reference](https://discord.com/developers/docs/interactions/message-components)).
`text.max_chars: 2000` is the **bot/free-tier** message content cap; Nitro
raises the *user* client's compose limit to 4000, which does not apply to bot
tokens (`Message Create` schema, [Discord character limits](https://www.usecarly.com/blog/discord-character-limit/)).
An **embed** raises the usable ceiling further — 4096 characters in a single
embed description, up to 6000 characters summed across an embed's fields, up
to 10 embeds per message — a materially different (and higher) number for
what is still "one Discord message," not expressible in one `max_chars` field.

`files.max_bytes: 8388608` (8 MB) is the **bot-token upload cap**
([`discord-api-docs` #2037](https://github.com/discord/discord-api-docs/issues/2037)),
distinct from every user-facing number (10 MB free tier, up to 100 MB boosted,
500 MB Nitro — [Discord file size limits](https://www.usecarly.com/blog/discord-file-size-limit/)).
It is flagged below as the declaration's least-confirmed number: the source
is a long-open, unresolved feature-request issue rather than a current
reference page, and it is not clear whether server boosts still leave a bot
pinned at 8 MB or lift it along with everyone else.

`fill.*.requires_permission` names the **Message Content Intent** rather than
an OAuth scope — Discord's permission surface for this is a gateway intent,
declared in the bot's code and, past a user-count threshold, reviewed by
Discord, not a scope requested per-install the way Slack's `channels:history`
is. `rendering.controls.ephemeral: true` is the interaction-response `EPHEMERAL` flag
(`1 << 6`), bound to the interaction token's 15-minute lifetime — a much
shorter horizon than Slack's ephemeral messages, which persist for the
session (`channels.md` "Editing is not universal" §6 notes edit generally;
this is the same token-lifetime constraint applied to ephemeral specifically).

| field | value used | why it is uncertain |
| --- | --- | --- |
| `rendering.files.max_bytes` | `8388608` (8 MB) | The only bot-specific figure found is from a years-old, still-open GitHub issue against `discord-api-docs`, not a current reference page. Could not confirm whether it is still accurate today, or whether it has since been raised or tied to the guild's boost level the way the user-facing limit is. **Could not confirm.** |
| `identity.scope` | `global` | True today — Discord snowflakes are unique platform-wide with no per-guild variant, unlike Slack. No uncertainty found here; listed for contrast with Slack's Enterprise Grid caveat above. |
| `fill.*.requires_permission` naming | `"Message Content Intent"` | This is a **gateway intent name**, not an OAuth scope string — the schema's example (Slack's `channels:history`) is a scope. Whether the field is meant to hold a scope specifically or "whatever the platform calls its gate" is not settled by the schema text (`capabilities.md` §fill only says the field is "informational" and names "what an operator must grant"), so the Discord value follows that looser reading. |
| threshold for privileged-intent review | not modelled | As of June 2026 Discord switched this from a 100-*server* threshold to a 10,000-*user* threshold (`support-dev.discord.com`, "Changes to Privileged Intent Access for Discord Apps"). This is an operator/install fact (has this app been reviewed) rather than a channel capability, so it correctly has no field — flagged only because it is recent enough that older secondary sources still cite the 100-server number. |

**Where Discord does not fit the schema cleanly:**

- **`group` conflates two different Discord containers under one bit.** Slack's
  `group` names one thing (`is_mpim`, a multi-person DM), and Discord's schema
  value inherits that meaning — `false`, since bots cannot join those. But an
  ordinary multi-user guild text channel is *also* a multi-person space a bot
  answers in, and the schema has no way to say "the DM-shaped group doesn't
  exist for bots, but the channel-shaped one is the platform's default and
  entirely fine." `group: false` is correct for the field's Slack-derived
  meaning and reads as "Discord bots can't do multi-user spaces at all" to
  anyone who has not read this paragraph.
- **One `text.max_chars` cannot hold "plain vs. embed."** Exactly the Telegram
  caption problem, worse in degree: 2000 (plain) vs. 4096 per embed
  description vs. 6000 summed across one message's embeds are three different
  numbers for one message, and an adapter that renders progress as an embed
  needs a ceiling the declaration does not carry.
- **`files.max_bytes` is a bot-vs-user split, not a plan-tier split.** Slack
  and Telegram's file ceilings vary by *install* (org plan) or *direction*
  (send/receive); Discord's varies by **which kind of Discord actor is
  uploading**, a distinction with no other channel parallel and one the
  schema's single scalar was not shaped to carry.
- **`addressing.commands.in_conversation: true` undersells the escape
  hatch.** The schema field is a boolean, but Discord's actual advantage over
  Slack (whose equivalent field is `false`) is not just "works in a thread" —
  it is that slash-command *options* arrive as typed, structured data
  regardless of the Message Content Intent gate, which is a capability about
  *data shape bypassing a permission gate* that no field in `addressing` or
  `fill` names.

### Teams

**Containers** — `personal`, `groupChat`, `channel`. Reply chains are not
addressable: `replyToId` exists in the schema but is often unpopulated on
incoming activities; the thread id is encoded inside `conversation.id`.

**Addressing** — sidecar entities, but `activity.text` carries a literal
`<at>Name</at>` marker inline that the bot must strip itself. Everything else is
untouched.

**Follow-ups** — default is mention-gated, verbatim: *"agents in group chats and
channels only receive messages when they're directly @mentioned… your agent
doesn't receive a message when… someone replies to a message from your agent
without @mentioning it."* Fixed by RSC (`ChannelMessage.Read.Group`,
`ChatMessage.Read.Chat`), consented per-conversation by an owner rather than a
tenant admin. Personal scope needs nothing.

**Fill** — a **different permission surface** from live delivery: Graph
(`ChannelMessage.Read.All`, or `ChannelMessage.Read.Group` under RSC) has no
documented install-time cutoff, unlike RSC which is forward-only. Whether those
endpoints sit behind the Protected APIs approval process is unresolved.

**Constraints** — agents cannot post messages or Adaptive Cards in **private
channels** at all. Message size limit is 100 KB (not the 40 KB widely repeated).

**Reset** — no native gesture. Personal scope is one persistent conversation per
user-bot pair forever; every implementation is an app-level text route, with an
open feature request asking for better.

### WhatsApp

**Containers** — 1:1, plus a Groups API opened to Official Business Accounts in
June 2026: capped at **8 participants**, invite-link only, one business per
group, and **interactive messages are unsupported inside groups** — so approval
buttons cannot work there. Messages cannot be edited or deleted at all; there is
one endpoint, `POST /messages`.

**No unit** — the reply pointer is `context.message_id`. The `conversation.id` on
status webhooks is a **24-hour billing window**, not a thread.

**Identity is changing under us.** Business-Scoped User IDs arrive with optional
usernames: from April 2026 webhooks carry a `user_id` that is scoped to a
business portfolio, **regenerated when the user changes phone number**, and the
phone number stops appearing for username-enabled users absent recent contact. So
the identity key here is both portfolio-scoped and mutable, and needs a rebinding
path that no other channel does.

**Limits** — 3 reply buttons with 20-character titles; lists of 10 sections but
10 rows total.

### Linear

Not a messaging platform, but the strongest reference for how a surface *should*
behave.

**Sessions are first-class.** An `AgentSession` is created on mention or
delegation, and follow-up comments arrive as `prompted` events into the same
session — no re-addressing needed.

**Context is pushed, and precisely scoped.** The webhook carries `promptContext`
(issue details, comments, guidance), `previousComments` (*"the previous comments
in the thread before this agent was mentioned"*) and `guidance` — all **only on
`created` events, never on `prompted`**. That is exactly U3's fill semantics,
from the one platform that designed for it deliberately. The model to copy for
what a bridge inbound event should carry.

**Accountability by delegation** — assigning an issue to an agent makes it the
**delegate, not the assignee**, so the human keeps ownership. An alternative to
the per-user-credential model of D2.

## 4. Degradation

Capability is static; permission is dynamic (D10). Always attempt what the
capability allows, record failure per conversation.

| channel | trigger, best | trigger, degraded | backfill | forwardfill |
| --- | --- | --- | --- | --- |
| Slack | addressed once, then not | addressed every message | attempt; 403 means mention-only content | `message.channels` filtered by thread |
| Telegram | addressed once; replies free | **identical** | **never attempted** — no capability | privacy off; earlier messages lost forever |
| Discord | addressed once, then not | addressed every message; `/ask` still works | attempt; **empty content means failure** | live `MESSAGE_CREATE` |

Three things this exposes:

- **Telegram never fails at backfill because it never tries.** Capability, not
  permission.
- **Discord's failure is silent** — a successful call with empty fields. Adapters
  detect their own failure modes; core cannot.
- **Telegram's degraded case equals its best case.** Only U4 differs.

## 5. The grant means different things per channel

On Slack and Discord the broad grant unlocks follow-ups in a conversation — what
users actually want. On Telegram follow-ups are **already free**, so the
equivalent grant unlocks channel-wide ingestion instead, which most users do not
want.

Modelling it as one uniform "enable follow-ups" toggle would make Telegram
installs strictly more invasive than they need to be, for a capability nobody
asked for. The grant must be per channel, tied to what it actually enables there.

## 6. Cross-cutting observations

**Tokenisation is a Slack problem and only Slack's.** Every other channel preserves
arbitrary text. The sigil is a Slack workaround that happens to be portable.

**Visibility gating is near-universal.** Four of six gate by default, each
demanding a different action from a different person. This, not rendering, is the
binding constraint — which is why the capability declaration is inbound-first.

**Reset is a text convention everywhere.** Three of three channels with units cannot
scope a command to one. Dify, Coze and Lark all reached the same answer
independently.

**Identity scope splits the channels.** Workspace or tenant scoped on Slack and
Teams, globally unique on Telegram, Discord and email, and portfolio-scoped plus
mutable on WhatsApp. No single identity-key shape works everywhere.

**Editing is not universal.** Slack, Telegram, Discord and Teams can edit;
WhatsApp and email cannot. On a surface that cannot edit, a projection can only
append — which constrains how progress and approval-resolution render.
