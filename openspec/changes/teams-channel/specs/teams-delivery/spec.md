# Teams delivery

## Purpose

Send the agent's answers, progress signals and approval cards to Teams with a short-lived access token, only to Microsoft's reply hosts, and map Teams errors to the shared outbox rules.

## ADDED Requirements

### Requirement: Access token cache
The adapter SHALL get an access token with the client credentials request from the connection spec, and SHALL reuse it for the same connection until 5 minutes before it expires.

#### Scenario: Reuse within the lifetime
- **WHEN** two sends for one connection run 10 minutes apart and the token lasts 3600 seconds
- **THEN** the adapter SHALL request one token from Microsoft

#### Scenario: Refresh near expiry
- **WHEN** a send runs less than 5 minutes before the cached token expires
- **THEN** the adapter SHALL request a new token first

#### Scenario: Separate connections
- **WHEN** two connections send at the same time
- **THEN** each SHALL use its own token, and no connection SHALL use another connection's token

### Requirement: Reply host allowlist
The adapter SHALL send an access token only to a `service_url` whose scheme is `https` and whose host is exactly `smba.trafficmanager.net`, `smba.infra.gcc.teams.microsoft.com`, `smba.infra.gov.teams.microsoft.us` or `smba.infra.dod.teams.microsoft.us`.

#### Scenario: Allowed host
- **WHEN** the locator's `service_url` is `https://smba.trafficmanager.net/amer/`
- **THEN** the adapter SHALL send the request

#### Scenario: Look-alike host
- **WHEN** the locator's `service_url` has a host such as `other.trafficmanager.net` or uses `http`
- **THEN** the adapter SHALL raise an error before any request, and SHALL NOT send the access token

### Requirement: Replies and thread replies
`post_message` SHALL send a `message` activity to `POST {service_url}/v3/conversations/{conversation}/activities`, where `conversation` is `conversation_id` joined with `;messageid={thread_id}` when `thread_id` is set, and SHALL return a receipt with the returned activity id as `message_id`.

#### Scenario: Reply in a channel thread
- **WHEN** the locator has `conversation_id` `19:abc@thread.tacv2` and `thread_id` `111`
- **THEN** the adapter SHALL post to the conversation `19:abc@thread.tacv2;messageid=111`

#### Scenario: Reply in a chat
- **WHEN** the locator has `thread_id` `""`
- **THEN** the adapter SHALL post to `conversation_id` as it is

#### Scenario: Text format
- **WHEN** the adapter posts an answer
- **THEN** the activity SHALL carry the Markdown text with `textFormat` `markdown`

### Requirement: Tenant on every send
Every activity the adapter sends, including replies, typing activities and card updates, SHALL carry `channelData.tenant.id` set to the connection's `tenant_id`.

#### Scenario: Reply carries the tenant
- **WHEN** the adapter posts an answer
- **THEN** the request body SHALL have `channelData.tenant.id` equal to the connection's `tenant_id`

#### Scenario: Card update carries the tenant
- **WHEN** `dismiss_choices` sends the card without buttons
- **THEN** the request body SHALL also carry `channelData.tenant.id`

### Requirement: Typing and the working message
The adapter SHALL declare `indicator: "native"` and `update: false`, and `signal_activity` SHALL post a `typing` activity to the same conversation as a reply, so the outbox sends no "Thinking…" message and posts "Working on it, I'll reply here when I'm done." after 30 seconds.

#### Scenario: Turn starts
- **WHEN** a turn starts for a Teams message
- **THEN** the outbox SHALL call `signal_activity`, and the adapter SHALL post `{"type": "typing"}` to the reply conversation

#### Scenario: Long turn
- **WHEN** a turn runs longer than 30 seconds
- **THEN** the outbox SHALL post the existing working message once, with no new text

#### Scenario: Typing fails
- **WHEN** the typing request fails
- **THEN** the turn SHALL go on, because the signal is best-effort

### Requirement: Long answers
The adapter SHALL declare `max_chars` 20000, so core splits a longer answer into several messages before `post_message` runs.

#### Scenario: Answer over the limit
- **WHEN** the agent answers with 45,000 characters of Markdown
- **THEN** Teams SHALL receive three or more messages, each at most 20,000 characters, in order, in the same conversation

#### Scenario: Later chunk fails
- **WHEN** one `post_message` call sends several activities and a later one fails after an earlier one was accepted
- **THEN** the adapter SHALL raise `ChannelDeliveryUncertain`, so the outbox does not post the answer twice

### Requirement: Approval cards
For a message with choices, `post_message` SHALL attach an Adaptive Card whose `Action.Submit` buttons carry `{"choice_token": <choice token>, "thread_id": <the locator's thread_id>}` in `data`, and `dismiss_choices` SHALL replace the card with a copy without buttons through `PUT {service_url}/v3/conversations/{conversation}/activities/{message_id}`.

#### Scenario: Card with Approve and Deny
- **WHEN** the outbox posts a pending approval
- **THEN** the card SHALL show the request text and two `Action.Submit` buttons, Approve and Deny, whose data carry `<interaction UUID>:approve` and `<interaction UUID>:deny`

#### Scenario: Buttons removed after the answer
- **WHEN** the approval is answered
- **THEN** `dismiss_choices` SHALL send the same card without its actions to the receipt's `message_id`

#### Scenario: Too many choices
- **WHEN** a pending choice has more options than `rendering.buttons.max`
- **THEN** core SHALL render numbered text, and the adapter SHALL post it as plain text

### Requirement: Error mapping
The adapter SHALL raise errors that carry the HTTP `status_code` of a failed Teams call, and on a 401 SHALL get a new access token and retry once before it raises `ChannelCredentialRevoked`.

#### Scenario: Expired access token
- **WHEN** a send gets 401, and the retry with a new access token succeeds
- **THEN** the message SHALL be delivered once and the connection SHALL stay active

#### Scenario: Secret no longer valid
- **WHEN** the token request is refused because the client secret is wrong or expired, or the retry after a new token also gets 401
- **THEN** the adapter SHALL raise `ChannelCredentialRevoked`, and the outbox SHALL switch the connection off

#### Scenario: App removed from a chat
- **WHEN** a send gets 403 with `subCode` `MessageWritesBlocked`
- **THEN** the outbox SHALL record that send as failed and SHALL NOT retry it, and the connection SHALL stay active

#### Scenario: Rate limit
- **WHEN** a send gets 429
- **THEN** the outbox SHALL retry it under the existing outbox rule

#### Scenario: Server error on a post
- **WHEN** a post gets a 5xx
- **THEN** the outbox SHALL record it as failed and SHALL NOT retry it, because the message may have landed
