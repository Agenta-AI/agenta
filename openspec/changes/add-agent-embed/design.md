# Design: agent embed (v1)

## Context

Today's behavior, from `Agenta-AI/agenta` at `release/v0.122.8` (0f613798):

- **Channel turns are session runs.** The inbox dispatcher starts the agent with `invoke_workflow_detached` on the thread's `session_id` (`api/oss/src/tasks/asyncio/channels/inbox.py:1050`). The request carries one input, `messages` (`inbox.py:1100-1119`).
- **Channels already tell the model who is speaking.** `compose_input` puts a separate text part before each message, built by `_attribution_part`, for example "From Test User (@testuser, Telegram id 1000001):" (`api/oss/src/core/channels/service.py:2134`, `:2228`, `:2501`). The person's words are not rewritten.
- **A first-party channel exists.** The `agenta` adapter authenticates with an Agenta API key, and its post writes nowhere outside our own tables (`api/oss/src/core/channels/adapters/agenta/adapter.py`). It has a public ingress route, `/channels/agenta/events/` (`api/oss/src/apis/fastapi/channels/ingress.py:151`), and a read route, `/channels/agenta/conversations/{id}` (`api/oss/src/apis/fastapi/channels/router.py:516`). Its design document calls this API "how any web surface talks to channels, including the real one web will build", and leaves open whether that surface replaces or sits beside the existing chat, since "a channel conversation is a session, and the web chat is a view onto a session" (`docs/design/channels-research/v2/agenta-channel.md`).
- **Commands exist for conversation lists.** `new` closes the current thread so the next message opens a fresh one, `sessions` lists the threads under the same key, and `use` switches to one (`api/oss/src/core/channels/commands.py:125-221`). The `agenta` capabilities declare all three (`adapters/agenta/capabilities.py:43`).
- **Approval answers already have a channel path.** A message or click that resolves a pending choice answers the parked session interaction (`inbox.py:183-248`).
- **Inbound files have a channel path.** Adapters store only a file reference and resolve the download at fetch time (`openspec/changes/channel-inbound-media`).
- **Replies leave through the outbox.** The outbox worker follows the session's turn stream and posts periodic progress edits, then a final edit (`api/oss/src/tasks/asyncio/channels/outbox.py`). For the `agenta` adapter that post stays in our tables.
- **The web chat streams from sessions.** `@agenta/chat` renders a session and streams its turn (`web/packages/agenta-chat/src/transport/AgentChatTransport.ts`). It has a "shared" session response mode (`AgentChatTransport.ts:410`), which suggests it can follow a turn that another sender started. Task 1.1 verifies this.
- **Setup can generate a document.** `ChannelAdapterInterface.build_setup_document` returns a document for the operator, such as a Slack manifest (`adapters/interface.py`).

## Goals / Non-Goals

**Goals**

- An owner puts a working agent chat into their own tool in minutes.
- Each visitor sees only their own conversations, with history that survives a reload, with or without a login on the host.
- The embed reuses the channel path end to end: one way in, the same routing, threads, commands, approvals, attribution and identity as every other channel.
- The chat looks and streams like the Agenta chat.
- Later identity options, values for tool bindings and other surfaces add to this design without changing the v1 contract.

**Non-Goals**

- Scoping tool calls per user: bindings, HTTP tools, header templating. Every tool call in v1 uses the agent's own credentials.
- Verified identity from a host server or a login provider.
- Client tools fulfilled by the host page.
- A floating launcher script, an npm SDK, Shopify or WordPress plugins.
- Spend caps, moderation, transcript retention, human handoff, custom CSS, version pinning.

## Decisions

### 1. The embed is a channel: one new adapter, no new path

| Option | Trade-off |
| --- | --- |
| A separate embed path on sessions, with its own table and gateway | Streams natively, but rebuilds connection settings, agent binding, threads, commands, approvals, attribution and identity beside the channel versions of the same things |
| Reuse the `agenta` adapter and add a second credential type to it | No new adapter, but one adapter would branch on how the caller authenticates |
| **A new `embed` adapter beside `agenta`** | **The adapter interface is where a channel proves who is calling. A new adapter keeps one credential per adapter, and everything after the inbound row is written stays the shared channel path** |

The `embed` adapter shares the `agenta` adapter's capabilities and its post methods (both write only to our tables). It implements its own `connection_locator`, `verify_signature` and `parse_event`.

### 2. An embed is a channel connection

One connection per embed. The connection's `external_key` is the public embed ID used in the snippet and the ingress path. Its `data` holds `allowed_origins` and `appearance`. The agent binding is a `ChannelAgent` row. A default grant admits every visitor.

The adapter's setup declares `allowed_origins` as a setup field, so the existing channel setup form collects it. `build_setup_document` returns the iframe snippet and a `postMessage` example.

No new table and no new admin API.

### 3. A visitor is a space; a conversation is a thread

| Channel concept | Embed meaning |
| --- | --- |
| Connection | One embed |
| Space (private) | One visitor, keyed by the SHA-256 hash of the visitor key |
| Thread | One conversation, mapped to one session |
| `new` command | "New chat" |
| `sessions` command, `query_threads` | The list of past conversations |
| `use` command | Reopen a past conversation |
| Pending choice | An approval or choice card |

The visitor key is a random secret of at least 128 bits. Only its hash is stored, as the space's external locator. The widget creates a key per browser by default. The host page may pass its own key, for example one random key stored per logged-in user, which gives the same history on every device. The host's key must also be random, from a secure generator, never a user ID or an email. The server cannot measure randomness, so it refuses the keys it can recognize as weak: shorter than 32 characters, characters outside `A-Z a-z 0-9 - _`, or fewer than 12 distinct characters.

There is no visitor table. A visitor is whoever holds the key.

### 4. One way in: the embed ingress

The widget sends every visitor action to `POST /channels/embed/events/{embed_id}/`: messages, commands and choice answers. The visitor key travels in the `X-Agenta-Visitor-Key` header.

- `connection_locator` reads `embed_id` from the path, as the Telegram adapter reads its routing token.
- `verify_signature` checks that the connection is active and that the key is valid (see section 3). It returns the connection's project. It does not check the `Origin` header: the widget's requests come from the iframe, so they carry Agenta's origin, not the host page's origin.
- `parse_event` builds the inbound event: the space locator from the key hash, the sender from the key hash plus an optional display name, the content parts, and the host context.

Rate limits per embed and per key apply at this route.

Where the widget may run is checked in two places, both in the browser. The widget page sends `frame-ancestors` with the allowed origins, so the browser refuses to show it elsewhere. The routes require the `X-Agenta-Visitor-Key` header, so a browser request from another website needs a CORS preflight, which the API's CORS policy refuses. A script outside a browser can still call the routes. The visitor key and the rate limits cover that case.

### 5. One way out: render the session

The reply is the session's turn. The widget renders the conversation's session with `@agenta/chat` and follows it live. The outbox still runs for the `embed` channel exactly as for `agenta`, and its post writes only to our tables, so it adds no branch.

Visitor-scoped read routes back the widget:

- `GET /channels/embed/{embed_id}/conversations`: the threads in the caller's space.
- `GET /channels/embed/{embed_id}/conversations/{thread_id}`: the session's messages.
- `GET /channels/embed/{embed_id}/conversations/{thread_id}/live`: the session's live events.
- `GET /channels/embed/{embed_id}/conversations/{thread_id}/files/{file_id}`: a file from that session.

Each route runs the same checks as the ingress, then confirms the thread belongs to the caller's space. A thread in another space answers as not found.

| Option | Trade-off |
| --- | --- |
| Poll the outbox, as the `agenta` probe page does | One read source shared with the probe, but no token streaming and a second chat renderer |
| **Render the session with `@agenta/chat`** | **Streaming, approval cards, files and mobile layout as in Agenta. Matches the design document's "a channel conversation is a session"** |

### 6. Host context: what the agent sees, and what tools will use later

The host page may pass any JSON in two places. Only the first exists in v1.

| Field | Who uses it | v1 |
| --- | --- | --- |
| `context` | The model. Stored on the inbound event as `processed.context` and rendered by `compose_input` as a labeled part after the sender attribution, marked as provided by the host and not verified | Yes |
| `bindings` | Tools, never the model. Would be stored as `processed.bindings` and passed by `_build_request` as `inputs.bindings`, for HTTP tools and header bindings | No. Reserved name, not accepted |

`processed.context` is a generic field on channel events. Any adapter may fill it. For example, a Slack adapter could pass the channel topic later. `compose_input` renders it the same way for every channel.

| Option | Trade-off |
| --- | --- |
| Change the agent handler to render non-message run inputs | Works outside channels too, but adds a second way to inform the model next to attribution |
| **Render context in `compose_input`, next to attribution** | **One place builds what the model sees for every channel. No SDK change** |

### 7. The chat shows the person's own words

`compose_input` adds the attribution part and the context part to the model's input. When it adds either one, the turn's user message also carries `display_content` with only the person's own words (the text of their parts, joined by new lines). The model sees `content`. The chat shows `display_content`. This uses the existing `Message.display_content`: the runner persists it on the user record, and `@agenta/chat` renders it in the replay and the live view. No chat change is needed. Attachments still show, because `display_content` replaces only the text. When a file cannot be read, the note that replaces it is added to `display_content`, so the person still sees it.

A part-level marker such as `"generated": "channel"` was the first plan. It cannot work: the runner flattens the parts into one text before it persists the user record, and the SDK `ContentBlock` drops unknown keys.

When one turn gathers messages from more than one sender (a forwardfilled group thread), `compose_input` sets no `display_content`. The "From ..." parts stay on screen there, because they tell the speakers apart. An embed conversation has one visitor, so the widget always shows only the visitor's words.

### 8. Iframe first, with a small message protocol

v1 ships an iframe snippet. It works anonymously without any script. The host passes a key, a display name or context with `postMessage`:

- The widget sends `agenta:ready`.
- The host replies `agenta:init` with `{ visitorKey?, displayName?, context? }`.
- The host may send `agenta:context` with a new `context` at any time, for example on page change.

If no `agenta:init` arrives within one second, the widget uses its own per-browser key. The widget accepts messages only from allowed origins, and it sends messages only to the parent's origin.

The widget page sends `Content-Security-Policy: frame-ancestors` with the embed's allowed origins.

### 9. Owners read embed conversations where they read channel conversations

Embed conversations are channel threads mapped to sessions, so they appear wherever channel conversations appear today, labeled with the connection's name.

### 10. Appearance stays small

Name, avatar, greeting, up to four starter prompts, theme (light, dark or system) and accent color, stored in the connection's `data.appearance` and mapped onto the `@agenta/chat` skin.

## How later work adds to this

| Later feature | Where it attaches | What changes |
| --- | --- | --- |
| Verified identity from the host's server | `parse_event` and identity links | A route where the host's server, with an API key, gets a visitor key for one of its users. The sender is marked verified |
| Verified identity from a login provider (Supabase, Clerk, Auth0) | `verify_signature` | The connection stores an issuer URL. The adapter checks the provider's token with its public keys and derives the space from the token's subject |
| Values for tool bindings, HTTP tools, header templating | `processed.bindings` and `_build_request` | The runner fills tool fields from `inputs.bindings`. The model never sees them |
| Same person on Telegram and the embed | Channel identity links | Link both senders to one user once identity is verified |
| Client tools on the host page | The message protocol | Two messages, `agenta:tool-call` and `agenta:tool-result` |
| A launcher script, an SDK, platform plugins | The message protocol | Wrappers around the same iframe and messages |

None of these changes the ingress route, the read routes, the space and thread model or the v1 messages.

## Risks / Trade-offs

- **The chat may not render a session whose turn the channel worker started.** The chat's shared mode suggests it can. Task 1 verifies it before anything else is built. If it fails, the widget keeps the channel ingress and adds a live-follow mode to the embed transport.
- **The inbox queue adds time before a turn starts.** Task 1 measures it.
- **A leaked visitor key exposes that visitor's conversations.** Same risk as a leaked session cookie. Only hashes are stored, and owners can disable an embed.
- **A host can pass a guessable key** such as a user ID. The docs require a random key, and the server refuses keys it can recognize as weak. It cannot refuse every predictable key.
- **Host context is not verified.** In v1 it only informs the model, and tools use the agent's own credentials.
- **Browser storage can be cleared.** Anonymous history lives in the iframe's storage. Safari clears script-written storage after seven days without interaction with the site. A host-provided key avoids this.
- **`frame-ancestors` and CORS stop other websites, not scripts.** The visitor key and rate limits per embed and per key back them up.

## Migration

- No new tables. One new adapter in the registry, one ingress route, read routes, and one optional field on processed events.
- The context part is additive. Events without context give the model the same input as today.
- The chat view of existing channels changes a little: a turn from one sender now shows that person's words without the "From ..." line. A turn from several senders shows the line as today. Sessions recorded before this change replay as before.
- Self-hosted instances need a public HTTPS URL that visitors can reach. Documentation only.
