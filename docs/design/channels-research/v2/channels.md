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
