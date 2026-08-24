# Channels: review scratchpad

Working notes from the review of `architecture.md`. Records cuts taken, the
reasoning, and what each cut deletes from the design. Not a rewrite of the
architecture — a running ledger of where the review lands, so the eventual
revision has a source.

Status: in progress. Sections marked OPEN are unresolved.

---

## 1. Cuts taken

### C1. Socket Mode and the egress-only posture — DROPPED

The design's §8 invariant 1 ("egress-only by default, no inbound ports for
self-hosted deployments") does not describe the platform. Verified in the
codebase:

- `POST /triggers/composio/events/` — public, auth-middleware-exempt,
  HMAC-verified with replay protection.
  `api/oss/src/apis/fastapi/triggers/router.py:120-127`; handler at 1557-1612,
  whose docstring reads "Public (no Agenta auth) — mirrors the Stripe events
  receiver."
- `POST /billing/stripe/events/` — same shape.
  `api/ee/src/apis/fastapi/billing/router.py:107-112`.
- Both listed in `_PUBLIC_ENDPOINTS`, `api/oss/src/middlewares/auth.py:52-79`.
- Both blanket-routed: nginx `location /api/`
  (`hosting/docker-compose/oss/nginx/nginx.conf:38-49`) and traefik
  `PathPrefix('/api/')` (`hosting/docker-compose/ee/docker-compose.gh.yml:90-95`).
  No path-level carve-out.
- Decisive: `api/oss/src/core/triggers/utils.py:20-24` branches on whether
  `AGENTA_API_URL` is a real `https://` URL. If it is, Composio registers that
  public URL and POSTs inbound over the internet. The WebSocket bridge
  (`api/entrypoints/dispatcher_composio.py`, `subscription.wait_forever()`) is a
  localhost-dev substitute — `_DUMMY_HTTPS_URL = "https://example.com/"` is the
  tell — not the production mechanism.

Any self-hoster running triggers has already opened a port. Selling egress-only
as a channels security headline would be incoherent. §8 invariant 2 (bring your
own app) is the defensible claim and does not depend on it.

Socket Mode is pushed back indefinitely — not "optional for dev".

### C2. The separate always-on gateway service — DROPPED

§3 justifies a dedicated service on two pillars, both removed:

1. "Someone has to hold those connections open around the clock" — void with C1.
2. "The gateway carries per-conversation queues that want one owner" — void with
   C3.

Shape instead: **ingress endpoint(s) in `api`, inbox worker(s), outbox
worker(s)**. This is the five-step pattern §2.5 already identifies in the
Composio receiver: verify signature, 202 immediately, write the inbox row, work
off the hot path. Workers already exist in the deployment topology
(`worker-streams`, `worker-queues`); no new container.

### C3. The queue moves to the runner — SEPARATE WORK PACKAGE

Distinguish two things the design conflates:

- **Mailbox** — per-conversation inbox state in the channels domain: which
  external events belong to this conversation, dedup, status. Channel-specific.
  Stays.
- **Queue** — the ordering discipline for submitted inputs against a running
  turn. Belongs to the runner.

Today `/sessions/streams/` returns 409 `SessionTurnInUse` on overlap, which
forces every caller to invent backpressure; §5 step 5's gateway mailbox is that
compensating hack. AHP puts the queue in the host as chat state
(`queuedMessages`, `steeringMessages`): when a turn completes and
`queuedMessages` is non-empty the server itself dispatches
`chat/pendingMessageRemoved` then `chat/turnStarted`; steering messages are
consumed mid-turn at the server's discretion. Clients submit; the host
sequences. See `docs/specification/chat-channel.md` in
microsoft/agent-host-protocol.

Not channels-specific — the web app hits the same 409.

**Dependency:** the channels ingest package depends on *some* answer to
turn-in-use. 409-retry is the degenerate answer that lets it be built
independently: on 409, leave the event in the inbox and retry when
turn-completed lands. Deletable when the runner package lands; nothing else in
channels changes.

Two constraints so this does not rot into permanent scaffolding:

- The inbox worker retries on 409 and does nothing else. No coalescing, no
  steer-vs-queue decisions — those are the runner's, and building them
  channel-side is what makes the runner work never happen.
- Event-driven retry needs a turn-completed signal, so the event-bus work is
  load-bearing for ordering, not only for approvals.

Cost of the degenerate answer, stated plainly: strict serialization. Three quick
corrections become three turns; a mid-turn "wait, stop" waits. Both are fixed by
the runner package.

### C4. Session lifetime / idle TTL — DROPPED (overrides D5)

D5 ("session lifetime is configuration") permits exactly the behavior being
rejected. The policy is binary: **always reuse** or **always new**. No timers,
no generations, no silent forking of a thread into generation 2.

Deletes:

- `channel_bindings.session_idle_ttl`
- `conversation_links.generation` and the `(binding_id, native_key, generation)`
  unique constraint. §4.4 justifies `generation` *entirely* as the
  implementation of idle expiry.
- `status = 'expired'` on conversation links.

The two settings are different products, not two values of a knob:

- **always reuse** — the conversation continues, context accumulates. The
  thread-as-session model.
- **always new** — every invocation is a fresh session. The trigger/automation
  shape: ask, answer, no memory.

Side effect worth noting: §4.4's "many links may point at one session" (the
cross-surface continuity door) is coherent under always-reuse and meaningless
under always-new. The policy makes that explicit instead of leaving it implied.
Under always-new, `conversation_links` is close to vestigial — more evidence for
the objection in §3 below that the table carries a Slack-shaped model only one
policy needs.

### C5. Interactions as a separate concern — DROPPED, both directions

Verified: an interaction is already an ordinary event on the response stream,
and its answer is already an ordinary inbound message.

**Outbound — it is a stream event like any other:**

- `interaction_request` / `interaction_response` are first-class members of the
  `AgentEvent` union, alongside `message` and `tool_call`:
  `services/runner/src/protocol.ts:419-432`.
- The pause handler emits it onto the same stream as everything else:
  `services/runner/src/engines/sandbox_agent/acp-interactions.ts:216-226`.
- `liveEmit` writes *every* emitted event to the NDJSON response unconditionally:
  `services/runner/src/server.ts:1091`.
- The same events persist as records with `record_type: event.type`:
  `services/runner/src/sessions/persist.ts:374-392`.
- The parked turn is just another frame: `{type: "done", stopReason: "paused"}`,
  `protocol.ts:456`.
- The web app proves the intent — it builds the entire approval UI by switching
  on `record_type` from the stream
  (`web/oss/src/components/AgentChatSlice/assets/transcriptToMessages.ts:199-260`).
  The interactions REST endpoints are consumed only by the SessionInspector
  debug panel. Explicit comment at
  `web/packages/agenta-entities/src/session/api/api.ts:97-100`: "NOT as the
  render source (the record renders the question; interactions hold the
  answer-state)."

**Inbound — the answer is a normal message:**

- Matching is by `toolCallId`, not by interaction id: `responder.ts:368-383`
  scans the inbound message history for `tool_result` blocks carrying an
  `{approved: boolean}` envelope and keys them by tool call.
- The runner then resolves the row itself: `run-turn.ts:907-910` →
  `resolveInteractionToken` (617-642) → `resolveInteraction`
  (`services/runner/src/sessions/interactions.ts:115-139`), POSTing
  `/sessions/interactions/transition` to `resolved`.
- `respond_interaction` (`api/oss/src/apis/fastapi/sessions/router.py:857-925`)
  is never called by the runner — it is the separate out-of-band path.
- The `tokens` exemption on cancel-stale exists precisely to protect
  in-band-answered gates:
  `api/oss/src/dbs/postgres/sessions/interactions/dao.py:166`.

The interaction row is bookkeeping the runner maintains. Channels needs nothing
interaction-specific in either direction.

Deletes from the design:

- `source_type: 'interaction'` in the deliveries table (§4.5).
- The whole §6.3 five-step approval path as a distinct mechanism.

**Correction — this cut was initially overstated.** An earlier version of this
note also deleted the `SESSIONS_INTERACTIONS_CREATED` event and "build-plan step
1's approval-delivery justification". That was wrong. The first-pass design was
right that events must be published: §6.3 names *"the two event types this design
adds… the other is turn-completed"*, and build-plan step 1 is
*"Session and interaction event types on the event bus"*, sized at days and
listed first precisely because it unblocks *"push-based approval and
turn-completion delivery to any surface"*.

C5's finding is narrower than deleting that. It says interactions need no
*separate* event from turn completion, because an interaction already travels as
an ordinary record. So **the two event types collapse into one, not zero** —
session events carrying records. Publishing remains required, and detached invoke
(v2 D22) makes it the design's one hard dependency.

Survives on its own merits, as a property of the out-mapping rather than an
approvals subsystem: the card must render from the recorded tool call, never
from model-composed text (prompt injection).

Remaining channels-side concern is not about interactions: authorizing the
click — may *this* user produce that approval message. Same identity check every
inbound message needs, different consequences. A policy question on the
in-mapping.

Note: `delivered_webhook` exists as a flag in the `flags` JSON column
(`api/oss/src/core/sessions/interactions/dtos.py:48-50`), not a SQL boolean.
Nothing sets it; the runner sets only `delivered_in_band`. With push-delivery
dropped there is no reason to revive it.

---

## 2. The reframing

The system is **two mappings**, not a pipeline of subsystems:

- **external event in → internal message in** — a message, a button click, an
  emoji, a slash command. All become an inbound message on the session. A click
  carries the approval decision as content; it is not a special code path.
- **internal event out → external event out** — assistant text, tool activity,
  the interaction request, the paused `done`. All are frames on the stream; the
  mapping renders whichever ones the surface cares about.

The capability descriptor (§6.2) is the **configuration of those two mappings**,
not a separate rendering subsystem.

Sender information is stamped when the external event is turned into an internal
message — there, and nowhere else.

### AHP as the reference for the runner side

`microsoft/agent-host-protocol`, `docs/specification/`. Relevant beyond the
queue:

- **`chat/inputRequested` → `chat/inputAnswerChanged` → `chat/inputCompleted`**
  is the elicitation primitive, and it streams answer *drafts* to other clients
  — which is what "two people looking at the same approval card" wants.
- **Session ⊃ chats.** AHP splits session (workspace, working directories,
  lifecycle) from chat (one conversation thread, turns). Our model conflates
  them: one `session_id` per thread. Bears directly on the
  `conversation_links` objections — a channel could be a session with each
  thread a chat, rather than minting an unrelated session per thread and
  papering over the relationship.
- **Terminology collision.** AHP uses "channel" for protocol channels
  (`ahp-session:/`, `ahp-chat:/`). Ours means Slack/Telegram. If we align, we
  need a different word — *surface* is already used throughout the design.

---

## 3. Open threads

Review comments on `architecture.md` not yet worked through.

### OPEN — connections and bindings cardinality (comments at 257, 268, 313)

Three statements that do not fit the design's model:

- "Only one connection per Slack application."
- "Possibly many agents per Slack application."
- "Each agent can be accessed via possibly many paths."

The design assumes one app = one agent (D3) and hangs `channel_bindings` off
that. The alternative separates the app (a connection, one per Slack
application) from the *paths* by which agents are reached through it. Not a
rename — a different cardinality. It also explains the objection to
`channel_scope_grants` as a separate table: if a path already carries "where
this is reachable", grants may be a property of the path rather than a sibling.

Collides with D3 head-on. D3 came from the review of `early-findings.md`: "An
app = one bot only is the correct model. But you need the ability to create
multiple apps and assign them to multiple bots." That reads the app as an
*identity*; "many agents per app" reads it as a *transport*. A genuine
disagreement, upstream of the whole data model.

#### How Dust does it (source-verified, `dust-tt/dust`)

Relevant because the gateway-bot shape is Dust's, and the disambiguation *is*
the UX. From `connectors/src/connectors/slack/bot.ts` and
`connectors/src/lib/bot/mentions.ts`:

```js
/^\s*([+~=][a-zA-Z0-9_\.-]{1,40})(?=\s|,|$)/
```

- `=agent` — exact match only, hard error if no match.
- `~agent` / `+agent` — fuzzy match (Jaro-Winkler) against active agent names;
  always returns the closest, never errors on a typo. `=` is the escape hatch.
- Names `[a-zA-Z0-9_.-]`, max 40 chars, no spaces. One agent per message; a
  second mention errors.
- **`@` is deliberately excluded.** Slack's client autocompletes `@name` into
  `<@U01J9JZQZ8Z>` before the event reaches the webhook, so literal
  `@agentname` either collides with a real human of that name or never survives
  as text. `~`, `+`, `=` have no autocomplete behavior and pass through intact.
  A platform constraint, not a taste preference — any design routing via `@` is
  broken before it starts.

Resolution order when no sigil is present:

1. Per-channel binding — `SlackChannelModel.agentConfigurationId`, set in the
   admin UI (`front/components/agent_builder/settings/SlackSettingsSheet.tsx`).
2. Hardcoded fallback — `DEFAULT_AGENTS = ["dust", "claude-4-sonnet", "gpt-5"]`,
   first active wins.

Plus a third mode: `autoRespondWithoutMention` per channel (feature-flagged) —
the bot answers every message with no mention at all.

**Threads inherit by conversation, not by re-resolution.** A follow-up looks up
the most recent `SlackChatBotMessageModel` for that `threadTs` and reuses its
`conversationId`; the agent is not re-parsed. A mid-thread sigil *can* switch
agents.

Gumloop contrast confirms the other shape: "Each custom Slack app credential can
only be assigned to one Gummie agent." N identities = N Slack apps.

#### What this implies for the model

A path is not a stored row per route — it is a **resolution chain** ending in an
agent, with four stacked mechanisms (explicit sigil → per-channel binding →
auto-respond channel → fallback), which thread continuation bypasses entirely by
inheriting the conversation.

So the question is not "how many bindings per connection" but "what is the
resolution order, and which steps are stored vs. parsed". Per-channel binding is
real stored state (Dust has exactly this: a channel row carrying agent id +
auto-respond flag — close to the "grants are a property of the path"
intuition). The sigil route is parse-time; no row per agent-reachable-via-app.
One-app-one-agent is then the degenerate case: a connection whose fallback is a
fixed agent and whose sigil parsing is disabled.

#### OPEN — is routing platform-specific?

Partly, unavoidably. Dust's sigil choice is a workaround for a Slack-specific
escaping behavior, and has no reason to be right elsewhere. Discord has native
application commands with typed options and server-side autocomplete — parsing
`~agentname` from text there would be strictly worse than the platform's own
mechanism.

Separate two things:

- **How the target is expressed** — sigil, native command, per-channel config,
  picker. Platform-specific, bounded by what each platform lets a bot receive
  and render.
- **What it resolves to** — an agent, plus the order when nothing is expressed.
  Platform-independent.

The in-mapping extracts a *routing intent*; the core owns the chain that turns
intent into an agent. Platform-shaped at the edge, uniform inside.

#### Per-platform findings

All six platforms are primary-source verified (Slack via the Dust source read,
the rest against official platform docs). Numeric limits noted as
community-sourced below are the exceptions.

**Tokenization is a Slack problem, and only Slack's.**

- Telegram — `MessageEntity` is pure offset/length metadata over *unmodified*
  text. Even Telegram's own `@username` mentions leave the literal text intact.
  A `~agentname` arrives with no entities over it, fully parseable.
  `core.telegram.org/bots/api#messageentity`
- Discord — tokenization fires *only* when the user selects from the `@` picker.
  Freehand text (including `@nonexistentname` typed and sent without selecting)
  stays literal. More favorable than Slack, where rewriting is server-side
  regardless of user intent.
- Teams — sidecar entities, but `activity.text` carries a literal
  `<at>DisplayName</at>` marker inline. Everything else is untouched; the docs
  tell bots to strip the `<at>` span themselves.
- WhatsApp, email — no tokenization construct exists at all.

So a uniform sigil is mechanically possible everywhere except Slack, and Slack's
own workaround (a non-`@` sigil) works everywhere too. **The real blocker is
visibility, and four of six platforms gate it by default:**

- **Telegram privacy mode**, default *enabled*: the bot receives only
  `/command@bot`, replies to its own messages, and @-mentions. Self-service
  toggle via BotFather `/setprivacy` — but **the bot must be re-added to existing
  groups** for the change to take effect. An operational wart for existing
  installs. `core.telegram.org/bots/features#privacy-mode`
- **Discord Message Content privileged intent**: without it, `content`,
  `embeds`, `attachments`, `components` arrive **empty**, except for the app's
  own messages, DMs, messages mentioning the app, and message-context-menu
  targets. Self-enable under 100 servers; review-gated above.
  `docs.discord.com/developers/events/gateway`
- **Teams**: default mention-gated in channels and group chats — and a reply to
  the bot's own message *without* re-mentioning does **not** reach it. Opt-in
  firehose via Resource-Specific Consent (`ChannelMessage.Read.Group`,
  `ChatMessage.Read.Chat`), granted by a conversation owner at install.
- **WhatsApp**: no general group model to be visible within (see below).

Only Slack (with the right scopes) and email deliver unconditionally.

The sigil *syntax* can be uniform; the "can the bot see it at all" precondition
cannot. Each gated platform demands a different operator action — toggle a
BotFather setting and re-add the bot, get a privileged intent approved, have a
conversation owner consent. That is setup UX and a support burden, per platform
and per install, not an implementation detail.

**Threading strength varies more than expected.**

- Discord — strongest of the chat platforms: a thread *is* a channel with its
  own globally-addressable snowflake plus `parent_id`.
- Email — strongest overall in principle: RFC 5322 `Message-ID` / `In-Reply-To` /
  `References`, content-addressed rather than platform-assigned. Interop wrinkle:
  some hops mangle `References`, and Gmail falls back to subject matching.
- Teams — `conversation.id` plus `replyToId` (points at the parent activity)
  rather than one flat root key. Channel-scoped and explicitly *not* guaranteed
  globally unique per the Bot Framework IDs guide.
- Telegram — weak: `message_thread_id` exists *only* in forum-enabled
  supergroups and is meaningful only relative to `chat_id`. Plain groups and DMs
  have no thread concept; continuity means walking `reply_to_message` yourself.
- WhatsApp — essentially none. Reply-context (`context.id` → wamid) only; the
  "conversation" in their docs is a 24h *billing* window, and Meta is moving to
  per-message pricing, so even that is receding.

**WhatsApp is not purely 1:1 — but the group case is nearly unusable.** The
Groups API opened to all Official Business Accounts on **16 June 2026**
(`recipient_type: "group"`, webhooks carry a real `group_id`), but it is capped
at **8 participants**, invite-link-only, one Cloud API business per group, and
**interactive messages are unsupported inside groups** — as are message edits and
deletes. So group + approval buttons is structurally impossible there, not merely
awkward.

The 1:1 reply pointer is `context.message_id` (not `context.id`). Note also that
outgoing *status* webhooks carry a `conversation.id`, but it is the 24h
billing-window identifier, not a thread id — do not mistake it for a container.

**Editing is not universal**, which bears directly on deliveries-vs-sync below:
Slack, Telegram, Discord, Teams can edit (Teams via `UpdateActivity`, documented
as a per-channel capability that may throw where unsupported); **WhatsApp and
email cannot**. WhatsApp has exactly one endpoint, `POST /messages` — no PATCH,
no delete. On a surface that cannot edit, a projection can only ever append.

Two corrections to claims made earlier in this review:

- **Telegram's "48-hour edit window" appears nowhere in the official Bot API
  docs.** It traces to a 2019 marketing tweet about the consumer client.
  `editMessageText` has no documented time limit.
- **Gmail's "Undo Send" is a 5/10/20/30s pre-dispatch cancellation window**, not
  a retraction. Email remains immutable once delivered.

**Identity scope splits the platforms**, bearing on the 422 comment:

- Workspace/tenant-scoped: Slack, Teams (Channel Account ids are explicitly
  documented as meaningful only within their channel; Entra object ids are
  tenant-scoped). The team/tenant id must be part of the identity key.
- Globally unique: Telegram (`user.id`), Discord (snowflake), email (address —
  the strongest guarantee of the six, by DNS construction).
- **WhatsApp is changing under us.** Optional usernames arrive in 2026 with
  **Business-Scoped User IDs**: from April 2026 webhooks carry `user_id`
  (`US.13491208655302741918`), which is **scoped to a business portfolio**,
  **regenerated when the user changes phone number**, and the phone number
  **stops appearing in webhooks** for username-enabled users absent recent
  contact. So WhatsApp identity is becoming portfolio-scoped *and* mutable —
  worse than Slack's workspace-scoping, because the key can change under an
  existing link. Any identity-linking design needs a rebinding story for it.

So embedding the team id in the `method` string is right for Slack and Teams,
pure noise for Discord and Telegram, and insufficient for WhatsApp. The identity
key must be per-platform-shaped, not one format.

**Native command mechanisms are a complement, not a replacement.** Discord
application commands give typed options with dynamic autocomplete (explicitly
"not confined to only use choices given by the application") — genuinely better
than sigil parsing for *explicit invocation*. But they solve "invoke an agent",
not "mention an agent inline within flowing text", they require pre-registration,
and global propagation is not instant (read-repair exists; the ~1h figure is
community-sourced). Telegram's `setMyCommands` is a discovery menu only;
arguments stay free text. Teams splits the two: manifest-declared slash commands
insert the command name as **plain text** for the bot to parse, while genuinely
typed parameters exist only via message-extension action commands (a modal
dialog, not inline text). WhatsApp and email have nothing.

Slash commands do remain a way to sidestep the Message Content gate on Discord,
since an interaction payload delivers its typed options directly rather than as
message content. But note this is *not* a general escape hatch: REST history
reads are **not** exempt (see §4.9), because the intent applies "across the
APIs", so only the command's own arguments arrive intent-free.

**Multi-persona from one registration**: Discord webhooks support per-message
`username`/`avatar_url` override; Slack has icon/username override on
`chat.postMessage` for some token types; email's `From` display name is free-form
per message. Telegram, WhatsApp and Teams cannot — identity is fixed to the
registration (WhatsApp's display name is number-bound and Meta-reviewed, max 10
changes per 30 days; Teams is one App ID per bot). So "one app, many visibly
distinct agents" is not universally available either.

#### Consequences for the model

- **The capability descriptor is inverted.** §6.2 frames capabilities as an
  *outbound rendering* concern — threads, edits, buttons, max length. The harder
  constraint is **inbound**: whether the bot can see a message at all, and what
  the operator must do to make it so. Four of six platforms gate this by default,
  each demanding a different provisioning step. That belongs in the descriptor,
  and it is user-visible setup rather than a rendering difference.
- **The Dust gateway-bot shape is not universally available.** One app fronting
  many agents is natural on Slack and Discord, available-but-gated on Telegram
  and Teams, and effectively unavailable on WhatsApp and email (routing there is
  answered by which number/address was contacted, or by a router agent
  dispatching in-model). Both shapes must exist, and *which are available* is a
  platform property.
- **Thread-as-session presupposes the bot receives follow-ups.** Where a bot only
  sees messages mentioning it, thread continuation needs either the mention every
  time or an elevated permission the operator must provision.
- **Where threading is absent (WhatsApp), always-new may be forced by
  construction** — the C4 policy question resurfacing as a platform constraint
  rather than a preference.

### RESOLVED — `conversation_links` shape (comments at 334, 376) — see §4

Slack-specific concepts (workspace, channel, dm, topic) should not be root
columns. A type-namespaced key plus a type-specific JSONB is cleaner. Same
objection applies to the inbox table.

Addressed by `bus_links` (§4.0, §4.1 layer 4): an opaque unit value plus a typed
locator in JSONB, with the grain set by `session_scope` rather than pinned to
`thread`. The AHP session⊃chat split turned out not to be needed to fix this —
the session-scope enum (§4.2) covers it.

### OPEN — deliveries vs synchronizations (comment at 413)

"That's because these are not deliveries but synchronizations." The design's
`channel_deliveries` models one-way sends with receipts; the objection is that
what is actually happening is bidirectional state synchronization.

### OPEN — subject and team scoping (comment at 422)

Why is the team id not part of the `subject`? The design embeds it in the
`method` string (`channel:slack:T0424242`) with the bare user id as subject.

### RESOLVED — the `sender` field (comment at 528) — it does not land

Attribution splits cleanly in two, and neither half needs a `sender` field:

- **The displayed part is formatting**, done in the external→internal mapping.
  `"Alice: ship v2"` composed by the adapter at the boundary is content, not
  metadata. The design treats prefixing as an interim hack pending a real field;
  it is the permanent answer.
- **The structured part is `created_by_id`**, already recorded on the turn
  (§2.1). Who invoked is captured today.

Private sessions later would mark the session stream private and restrict
interaction to `created_by_id` — still no `sender` needed.

This deletes build-plan step 7 ("1–2 weeks: `sender` on wire, storage, replay,
web UI") and revises D6, which listed the field as one of exactly two remaining
gaps. Cost: the model sees `"Alice: ..."` as text rather than structured
metadata, and the web app cannot render speaker chips for bus messages.
Reversible if it ever matters.

### OPEN — batch vs stream (comment at 532)

If batch is the default for messaging surfaces, stream must be genuinely
selectable and functional, not vestigial.

---

## 4. The counter-model

Naming note: `bus_` is a placeholder prefix, chosen because `channel_` collides
with "channel" as the external thing (a Slack channel, a Telegram group). It
reads as message-broker infrastructure, which is wrong, and should be revisited.

```text
bus_connections    -- 1:1 with the external app registration
bus_agents         -- 0..N addressable agents, by slug
bus_grants         -- agent x channel allowlist; no rows = unrestricted
bus_channels       -- private | group | topic; where it may answer, and the rules
bus_links          -- resolved external<->session correlation
bus_inbox_events   -- per connection; dedup on the platform's external id
bus_outbox_events  -- per connection; idempotency key + receipt
```

`bus_links` was `bus_conversations`; `bus_streams` is unavailable because
sessions already have a streams facet (the turn-coordination plane behind
`POST /sessions/streams/` and the 409 `SessionTurnInUse`), and this row points
*at* a session that has one. The row is a correlation, not the conversation
itself — the session is that.

**Note: this is seven tables, not fewer than the design's six.** What the
counter-model reduces is the *cross product* (3 agents in 5 channels is 8 rows,
not up to 15) and null-column pollution, not the table count. An earlier claim
in this review that it was "fewer tables" was wrong.

### 4.0 What each table is, and is not

**`bus_connections`** — one row per external app registration (a Slack app, a
BotFather bot, a Discord Application, an Azure Bot, a WhatsApp number on a WABA).
Holds the credentials and the platform identifiers. It is *not* an identity for
an agent, and carries no routing policy: the app is a transport.

**`bus_agents`** — the roster of agents this connection can reach, each with a
slug used for addressing. The row with a null slug is the default. It is *not* a
copy of the agent — it is a reference plus its addressing config. It does not
say where the agent may answer.

**`bus_grants`** — restricts an agent to a subset of the connection's channels;
no rows for an agent means unrestricted. Designed to grow per-pair policy
columns later (§4.4). It is *not* the design's `channel_scope_grants` — that one
is `bus_channels`.

**`bus_channels`** — the places this connection may answer, `private | group |
topic`, with the rules for each (invocation triggers enabled, session scope and
policy, optional default agent). Default-deny: no row, no answer. It is *not*
about which agent — only where, and how.

**`bus_links`** — resolved correlations between an external thing and a session,
at whatever grain `session_scope` names. 1:1 under `reuse`, 1:N under `new`. It
is *not* the conversation (the session is), and *not* a message log.

**`bus_inbox_events`** — what the platform said, recorded before interpretation,
keyed `(connection_id, external_event_id)` so redeliveries die on arrival. It is
*not* a queue, and *not* per-agent: at insert time no agent is known.

**`bus_outbox_events`** — what we owe the platform, after all interpretation:
content, destination, idempotency key, and the receipt (`native_message_id`)
needed to edit later. It is *not* a queue either; ordering that matters belongs
to the runner (C3).

### 4.1 The four layers

**Layer 1 — the external app is a connection (1:1).** "The one thing you set up"
is concrete and different per platform, but the cardinality holds everywhere:

| Platform | What you register | What the connection holds |
|---|---|---|
| Slack | a Slack app in a workspace | bot token, signing secret, team id |
| Telegram | a bot via BotFather | bot token (the identity *is* the token) |
| Discord | an Application + bot user | bot token, app id, public key |
| Teams | an Azure Bot registration + Teams app manifest | app id, secret, tenant |
| WhatsApp | a phone number on a WABA | phone-number id, WABA id, token, verify token |

**Layer 2 — the connection fronts agents (0..1 default, 0..N addressable).**
The app is a **transport**, not an identity. Agents are distinguished by slug,
with exact and search match modes (Dust: `=slug` exact, `~slug`/`+slug` fuzzy,
absent → default).

**The default is a `bus_agents` row with a null slug**, not a column on the
connection. This was arrived at by eliminating the alternatives, because having
defaults definable in two places is a real smell:

- A default column on `bus_connections` plus roster rows means two definition
  paths for the same thing, and the default cannot carry the config a roster
  agent can (grants included).
- It also forces channels-domain columns (`default_agent_ref`) onto the
  connections table — precisely the drift warned about at comment 257 if
  `gateway_connections` is reused.
- A null-slug row gives one table, one shape, one resolution path: match the
  parsed slug; if nothing was parsed, take the null-slug row. Uniqueness is one
  null-slug row per connection.

**The sigil is declared per bus type, not per connection and not by the user.**
Which character — or whether text sigils are used at all — is a property of the
platform, declared once by its adapter: Slack's declares `~` because `@` is
destroyed by autocompletion; Discord's declares typed commands instead. Every
Slack connection gets the same sigil; nobody picks one per app. It sits in the
capability declaration alongside `threads` and `message_update`, so the sigil
appears **nowhere in the data model**, and **`bus_connections` needs no
channels-specific columns** — which dissolves the reuse-`gateway_connections`
question rather than answering it.

The degenerate case is the same schema, not a fork: one agent means an empty
roster apart from the null-slug default, and sigil parsing that resolves nothing.
That is what lets the Dust gateway-bot shape and the Gumloop one-app-one-agent
shape coexist without branching. See the Slack thread in §3 — both are wanted.

**Layer 3 — the connection answers in channels.** Scope is `private | group |
topic`, where a **topic** is a named persistent place with membership
independent of the conversation (Slack channel, Discord guild channel, Teams
channel, Telegram supergroup) and a **group** is an ad-hoc set of people with no
independent identity (Slack mpim, group DM, Teams group chat, WhatsApp group).
The distinction is real: a topic outlives its participants, a group *is* its
participants. One-way broadcast setups are out of scope.

Rules default on the connection and are overridable per channel row. Everything
platform-varying is **capability-gated, never hardcoded** — including the
conversation unit, since `thread` is not offerable where the platform has no
stable thread key (Telegram DMs, WhatsApp, email). This kills the design's
`session_scope` being pinned to `'thread'`, which is false for three of five
platforms.

**Layer 4 — resolved correlations.** `bus_links` keyed by
`(channel row, unit value)` where the unit value is opaque — a `thread_ts`, a
channel id, a user id — with the typed locator in JSONB. No platform-shaped root
columns, which answers the 334/376 objection.

### 4.2 Session scope is one enum, not two

The comment at 364 ("this requires a field for 'all paths reuse session' or
'each path uses new session'") and C4 (always reuse / always new) look like two
axes — a *grain* and a *reuse policy*. They are not orthogonal, and modelling
them as two variables is a mistake: **`new` makes grain irrelevant.** If a
session is never reused, the level at which you are not reusing it carries no
information. `channel × new` and `conversation × new` are the same behaviour.

So it collapses to one enum over the grains that actually differ:

`session_scope`: `connection` | `channel` | `conversation` | `message`

| value | behaviour |
|---|---|
| `connection` | one session for the whole app, ever |
| `channel` | one ongoing session per place |
| `conversation` | one per thread where the platform has them, else per place |
| `message` | a fresh session per message — this *is* always-new |

`conversation` is the finest grain the platform offers and is therefore
capability-declared (no thread key on Telegram DMs, WhatsApp or email, where it
degenerates to `channel`). `message` is the trigger/automation shape.

`bus_links` holds resolved instances at whatever grain the enum names — which is
why "link" works as a name where "conversation" did not: a correlation at the
configured scope, not necessarily a conversation. Cardinality follows: **1:1**
for the reusing scopes (get-or-create, `session_id` never changes) and **1:N**
for `message` (insert per message). So there is no unique constraint on
`(channel, unit value)` — reuse is enforced in the resolution path, not by the
schema. Under `message`, the rows for one key are the history of every session
that external thing produced, which is what the design's `generation` column was
groping toward without pretending it is one conversation.

An enum, not a flag, per Agenta convention.

**Where it lives:** on `bus_channels`, since it is plausibly different per place
(an ongoing project topic wants `conversation`; a support intake wants
`message`). It cannot default from `bus_connections` — that table holds no
channels-specific columns (§4.1) — so the default comes from the adapter's
capability declaration and the channel row overrides it. Unconfirmed.

### 4.3 Routing reads, it does not store

Routing is a **resolution chain**, not a row per route:

1. `bus_channels` — is there a row for this place? (default-deny) What rules?
2. parse — sigil present? → `bus_agents` by slug
3. fall back — the channel's default agent, then the connection's
4. `bus_grants` — if the agent has any rows and this channel is not among them,
   refuse
5. `bus_links` — get-or-create by `(channel, unit value)`

Thread continuation **bypasses steps 2–4 entirely** by inheriting the
conversation, which is what Dust does. That is the real job of layer 4: it
short-circuits resolution, rather than mapping ids for their own sake.

Consequence for C4: under always-new, there is nothing to inherit and every
message re-resolves, so `bus_links` is nearly vestigial. The reuse/new
policy and the resolution chain are the same question from two ends.

### 4.4 Why agents and channels are separate tables, not bindings

They sit on opposite sides of the connection: `bus_agents` points inward (which
Agenta agent, by what slug), `bus_channels` points outward (which external
place, under what rules). A binding table is their cross product, and the cross
product asserts per-pair facts nobody configures. One app, 3 agents, 5 channels
is 3 + 5 = 8 rows, versus up to 15.

The one real coupling is that a channel may name a **default agent**, overriding
the connection's — a nullable FK, not a join table. (Validate at write time that
it does not contradict that agent's grants.)

Dust matches this: the agent roster is workspace-wide, and `SlackChannelModel`
separately carries channel → default agent + auto-respond flag.

### 4.5 `bus_grants` is a restriction, not a permission set

**Not** the design's §4.3 `channel_scope_grants`. That table was binding →
where-it-may-answer, which in this model *is* `bus_channels`. This one is
agent → which-of-those-channels: a restriction *within* an already-permitted
set. Same word, different layer.

Direction and polarity were both deliberate:

- **On the agent, not the channel.** Sensitivity is a property of the agent
  ("the finance agent belongs only in `#finance`"), not of the place. Modelling
  it channel-side means every new sensitive agent edits every channel row.
- **Allowlist, not denylist.** An allowlist fails closed — forget the new
  channel and the agent stays silent, which someone notices and fixes. A
  denylist fails open — forget it and the sensitive agent is reachable, which
  nobody notices until it matters.
- **Only one direction.** Lists on both sides would need a conflict-resolution
  rule for "agent allows channel X, channel X denies agent" — invented
  machinery for a case nobody asked for.
- **A side table, not a JSONB column.** Same rows either way, but a table keeps
  FK integrity and is already shaped to grow policy columns if per-pair
  behaviour (per-pair approval requirements, per-pair identity) ever lands.
  Migrating a JSONB array into rows later is worse than adding columns to rows
  that exist.

No rows for an agent = addressable in every channel its connection may answer
in. The empty set is therefore unreachable, so "disabled everywhere" belongs on
the agent's own status column, not here.

**It stays just the allowlist.** An earlier draft of this section proposed
per-pair `invocation_override`, `approval_override`, `authorization_mode` and
`actor_ref` columns. Checked against the design, most of that was invented:

- **`invocation_override`** — the design has `channel_scope_grants.invocation_mode`
  overriding a binding default (§4.3), but that is per-*channel*, which
  `bus_channels` already carries. Per-*pair* invocation ("`~deploy` needs a
  mention in `#releases` but not `#staging`") has no ancestor and nobody asked
  for it. **Cut.**
- **`approval_override`** — the nearest thing in the design is §6.3's approver-
  policy hook, which is about *who may approve*, not *what requires approval*.
  Per-pair approval requirements are invented. **Cut.**
- **`authorization_mode` / `actor_ref`** — this one is real:
  `channel_bindings.authorization_mode` exists (§4.2) with `invoking_user` plus
  two deferred modes, and D2 explicitly keeps agent-own-identity and
  service-account doors open. So "use a service account here rather than the
  invoking user" is a plausible future. But it belongs on `bus_channels` first —
  per place, not per pair. **Not in grants.**

So `bus_grants` is the pair table and nothing more: presence means allowlisted.
Pair-level policy columns only if a concrete need ever forces them, and the row
shape is already there if it does.

What refusal *looks like* (silent skip vs. an ephemeral "that agent is not
available here") is a product call, and probably wants the same answer as the
design's §11 open question 2 on unlinked users. Silence reads as broken.

### 4.6 Inbox and outbox are per connection

They are the integration-sync buffer at the boundary, not a queue. The
credential and the dedup key both live at the connection: Slack mints
`event_id` per app, and the reply goes out with that app's bot token. Inbound
the agent is not yet known; outbound it is already resolved and what remains is
content plus destination. Routing happens separately, reading from the inbox.

So `channel_inbox_events` was already right to key on
`(connection_id, external_event_id)`, and its nullable `conversation_link_id` is
correct: null until routing resolves it, and null forever for events that
resolve to nothing.

**Keep them as two tables.** They look symmetric but are not: the dedup key is
inbound-only (the platform's id, unique constraint, duplicate dies on arrival)
while outbound has an idempotency key *we* mint and a `native_message_id` that
comes back *as a result* — same column position, opposite causality. The receipt
is outbound-only. The status vocabularies differ (`skipped` has no outbound
meaning; `abandoned` has no inbound meaning). And they are driven by different
processes with different failure modes. A merged table is one where a direction
column decides which half of the columns mean anything — the same objection
raised against folding `TriggerSubscription` into bindings.

The queue is out of scope here entirely; it belongs to the runner, per session
(C3).

### 4.7 Ports and adapters: nothing bus-specific in core

Nothing about a platform is hardcoded. Core stores opaque values (unit value,
locator JSONB, native ids) and reads a **capability declaration** to decide what
is offerable and how to render. The adapter does external event ↔ internal
message in both directions. Everything platform-varying — inbound addressing,
available conversation units, interactive elements, editing, identity shape, the
sigil character — is declared, not assumed.

**First-party and bridge differ only in how the adapter is reached, and where
the declaration comes from.** In both cases capabilities are *fetched*: an
in-process adapter answers a process call, a bridge answers a wire call. Same
interface, same declaration, same core. This is §9.4's "first-party channels eat
this contract", and it means C1 does **not** break the bridge contract — removing
the dial-out WebSocket changes the bridge's *transport*, not the contract. An
earlier claim in this review that the contract was "untouched and broken" was
wrong; only §9.3's transport section needs rewriting.

### 4.8 Cross-bus is fan-out, not a shared session

The design's "many links may point at one session" (§4.4) was offered as
cross-surface continuity. Two cases hide in that phrase, and only one is real:

- **Agenta ↔ one bus** — the web app and Slack on the same session. Valuable,
  and already free: both are surfaces on one session (§3's peer rule). No N:1
  needed.
- **Bus ↔ bus** — a Slack thread and an email thread continuing one session.
  No convincing use case: two groups of people in two places writing into one
  conversation, each seeing replies to messages they cannot see, is confusing
  rather than continuous.

The genuine want in that neighbourhood is **mirroring**: keep a GitHub
discussion, a Slack channel and a Linear issue in sync. But that is content
replication across surfaces, not one agent conversation with participants in
three places — the agent is not running three turns. Mechanically it is
**outbound fan-out**: one internal event, N external destinations, which
`bus_outbox_events` already supports as N rows since it keys per connection. No
N:1 on links required.

The hard parts are all inbound and none of them need the links table to change:
dedup (a mirrored message arriving back as a webhook), loop-breaking (§8
invariant 8), and attribution across identity systems. Recording cross-bus
shared sessions as **deliberately not supported**, with fan-out as the door left
open.

### 4.9 Use cases, in one vocabulary

Written bus-neutrally so the same sentence means the same thing everywhere.
Vocabulary: a **place** is `private` (1:1), `group` (ad-hoc set of people) or
`topic` (named persistent place). A **unit** is what a session corresponds to —
the place itself, or a nested conversation inside it. **Entry** is how the agent
is pulled in (`mention` or `always`). **Fill** is what content enters
(`none`, `backfill`, `continuous`). **Reset** is how a user starts fresh.

- **U1 — "In my DM it remembers everything."** One ongoing session per person.
- **U2 — "In my DM every message is independent."** Fresh session per message.
- **U3 — "Mention it in the group; it answers in a thread that keeps context."**
  Mention to start, then no mention needed inside the unit. The universal
  default — every vendor surveyed ships exactly this.
- **U4 — "In this group it is always on, no mentions."** Every message in the
  place enters one ongoing session.
- **U5 — "Each mention is its own task."** No accumulation. Devin's `!new` is
  the manual form of this.
- **U6 — "Let me close the session and start a new one."** A user gesture, not
  a timer.

**U3 is two settings, not one**: mention-to-start at the *place*, no-mention
*within the unit*. Those are different entries at different layers, which is why
a single `invocation_mode` enum on one row cannot express it.

#### What each bus can express

| | U1 | U2 | U3 unit | U4 always-on | U5 | U6 reset |
|---|---|---|---|---|---|---|
| Slack | yes | yes | `thread_ts` | needs `channels:history` | yes | **no slash cmd in threads** |
| Telegram | yes | yes | forum topics (stable id) else reply-chain | privacy off + re-add, **or bot as admin** | yes | **commands cannot scope to a topic** |
| Discord | yes | yes | thread = channel | needs Message Content intent | yes | slash cmd works |
| Teams | yes | yes | thread id inside `conversation.id` | needs RSC | yes | **no native gesture** |
| WhatsApp | yes | yes | no unit exists | inherent (1:1) | yes | text only |
| Linear | n/a | n/a | the issue; context **pushed** | n/a (delegation) | yes | n/a |

Verified specifics behind that table:

- **Slack slash commands cannot be invoked in threads.** Official: *"Slash
  commands created by developers cannot, however, be invoked in message
  threads."* Only built-ins (`/topic`, `/remind`) and Giphy work there. The
  slash payload carries no `thread_ts` at all.
- **Teams has no native new-conversation gesture** for bots; personal scope is
  one persistent conversation per user-bot pair forever. Every implementation is
  an app-level text route the developer wires (open feature request
  `microsoft/teams-sdk#752`).
- **Telegram commands cannot be scoped to a topic.** `BotCommandScope` has
  exactly seven variants and none reference `message_thread_id`; the finest
  granularity is per-chat. A bot *receiving* a command can tell which topic it
  came from, but the displayed menu cannot differ per topic.
- Therefore, on three of three platforms with units, per-unit commands are
  unavailable, and **a text convention (`!new`) is the only reset mechanism that
  works everywhere** — validating Devin's `!new` and OpenClaw's `!` prefix as
  portability workarounds rather than style choices. Corroborating: `/clear`-style
  reset is an application-layer convention in Dify, Coze and Lark too; none of
  them ship it as a platform primitive.
- **Telegram passes replies through by default.** Privacy mode enabled still
  delivers *"replies to any messages implicitly or explicitly meant for this
  bot"* — so U3 works with no toggle. But bare @mentions are **not** in the
  pass-through list; only `/command@botname` is. So on Telegram "mention the
  bot" effectively means "use a command".
- **Slack has no separate thread-reply permission.** `message.channels` +
  `channels:history` delivers *every* message in the channel and you filter by
  `thread_ts` yourself; `app_mention` is opt-in narrowing, not the only path.
  So U3 and U4 need the *same* scope there — there is no way to get thread
  replies without also being able to read the channel. The reverse of Telegram.
- **Slack containers are four, and a thread is not one of them**: DM (`is_im`),
  group DM (`is_mpim`, *"unnamed private conversation between multiple users"*),
  private channel, public channel. `thread_ts` is orthogonal to `channel`.
  Slack Connect is a *property* of a channel (`is_shared`), not a fifth type.
- **Teams reply chains are not addressable either**: `replyToId` exists in the
  Activity schema but Teams often does not populate it on incoming activities;
  the thread id is encoded inside `conversation.id`. Also: agents cannot post
  messages or Adaptive Cards in **private channels** at all.
- **Linear pushes context, and scopes it precisely.** The `AgentSessionEvent`
  webhook carries `promptContext` (a formatted string of issue details, comments
  and guidance), `previousComments` (*"the previous comments in the thread before
  this agent was mentioned"*) and `guidance` (workspace/team standing
  instructions) — all documented as **present only on `created` events, never on
  `prompted` follow-ups**. That is exactly U3's fill semantics stated by a
  platform that designed for it: backfill once at session creation, nothing
  afterwards. The model to copy for what a bridge inbound event should carry.
- **Telegram has no backfill at all, categorically.** Confirmed by exhaustive
  search of the Bot API method list — no history method exists. Worse, updates
  are *"not kept longer than 24 hours"* server-side, so even the forward buffer
  is capped. A bot added to an existing group starts from zero, permanently.
- **Discord backfill does NOT bypass the Message Content intent.** A widely-held
  assumption — repeated earlier in this review — is that REST history reads
  sidestep the privileged intent. Discord's docs say the opposite verbatim:
  `MESSAGE_CONTENT` *"permits your app to receive message content data **across
  the APIs**"*. So `GET /channels/{id}/messages` paginates fine but returns
  **empty `content`** without the intent, subject to the same four exceptions
  (own messages, DMs, mentions, context-menu targets). Discord has no advantage
  here after all.
  - Two corollaries. The intent gates *fields*, not *delivery*: with
    `GUILD_MESSAGES` a bot still receives `MESSAGE_CREATE` for every visible
    message, so it knows *that* something was said, just not *what*. And
    **thread membership is not an exception** — a message in a thread the bot
    itself created, without a mention, still arrives with empty content. U3 on
    Discord genuinely requires the intent.
  - Backfill also needs `VIEW_CHANNEL` + `READ_MESSAGE_HISTORY` (plus `CONNECT`
    for voice channels); without `READ_MESSAGE_HISTORY` no messages are returned
    at all.
- **Telegram forum topics have genuinely stable ids.**
  `ForumTopic.message_thread_id` is the topic's own identifier, assigned at
  creation (General is always `id=1`) and reused on every message in it — not a
  message id. Structurally different from Slack's `thread_ts`, which *is* the
  parent message's timestamp. Enabling topics needs the `can_manage_topics` admin
  right, not Premium.
- **Telegram bot admins bypass privacy mode entirely** (*"bot admins always
  receive all messages"*), so U4 has a second path there: make the bot an admin
  rather than toggling `/setprivacy`. This is what Coze's Telegram setup requires.
- **Teams splits live delivery from backfill across two permission surfaces.**
  RSC delivers messages forward from install; Graph (`ChannelMessage.Read.All`,
  or `ChannelMessage.Read.Group` when RSC-consented) has no documented
  install-time gate, so historical reads are a *different* grant. Inferred from
  the absence of a cutoff in the endpoint contract, not stated — and it is
  unresolved whether those endpoints sit behind Teams' "Protected APIs"
  extra-approval process.
- **Linear's accountability model is delegation, not impersonation**: assigning
  an issue to an agent sets it as **delegate, not assignee**, so the human keeps
  ownership. Their answer to the question D2 solves with per-user credentials.

### 4.10 The inbound grammar

```text
<platform mention of the bot>  [~agent]  [!command]  <text>
         |                        |          |
   platform's, tokenized        ours       ours
```

The **bot mention resolves the connection** — but the connection is already known
from which webhook received the event, so parsing it is only about *stripping* it
from the text. That strip is needed regardless: Slack leaves `<@U0DEPLOY>`, Teams
leaves `<at>deploybot</at>`, and both must come off before the text reaches the
model (Teams ships `removeRecipientMention` for exactly this).

So the adapter's inbound job is: strip the platform mention → parse `~agent` if
present → parse `!command` if present → hand core a routing intent plus clean
text.

**Both sigils are declared per bus**, like every other capability. The grammar
*shape* is universal; the characters are not. `@` is unusable (Slack destroys
it via autocompletion); `/` collides with native command surfaces on Slack,
Discord and Telegram — so Telegram may declare `/` where it is native, while
Slack must use `!`. `~` and `!` are what Dust and OpenClaw independently landed
on. Anchor at the start with a trailing boundary, as Dust does
(`(?=\s|,|$)`), so `~` inside code snippets or paths does not false-positive.

**Agent and command are siblings, both optional — command does not nest under
agent.** `!new` alone must work, because reset is about the conversation, not
about any agent; `~support !new` reading as "reset, but with support" is
incoherent. If agent-scoped verbs ever appear they are a different thing and can
nest then.

Commands are a **core vocabulary** (`new`, and probably `help`) expressed
per-adapter — so a bus with a native command surface can register real slash
commands as *aliases* that produce the same internal command event, giving
discoverability where the platform allows it while the text sigil remains the
mechanism that works everywhere. Core sees one command event either way. The
supported command set should be part of the capability declaration so a bridge
can state what it implements.

Open: what `~support` alone means (no text). Probably "switch this conversation
to `~support`", which Dust allows mid-thread; or an error. Cheap to decide later,
but the grammar must make it representable rather than silently parsing as empty
text.

### 4.11 GAP — how does the agent see the conversation it was pulled into?

Not answered anywhere in `architecture.md`, `decisions.md`, or `raw/`. The
closest is §2.1's admission that the caller ships history today and build-plan
step 6 (server-side hydration) — but that is about *the session's own* history,
messages the agent already took part in.

The unaddressed case: messages 1–3 happen in a Slack thread with no bot
involvement (nobody mentioned it; on most platforms it never even received
them), then message 4 mentions the agent and says "can you fix it?". Three
possible answers:

1. **Only message 4.** The agent has no referent for "it". This is what the
   design gives by omission, since only mentioned messages arrive.
2. **Backfill on first mention.** When a link is created, fetch the thread's
   prior messages from the platform API and seed the session. One bounded fetch
   per thread; needs read scopes (Slack `conversations.replies`).
3. **Ingest continuously.** Every message in a granted channel enters the
   session whether the bot is mentioned or not. This is the `always` invocation
   trigger, and per §3 it is exactly what requires privilege provisioning.

**This collides with §8 invariant 7**, which promises "the gateway ingests the
thread it is part of, not channel history" as a data-minimisation posture. Both
(2) and (3) break that promise, so the security claim and the usable UX are in
direct tension — and the design states the claim without noticing it forecloses
the behaviour.

Backfill-on-first-mention is the reasonable default (bounded, matches the
expectation that an agent pulled into a thread has read it), but it must be
capability-gated: WhatsApp and email cannot do it at all, and Slack needs the
scope. Needs an explicit decision rather than defaulting to (1) by silence.

### 4.12 Mapping back to the design's tables

| Design | Counter-model | Why |
|---|---|---|
| `gateway_connections` (reused, §4.1) | `bus_connections` | Whether to reuse the existing table or use a dedicated one is still open (comment at 257). Cardinality itself is unchanged. |
| `channel_bindings` (§4.2) | split into `bus_agents` + `bus_channels` | The binding assumed one binding = one agent with policy inline. Agents and channels are independent lookups on opposite sides. |
| `channel_scope_grants` (§4.3) | `bus_channels` | Where-it-may-answer *is* the channel row. Default-deny survives. |
| — | `bus_grants` | New: agent → channel restriction, which the design had no place for. |
| `conversation_links` (§4.4) | `bus_links` | Same job, opaque unit value + typed locator instead of Slack-shaped columns. `generation` and TTL dropped (C4). |
| `channel_inbox_events` (§4.5) | `bus_inbox_events` | Unchanged in shape. |
| `channel_deliveries` (§4.5) | `bus_outbox_events` | Renamed for symmetry. Its *shape* is still open — see the deliveries-vs-synchronisations thread. |
| `user_identities` (reused, §4.6) | unchanged | But the key shape must be per-platform; see the identity findings in §3. |

### 4.13 Invocation triggers: capability × provisioning × enablement

`mention | command | always` is not one vocabulary. It breaks three ways: `always`
is ungrantable on some platforms; `command` is a typed interaction payload on
Discord but plain text on Telegram and Teams; WhatsApp has no mention concept at
all. The resolution is three separate things, not one enum:

- **Capability** — does the platform support this trigger at all? Declared by
  the adapter. (WhatsApp: no mention. Discord: typed commands.)
- **Provisioning** — has the operator completed the external step? Telegram
  privacy mode off **and the bot re-added to existing groups**; Discord's
  Message Content intent approved (review-gated above 100 guilds); Teams RSC
  consented by a conversation owner. This is not a config value — it is a *fact
  about the world*, discoverable only by asking the platform or by failing. It
  needs observed state ("we believe this is granted"), refreshed on failure.
- **Enablement** — does the admin want it on here? Stored, per channel,
  defaulting from the connection.

`always` needs all three. `mention` typically needs only capability and
enablement.

### 4.14 Fill is not trigger

The single most clarifying distinction in this whole review, and the design never
draws it:

- **fill** — what enters the session as content
- **trigger** — what starts a turn

**Only explicit addressing triggers.** A mention, a command, a button click, a
Linear delegation. Everything else fills: messages arrive, become part of the
conversation, and the agent does *not* run. When someone finally mentions it, the
turn starts with all that context already present.

This generalises D1's note about unlinked users ("his message still enters the
session as conversation content") into the general rule, and it resolves what
"always-on" means: **not that the agent replies to everything — that it hears
everything.** A bot answering every message in a busy channel would be unusable;
that is not what anyone is asking for.

Two consequences:

- **Concurrency is a non-problem.** Filling does not contend for a turn, so the
  409 only arises from triggers, which are far rarer than messages. Plain
  409-retry is entirely adequate while C3 is outstanding.
- **Ordering matters in exactly one place.** Fill messages must land in the
  session *before* the triggering mention's turn starts, or the agent runs
  without context it should have had. So a conversation's inbox events must be
  processed in order — strictly, not eventually. This is the one real ordering
  constraint on the channels side.

### 4.15 Fill options, and how they degrade

Three options, not two — because "backfill" is misleading on platforms that
cannot fetch:

- **`none`** — the agent sees only the triggering message. Works everywhere, no
  scopes, no retention exposure.
- **`fetch-on-first-trigger`** — on the first mention in a conversation, fetch
  that conversation's prior messages once; thereafter it is live. Retains only
  what a deliberately-invited conversation needed.
- **`store-always`** — hold messages as they arrive against the chance someone
  later mentions the agent. The *only* route on Telegram, and the heaviest
  posture anywhere: it means recording conversations the agent was never invited
  to. Precisely the "unmanaged data lake of regulated content" that
  `raw/enterprise-posture.md:181` names a deal-killer.

The hybrid worth shipping is **fetch on first trigger, then continuous within the
link**. Nothing is stored for a conversation until someone pulls the agent into
it; from then on it is live. Per bus:

| bus | fetch on first trigger | continuous within link |
|---|---|---|
| Slack | `conversations.replies` — one call, inside the 1/min cap | `message.channels` filtered by `thread_ts` |
| Discord | `GET /channels/{id}/messages` | live `MESSAGE_CREATE` |
| Telegram | **impossible** — no history API exists | works if privacy off; messages before the mention are lost forever |

Both halves need the same grant on Slack (`channels:history`) and Discord (the
Message Content intent), so once you have paid for continuous-within-link, the
fetch is nearly free and adds no retention exposure. Telegram degrades to the
tail only.

Note "continuous within link" is the same thing as always-within-link — not a
separate setting. The only genuinely separate decision is the one-time fetch.
Channel-wide ingestion of conversations the agent was never mentioned in remains
a distinct, rarely-wanted thing (the Charlie-daemon shape, whose own docs warn
that broad watch conditions are an easy way to build an over-eager bot).

### 4.15a Capability is static, permission is dynamic

The distinction that makes degradation tractable:

- **Capability** — what the bus can do at all. Static, declared by the adapter,
  known before anything is attempted. Telegram has no history API: not a
  permission question, ever.
- **Permission** — whether *this install* is currently allowed to. Dynamic, may
  change in either direction at any time, and discoverable mainly by trying.

So the rule is: **always attempt what the capability allows; let failure teach
us, per link, not per install.** A one-time check at install is wrong — it means
a permission granted tomorrow never takes effect, and one revoked keeps being
attempted forever.

Recording the outcome on `bus_links` ("we tried to backfill this conversation and
could not") gives the per-conversation non-retry for free, while leaving the next
conversation free to try again. A permission granted later starts working without
anyone re-running setup; one revoked degrades without breaking.

Two vocabulary notes: **backfill** is the one-time fetch of what came before;
**forwardfill** is the continuous flow of what comes after. They are separately
capability-gated and separately permissioned. Where the configuration is
one-message-one-session, neither applies and neither is attempted.

#### Degradation table

| bus | trigger, best case | trigger, degraded | backfill | forwardfill |
|---|---|---|---|---|
| Slack | mention starts, then none needed | mention on every message | attempt `conversations.replies`; 403 → content is mention-only | `message.channels` filtered by thread |
| Telegram | mention or command starts; replies free | **identical** — replies pass by default | **no capability — never attempted** | needs privacy off; otherwise replies only |
| Discord | mention starts, then none needed | mention every message; `/ask` still works | attempt REST; **empty `content` = failure** | live `MESSAGE_CREATE` |

Three things this exposes:

- **Telegram never fails at backfill because it never tries.** Capability, not
  permission — the split doing real work.
- **Discord's failure is silent.** The REST call *succeeds*; the `content` fields
  are simply empty. So success is not an HTTP status there, unlike Slack's 403.
  Adapters must detect their own failure modes; core cannot.
- **Telegram's degraded trigger case equals its best case.** Only channel-wide
  ingestion differs, which is the point made in §4.16.

### 4.16 The grant means different things per bus

Splitting the three primary buses by whether the operator has granted the broad
permission:

**Without it** — every message needs an explicit mention, including inside a
conversation the agent is already in. DMs still work perfectly everywhere (all
three deliver 1:1 unconditionally). Telegram is the exception on groups too:
replies to the bot pass through privacy mode for free, so links work naturally
there and clunkily on Slack and Discord. Discord has one escape hatch — slash
commands arrive as interaction payloads regardless of the intent, so a
`/ask agent:… prompt:…` flow works with no privileged grant at all; Slack has no
equivalent, since its slash commands do not work in threads.

**With it** — follow-ups arrive without mention, and fetch-on-first-trigger
becomes available.

**But the grant is not one thing.** On Slack and Discord it unlocks follow-ups in
a link — what users actually want. On Telegram follow-ups were *already free*, so
the equivalent grant (privacy mode off, or bot-as-admin) unlocks channel-wide
ingestion instead — something most users do not want. Treating it as a uniform
"enable follow-ups" toggle would make Telegram installs strictly more invasive
than they need to be, for a capability nobody requested.

So the grant must be modelled per bus, tied to what it actually enables there.

### 4.17 Commands, and what `!new` does to links

Commands are triggers, and the vocabulary so far:

- **`!new`** — start a fresh session for this link
- **`!sessions`** — list this channel's recent sessions
- **`!use:xxx`** — continue an existing session here

Grammar is `!command[:arg]`. Colon rather than space, so the command token stays
self-contained — everything after it is the message the agent receives.

**`!new` breaks the 1:1 claim.** An earlier draft said `session_scope =
conversation` gives 1:1 and `message` gives 1:N. With `!new`, a link's session can
change under either. So `bus_links` is **always append-only**, one row per
session the external thing has had; the current session is the latest row.
`session_scope` only determines *when* you append — on first sight and on `!new`,
versus on every message.

Which is the design's `generation` column arriving through the front door. §4.4
invented it for idle expiry (killed with the TTL), but its *reasoning* was right —
"the old link remains, so history stays reachable and audit stays coherent". Wrong
trigger (a timer), right mechanism (a user gesture).

**But no counter column.** Latest-row-wins by creation time: no `generation`
index to maintain, old rows keep the same foreign keys and simply are not
current. This also survives `!use:` pointing at an older session without any
renumbering, which a counter would make incoherent.

Lookup is therefore "latest row for this key", which is a second independent
reason there can be no unique constraint on `(channel, unit value)`.

**`!sessions` + `!use:` give N:1 for free** — two links pointing at one session,
which is the cross-surface continuity §4.4 wanted, arriving as a side effect
rather than a designed feature. Three caveats:

- **Authorisation is not optional.** A session id must not become a bearer token.
  `!use:` needs the same check the web app does — may this user, in this project,
  read this session. `!sessions` makes ids *discoverable*, never *authorised*.
- **Scope the listing.** Channel-scoped is both safer and more useful ("what have
  we been talking about here"); project-wide would leak the existence of
  conversations across channels. In a DM the list is personal — the
  `shared | personal` distinction (D4) doing real work.
- **The web-app-driven direction is the better UX.** "Continue this session in
  #releases" from the web app posts a message that establishes the link, with no
  id typing at all. Factory already ships the mirror of this (paste a Slack thread
  URL into Factory and it imports).

On platforms with buttons, `!sessions` renders as a picker whose rows issue the
`!use:` — same internal command, better UX, capability-declared. The alias
pattern from §4.10.

**Open:** `!new` mid-turn. Someone resets while the agent is working. Letting the
in-flight turn finish is right (cancellation is a different gesture — `steer` /
`cancel`), but its reply then lands in a conversation whose current session has
already moved on, which is confusing to look at. Needs a decision.

### 4.17a Retention: inherited, not invented

Agenta has **no operational retention today** for non-tracing data — core tables
keep every message, event and log forever, because partitioning is not handled
yet. Channels inherits that; it does not get to invent a retention story of its
own, and `bus_inbox_events` / `bus_outbox_events` are append-only like everything
else.

Worth flagging once so it is not a surprise later: **channels is likely to be
what creates the demand.** A busy channel with forwardfill on ingests messages
the agent was never mentioned in, keeping raw platform payloads indefinitely — a
volume profile unlike any existing operational table. Not a reason to build
retention now; a reason to expect this to be the forcing function when it comes.

When it does arrive, it should look like Agenta's existing retention (periodic,
plan-configurable) rather than a per-row TTL — the mechanism C4 already rejected
for sessions.

### 4.18 Still open in this model

- **The `bus_` prefix**, which reads as message-broker infrastructure.
- **Whether `bus_connections` reuses `gateway_connections`** (comment 257). Now
  much cheaper either way, since §4.1's sigil-as-capability leaves no
  channels-specific columns to add.
- **`bus_outbox_events` shape** — the deliveries-vs-synchronisations objection
  (comment 413) is not yet resolved, and the platform findings sharpen it:
  WhatsApp and email cannot edit at all, so on those surfaces a projection can
  only append.
- **Default posture** — do we request the broad grant at install (so links work
  as users expect) or ship mention-only and let operators opt in? This is the
  install UX and the security story on every platform, and it is a product call.
- **Does fill ship in the first pass at all**, or start at `none` everywhere?
- **What refusal looks like** when an agent is not granted in a channel, or a
  user is unlinked — silent skip or an ephemeral notice. Same question as the
  design's §11 open question 2.
- **Grant probing.** D1's deferred safety rule assumed nothing member-private
  exists to leak. `bus_grants` introduces a new per-agent-per-place restriction,
  so if refusal is silent a user can still probe which agents exist where. Minor,
  but new surface D1 did not contemplate.
- **Slack backfill: the case that matters works.** Bot in the channel for months,
  thread starts, three messages, then a mention — `conversations.replies` fetches
  the thread by parent timestamp, gated by scope and channel membership, not by a
  per-message watermark. The bot was a member throughout, so nothing withholds
  them. Only the *pre-join* edge is unverified (Dust documents those as
  inaccessible), and it bites solely when someone mentions the bot in an old
  thread shortly after install. An earlier note in this review conflated the two
  and overstated the risk to fetch-on-first-trigger
  there.

## 5. Against the recorded decisions

- **D1 (group sessions are shared)** — holds. Its deferred safety rule gains one
  new surface: grant probing (§4.18).
- **D2 (agent acts as the invoking user)** — untouched by the model work.
- **D3 (one platform app is one agent)** — **contradicted, deliberately.** Wrong
  as a modelling constraint: it forbids the gateway-bot shape both Mahmoud and
  the review want. It survives as a *default configuration* — an empty roster
  plus the null-slug default — and the multi-agent roster is an add-on that
  changes nothing about how the single-agent case works.
- **D4 (DMs allowed, personal vs shared)** — holds; becomes `private` in the
  `private | group | topic` scope taxonomy.
- **D5 (session lifetime is configuration)** — **overridden.** The idle-TTL
  fiction is gone (C4); what remains is one enum (§4.2). This reverses an
  explicit review call, so it needs to be flagged as such rather than presented
  as a gap.
- **D6 (continuity rides on sessions)** — confirmed, but **halved**: of its two
  named gaps, `sender` does not land at all, leaving only server-side history
  hydration.
- **D7 (learn from Linear)** — superseded in practice by AHP, which has the same
  ideas (typed activities, elicitation, derived states) as a written spec with
  schemas, plus host-owned queueing (C3). The in/out mappings AHP implies are
  per-bus, which is the ports-and-adapters shape of §4.6.

## 6. Work packages (emerging)

Not sequenced, not sized. Dependencies noted where they are real.

**Runner / API**

- **Input sequencing** — host-owned queued/steering messages; submissions
  accepted rather than 409'd. (C3)
- **Server-side history hydration** — the server loads the transcript into model
  context instead of the caller shipping it. Co-designed with the runner, not an
  API-only concern.
- **Turn events on the bus** — turn-completed as a published event. Prerequisite
  for 409-retry being event-driven rather than polling.
- **Batch/stream negotiation** — see the open thread above.

**Channels**

- **Ingress** — public HMAC-verified receiver route(s), replay protection, inbox
  write, 202. Patterned on the Composio receiver.
- **In-mapping** — external event → internal message: route, authorize scope,
  identify speaker, resolve conversation → session, submit. Sender stamped here.
- **Out-mapping** — internal event → external event: render per capability
  declaration, deliver, record receipts.
- **Data model** — whatever survives the open threads in §3.
- **Identity linking** — `channel:*` identity methods and the linking flow.
  Possibly a platform package rather than a channels one, given `user_identities`
  is shared machinery and the subject-scoping question is general.
- **Connection provider** — the platform app install/credential story.
- **Bridge contract** — third-party surfaces.

No approvals package: C5 removes it.
