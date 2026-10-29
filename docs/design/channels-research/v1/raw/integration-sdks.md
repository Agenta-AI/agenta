# Integration SDKs: how platforms define a stable, versioned channel-provider contract

This document surveys how five mature platforms let third parties add messaging channels
(or, more generally, integrations) to a product they do not control. The question behind
the survey: Agenta is self-hosted and open source, and its channels feature (agents
connected to Slack, Telegram, and similar surfaces, where a thread is a session and
approvals happen in-channel) must let self-hosting users add channels themselves,
including channels we cannot even test against, such as WeCom or Feishu. So we need a
contract a stranger can implement, not a plugin folder only we understand.

The five subjects, chosen because each represents a distinct answer to that question:

1. **Botpress** — a chatbot platform whose entire channel and tool surface is built from
   third-party "integrations" written against a TypeScript SDK and published to a hub.
2. **Microsoft Bot Framework / Azure Bot Service** — the decade-hardened answer: one
   normalized message schema (the Activity), a hosted per-channel translation service
   (the Channel Connector), and a versioned HTTP protocol for custom channels (Direct
   Line).
3. **Chatwoot** — an open-source support inbox whose channels are typed database records,
   plus a first-party generic "API channel" that is itself the extensibility story.
4. **Novu** — open-source notification infrastructure whose providers are in-tree
   TypeScript classes contributed by the community via pull request.
5. **Home Assistant and n8n** — not messaging products, but the two dominant governance
   patterns for letting users of a self-hosted product install community integrations
   without forking it.

Each section extracts the same things: what the provider declares, what callbacks it
implements, how delivery and errors work, how the contract is versioned, how the code is
packaged and distributed, and how identity and conversations are keyed.

---

## 1. Botpress: integrations as declared contracts, deployed to a hub

Botpress (https://github.com/botpress/botpress) is a cloud chatbot platform. Everything
that connects a bot to the outside world — Slack, Telegram, Linear, GitHub, an LLM
provider — is an **integration**: a TypeScript package written against `@botpress/sdk`,
built and deployed with `@botpress/cli`, and installed into bots either privately or from
the public Botpress Hub. The integration framework is the most complete "channel SDK"
in this survey and the closest analog to what Agenta would build.

Primary sources: the concepts page
(https://botpress.com/docs/integrations/sdk/integration/concepts), getting started
(https://botpress.com/docs/integrations/sdk/integration/getting-started), messaging
(https://botpress.com/docs/integrations/sdk/integration/messaging), and hub publishing
(https://botpress.com/docs/integrations/sdk/integration/publish-your-integration-on-botpress-hub).

### Anatomy of an integration

An integration is two files plus generated glue:

- **`integration.definition.ts`** — the *declaration*. It exports a data structure
  describing "what it is, what it can do, and how it can be used": name, version, title,
  description, icon, readme, and then the five contract surfaces below. Schemas are
  written in Zod (a TypeScript schema library); Botpress renders configuration schemas
  as forms in its Studio UI and type-checks everything else against them.
- **`src/index.ts`** — the *implementation*. It exports an `Integration` object whose
  shape must match the definition. The CLI (`bp init`, `bp build`, `bp deploy`) generates
  types from the definition so the implementation cannot drift from the declaration.

The declared surfaces:

- **`configurations`** — one or more named configuration schemas (e.g. a Linear
  integration declares `apiKey: { title, description, schema: z.object({ apiKey:
  z.string() }) }`; GitHub declares two alternatives, `manualApp` and `manualPAT`).
  Multiple named configurations means an integration can offer alternative auth modes as
  first-class options rather than one mega-form.
- **`channels`** — the messaging part. A channel represents one communication medium
  inside the external platform (a GitHub integration declares `pullRequest` and `issue`
  channels; a chat platform would declare `dm`, `channel`, `thread`). Each channel
  declares:
  - **`messages`** — the message types it can send, each with a Zod schema, e.g.
    `messages: { text: { schema: z.object({ text: z.string() }) } }`. Botpress ships a
    standard set of message types (text, image, audio, video, file, card, carousel,
    choice, dropdown, location...) and recommends implementing all of them so bots behave
    uniformly across channels.
  - **`conversation.tags`** — declared metadata keys that bind an external conversation
    to a Botpress conversation, e.g. `tags: { id: { title: 'Conversation ID',
    description: 'The ID of the conversation in the external service' } }`. Tags are
    string values (max 500 chars) and are queryable: they are the join keys of the whole
    system.
- **`actions`** — operations a bot can invoke on the external service, each with input
  and output schemas. These surface as cards in the Studio workflow editor.
- **`events`** — things that happen in the external service that bots can subscribe to
  (e.g. Slack's `memberLeftChannel`, GitHub's `pullRequestOpened`), each with a payload
  schema.
- **`states`**, **`user.tags`**, **`secrets`** — typed state scoped to conversation /
  user / global; declared user metadata keys; and integration-global secrets prompted at
  deploy time (not per-bot).

### The implementation lifecycle

The implementation exports five things:

- **`register`** — called when a bot installs/enables the integration with a given
  configuration. This is where the integration validates credentials and installs
  webhooks on the external service. It must `throw new sdk.RuntimeError('...')` on bad
  configuration; the error surfaces to the installing user.
- **`unregister`** — teardown: remove webhooks, revoke tokens.
- **`handler`** — the single inbound entrypoint. Botpress provisions one webhook URL per
  integration installation; every HTTP request the external service sends to that URL
  invokes `handler`. Inside it, the integration normalizes the platform event and pushes
  it into Botpress with three idempotent API calls:
  1. `client.getOrCreateConversation({ channel: 'webhook', tags: { id: conversationId } })`
  2. `client.getOrCreateUser({ tags: { id: userId } })`
  3. `client.createMessage({ type: 'text', conversationId, userId, payload: { text }, tags: {} })`
  The get-or-create-by-tag pattern is what makes inbound delivery safe to retry and what
  keys identity: the external IDs live in tags, the platform owns its own IDs.
- **`channels`** — outbound: for each declared channel and message type, a handler
  `channels.webhook.messages.text = async (props) => { ... }` receives the Botpress
  conversation (with its tags, so the external conversation ID is recoverable), the typed
  payload, and an `ack` mechanism, and calls the external platform's send API.
- **`actions`** — one async function per declared action.

Integrations run as managed serverless functions inside Botpress Cloud; the author never
hosts anything. **[unverified]** the exact runtime (the docs describe deployment via
`bp deploy` but not the execution substrate).

### Interfaces: contracts above integrations

Botpress also defines **interfaces**: standard schema contracts that integrations can
implement, so bots can depend on a capability rather than a concrete vendor
(https://botpress.com/docs/integrations/sdk/interface/how-tos/implementing-hitl). The
LLM interface makes any integration extending it an interchangeable LLM provider. The
HITL (human-in-the-loop) interface is directly relevant to Agenta's approvals story: a
HITL provider must expose actions to create a session, add messages to it, and close it,
plus emit webhook events for closure, assignment, and agent replies. This is a
worked example of "escalate to a human in an external tool" specified as a reusable
contract rather than per-vendor code.

### Versioning and distribution

The definition carries a `version` field. Publishing to the hub is a dashboard action
("Make Public") plus a manual review: Botpress requires workspace profile info, `title` /
`description` / `icon` / `readme` in the definition, `icon.svg` and `hub.md` in the repo
root, and demonstrable error handling (`RuntimeError` on bad config); verification is
requested explicitly and Botpress tests the integration, asking for a demo bot shared
with `hub-applications@botpress.com`. Bots install a specific integration version and
upgrade explicitly. **[unverified]** the precise semver enforcement rules (the public
docs describe the review gates but not version-bump mechanics; the CLI refuses to
redeploy a public version in place, per community reports).

### What to take from Botpress

The load-bearing ideas: (a) a *declaration file* separate from the implementation, with
schemas for everything, so the platform can render UI, validate config, and type-check
handlers; (b) **tags as the universal identity join** (conversation tags, user tags,
message tags — external IDs are metadata on platform-owned entities, and get-or-create
queries on tags make inbound idempotent); (c) channels declaring their message-type
matrix explicitly instead of promising "supports messages"; (d) interfaces as named
capability contracts above concrete integrations.

---

## 2. Microsoft Bot Framework: one schema, per-channel connectors, a versioned HTTP protocol

The Bot Framework is the oldest and most battle-tested design in this survey (2016 to its
archival in December 2025 — note the SDK is now archived in favor of the Microsoft 365
Agents SDK, per https://learn.microsoft.com/en-us/azure/bot-service/bot-builder-basics,
which changes nothing about the architectural lessons). Its three-part shape — normalized
schema, hosted connectors, versioned client protocol — is the reference architecture for
"bot talks one protocol; someone else absorbs channel weirdness."

### The Activity schema

The **Activity** is the single wire object for everything that happens in a conversation.
The spec lives at
https://github.com/Microsoft/botframework-sdk/blob/main/specs/botframework-activity/botframework-activity.md.
An activity is a flat JSON object of name/value pairs. The fields worth internalizing:

- **`type`** — what kind of activity this is (see the type list below). Custom types are
  allowed; receivers must ignore types they do not understand.
- **`channelId`** — which channel the activity belongs to; establishes which store is
  authoritative. Required on every activity.
- **`id`** — assigned by the channel after it records the activity (senders omit it).
- **`serviceUrl`** — the URL where replies to this activity may be POSTed. This is how
  the protocol stays symmetric: the bot replies by calling back to the channel's own
  service endpoint, so any number of channel services can exist.
- **`from`** / **`recipient`** — channel-account objects (`id` + optional `name`)
  identifying the sender and the single intended recipient.
- **`conversation`** — the conversation identifier plus optional metadata (name,
  `isGroup`). Conversation IDs are channel-scoped: `(channelId, conversation.id)` is the
  global key.
- **`replyToId`** — reference to a prior activity; this is how threading is expressed.
- **`timestamp`** / `localTimestamp` / `localTimezone` — channel-recorded UTC time vs.
  origin-local time.
- **`text`** + **`textFormat`** (`markdown` | `plain` | `xml`) — message content.
- **`attachments`** + `attachmentLayout` — cards, files, rich content.
- **`suggestedActions`** — ephemeral quick-reply buttons.
- **`entities`** — a flat list of typed metadata objects (mentions, geo, schema.org
  types); receivers must ignore unknown entity types.
- **`channelData`** — the escape hatch: an opaque, channel-defined blob for anything the
  normalized schema cannot express (e.g. a raw Slack block kit payload). Every serious
  normalization layer ends up needing exactly this field.
- **`deliveryMode`** — `normal` | `notification` | `expectReplies` (the latter asks the
  receiver to return replies synchronously in the HTTP response body instead of via
  `serviceUrl` — the sync-vs-async switch is *in the schema*).
- **`inputHint`**, `speak`, `locale`, `summary`, `importance`, `expiration`, `value`,
  `semanticAction`, `callerId`, `relatesTo` — speech/UX/routing refinements.

Activity **types**: `message`, `conversationUpdate` (members added/removed),
`event` (async app-to-bot signal) and its synchronous twin `invoke`, `typing`,
`messageReaction`, `messageUpdate`, `messageDelete`, `endOfConversation`,
`installationUpdate` (bot added/removed from an org unit), `suggestion`, `trace`
(debug-only), `handoff`, `command`/`commandResult`, `contactRelationUpdate`. For Agenta
this taxonomy is a checklist: a channels design that only models `message` will
rediscover `conversationUpdate`, `messageReaction`, `typing`, and `installationUpdate`
the hard way.

**Versioning strategy.** The spec's compatibility mechanism is deliberately boring:
requirement A2005 says senders may include extra fields and receivers must accept fields
they do not understand; A2014 says bots and clients ignore unknown activity types. The
schema evolves additively (the spec carries a change log; the published
`botframework-schema` npm package tracks it) and the *protocol* endpoints carry the
version (`/v3/...`), not the payload. The specific phrase "schema transformation
versions" does not appear in the current spec; the transformation idea lives in the
connector instead (next section) — **[unverified]** whether an older spec revision used
that exact term.

### The Channel Connector service model

Bots implement exactly one HTTP contract: receive an Activity by POST at their messaging
endpoint, reply by POSTing Activities to the Bot Connector REST API at the activity's
`serviceUrl`, all within a turn (bots must 200 the inbound POST within ~15 seconds).
Microsoft operates a **per-channel connector service** that translates between the
Activity schema and each platform's native schema — and, critically, *degrades* content
the channel cannot render: "if the bot sends a message that contains a card with action
buttons to the email channel, the connector might send the card as an image and include
the actions as links in the body of the email"
(https://learn.microsoft.com/en-us/azure/bot-service/bot-service-manage-channels).
Down-conversion is the connector's job, not the bot's. Channel capability differences
are documented per channel rather than abstracted away, and `channelData` lets a bot
opt out of normalization for one channel when it must.

The **BotAdapter** is the same translation seam moved in-process
(https://learn.microsoft.com/en-us/azure/bot-service/bot-builder-basics). The adapter's
*process activity* method takes the raw HTTP request, authenticates it, deserializes the
Activity, builds a **TurnContext** (the per-turn object carrying the inbound activity and
the send/update/delete-activity methods), runs a middleware pipeline, and calls the bot's
turn handler. The SDK explicitly supports **channel adapters** — adapters that "perform
the tasks that the Bot Connector Service would normally do for a channel" — and a
community ecosystem (Botkit, Bot Builder Community) shipped adapters for Slack, Twilio,
and others. So the same architecture supports both topologies: hosted connector service
(Microsoft runs the translation) and in-process adapter (you run it). The contract — the
Activity — is identical in both.

### Direct Line: the custom channel as a product

**Direct Line API 3.0**
(https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-direct-line-3-0-concepts)
is Microsoft's generic HTTP channel: a versioned REST + WebSocket protocol that lets
*any* client — a web page, a mobile app, or a bridge to an unsupported messaging platform
— converse with a bot without Microsoft supporting that surface. The contract:

- **Auth**: a channel **secret** (configured in the portal) or, preferably, a short-lived
  **token** minted from the secret at runtime, scoped to one conversation.
- **Conversations**: the client explicitly opens one (`POST
  /v3/directline/conversations`), receiving a `conversationId` and a streaming URL.
- **Send**: `POST /v3/directline/conversations/{id}/activities`, one Activity per
  request.
- **Receive**: WebSocket stream, or `GET .../activities?watermark=N` polling; either way
  the client receives an **ActivitySet** (a batch of activities plus a watermark cursor —
  resumable, at-least-once delivery with client-side dedup by watermark).
- **Versioning**: the version is in the URL path (`/v3/`), and Direct Line's pitch is
  explicitly that it is "a stable contract... even if the underlying bot protocol
  changes." Microsoft's own products build on it: Dynamics 365 Contact Center's
  "bring your own channel" instructs partners to implement custom channel connectors
  *against Direct Line* (https://learn.microsoft.com/en-us/dynamics365/customer-service/develop/bring-your-own-channel).

That last point is the pattern to notice: when Microsoft itself needed third parties to
add channels it does not run, the answer was not "write a plugin," it was "here is a
versioned HTTP protocol; bridge your platform to it."

---

## 3. Chatwoot: channels as typed records, and the API channel as the extension point

Chatwoot (https://github.com/chatwoot/chatwoot) is an open-source, self-hostable customer
support inbox — the product in this survey closest to Agenta's deployment model.

### The Inbox/Channel data model

An **Inbox** is the user-facing routing entity (agents are assigned to inboxes;
conversations belong to an inbox). Each inbox has exactly one **Channel**: a polymorphic
association to a typed record (`Channel::Telegram`, `Channel::Api`, ...) that stores the
channel-type-specific configuration (tokens, phone numbers, webhook URLs). The built-in
channel classes, from `app/models/channel/` on the `develop` branch
(https://github.com/chatwoot/chatwoot/tree/develop/app/models/channel): `api`, `email`,
`facebook_page`, `instagram`, `line`, `sms`, `telegram`, `tiktok`, `twilio_sms`,
`twitter_profile`, `web_widget`, `whatsapp`.

Conversation keying: each conversation carries a **`source_id`** — the identifier of the
contact/conversation in the source channel (a Telegram chat ID, a widget session token).
A `ContactInbox` join record maps (contact, inbox, source_id), so one person can exist on
several channels and each channel keeps its native key. This is the same move as Botpress
tags, expressed relationally.

Channel types are **in-tree Ruby classes**: adding a native channel type means forking
core. Chatwoot's answer to "channel we don't support" is not a plugin API — it is a
first-party generic channel:

### The API channel: the exact contract

The **API channel** (https://www.chatwoot.com/docs/product/channels/api/create-channel)
is a channel type whose "platform" is *you*. Creating one yields two things: an
**`inbox_identifier`** and a **callback webhook URL you provide**. The contract has two
halves:

**Inbound (your platform → Chatwoot)** — the Client API, unauthenticated by account
token, keyed instead by the identifiers themselves
(https://developers.chatwoot.com/, endpoints verified via the API reference):

1. Create a contact: `POST /public/api/v1/inboxes/{inbox_identifier}/contacts` →
   returns a **`source_id`** (also called `contact_identifier`) and a `pubsub_token`
   (for optional WebSocket real-time updates).
2. Create a conversation:
   `POST /public/api/v1/inboxes/{inbox_identifier}/contacts/{contact_identifier}/conversations`
   → returns a conversation ID (returns the existing conversation if one is already
   open).
3. Create a message:
   `POST /public/api/v1/inboxes/{inbox_identifier}/contacts/{contact_identifier}/conversations/{conversation_id}/messages`
   with `content` and `message_type` (`incoming` = end-user, `outgoing` = agent). GETs
   exist at each level for listing.

**Outbound (Chatwoot → your platform)** — Chatwoot POSTs JSON events to the callback URL
configured on the inbox. The event vocabulary (shared with account-level webhooks,
https://www.chatwoot.com/hc/user-guide/articles/1677693021-how-to-use-webhooks):
`conversation_created`, `conversation_updated`, `conversation_status_changed`,
`message_created`, `message_updated`, `contact_created`, `contact_updated`,
`conversation_typing_on/off`, `webwidget_triggered`. Payloads carry the full message +
conversation + inbox + account objects plus an `event` field; your bridge filters for
`message_type: outgoing` on `message_created` and relays it to the real platform.
Requests are signed with `X-Chatwoot-Signature` (HMAC-SHA256, `sha256=` prefix) and
`X-Chatwoot-Timestamp` headers **[unverified** for the API-inbox callback specifically —
verified for account webhooks].

So a WeCom bridge for Chatwoot is a stateless ~200-line web service: WeCom webhook →
Client API POSTs; inbox callback → WeCom send API; `source_id` = the WeCom user key.
No Chatwoot code modified, works on any self-hosted instance, survives upgrades because
the Client API is a public, documented, versioned (`/api/v1/`) HTTP surface. The
community has built dozens of such bridges. The trade-off: the bridge is an extra
deployable the user must run and monitor, and rich content is limited to what the
Client API models (Chatwoot added attachment support to it later; content degradation is
the bridge author's problem, there is no connector doing down-conversion for you).

---

## 4. Novu: in-tree provider classes behind a factory

Novu (https://github.com/novuhq/novu) is open-source notification infrastructure: one
API to send notifications across email, SMS, push, chat, and in-app, with ~50+
**providers** per-channel (SendGrid, Twilio, Slack, FCM...). Its extension model is the
opposite pole from Chatwoot's: providers are **code in the monorepo**, contributed by
community PR (https://docs.novu.co/community/add-a-new-provider).

The contract is a per-channel TypeScript interface. A provider is a class in
`packages/providers/src/lib/[channel]/[provider-name]` (scaffolded by
`pnpm run generate:provider`):

```typescript
export class ExampleProviderEmailProvider implements IEmailProvider {
  id = 'example-provider';
  channelType = ChannelTypeEnum.EMAIL;
  async sendMessage(options: IEmailOptions): Promise<ISendMessageSuccessResponse> { ... }
}
```

Every channel type has the same shape: an `id`, a `channelType`, and an async
`sendMessage(options) → { id, date }` (the returned `id` is the provider-side message ID,
kept for status tracking). Alongside the class, a contributor must register metadata in
several hard-coded lists: credential field descriptors
(`IConfigCredentials[]` — key, displayName, type, required — which drive the dashboard's
credential form), the provider ID enum, the providers list entry (id, displayName,
channel, credentials, logo), and a handler + factory registration
(`libs/application-generic/src/factories/mail/handlers/...` extending `BaseHandler`, with
`buildProvider(credentials)` instantiating the class; registered in `mail.factory.ts`).

What to notice: (a) the *interface* is minimal and one-directional — notifications are
fire-and-forget sends, so there is no inbound half, no conversation identity, and the
whole contract fits in one method; (b) the credential schema is data, not code, so the
dashboard renders provider config forms generically — same move as Botpress
`configurations` and a pattern Agenta should copy regardless of packaging; (c) the cost
of in-tree: adding a provider touches ~8 files across 4 packages, ships only with the
next Novu release, and self-hosters cannot add one without building from a fork. Novu
accepts this because providers are commodity API wrappers with tiny contracts; channel
integrations with webhooks, threading, and identity are much bigger, which is why
Botpress and Chatwoot chose differently.

---

## 5. Governance patterns: Home Assistant and n8n

Two non-messaging products define the state of the art for "self-hosted product, users
install community integrations, core team keeps quality without gatekeeping."

**Home Assistant** ships ~2000 built-in integrations in-tree, but also loads **custom
integrations** from a `custom_components/<domain>/` directory: the same Python package
shape as built-ins (a `manifest.json` with domain, version, requirements; a
`config_flow.py` defining the UI setup wizard), just dropped into the user's config
directory — custom code overrides built-ins with the same domain
(https://developers.home-assistant.io/docs/creating_integration_manifest/). Distribution
is delegated to **HACS**, the Home Assistant Community Store (https://www.hacs.xyz/), a
community-run catalog that installs custom integrations from GitHub repos and manages
updates — itself a custom integration, not part of core. Quality is governed by the
**Integration Quality Scale** (https://developers.home-assistant.io/docs/core/integration-quality-scale/):
bronze/silver/gold/platinum tiers, defined as explicit checklists (bronze is mandatory
for new core integrations; progress is tracked in a `quality_scale.yaml` inside the
integration). The tier is displayed to users. The compatibility story is the weak spot:
custom components import core internals, so core releases routinely break them; HA
mitigates with the manifest `version` requirement, deprecation windows announced in
release notes, and the scale's requirements, but "my custom component broke on upgrade"
is a fact of life there — the cost of a code-level rather than wire-level contract.

**n8n** (workflow automation) distributes **community nodes as npm packages** named
`n8n-nodes-<name>` (https://docs.n8n.io/integrations/community-nodes/). A node package
implements n8n's TypeScript node interface and declares itself in its `package.json`;
self-hosted admins install any package by npm name from the UI or CLI. On top of the
open firehose (500+ packages), n8n added a **verified tier**
(https://docs.n8n.io/integrations/creating-nodes/build/reference/verification-guidelines/):
manually vetted nodes get a shield badge, appear in the in-editor catalog, and are
allowed on n8n Cloud; verification bans runtime dependencies and enforces security
guidelines. The cautionary tale: unverified npm install is a real supply-chain surface —
a January 2026 typosquatting campaign published credential-harvesting packages under
near-miss names of popular community nodes **[unverified** beyond secondary reporting].
The lesson is the two-tier shape itself: open distribution for reach, curated tier for
trust, with the trust signal rendered in-product.

---

## Cross-cutting synthesis

**Contract shapes.** Every system that handles *conversational* channels (Botpress, Bot
Framework, Chatwoot) converges on the same decomposition: a declaration of capabilities
and config schema (rendered as UI, validated by the platform); an inbound path that is
*idempotent by external key* (get-or-create conversation/user by tag or source_id); an
outbound path dispatched per message type; and lifecycle hooks (register/unregister,
webhook installation). Fire-and-forget systems (Novu) collapse to a single `sendMessage`.
Sync vs. async: everything is async webhooks + callback POSTs by default; Bot Framework
uniquely makes synchronous delivery a *schema flag* (`deliveryMode: expectReplies`) and
a paired type (`invoke` vs `event`) rather than a different architecture.

**Error/retry semantics.** Bot Framework: HTTP status codes with a 15-second turn
deadline; connectors retry. Chatwoot: standard webhook retry on non-2xx
**[unverified** — retry policy is not documented precisely]. Botpress: `RuntimeError`
as the typed, user-visible configuration failure; handler failures surface in
integration logs. The common floor: idempotent inbound writes so retries are safe, and
a distinguished "configuration is wrong, tell the human" error type.

**Versioning.** Wire contracts version in the URL path and evolve additively with
must-ignore-unknown-fields rules (Activity A2005, Direct Line `/v3/`, Chatwoot
`/public/api/v1/`). Code contracts version per-package (Botpress definition `version`,
HA manifest `version`, npm semver) and rely on the platform holding the SDK interface
stable. Wire contracts demonstrably survive a decade; code contracts demonstrably break
on core upgrades (Home Assistant) unless the interface surface is kept tiny (Novu).

**Packaging.** Four patterns, in increasing decoupling: in-tree PR (Novu, Chatwoot
native channels); installable code package (n8n npm, HA custom_components + HACS);
platform-hosted managed function (Botpress Hub); and pure HTTP contract with a
self-hosted bridge (Chatwoot API channel, Direct Line, Dynamics bring-your-own-channel).
For a self-hosted Python/TypeScript platform whose users must add channels the vendor
cannot test, the HTTP contract is the only pattern with no fork, no core release
dependency, no in-process code execution, and language freedom for the bridge author;
the code-package pattern is the right *second* layer for first-party and blessed
channels.

**Identity and conversation keying.** Unanimous: the platform owns its own conversation
and user IDs; the external channel's IDs are attached as queryable metadata (Botpress
tags; Chatwoot `source_id` + ContactInbox; Bot Framework scopes `conversation.id` under
`channelId`). Inbound resolution is always get-or-create by (channel instance, external
conversation key, external user key). No system tries to make the external ID the
primary key.

---

## Contract design lessons for Agenta

The shortlist of interface shapes worth copying, with trade-offs:

1. **Make the extensibility story a versioned HTTP contract, not a plugin API — the
   "generic channel" IS the SDK.** Copy Chatwoot's API channel / Direct Line: a
   first-party channel type whose config is (a callback URL you POST events to) + (a
   token for calling us), with inbound endpoints under a versioned path
   (`/api/v1/channels/{channel_app_id}/...`) that get-or-create session and identity by
   external keys, and signed outbound webhooks with a small, enumerated event
   vocabulary. A WeCom bridge then needs zero Agenta code and survives every upgrade.
   Trade-off: the user runs an extra service; accept it — every alternative (in-tree,
   in-process plugin) costs a fork or a release train, which the WeCom requirement rules
   out. Build Agenta's own Slack/Telegram channels *on this same contract* (as bundled
   bridges) so the contract is exercised first-party — the Bot Framework connector model.
2. **One normalized event object with an explicit type taxonomy and a per-channel escape
   hatch.** Steal the Activity checklist: message, message-edit/delete, reaction,
   membership change, typing, installation update, plus `replyToId` for threading and a
   `channel_data` opaque blob for native payloads. Skipping the non-message types now
   means schema churn later; the escape hatch is what keeps the normalized core small.
3. **Declaration as data: capabilities, message-type matrix, and config schema are
   fields the channel app registers, not code.** From Botpress definitions and Novu
   credential descriptors: a registered channel app declares which event types it emits,
   which message/content types it can render (so Agenta can down-convert or refuse
   up-front, like the connector's card-to-image degradation), and a JSON-schema for its
   config so the dashboard renders setup forms for channels we have never heard of.
4. **Key identity the way everyone does: platform-owned IDs, external IDs as queryable
   links.** Entities: `connection` (credentialed link to one external workspace/app
   instance), `channel_app` (the provider registration), `identity_link` (external user
   ↔ Agenta user), session keyed by (connection, external conversation ID). Inbound is
   get-or-create on those keys — which also buys idempotent webhook retries for free.
5. **Version the wire path, evolve additively, and write the must-ignore rule into the
   spec** (Activity A2005). Never version by payload field; never break by removing.
   The bridge authors we will never meet depend on exactly this discipline.
6. **A distinguished configuration-error surface.** Botpress `RuntimeError` on register:
   the contract needs a way for a channel app to say "my config/credentials are bad" that
   renders to the human who configured it, distinct from transient delivery failures
   (which get retries).
7. **Sync-in-the-schema for approvals.** Approvals-in-channel need a
   request/response exchange; model it as Bot Framework does — an `invoke`-style event
   type or `expectReplies` delivery flag inside the same event schema — rather than a
   second protocol.
8. **Two-tier distribution, deferred.** When a catalog of community channel bridges
   emerges, copy n8n/HA governance: open listing (a repo directory of bridges, like
   HACS) plus a verified tier with a visible badge and security rules; and an HA-style
   quality checklist as data. Not needed for v1 — the HTTP contract makes distribution
   literally anyone's problem — but the typosquatting incident says never auto-install
   community code without a curated tier.
9. **Consider a named capability layer later** (Botpress interfaces): "HITL provider,"
   "approval surface" as contracts multiple channel apps satisfy, so product features
   depend on capabilities, not on Slack.
