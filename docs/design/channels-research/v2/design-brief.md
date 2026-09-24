# Design brief: connect an Agenta agent to Slack and Telegram

## What Agenta is
Agenta is a platform where people build AI agents. An agent answers questions and does
work. Today an agent is used inside Agenta's own apps. We now let a person talk to their
agent from the chat tools they already use: Slack first, Telegram next.

## What to design
Design the full flow for connecting one agent to an outside chat platform, and for
managing that connection afterward. Cover Slack and Telegram. Design for two surfaces
that must look and behave the same:
- The new Agenta app (route `/m`). This is the new app for all devices, not mobile only.
- The desktop Agenta app.

## The core journeys
1. A person opens their agent and connects it to Slack or Telegram.
2. By default they use the Agenta-hosted bot with one click.
3. They can instead use their own custom app or bot. Walk them through it step by step.
4. After connecting, they can see the connection, change two simple behavior switches,
   and disconnect.

## Default versus custom
- Hosted (default): the Agenta bot. One click to connect. No tokens, no manifests.
- Custom: the customer's own Slack app or Telegram bot. Show a clear, numbered setup
  guide. Copy a pre-filled manifest for Slack, or a bot token for Telegram. Let them
  paste credentials and finish.

Reference flows to follow for tone and structure (screenshots provided separately):
- Slack, hosted and custom, uses tabs: New Channel, Existing Channel, Commands, Custom
  App. Custom App offers "New App (pre-filled manifest)" or "Existing App", then a setup
  guide, then a credential form.
- Telegram, hosted, uses a QR code and a "Continue in Telegram" deep link. The bot then
  greets the user and shows a "Link Account" button with a one-time link that expires.
  It also offers an "Allowed user IDs" field so only listed people can message the bot.

## The two behavior switches (the only agent settings we show)
- Direct messages: Allow or Deny. Default Allow.
- Group chats: Allow or Deny. Default Allow.
Use plain wording, for example "Whether this agent answers a direct message opened with
it." Keep both simple and visible.

## What to hide
Do not show these advanced controls in the main flow. Put them under an "Advanced"
section that is collapsed by default: message triggers, session memory scope, reading
prior history (backfill), and reading messages that arrive while the agent is thinking
(forwardfill). We ship sensible defaults for all of them.

Never show internal identifiers. No slugs, no ids, no revision numbers, no raw tokens in
plain view. Use secret fields with a show or copy control.

## One agent rule
On the hosted bot, a workspace routes to a single default agent for now. Design for one
connected agent per workspace on the hosted path. On a custom app or bot, one app equals
one agent, because the customer names their own bot.

## Entry point: give me options
The likely home for the connect flow is the agent page, with a "Connect to Slack or
Telegram" area, like the reference. Do not assume this is the only answer. Propose two or
three entry-point options with trade-offs, for example:
- A card on the agent page.
- A tab in Settings that lists all connections.
- A dedicated "Integrations" area.
Recommend one and say why. Show how the chosen entry point looks on both surfaces.

## States to include
- Empty state: no connection yet.
- Connecting: the hosted one-click and the custom step-by-step.
- Connected: an overview that shows the platform, the connected chats, and status.
- Error states: a failed connect, a revoked or expired credential, a bot removed from a
  chat.
- The Telegram account-link waiting state and its success.

## Visual style
Match Agenta's existing design system. Clean, minimal, lots of whitespace, few colors.
Use the platform logos for Slack and Telegram next to the Agenta mark, as in the
references.

## Deliverables
- The connect flow for Slack (hosted and custom) on both surfaces.
- The connect flow for Telegram (hosted and custom) on both surfaces.
- The connected overview and the two behavior switches.
- The Advanced section, collapsed, showing where the hidden controls live.
- The entry-point options with a recommendation.
