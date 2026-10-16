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
| The Agenta chat streams a session whose turn the channel worker started | Not run | |
| Time from ingress to first token, compared with a direct chat send | Not run | |

## Status

Specification only. No implementation yet. Base branch: `release/v0.122.8`.
