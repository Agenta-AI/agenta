# Mature bot platforms: how Botpress, Voiceflow, and Microsoft Copilot Studio model channels

Light first-pass research (breadth over depth) for the Agenta "channels" feature: connecting an
agent to messaging surfaces (Slack, Discord, Telegram, WhatsApp, Teams, email) so a team can talk
to it where they already work. The three platforms studied here are the mature bot-building
platforms that solved "one bot, many messaging surfaces" roughly a decade ago. They are the
richest source for the channel abstraction itself: how one bot definition maps onto many surfaces
with different capabilities. Claims come from vendor documentation fetched 2026-07-20; anything I
could not confirm in a primary source is marked **[unverified]**.

A note on vocabulary, since each vendor uses different words for the same things:

- A **channel** is a connection between a messaging surface (Slack, Teams, WhatsApp, a web
  widget) and the bot. All three vendors use this word, though Botpress calls the installable
  unit an "integration" and reserves "channel" for a sub-scope inside it.
- A **normalized message format** is the vendor's internal message schema. Inbound messages from
  every surface are translated into it, and outbound messages are translated from it into each
  surface's native format. This is what lets one bot definition serve many surfaces.
- **Fallback rendering** (also called downgrading) is what happens when the bot sends a rich
  message (buttons, cards) to a surface that cannot display it: the platform converts it to
  something the surface can show, such as a numbered text list.
- **Human handoff** (or escalation) is transferring a conversation from the bot to a human
  agent, usually into a separate inbox or contact-center product, with the conversation history
  attached.

---

## 1. The foundation: Azure Bot Framework's channel model

Microsoft Copilot Studio inherits its channel machinery from the Azure Bot Service / Bot
Framework, which is the oldest and most explicit articulation of the channel abstraction, so it
is worth describing first.

### 1.1 One schema, per-channel translation

The Bot Framework's core idea: "The Bot Framework allows you to develop a bot in a
channel-agnostic way by normalizing messages that the bot sends to a channel. The service or an
adapter translates communication between the Bot Framework Activity schema and the channel's
schema" ([Azure Bot Service: manage channels](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-manage-channels?view=azure-bot-service-4.0)).

The normalized unit is the **Activity** — a JSON object representing one event in a conversation
(a message, a typing indicator, a member joining, a reaction). The
[Activity schema spec](https://github.com/microsoft/botframework-sdk/blob/main/specs/botframework-activity/botframework-activity.md)
defines the fields that matter for channel abstraction:

- `channelId` — which surface the activity came from or goes to. The spec is explicit that
  channel IDs are opaque: "the `channelId` field establishes the channel and authoritative store
  for the activity," and two channel IDs compare only by exact string match.
- `conversation` — a **ConversationAccount** with an `id` (the channel's own opaque conversation
  identifier), an `isGroup` boolean ("whether more than two participants can send/receive
  messages"), and a channel-specific `conversationType` (for example, Teams distinguishes
  personal chats from channel threads). The spec instructs: "Channels SHOULD choose `id` values
  that are stable for all participants within a conversation." Conversation identity is
  therefore keyed by `(channelId, conversation.id)` — each channel supplies its own native key
  (Slack channel+thread, Telegram chat id, WhatsApp phone number) behind one interface.
- `from` / `recipient` — **ChannelAccount** objects (`id`, optional `name`, optional Azure AD
  object id). Speaker identity is per-channel; there is no built-in cross-channel identity
  linking at this layer.
- `channelData` — the escape hatch: a channel-native payload passed through untouched, for when
  the normalized schema cannot express something a specific surface supports. Receivers that do
  not understand a channel's format are told to ignore it. This field is the honest admission
  baked into the schema that normalization is always leaky.
- `entities` — a flat list of typed annotations, including @mentions. "Receivers must ignore
  entities whose types they do not understand."

### 1.2 Fallback rendering

When a channel cannot render an activity, the connector service downgrades it: "If the channel
doesn't support all aspects of the activity schema, the Bot Connector Service tries to convert
the message to a format that the channel does support. For example, if the bot sends a message
that contains a card with action buttons to the email channel, the connector might send the card
as an image and include the actions as links in the body of the email"
([manage channels](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-manage-channels?view=azure-bot-service-4.0)).

### 1.3 Schema transformation versioning — the API-churn answer

A detail worth stealing: the per-channel translation logic is itself **versioned**. Bot
developers pin a "schema transformation version" and upgrade when ready, because fixing a
translation bug or tracking an upstream API change (the changelog cites a Facebook Graph API v9
upgrade and a Telegram MarkdownV2 switch) can change the behavior of existing bots that depended
on the old rendering. This is a decade of "maintaining many channels" experience condensed into
one mechanism: channel APIs churn, translation must follow, and bots need a way to opt in on
their own schedule.

### 1.4 Channel matrix

First-party channels ([full table](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-manage-channels?view=azure-bot-service-4.0)):
Alexa, Azure Communication Services chat, Direct Line (the generic REST/WebSocket channel for
embedding in any app), Email (Microsoft 365), Facebook Messenger/Workplace, GroupMe, LINE,
Microsoft Teams, Omnichannel (the Dynamics 365 contact-center bridge), Outlook actionable
email (preview), Search (preview), Slack, Telegram, Telephony (preview, closed), Twilio SMS,
WeChat, Web Chat. Notably dead: Kik and Skype "no longer support new bot development" — channel
lists rot from both ends. Community channels exist as adapters via Botkit and the
BotBuilder-Community repositories. There is **no first-party Discord channel**, and WhatsApp
arrives only via Copilot Studio's ACS channel (below) or third-party adapters.

---

## 2. Microsoft Copilot Studio

Copilot Studio is Microsoft's low-code agent builder (formerly Power Virtual Agents) sitting on
top of the Bot Framework machinery above.

### 2.1 Channels supported

From [Publish and deploy key concepts](https://learn.microsoft.com/en-us/microsoft-copilot-studio/publication-fundamentals-publish-channels):

- **Native channels**: Teams + Microsoft 365 Copilot, SharePoint, WhatsApp, Demo Website,
  Custom Website (web widget), Mobile App (Direct Line), Facebook.
- **Via Azure Bot Service passthrough**: Cortana, Slack, Telegram, Twilio SMS, LINE, Kik,
  GroupMe, Direct Line Speech, Email.
- **Customer engagement hub channels**: Dynamics 365 Customer Service / Omnichannel (which
  itself fans out to chat widgets, SMS, WhatsApp-via-Twilio, WeChat, and more).

The tiering is visible in the docs' energy: Teams gets a 4,000-word setup guide; Slack and
Telegram are one bullet pointing at decade-old Azure Bot Service pages. The strategic channels
(Teams, M365 Copilot, SharePoint, WhatsApp) are native; the long tail is inherited passthrough.

### 2.2 Capability differences and fallback

Copilot Studio publishes an explicit **channel experience reference table**: the customer
satisfaction survey renders as an Adaptive Card on the website channel but text-only on Teams,
Facebook, and Omnichannel; multiple-choice options are unlimited on the website, capped at six
on Teams (rendered as a hero card), 13 on Facebook (quick replies), and degrade to a
retype-the-option text list on SMS/WhatsApp-style asynchronous channels; Markdown is "partially
supported" nearly everywhere ([reference table](https://learn.microsoft.com/en-us/microsoft-copilot-studio/publication-fundamentals-publish-channels#channel-experience-reference-table)).
Makers are told to author for the lowest common denominator of the channels they target rather
than trusting automatic downgrades — the platform documents the differences instead of hiding
them.

On the WhatsApp channel, only three Adaptive Card patterns are supported (Action.Submit with up
to three buttons, Input.ChoiceSet with up to 10 options, Action.OpenUrl), mirroring WhatsApp's
native interactive-message limits; makers "must restrict [their] use of adaptive cards to this
subset" ([WhatsApp channel](https://learn.microsoft.com/en-us/microsoft-copilot-studio/publication-add-bot-to-whatsapp)).
A platform-wide limitation: users cannot send attachments to the agent on any channel, even
where the surface supports it.

### 2.3 Connection UX

- **Teams / M365 Copilot**: near-zero-friction for the maker ("Authenticate with Microsoft" is
  on by default, no manual setup), but distribution is governed: install-for-yourself → share a
  link with named users → "Built with Power Platform" store section for shared users → **submit
  for admin approval** to reach the org-wide "Built for your org" store section. Admins can
  auto-install and pin the agent via app setup policies. Detail changes (icon, description)
  require re-approval; content changes do not
  ([Teams channel](https://learn.microsoft.com/en-us/microsoft-copilot-studio/publication-add-bot-to-microsoft-teams)).
  The Teams setup pain is thus not technical but organizational: tenant policy must allow Power
  Platform apps, and org-wide reach requires an admin in the loop.
- **WhatsApp**: native channel backed by **Azure Communication Services (ACS)**. The maker picks
  an Azure subscription, an ACS resource, and an ACS-registered phone number, then deploys and
  gets a QR code. The Meta-side pain (WhatsApp Business Account, Meta business verification,
  phone number registration) is pushed into the ACS prerequisites
  ([prerequisites](https://learn.microsoft.com/en-us/azure/communication-services/concepts/advanced-messaging/whatsapp/whatsapp-channel-prerequisites));
  Microsoft effectively acts as the intermediary so Copilot Studio itself never touches Meta.
  WhatsApp does not support "Authenticate with Microsoft"; the documented alternative is
  phone-number allowlisting via a custom HTTP-request topic against your own API — notably
  manual for a first-party channel. File upload/download is unsupported.
- **Slack/Telegram/etc. via Azure Bot Service**: classic per-channel credential entry in the
  Azure portal (Slack app credentials, Telegram BotFather token), documented in the inherited
  Azure pages.

### 2.4 Session and conversation model

A **session** ends after 30 minutes of inactivity "in most channels"; newly published content
only takes effect when a new session starts. Channels with **persistent conversations** (Teams,
Omnichannel) never naturally end, so users must type "start over" or wait up to an hour to pick
up a newly published version ([publish concepts](https://learn.microsoft.com/en-us/microsoft-copilot-studio/publication-fundamentals-publish-channels#publish-the-latest-content)).
Conversation identity itself is the Bot Framework `(channelId, conversation.id)` pair; user
identity is the channel account (`System.Activity.From.Id` — on WhatsApp this is the user's
phone number). Cross-channel identity linking is achieved only through end-user authentication
(Entra ID sign-in), not through any native identity-merge feature.

### 2.5 Group chat handling

Teams is the flagship group surface: a user adds the agent to a team, and "team members can
'@mention' it in any team channels, and all teammates see the responses" — this is exactly the
Agenta channels UX under study. When added to a channel/group/meeting chat, "the agent gets
access to the conversation history from the team channel, group chat, or meeting chat"
([Teams channel](https://learn.microsoft.com/en-us/microsoft-copilot-studio/publication-add-bot-to-microsoft-teams#allow-users-to-add-an-agent-to-a-team-in-teams)).
Group-mode caveats are instructive:

- In group chats and channels, agents **cannot use knowledge sources requiring end-user
  authentication** (like SharePoint) — "by design and helps prevent unintended data exposure,"
  because a reply visible to the whole group would leak content only one member can access.
  Those agents work in 1:1 chats only.
- Group/meeting chats don't support manual auth with Teams SSO.
- Makers must set access to "everyone in the org" before enabling team install, or members hit
  permission errors — group membership and agent ACLs are separate systems that the maker must
  reconcile by over-granting.

### 2.6 Human handoff

Copilot Studio's escalation is a first-class **Transfer conversation** node in the system
"Escalate" topic. It hands the conversation to a **customer engagement hub** — Dynamics 365
Customer Service/Omnichannel natively ([configure](https://learn.microsoft.com/en-us/microsoft-copilot-studio/configuration-hand-off-omnichannel)),
or any third-party hub via a generic handoff protocol
([generic handoff](https://learn.microsoft.com/en-us/microsoft-copilot-studio/configure-generic-handoff)).
On handoff the platform "can share the full history of the conversation and all relevant
variables," plus a private note from bot to human agent. Escalation triggers are either explicit
(user asks for a human) or implicit (topic logic decides)
([hand off to a live agent](https://learn.microsoft.com/en-us/microsoft-copilot-studio/advanced-hand-off)).
The pattern: handoff is a *conversation-routing* event into a separate human-agent console, not
an approval ping into the same thread.

### 2.7 Gotchas of many channels

- Every published change propagates to **all** channels at once; there is no per-channel version
  pinning at the Copilot Studio layer (the Bot Framework schema-transformation version below it
  is the only pin).
- Teams applies its own **rate limiting** to bots; docs advise keeping content concise.
- Teams caches app metadata aggressively — icon changes need reinstalls, republished agents can
  serve stale versions and throw `SystemError` until the app is toggled in the admin center.
- M365 Copilot (the newest surface) has a long unsupported-features list: no conversation-start
  greeting, no images/video/basic cards (`ContentFiltered` errors), embedded URLs stripped, no
  handoff node, no reactions — even Microsoft's own newest channel is the least capable renderer
  of its own schema.

---

## 3. Botpress

Botpress is a bot platform (v12 was open-source; the current product is Botpress Cloud) whose
current architecture treats channels as one kind of **integration** — the same plugin mechanism
used for tools and services — with a public SDK and a marketplace (Botpress Hub).

### 3.1 Channel abstraction

The runtime model ([Runtime API concepts](https://botpress.com/docs/api-reference/runtime-api/concepts),
[Conversation concept](https://botpress.com/docs/developers/concepts/conversation)) is a small
set of normalized entities:

- **Integration** — an installable package connecting the bot to an external service. Channel
  integrations (WhatsApp, Slack, Telegram, Discord, ...) are just integrations that define
  channels. First-party and community-built integrations coexist on
  [Botpress Hub](https://botpress.com/docs/integrations/get-started/introduction/) (50+ listed).
- **Channel** — a logical subdivision inside an integration (the docs' example: a GitHub
  integration might expose "issues" and "pull requests" as distinct channels).
- **Conversation** — "the interaction of multiple speakers sending messages"; every conversation
  belongs to a specific channel of a specific integration.
- **User** — a speaker; also scoped to an integration. The docs are explicit that the same
  person on WhatsApp and on Slack is **two distinct user records** — no native cross-channel
  identity linking.
- **Message** — belongs to a conversation and a user, with direction (incoming/outgoing).
- **Tags** — free-form string key-value metadata on conversations, users, and messages, declared
  in the integration definition.

**Normalized message types**: text, image, audio, video, file, location, card, choice, carousel,
and bloc (a composite container), each with a defined payload schema
([concepts](https://botpress.com/docs/api-reference/runtime-api/concepts)). This is essentially
the same vocabulary the Bot Framework converged on, minus Adaptive Cards.

**Conversation keying is done through tags**: the integration stamps the channel's native
identifiers onto the conversation as namespaced tags — for Slack,
`event.tags.conversation["slack:id"]` holds the Slack channel ID and
`event.tags.conversation["slack:thread"]` the thread timestamp
([Slack guide](https://botpress.com/docs/integrations/integration-guides/slack)). So instead of
a fixed `conversation.id` field with per-channel semantics (Bot Framework), Botpress uses an
open key-value namespace per integration. Same idea, looser schema — and it makes the mapping
inspectable and queryable (tags are filterable in the API).

**Fallback rendering** is not documented as a systematic mechanism the way Bot Framework's
connector downgrading is; the Slack guide instead warns that "rich text messages from your bot
may not be rendered properly in Slack" because Botpress emits standard Markdown while Slack uses
its proprietary `mrkdwn` dialect. Translation quality is per-integration, and gaps leak to the
bot author. **[unverified]** whether newer Botpress versions added automatic per-channel
downgrading of choice/carousel types.

### 3.2 Connection UX per channel

Botpress consistently offers **two paths per channel**: a one-click OAuth flow using a shared
Botpress-owned app, and a manual "bring your own app" path for custom needs.

- **Slack** ([guide](https://botpress.com/docs/integrations/integration-guides/slack)): either
  "Authorize Slack" OAuth, or create your own Slack app from a provided **app manifest** and
  paste four credentials (Bot User OAuth Token, Client ID, Client Secret, Signing Secret).
  Scopes cover channels, groups, and DMs. Options: custom bot name/avatar, a typing-indicator
  emoji reaction, and **reply threading** — the bot answers in a thread per incoming message,
  optionally only when @mentioned. That mention-gated threading is precisely the "@mention opens
  a session in a thread" UX.
- **Telegram** ([guide](https://botpress.com/docs/integrations/integration-guides/telegram)):
  message BotFather, paste one bot token. Minutes of work; the floor of channel setup cost.
- **WhatsApp** ([guide](https://botpress.com/docs/integrations/integration-guides/whatsapp/introduction)):
  three tiers — a **sandbox playground** (test without any Meta setup), **embedded signup**
  ("Authorize WhatsApp" — Meta's hosted flow that creates the WhatsApp Business Account for
  you), and fully manual (bring a Meta developer app: Access Token, Client Secret, Phone Number
  ID, WhatsApp Business Account ID, webhook Verify Token). The pain is unavoidable and Meta-side:
  "Until Meta has verified your business, your bot won't be able to send messages to WhatsApp
  users" — you need a Facebook business page, a WhatsApp Business Account, and a completed Meta
  business verification before production traffic. Conversations are keyed by phone number,
  which is what makes proactive/webhook-initiated messaging possible. Template messages support
  only positional (not named) parameters.
- **Discord, Messenger, Instagram, LINE, Teams, email, SMS(Twilio)**: available on the Hub; mix
  of first-party and community. **[unverified]** exact first-party/community split per channel —
  the Hub labels builders but I did not enumerate the full list.

### 3.3 Sessions, group chats, identity

Conversations persist as records; the docs surveyed do not describe a session timeout at the
conversation layer (dialog state expiry is a separate concern). **[unverified]** default state
TTL. Group-chat handling is delegated to the integration: in Slack, the bot is added to a
channel and responds there (optionally only to mentions, in threads); each speaker arrives as
their own integration-scoped user, so the bot logic does see distinct speakers within one
conversation. RBAC on the platform side governs who edits the bot (workspace roles), not who may
talk to it in a channel; talk-permission is whatever the surface itself enforces (who can join
the Slack channel, who has the Telegram bot link). **[unverified]** any Botpress feature for
restricting which channel members may invoke the bot.

### 3.4 Human handoff (HITL)

Botpress ships **HITL (Human-in-the-Loop)** as an official integration plus plugin
([HITL docs](https://botpress.com/docs/integrations/integration-guides/hitl/introduction)):
an "Escalate to a Human" card is dropped anywhere in a workflow; the conversation then appears
in a HITL inbox tab in the Botpress dashboard where human agents "review conversation history,
assign conversations to themselves or teammates, resolve user issues, and pass the conversation
back to the bot." Escalation triggers can be workflow conditions (low KB confidence, user
frustration). Team/Enterprise plans only. There is also a lower-level
[HITL API integration](https://botpress.com/integrations/human-in-the-loop-api) for wiring
escalation into external agent consoles. Same shape as Microsoft's: escalation routes the
conversation to a human inbox; the human replies through the same channel the user is on.

### 3.5 What reaches the bot logic

Every event carries the integration-namespaced tags (conversation, user, message IDs of the
native surface), the normalized user record, and the conversation history stored by the runtime.
Bot logic can read `event.tags.*` to branch on channel specifics, which is the Botpress analog
of `channelData`.

---

## 4. Voiceflow

Voiceflow is a conversation-design platform (originally for Alexa/Google voice apps, now
"chat and voice agents"). It is the interesting **counter-example**: it largely did *not* build
a channel matrix.

### 4.1 Channel model: an API, not a matrix

Voiceflow's deployment surfaces ([docs](https://docs.voiceflow.com/docs/welcome)) are:

- **Web chat widget** (native, first-party) — embed in a site or mobile app.
- **Telephony** (native) — inbound/outbound phone calls.
- **Dialog Manager / Conversations API** (the real channel story) — "Deliver your agent on any
  channel or custom interface via our Conversations API."

The [Dialog Manager API](https://docs.voiceflow.com/reference/overview) is a stateless-ish HTTP
interface: you POST a user turn to `/state/user/{userID}/interact` and get back a list of
**traces** — normalized response primitives (speak/text, choice buttons, cards, custom traces)
that *your* channel adapter renders into Slack blocks, WhatsApp interactive messages, or
whatever the surface needs. Session state is keyed **entirely by the `userID` you choose**; the
platform "maintains an independent conversation session per userID." State can be fetched,
mutated, or deleted via `/state/user/{userID}` ([state docs](https://docs.voiceflow.com/reference/state)),
and a second API variant passes the full state back and forth each turn so Voiceflow stores
nothing. This means conversation keying strategy — per-person, per-thread, per-channel — is
**your** decision encoded in how you construct the userID string (e.g. concatenating Slack
channel + thread ids). **[unverified]** the exact current default session TTL for stored state.

### 4.2 Channels supported: mostly community glue

Slack, WhatsApp, Telegram, Discord, and similar exist as **community example repositories**, not
first-party managed connectors: the docs' Slack page is the
[voiceflow-community/voiceflow-slack](https://docs.voiceflow.com/docs/deploy-slack) repo; the
WhatsApp page is a community example wiring the WhatsApp Cloud API to the DM API
([example-integration-whatsapp](https://docs.voiceflow.com/docs/deploy-whatsapp)); third parties
(FlowBridge, HitlChat, Seasalt.ai) sell hosted bridges. A 2026 review notes WhatsApp routing
"through Twilio's WhatsApp Business API, not Meta-BSP-direct" and no native WhatsApp channel
launch as of 2026 ([search summary](https://chatbotscape.com/reviews/voiceflow-review))
**[unverified]** in detail. The marketing site lists Slack/Teams/WhatsApp "integrations," but
these resolve to the API-plus-glue-code pattern, not a click-to-connect channel matrix.

The lesson in the counter-example: a platform can thrive on **"we normalize the conversation
turn; you own the last mile per channel."** The cost is that every per-channel concern in this
research — group chat, threading, identity, Meta verification, fallback rendering — falls on the
customer's adapter code. The community repos exist precisely because every customer kept
rebuilding the same glue.

### 4.3 Handoff and group chat

Human handoff is likewise integration-level: Voiceflow agents hand off to Zendesk/Salesforce
et al. through integrations or custom API calls **[unverified]** in mechanism detail; third-party
products (HitlChat) exist to add a HITL inbox on top. Group-chat semantics are undefined at the
platform level — whatever the adapter encodes into the userID/state key.

---

## 5. Cross-vendor synthesis: lessons for an Agenta channels feature

### 5.1 The channel abstraction, distilled

All three converge on (or deliberately punt to the customer) the same four-layer stack:

1. **A normalized message/event schema** with a small vocabulary of types — text, choice
   (buttons), card, carousel, image/audio/video/file, location — plus typing/receipt events.
   Bot Framework's Activity and Botpress's message types are near-identical vocabularies;
   Voiceflow's traces are the same idea over HTTP.
2. **A per-channel translator** owning both directions, with **fallback rendering** (buttons →
   numbered text list; card → image + links) when the surface can't render a type. The mature
   platforms *document a capability matrix* (Copilot Studio's channel experience reference
   table) instead of pretending translation is lossless.
3. **An escape hatch** for channel-native payloads (Bot Framework `channelData`; Botpress
   namespaced tags + raw integration events). Every vendor needed one; normalization is always
   leaky.
4. **Per-channel conversation keying behind a uniform identity**: `(channelId,
   conversation.id)` in Bot Framework, integration-namespaced tags (`slack:id`, `slack:thread`)
   in Botpress, caller-chosen `userID` in Voiceflow. Thread-scoped sessions (the Agenta model)
   map exactly onto Slack thread-ts / Teams conversationType=channel replies, and both Botpress
   (mention-gated reply threading) and Copilot Studio (@mention in team channels with
   conversation-history access) already ship that UX.

Two structural warnings from Bot Framework's decade of scars: **version the translators**
(schema transformation versions — upstream channel APIs churn and translation fixes break bots
that depended on old behavior), and **expect channel death** (Kik, Skype, Cortana are all
tombstones in the current channel list).

### 5.2 Identity and cross-surface continuation

None of the three has native cross-channel identity linking. Botpress explicitly stores the same
human as two user records on two integrations; Bot Framework identity is per-channel
ChannelAccount; Copilot Studio reaches cross-channel identity only when end-user authentication
(Entra sign-in) is enabled. Agenta's "continue the session from another surface" is therefore a
genuine differentiator — but the prior art says it requires an explicit account-linking step
(auth) rather than heuristics, and Copilot Studio's group-chat restriction (no user-scoped
knowledge sources in group contexts, to avoid leaking one member's access to the room) is the
key safety precedent for multi-user sessions.

### 5.3 Per-channel setup cost ranking (cheapest → most painful)

1. **Telegram** — paste one BotFather token (Botpress: minutes).
2. **Discord** — bot token + intents; comparable to Telegram **[unverified]** per-vendor detail.
3. **Slack** — either shared-app OAuth (one click) or bring-your-own app via a provided
   manifest + 4 credentials; workspace-admin approval may gate installation.
4. **Teams** — technically trivial (Microsoft handles auth), organizationally heavy: tenant
   policy must permit the app, org-wide reach requires admin approval of a store submission,
   metadata changes require re-approval, aggressive caching causes stale-version support
   tickets.
5. **Email** — first-party only in the Microsoft stack (M365 mailbox); niche elsewhere.
6. **WhatsApp** — the deep end: WhatsApp Business Account, Facebook business page, **Meta
   business verification** (days-to-weeks, blocks all production sends), phone number
   registration, template-message approval for business-initiated messages, and either Meta's
   embedded-signup flow (Botpress), an intermediary BSP (Copilot Studio via Azure Communication
   Services; Voiceflow via Twilio), or raw Cloud API credentials. Every vendor either built an
   embedded-signup flow, hid behind an intermediary, or punted to the community — none makes
   WhatsApp cheap. Sandbox/playground numbers for pre-verification testing are the standard
   mitigation.

### 5.4 Human-in-the-loop pattern

Both mature platforms model escalation as **conversation routing to a human inbox with history
and variables attached** (Botpress HITL tab; Copilot Studio Transfer-conversation → engagement
hub), triggered explicitly or by workflow conditions, with a pass-back-to-bot transition. The
Agenta channels idea — approvals flowing through the same channel as the conversation — is
*not* their pattern; their human is a support agent in a console, not a teammate in the thread.
Closest precedent for in-thread approval is Copilot Studio's Adaptive Card Action.Submit
buttons (which do work, capped at 3, even on WhatsApp), i.e. the building blocks exist in the
normalized schema (choice/card types) but no studied vendor ships "approve in Slack thread" as
a product feature.

---

## 6. Open questions for a deeper pass

- Botpress: does the current runtime auto-downgrade choice/carousel per channel, or is fallback
  fully delegated to each integration? Read the integration SDK source for Slack/WhatsApp (open
  on GitHub) to see real translator implementations and their edge-case handling.
- Botpress: conversation/dialog state TTL and its interaction with channel threads (does a new
  Slack thread always open a fresh conversation record?).
- Copilot Studio generic handoff protocol: the wire format (it rides Direct Line) is a candidate
  blueprint for an Agenta handoff/approval event schema — worth reading in full.
- Teams deep-dive: proactive messaging (bot-initiated thread creation) and the conversation
  reference model, which the summary pages don't cover.
- Voiceflow: whether 2026-era "native integrations" for Slack/Teams on paid tiers are real
  managed connectors or still hosted glue **[unverified]** either way from marketing pages.
- Pricing/packaging: all three gate channels or HITL by plan tier (Botpress HITL =
  Team/Enterprise); a deeper pass should map which channels are premium across vendors.
- The newer agent-platform generation (Relevance, Dust, Lindy, CrewAI et al.) — out of scope
  here — should be compared against this decade-old baseline to see which of these lessons they
  relearned or skipped.
