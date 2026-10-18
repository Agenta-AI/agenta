## ADDED Requirements

### Requirement: Publish an agent as an embed

The system SHALL let a project member create an `embed` channel connection for an agent. The connection SHALL hold a public embed ID, an optional list of allowed origins and an appearance config, and SHALL use the ordinary channel agent binding and grants. The connection's setup document SHALL be the iframe snippet.

#### Scenario: Create an embed

- **WHEN** a project member creates an embed connection, with or without allowed origins, and binds an agent to it
- **THEN** the connection is active and its setup document shows an iframe snippet that contains the public embed ID

#### Scenario: Turn on specific domains

- **WHEN** a project member turns on "Only allow embedding the agent on specific domains" and saves with no domain, or with an entry that is not an http or https origin with an optional leading `*.` label
- **THEN** the settings refuse to save and name the problem

#### Scenario: Turn off specific domains

- **WHEN** a project member turns off "Only allow embedding the agent on specific domains" and saves
- **THEN** the connection stores an empty origin list, and any website can embed the agent

#### Scenario: Archive an embed

- **WHEN** a project member archives the embed connection
- **THEN** the ingress and the read routes refuse every request for that embed, and the widget shows that the chat is unavailable

### Requirement: Restrict where the widget can load and call

An embed's allowed origins SHALL be optional. When the list is empty or absent, any website MAY embed the widget. An entry SHALL be an http or https origin `scheme://host[:port]`, and its host MAY start with one `*.` label, which matches every subdomain of the rest but not the rest itself, as in CSP. The system SHALL drop every other entry before it uses the list, and a list whose entries are all dropped SHALL allow no website, not every website.

The widget page SHALL send a `Content-Security-Policy: frame-ancestors` header that lists the embed's allowed origins and Agenta's own web origin, so the owner can preview the widget in Agenta. For an embed with no allowed origins, the header SHALL be `frame-ancestors *`. This header is the check on where the widget is framed. It does not stop a visitor from opening the widget page directly as a top-level page; that is allowed, because such a visitor can do no more than any client that holds a visitor key, and the visitor key and rate limits apply the same way. The `embed` ingress and read routes SHALL NOT compare the request's `Origin` header with the allowed origins, because the widget's own requests carry Agenta's origin, not the host page's origin. The routes SHALL require the `X-Agenta-Visitor-Key` header, so a browser request from another website needs a CORS preflight, which fails for every origin the API's CORS policy does not admit. The CORS policy is a separate, global setting; the frame restriction holds regardless of it.

#### Scenario: Load on an allowed site

- **WHEN** a page on an allowed origin includes the iframe snippet
- **THEN** the widget loads and shows the chat

#### Scenario: Load on another site

- **WHEN** a page on an origin that is not allowed includes the iframe snippet
- **THEN** the browser refuses to show the widget, and a browser request from that page to the ingress fails the CORS preflight

#### Scenario: Load on a subdomain of a wildcard entry

- **WHEN** the embed allows `https://*.example.com` and a page on `https://shop.example.com` includes the iframe snippet
- **THEN** the widget loads and shows the chat, and a page on `https://example.com` is refused

#### Scenario: Load anywhere when no origin is listed

- **WHEN** the embed has no allowed origins and a page on any website includes the iframe snippet
- **THEN** the widget loads and shows the chat, and the widget page's header is `frame-ancestors *`

### Requirement: Visitor keys own conversations

Each visitor SHALL be one channel space keyed by the SHA-256 hash of a visitor key. The system SHALL store only the hash. A visitor key SHALL be a random value of at least 128 bits from a cryptographically secure generator. A user ID, an email address or any other value that someone else can guess SHALL NOT be used as a key, and the embed guide SHALL say so. The server cannot measure randomness, so it SHALL refuse a key that is shorter than 32 characters, that uses characters outside `A-Z a-z 0-9 - _`, or that has fewer than 12 distinct characters. It SHALL also refuse a key longer than 256 characters, so a header stays small. The ingress and read routes SHALL return or change only threads in the caller's space.

#### Scenario: Anonymous visitor gets a key

- **WHEN** the widget loads and the host does not provide a visitor key within one second
- **THEN** the widget creates a random key of at least 128 bits, stores it in the browser, and uses it for every request

#### Scenario: Host provides a key

- **WHEN** the host page sends `agenta:init` with a valid `visitorKey`
- **THEN** the widget uses that key instead of its own

#### Scenario: Weak key is refused

- **WHEN** a request carries a visitor key shorter than 32 characters, with other characters, or with fewer than 12 distinct characters, such as `user-00000000000000000000000000042`
- **THEN** the route refuses it, and no space or thread is created

#### Scenario: Another visitor's conversation is not reachable

- **WHEN** a request asks for a thread that belongs to another space
- **THEN** the route answers as if the thread does not exist

### Requirement: Every visitor action goes through the channel ingress

The widget SHALL send messages, commands and choice answers to `POST /channels/embed/events/{embed_id}/`. The `embed` adapter SHALL verify the request and build the inbound event, and the rest SHALL be the shared channel path: inbox, resolution, commands, threads, turns and outbox.

#### Scenario: A message starts a turn

- **WHEN** a visitor sends a message
- **THEN** the event is recorded in the channel inbox and the agent runs on the thread's session through the shared inbox dispatcher

#### Scenario: A second message during a running turn

- **WHEN** a visitor sends a message while the agent is still answering in the same conversation
- **THEN** the message is handled by the channel's existing turn queue, as it is for other channels

### Requirement: Visitors keep their history

The widget SHALL list the visitor's conversations for this embed, SHALL start a new conversation through the channel's `new` command, SHALL reopen a past conversation through the channel's `use` command, and SHALL restore the open conversation after a page reload.

#### Scenario: Reload keeps the conversation

- **WHEN** a visitor reloads the host page during or after a conversation
- **THEN** the widget reopens the same conversation with its messages

#### Scenario: Same key on another device

- **WHEN** the host passes the same visitor key on another device
- **THEN** the widget lists the same conversations

#### Scenario: New chat

- **WHEN** the visitor chooses "New chat"
- **THEN** the current thread is closed, the next message opens a new thread with a new session, and the old conversation stays in the list

### Requirement: The widget shows the agent like the Agenta chat

The widget SHALL render the conversation's session with `@agenta/chat`, stream the reply, show tool activity, show approval and choice cards, accept file uploads, and offer the session's files for download. The agent SHALL run with its own tools and credentials.

#### Scenario: Streaming reply

- **WHEN** the agent answers a visitor's message
- **THEN** the widget shows the answer as it is produced, not only when the turn ends

#### Scenario: Approval

- **WHEN** the agent asks for approval of a tool call during a widget conversation
- **THEN** the visitor sees the approval card, the answer is sent through the ingress as a choice answer, and the run continues

#### Scenario: File upload

- **WHEN** the visitor attaches a file to a message
- **THEN** the file reaches the agent through the channel inbound media path as a session attachment

#### Scenario: No workspace browsing

- **WHEN** a visitor uses the widget
- **THEN** the widget offers no files beyond those attached to or produced in the visitor's own conversations

### Requirement: Host context reaches the agent

The widget SHALL accept a `context` object and an optional `displayName` from the host page, and SHALL send them with each message. The host SHALL be able to replace `context` during the conversation. The widget SHALL not accept a `bindings` field in v1.

#### Scenario: Page context changes

- **WHEN** the host sends `agenta:context` with a new context after the user navigates
- **THEN** the next message carries the new context

#### Scenario: Messages from other windows are ignored

- **WHEN** a window other than the widget's parent posts an `agenta:init` or `agenta:context` message to the widget, or the embed lists allowed origins and the parent is not on one of them
- **THEN** the widget ignores the message

#### Scenario: Any parent is heard when no origin is listed

- **WHEN** the embed has no allowed origins and its parent page posts `agenta:init`
- **THEN** the widget accepts the message whatever the parent's origin, and it sent `agenta:ready` only to the parent's own origin

### Requirement: Owners can read embed conversations

Embed conversations SHALL appear wherever channel conversations appear for project members, labeled with the embed connection's name, and SHALL open in the normal session view.

#### Scenario: Find an embed conversation

- **WHEN** a project member opens the embed connection's conversations
- **THEN** each visitor conversation is listed and opens in the session view

### Requirement: Limit request rates

The `embed` ingress SHALL limit request rates per embed and per visitor key, and SHALL refuse messages longer than a configured maximum. The read routes SHALL limit request rates per embed and per visitor key, and SHALL cap the open live streams per embed.

#### Scenario: Too many requests

- **WHEN** a visitor key exceeds the request limit
- **THEN** the ingress answers with a rate-limit error and a `Retry-After` value, and the widget shows a short wait message

### Requirement: Simple appearance settings

The embed connection SHALL support a name, an avatar, a greeting, up to four starter prompts, a theme (light, dark or system) and an accent color. The settings screen SHALL show a live preview.

#### Scenario: Change the greeting

- **WHEN** a project member edits the greeting and saves
- **THEN** new widget loads show the new greeting without a new snippet
