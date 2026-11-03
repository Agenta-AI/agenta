# Agent embed: handoff

This folder is the full brief for implementing the agent embed (v1). It is written for an agent or engineer who has not seen the discussion that produced it.

## Read in this order

1. `proposal.md`: what we are building and why, in one page.
2. `design.md`: today's code, the decisions with their options, and how later work attaches.
3. `specs/embed-channel/spec.md` and `specs/channel-turn-context/spec.md`: the required behavior, as scenarios.
4. `tasks.md`: the work, in order. Start with section 1.
5. `qa.md`: the scenarios a live QA pass runs before the change ships.

## Words used in this folder

- **Host page**: the owner's website or internal tool where the chat appears.
- **Widget**: the chat page Agenta serves inside an iframe on the host page.
- **Visitor**: the person chatting in the widget. Not an Agenta user.
- **Visitor key**: a random secret that identifies a visitor. Whoever holds it can see that visitor's conversations.
- **Channel**: Agenta's system for publishing an agent to a chat platform (Slack, Telegram, WhatsApp, and the first-party `agenta` channel). Code: `api/oss/src/core/channels/`.
- **Adapter**: one channel's implementation of `ChannelAdapterInterface`: how a request is located, verified and parsed, and how a reply is posted.
- **Connection, space, thread**: a channel installation, a place where people talk (here: one visitor), and one conversation in it, mapped to one session.
- **Ingress**: the public route through which a channel receives events.
- **Context**: JSON the host page passes that the model sees as a labeled part.
- **Bindings**: JSON the host page would pass for tools only. Reserved name, not part of v1.

## Decisions already made

These were decided with the product owner on 2026-10-16. Do not reopen them without a reason found in the code.

- v1 serves internal tools: a dashboard or small app with a chat panel whose agent calls that app's backend.
- Visitors are anonymous or identified by the host. There is no Agenta login inside the iframe.
- Every tool call uses the agent's own credentials. No per-user tool scoping in v1.
- Chat history works without a login: per browser by default, and across devices when the host passes its own key.
- Approvals are answered by the visitor in the widget.
- The host passes context the agent sees. Values used only by tools (bindings), HTTP tools and header templating come later.
- Frontend-only host apps must work.
- The embed reuses the channel system rather than a parallel path.

## What to check before building

Task 1 checks two assumptions. Record the results here.

| Check | Result | Date |
| --- | --- | --- |
| The Agenta chat streams a session whose turn the channel worker started | Yes, if the reader subscribes before the reply starts. A chat already open on the session streams the reply token by token, about 100 ms behind the live relay. A reader that subscribes after the reply's `text-start` frame shows "Working" and then the whole reply at the end. | 2026-10-16 |
| Time from ingress to first token, compared with a direct chat send | Median of 3, first `text-delta` on the session live relay: ingress after an ingress turn 4775 ms; direct send after a direct send 1507 ms. The gap is a cold sandbox, not the ingress hop: a turn the channel worker started is not kept warm, so the next turn on that session starts cold. On a warm session the two paths are within about 0.5 s of each other. | 2026-10-16 |

### Task 1 details (2026-10-16)

Setup: OSS dev stack from this branch (`release/v0.122.8` code), `pi_core` harness, local
sandbox, OpenAI `gpt-4.1-nano`, the first-party `agenta` channel with a connection-wide default
agent. Messages went through `POST /channels/agenta/events/`.

1.1, what the chat does with a turn the inbox worker started:

- The chat subscribes to `GET /sessions/{id}/events` for every open session whose snapshot
  advertises `capabilities.shared_reader` (`useSessionLivePreview`, `sender: true`). An
  ingress-started turn publishes `text-delta` live frames to that relay like any other turn,
  so a chat that is open before the reply starts renders it progressively.
- A reader that subscribes after the reply's text entity began does not stream it. The relay
  does not replay live frames on connect (`after=` only replays durable events), and
  `reduceSessionLivePreview` in `web/packages/agenta-chat/src/model/livePreview.ts` marks a
  delta for an unseen entity with `frame_index != 0` as incomplete and drops its deltas. The
  text appears when the transcript is adopted after `execution.stopped`. Measured: deltas on the
  relay from 4.5 s to 10.3 s after the 202, the page joined at 5.1 s, the reply appeared at
  11.4 s.
- For the embed this means the widget must open the live subscription before the reply starts.
  On an existing conversation it can subscribe before it posts. On the first message of a new
  conversation the session id exists only after the worker resolves the thread, so the widget
  races the reply. The race is usually won today because a cold start takes about 3 s, but it is
  not guaranteed. Task 1.3 (a live-follow mode) is not needed for streaming itself; the open
  question is how the widget learns the new thread's session id early.

1.2, why ingress turns are slower in steady state:

- After an ingress-started turn, the runner logs `[keepalive] evict reason=no-park:end_turn`
  and the next turn on the session rebuilds the sandbox (`decision=rebuild(miss)`, about
  2.5 s to 3 s). After a direct chat send it logs `park ttl=60000ms` and the next turn reuses
  the warm sandbox.
- Cause: `services/runner/src/server.ts` sets `clientDisconnected = true` when the invoke
  response closes mid-turn on a session-owned run, and `shouldPark` in
  `services/runner/src/engines/sandbox_agent/engine.ts` refuses to park when `clientGone()` is
  true. The detached start the inbox worker uses (`invoke_workflow_detached` in
  `api/oss/src/core/workflows/service.py`) returns on the first record without draining the
  stream, so every channel turn ends unparked. The browser's own detached
  send keeps reading its stream to the end, so it parks.
- All runs (first `text-delta` on the live relay, ms after the 202 or after the send):
  ingress after ingress 5383, 4673, 4775; ingress after a direct send 2373, 2162, 1536;
  direct after direct 2164, 1374, 1507 (invoke stream 1691, 945, 1066); direct after an
  ingress turn 5040, 4571, 4573.

## Status

Base branch: `release/v0.122.8`.

- Task 1 (spike): done. Results above.
- Task 2 (channel turn context): done. `processed.context`, the context part, and `display_content` on the turn's user message (in place of the part marker, see design section 7). `_attribution_part` prefers `sender["platform"]`, which the embed adapter (task 3.4) sets to the connection name.
- Task 3 (`embed` adapter): done. `api/oss/src/core/channels/adapters/embed/`, the ingress route `POST /channels/embed/events/{embed_id}/` and the public `GET /channels/embed/{embed_id}/config` (name, sanitized allowed origins, appearance; 404 when missing or inactive). Settings in `env.channels.embed` (rates per embed and per key, maximum message length, maximum file size; at most 10 files). `parse_event` takes an optional `request`; `build_setup_document` takes an optional `locator` (the connection's `connection_locator`, never the hydrated connection). The read routes reuse `visitor_key`, `visitor_locator` and `ChannelsIngressRouter.resolve_embed`.
- Task 4 (read routes): done. On `ChannelsIngressRouter`: `GET /channels/embed/{embed_id}/conversations` (the caller's threads, newest first, one row per session), `.../{thread_id}` (the session's records and the thread's `pending_choice`), `.../{thread_id}/live` (`live_event_stream`; the re-check closes the stream when the embed is deactivated or archived) and `.../{thread_id}/files/{file_id}` (session attachments only). A missing or inactive embed or a weak key answers 401; a thread outside the caller's space answers 404 like an unknown thread. Visitors see tool records (design risks). The read routes have their own rate limits per embed and per key (`env.channels.embed.read_requests_per_minute_*`, 6000 and 240 by default). Also: the attribution and context parts in `compose_input` now end with a blank line, because the runner joins text parts with no separator.
- Task 5 (widget): done. `web/mobile/src/pages/embed/[embedId].tsx` (thin shell; `getServerSideProps` reads the config route through `AGENTA_API_INTERNAL_URL` or `AGENTA_API_URL` and sends `frame-ancestors` with the allowed origins plus `AGENTA_WEB_URL`'s origin) and `web/mobile/src/features/embed/`. `_app.tsx` renders the page inside `BareProviders` only (query client and jotai store, no auth gate), and `AppProviders.tsx` skips the SuperTokens interceptor on `/m/embed`. The client is plain `fetch` with `X-Agenta-Visitor-Key` and `credentials: "omit"`; live events use a fetch-based SSE reader that shares `dispatchSessionLiveMessage` with the chat's EventSource transport. Rendering uses the `@agenta/chat` model and components. Approvals answer through the ingress with the token from `pending_choice` (retried while the outbox writes it). Files go up as base64 and come down as blobs. The server's current conversation is the newest row, so the widget keeps no thread id of its own: a reload opens the newest conversation. Before each send the widget re-reads the list and refuses the send if another window switched the conversation. The dev `web-mobile` service needs `AGENTA_API_URL` passed through turbo (`turbo.json` `passThroughEnv`). nginx stops sending `X-Frame-Options` for `/m/embed/`.
  The `use` command now switches for every channel: it closes the current row and creates a new current row that reuses the chosen session and keeps its open approval. The outbox posts to a session's newest row.
- Task 6 (publish and owner screens): done. The agent's Publish panel lists Embed next to API (`useChannelPanel` route `{view: "embed"}`, `ChannelsHubView`); the `ChannelPlatform` union is unchanged. `web/packages/agenta-settings-ui/src/publish/AgentEmbedPanel.tsx` lists the agent's embeds and creates one (allowed origins, then the agent is bound with the shared `pointConnectionAt`; a failed bind archives the new row). `EmbedSettingsForm.tsx` edits the name, origins and appearance, shows the snippet from the setup document and a live preview iframe, and archives. The settings write `name` on the connection and leave `appearance.name` unset, so the widget header and the owner's session titles use one value. Wired on /m in `useAgentPublishPanel.tsx`; `AgentPublish` (used only by the old desktop app) is not wired. 6.3 needed no UI: embed conversations are ordinary sessions of the agent, they show in the agent's session list, and their titles carry the connection name ("From user 1af9… (Support bot id 1af9…)"), checked live on 2026-10-17. An embed bound to a revision instead of the agent (only possible through the API) is not listed in the panel, as for the other channels.
- Task 7 (docs): done. 7.1 is `docs/docs/guides/13-embed-an-agent.mdx` (create from Publish > Embed, snippet, anonymous history, per-user key and its refusal rule, `agenta:init` and `agenta:context`, approvals, files, limits, and the v1 limits a user notices). 7.2 is `docs/docs/self-host/channels/02-embed-widget.mdx` (public HTTPS, `AGENTA_API_INTERNAL_URL` for the web-mobile server fetch, which Helm sets from `agenta.apiInternalUrl`, nginx `X-Frame-Options`) and the `channels.embed` table in `docs/docs/self-host/reference/01-configuration.mdx`.
- Phase 4 (full tests and whole-branch review): done. Helm now passes `agenta.apiInternalUrl` to the web-mobile pod. Each API process caps the open live streams per embed (`env.channels.embed.max_live_streams_per_embed`, default 200); the check and the reservation happen in the response (`_EmbedLiveResponse`), and over the cap the route answers 429, which the widget retries. `live_event_stream` now closes its pubsub even when its own cleanup cancels a slow unsubscribe. `sanitize_origins` drops the scheme's default port. `!sessions` counts sessions, not rows.
- Phase 5 (recorded live QA): every `qa.md` scenario passes on the dev stack (6 recordings, kept outside the repo until they go on the PR). One fix: a missing or archived embed now sends `frame-ancestors *`, so the host page shows "This chat is not available." instead of a blocked frame. The results table is on the PR (task 8.1). The videos could not be attached because the upload browser was not reachable, so they stay with the QA run.
- Optional origins (task 9): done. `allowed_origins` is optional and is the only record: empty or absent means any site. The API config route returns `["*"]` for it and the widget page sends `frame-ancestors *` and hears `agenta:init`/`agenta:context` from its parent on any origin (`agenta:ready` still goes only to the parent's origin). A list whose entries all fail sanitizing allows no site. Entries may be `scheme://*.host[:port]` (subdomains only, as in CSP). The settings and create form show the "Specific domains" toggle; it is derived from the list, and the typed domains are kept in the form only while it is open. Design section 2 records why there is no second field.
- Widget fixes (2026-10-18): (1) the typing dots stay from the send until a reply shows. The widget keeps a list of pending sends, registered before the request, and waits until the records hold them all and a reply follows; the loader no longer replaces the transcript while a sent message's new conversation loads, and the read is re-polled every second while a send waits with no running turn. (2) A turn that never ran writes nothing to the session, so the read route returns `unstarted_turns`: REFUSED triggers and FAILED ones with code `never_sent` or `start_rejected` over the session's rows. `start_rejected` is new: the inbox writes it for `WorkflowDetachedStartRejected`, which the workflows service raises when the service itself answers the start with a failure (a stamped non-2xx answer, such as the 422 for a model with no credential, or a failure as the first record). A gateway 502 or 504 stays `500` and is not counted. The widget shows "The agent could not reply. Try again." and never the run's own error text. A turn that ends with nothing after the message falls back to the 90 s timeout notice. (3) "Copy prompt" next to the snippet's Copy builds a prompt for an AI coding assistant from the snippet (`embedAssistantPrompt` in `embedApi.ts`).
