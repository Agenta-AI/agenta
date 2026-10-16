## 1. Verify the two assumptions first

- [ ] 1.1 With the existing `agenta` channel on a dev stack, send a message through `/channels/agenta/events/` and open the thread's session in the Agenta chat. Confirm the chat streams the turn the channel worker started. Record the result in `HANDOFF.md`
- [ ] 1.2 Measure the time from ingress `202` to the first streamed token, and from a direct chat send to the first token. Record both
- [ ] 1.3 If 1.1 fails, add a live-follow mode to the embed transport (subscribe to the session's live events after the ingress accepts) and note the change in `design.md` before continuing

## 2. Channel turn context (all channels)

- [ ] 2.1 Add optional `context` to `ChannelInboxEventProcessed`, redacted like `content` and `sender`
- [ ] 2.2 In `compose_input`, render `context` as one labeled part after the attribution part
- [ ] 2.3 Mark the attribution and context parts with `"generated": "channel"`
- [ ] 2.4 Hide marked parts inside a person's own message in `@agenta/chat`
- [ ] 2.5 Unit tests: with context, without context, another adapter filling context, marker present

## 3. The `embed` adapter

- [ ] 3.1 Add the `embed` adapter and register it; share capabilities and post methods with `agenta`
- [ ] 3.2 `connection_locator`: read `embed_id` from the path
- [ ] 3.3 `verify_signature`: active connection and a valid key (32+ characters, `A-Z a-z 0-9 - _`, 12+ distinct characters); return the project. No `Origin` check
- [ ] 3.4 `parse_event`: space locator from the key hash, sender from the key hash plus `displayName`, content parts, `context`; refuse a `bindings` field
- [ ] 3.5 Setup: declare `allowed_origins` as a setup field; `build_setup_document` returns the iframe snippet and a `postMessage` example
- [ ] 3.6 Add the ingress route `POST /channels/embed/events/{embed_id}/` and list it as a public endpoint
- [ ] 3.7 Rate limits per embed and per key; maximum message length
- [ ] 3.8 Unit tests: weak keys, archived connection, space from hash, `bindings` refused

## 4. Visitor-scoped read routes

- [ ] 4.1 `GET /channels/embed/{embed_id}/conversations`
- [ ] 4.2 `GET /channels/embed/{embed_id}/conversations/{thread_id}`
- [ ] 4.3 `GET /channels/embed/{embed_id}/conversations/{thread_id}/live`
- [ ] 4.4 `GET /channels/embed/{embed_id}/conversations/{thread_id}/files/{file_id}`
- [ ] 4.5 Each route: the ingress checks, then thread-in-caller's-space; another space answers not found
- [ ] 4.6 Tests for each route, including a thread from another space

## 5. Widget

- [ ] 5.1 Widget route served with `frame-ancestors` from the connection's allowed origins
- [ ] 5.2 Embed transport for `@agenta/chat`: send through the ingress, read through the read routes
- [ ] 5.3 Approval and choice cards answer through the ingress
- [ ] 5.4 File upload through the inbound media path; downloads through 4.4
- [ ] 5.5 `agenta:ready`, `agenta:init`, `agenta:context` with origin checks; anonymous key after one second
- [ ] 5.6 Conversation list, "New chat" (`new`), reopen (`use`), reopen after reload
- [ ] 5.7 Appearance applied to the chat skin; phone-width layout checked

## 6. Publish and owner screens

- [ ] 6.1 The embed appears with the other channels in the agent's publish menu
- [ ] 6.2 Settings: allowed origins, appearance, live preview; the snippet from the setup document
- [ ] 6.3 Embed conversations appear with other channel conversations, labeled with the connection name

## 7. Docs

- [ ] 7.1 Embed guide: snippet, anonymous history, a per-user key, context
- [ ] 7.2 Self-hosting: a public HTTPS URL that visitors can reach

## 8. QA

- [ ] 8.1 Run every scenario in `qa.md` as a recorded live QA pass and attach the evidence to the pull request
