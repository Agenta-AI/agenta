# Teams conversation

## Purpose

Accept only genuine Teams requests for the connected bot and tenant, turn each Teams activity into an Agenta inbound event, map Teams places to Agenta spaces and threads, and decide which messages address the agent.

## ADDED Requirements

### Requirement: Messaging route
The channels ingress SHALL accept `POST /teams/events/` under both `/channels` and `/preview/channels`, SHALL list the four path forms in `_PUBLIC_ENDPOINTS`, and SHALL answer an accepted request with 202 and the shared `ChannelEventAck` body.

#### Scenario: Accepted message
- **WHEN** Teams posts a valid message activity for a connected bot
- **THEN** the route SHALL store the event, enqueue its dispatch and answer 202 with `{"status": "accepted"}`

#### Scenario: No session cookie or API key
- **WHEN** the request carries only the Teams `Authorization: Bearer` header
- **THEN** the auth middleware SHALL let it through to the route, because the path is a public endpoint

### Requirement: Connection guess from the activity
`connection_locator` SHALL return `{"app_id": <bare app id>}` read from the activity's `recipient.id` without any check, and SHALL turn the `28:<app_id>` form into the bare GUID.

#### Scenario: Recipient id with prefix
- **WHEN** an activity has `recipient.id` `28:<app_id>`
- **THEN** `connection_locator` SHALL return the bare `app_id`

#### Scenario: Unknown bot
- **WHEN** the guessed `app_id` matches no connection
- **THEN** the ingress SHALL answer 401, the same as a bad signature

### Requirement: Inbound JWT check
`verify_signature` SHALL accept a request only when its `Authorization: Bearer` JWT has a valid RS256 signature from Microsoft's Bot Framework keys, issuer `https://api.botframework.com`, an audience that names the connection's `app_id`, a valid time window with 300 seconds of leeway, a `serviceurl` claim equal to the activity's `serviceUrl`, an activity `channelId` of `msteams`, and a signing key whose `endorsements` include `msteams`.

#### Scenario: Valid token
- **WHEN** the JWT passes every check and its audience is `<app_id>`, `api://<app_id>` or `api://botid-<app_id>`
- **THEN** `verify_signature` SHALL return the bare `app_id`

#### Scenario: Missing or bad token
- **WHEN** the header is missing, the signature does not verify, the issuer differs, the audience names another bot, or the token has expired beyond the leeway
- **THEN** `verify_signature` SHALL raise `ChannelSignatureInvalid`, and the ingress SHALL answer 401

#### Scenario: Service URL mismatch
- **WHEN** the JWT's `serviceurl` claim differs from the activity's `serviceUrl` after a trailing `/` is removed from both
- **THEN** `verify_signature` SHALL raise `ChannelSignatureInvalid`

#### Scenario: Another channel
- **WHEN** the activity's `channelId` is not `msteams`, or the signing key's `endorsements` do not include `msteams`
- **THEN** `verify_signature` SHALL raise `ChannelSignatureInvalid`

#### Scenario: Emulator token
- **WHEN** the JWT is signed for the Bot Framework Emulator, with another issuer
- **THEN** `verify_signature` SHALL raise `ChannelSignatureInvalid`

### Requirement: Signing key cache
The adapter SHALL cache Microsoft's signing keys for the whole deployment, read from the `jwks_uri` in `https://login.botframework.com/v1/.well-known/openidconfiguration`, and SHALL read them again after 24 hours or when a token names an unknown key id.

#### Scenario: Unknown key id
- **WHEN** a JWT names a key id that the cache does not hold
- **THEN** the adapter SHALL read the keys again once before it decides

#### Scenario: Cache reuse
- **WHEN** two requests arrive within 24 hours and name a known key id
- **THEN** the adapter SHALL read the keys from Microsoft at most once

### Requirement: Tenant check
`parse_event` SHALL return `None` for an activity whose tenant id, read from `channelData.tenant.id` or else `conversation.tenantId`, differs from the connection's `tenant_id`.

#### Scenario: Foreign tenant
- **WHEN** a correctly signed activity names a tenant other than the connected one
- **THEN** no inbox row SHALL be written and the route SHALL answer 202

#### Scenario: Same tenant
- **WHEN** the activity names the connected tenant
- **THEN** `parse_event` SHALL parse it as usual

### Requirement: Places, spaces and threads
`parse_event` SHALL map `conversationType` `personal` to a private space, `groupChat` to a group space and `channel` to a topic space, and SHALL set `tenant_id`, `conversation_id`, `thread_id`, `service_url`, `message_id` and `title` in the locator.

#### Scenario: Personal chat
- **WHEN** a message arrives in a personal chat
- **THEN** the space kind SHALL be private, `conversation_id` SHALL be `conversation.id` and `thread_id` SHALL be `""`

#### Scenario: Group chat
- **WHEN** a message arrives in a group chat
- **THEN** the space kind SHALL be group and `thread_id` SHALL be `""`, so the whole chat is one thread

#### Scenario: Reply in a channel thread
- **WHEN** a message arrives with `conversation.id` `19:abc@thread.tacv2;messageid=111`
- **THEN** `conversation_id` SHALL be `19:abc@thread.tacv2` and `thread_id` SHALL be `111`

#### Scenario: Top-level channel post
- **WHEN** a top-level post with activity `id` `222` arrives with `conversation.id` `19:abc@thread.tacv2`
- **THEN** `thread_id` SHALL be `222`, so the reply goes into the thread of that post

#### Scenario: Service URL kept for replies
- **WHEN** any message is parsed
- **THEN** the locator SHALL carry the verified `serviceUrl` as `service_url`, and `service_url` SHALL NOT be part of any identity key

### Requirement: Sender identity
`parse_event` SHALL set the event's sender id to `from.aadObjectId` and its name to `from.name`, SHALL NOT use `from.id` for identity, and SHALL return `None` for an activity without `from.aadObjectId`.

#### Scenario: Same person in two chats
- **WHEN** one person writes in a personal chat and in a team channel
- **THEN** both events SHALL carry the same sender id, the person's Entra object id

#### Scenario: No object id
- **WHEN** an activity has `from.id` but no `from.aadObjectId`
- **THEN** `parse_event` SHALL return `None`, and no inbox row SHALL be written

### Requirement: Mentions address the bot
For a message activity, `parse_event` SHALL set `addressed` to true only when an `entities` entry of type `mention` has a `mentioned.id` that names the connection's `app_id`, and SHALL then remove that entry's `text` from the message text. Mention entities carry no offsets, so the n-th entity with a given `text` SHALL own the n-th occurrence of that text.
A card click (an `ACTION` event) SHALL always be addressed, because the bot posted the card.

#### Scenario: Bot mentioned
- **WHEN** a channel message has the text `<at>Helper</at> what is the status?` and a mention entity for `28:<app_id>`
- **THEN** `addressed` SHALL be true and the content text SHALL be `what is the status?`

#### Scenario: Command after the mention
- **WHEN** a channel message has the text `<at>Helper</at> !new` and a mention entity for the bot
- **THEN** the content text SHALL be `!new`, and the existing command grammar SHALL parse it as the `new` command

#### Scenario: Other people mentioned
- **WHEN** a message mentions the bot and another person
- **THEN** only the bot's mention text SHALL be removed, and the other mention SHALL stay in the text

#### Scenario: Person with the bot's display name
- **WHEN** a message mentions the bot and another person whose mention text is the same as the bot's, in either order
- **THEN** only the occurrence that matches the bot's entity SHALL be removed, and the other person's mention SHALL stay in the text

#### Scenario: Tag or channel mention
- **WHEN** a message mentions a tag or the whole channel, and not the bot
- **THEN** `addressed` SHALL be false

#### Scenario: Bot name in the text only
- **WHEN** the text contains `<at>Helper</at>` but no mention entity names the bot
- **THEN** `addressed` SHALL be false

### Requirement: Card clicks
`parse_event` SHALL turn a `message` activity whose `value.choice_token` holds a choice token into an `ACTION` event whose content is that token, with `message_id` set to the activity's `replyToId`. In a team channel, the click's `thread_id` SHALL come from the `;messageid=` part of `conversation.id` when present, else from `value.thread_id`; in chats it SHALL be `""`.

#### Scenario: Approve click
- **WHEN** a user clicks Approve on an approval card
- **THEN** `parse_event` SHALL return an `ACTION` event with the content `<interaction UUID>:approve`

#### Scenario: Click in a channel thread
- **WHEN** a user clicks a card whose button data has `thread_id` `111`, and the click arrives with `conversation.id` `19:abc@thread.tacv2;messageid=111`
- **THEN** the event's `thread_id` SHALL be `111` and its `message_id` SHALL be the card's activity id

#### Scenario: Click without a thread suffix
- **WHEN** a channel click arrives with `conversation.id` `19:abc@thread.tacv2` and button data with `thread_id` `111`
- **THEN** the event's `thread_id` SHALL be `111`, so the click finds the pending choice on the thread of the card

#### Scenario: Value without a choice token
- **WHEN** a `message` activity has a `value` that carries no choice token and no text
- **THEN** `parse_event` SHALL return `None`

### Requirement: Ignored activities
`parse_event` SHALL return `None` for every activity other than a `message` with text or a choice token, including `installationUpdate`, `conversationUpdate`, `messageReaction`, `messageUpdate`, `messageDelete`, `typing`, `event` and `invoke`, and `detect_deactivation` SHALL return false.

#### Scenario: App removed from one team
- **WHEN** Teams sends `installationUpdate` with `action` `remove`
- **THEN** no inbox row SHALL be written, and the connection SHALL stay active

#### Scenario: Bot added to a chat
- **WHEN** Teams sends `conversationUpdate` with the bot in `membersAdded`
- **THEN** no inbox row SHALL be written and no message SHALL be sent

#### Scenario: Empty text after the mention
- **WHEN** a message holds only the bot's mention
- **THEN** `parse_event` SHALL return `None`

### Requirement: Duplicate deliveries
The adapter SHALL use `<conversation_id>:<activity id>` as the event's `external_id`, because Teams activity ids are unique only within one conversation, so the existing inbox constraint on `(project_id, connection_id, external_id)` SHALL drop a second delivery of the same activity.

#### Scenario: Teams retries a request
- **WHEN** Teams sends the same activity twice
- **THEN** only one inbox row SHALL exist, and at most one turn SHALL start

#### Scenario: Same activity id in two conversations
- **WHEN** two conversations of one connection send activities with the same `id`
- **THEN** each activity SHALL have its own inbox row

### Requirement: Who may talk to the agent
Messages from Teams SHALL follow the existing trigger rule, grants and roster, so a private space always triggers and a shared space triggers only on a mention, a command or an answer to a pending choice.

#### Scenario: Personal chat without a mention
- **WHEN** a user writes in a personal chat with the bot
- **THEN** the message SHALL open a turn

#### Scenario: Card click by another channel member
- **WHEN** a channel member clicks a card for a choice that is no longer pending
- **THEN** `resolve_pending_choice` SHALL resolve nothing, and no turn SHALL start
