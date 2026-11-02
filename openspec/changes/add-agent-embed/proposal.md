# Add agent embed (v1)

## Why

People build small internal tools and dashboards, then want to talk to an agent inside them. Today an Agenta agent can be published to Slack, Telegram and WhatsApp, but not into a web page. The first users are internal tools: a dashboard or small app whose owner wants a chat panel with an agent that can call that app's backend.

The channels system already does most of the work a published agent needs: connection settings, agent binding, grants, threads mapped to sessions, sender attribution, approval answers, commands, turn queueing and identity links. Its design names the first-party `agenta` channel as "how any web surface talks to channels" (`docs/design/channels-research/v2/agenta-channel.md`). The embed is that web surface, opened to people without an Agenta login.

## What Changes

- **New: an `embed` channel.** A channel adapter registered beside `agenta`. It reuses the `agenta` adapter's capabilities and its in-house delivery, and differs only in how a request proves who it is: a visitor key instead of an Agenta API key. The widget page may load only on allowed origins.
- **New: embeds are channel connections.** One connection per embed. Its data holds the allowed origins and a small appearance config. The agent binding and grants are the ordinary channel rows. The setup document is the iframe snippet.
- **New: visitor keys.** Each visitor is one channel space, keyed by the hash of a random visitor key. The widget creates the key per browser by default. The host page may pass its own key, for example one stored per logged-in user, so history follows that user across devices.
- **New: the widget.** A chat page served by Agenta inside an iframe, built on `@agenta/chat`. It sends through the `embed` channel's ingress and renders the conversation's session, which streams.
- **New: visitor-scoped read routes.** List the visitor's conversations, read one, follow it live, and download its files. Each route checks that the conversation belongs to the caller's space.
- **New: host context.** The host page may pass `context`, any JSON. It is stored on the inbound event and shown to the model as a labeled part before the message, next to the existing sender attribution. This works for every channel, not only the embed.
- **Modified: the chat shows the person's own words.** When the attribution part or the context part is added, the turn's user message carries `display_content` with only the person's own words, so chat views show those words and the model still sees every part.

## Capabilities

### New Capabilities

- `embed-channel`: the `embed` adapter, embed connections, visitor keys, the widget, visitor-scoped read routes, and owner visibility.
- `channel-turn-context`: host context stored on inbound events and shown to the model; `display_content` keeps the person's own words for the chat.

## Impact

- **API:** a new adapter and ingress route `/channels/embed/events/{embed_id}/`; visitor-scoped read routes; a `context` field on processed inbound events; `display_content` on the channel turn's user message in `compose_input`.
- **Web:** a widget route built on `@agenta/chat` with an embed transport; the embed appears in the channel publish screens.
- **No new tables.** Embeds, visitors and conversations are existing channel rows.
- **Security surface:** a public ingress and public read routes, limited by visitor key, `frame-ancestors`, CORS and rate limits.
- **Out of scope for v1:** values for tool bindings, HTTP tools, header templating, verified identity, client tools on the host page, a floating launcher script, platform plugins.
