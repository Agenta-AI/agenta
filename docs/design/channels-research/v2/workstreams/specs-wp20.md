# WP20 — Inbound actions

Parsing a click. `ChannelEventKind.ACTION` exists and is unreachable: `parse_event`
returns `None` for anything that is not `event_callback`, and a Slack click arrives
as `block_actions` (`F38`).

Design: `rendering.md`, `agenta-channel.md`.

## Why this is designed against Agenta first

`rendering.md` decides *how* a choice resolves: **a click and a reply of "1" are the
same event**. That constraint is what makes the mechanism portable — a text-only
surface has nowhere to put a payload, so the id must be resolvable from the thread
plus a short token.

Slack's `block_actions` carries a rich payload, and building the parser against it
first would produce a mechanism that only works where such a payload exists. Agenta
posts the token as an ordinary message, which is the poorest possible shape, so
designing here keeps the general form.

This is also why the package sits after WP24 rather than in C6 with Slack.

## The pending choice is state on the thread

It has to be, or the numbered form cannot resolve. Stored on the thread, with:

- the choices, in order, as rendered
- a short token per choice
- superseded when a newer choice is posted — a stale `2` must not answer an hour-old
  question

**Newest pending choice wins; older ones stop accepting.** The label is the agent's
own words; the token is ours and the user never sees it.

## Resolution

Both paths converge before anything is written:

| arrival | becomes |
| --- | --- |
| a click carrying a token | an inbound message whose content is that token |
| a reply of `1` in a thread with a pending choice | the same |

So there is **one** event kind and one write. `ChannelEventKind.ACTION` marks it,
and the inbox worker treats it as an ordinary addressing event — a turn runs, the
agent receives the resolved choice.

An answer to a choice that has been superseded, or a token that matches nothing, is
**ignored rather than refused**: the thread has moved on and an error would be
noise. Log it; do not post.

## Slack's half

`parse_event` learns `block_actions`:

- extract the action's `value` — which is the token, because WP5's renderer puts it
  there
- the `external_id` for dedup: Slack redelivers, so the action's own id, not the
  message's
- the space and thread locators come from the payload's `container`, not from
  `event`, which is the shape difference that makes this more than a branch

The `value` is currently dropped by Slack's button rendering (`F13`, P3) — fix it
here, since a token that never reaches the payload cannot come back.

## Files

- `core/channels/adapters/slack/mapping.py` — the `block_actions` shape
- `core/channels/adapters/agenta/` — token-as-message, if not already done in WP24
- `core/channels/dtos.py` — the pending-choice shape on `ChannelThreadData`
- `core/channels/service.py` — resolution and supersession
- `tasks/asyncio/channels/inbox.py` — treat `ACTION` as an addressing event

## Tests

- Unit: a click and a numbered reply produce **the same** inbound event.
- Unit: a stale token against a superseded choice is ignored, not refused.
- Unit: an unknown token is ignored.
- Unit: a second choice supersedes the first; the first stops accepting.
- Unit: Slack `block_actions` yields the token, the right locators, and a stable
  `external_id`; a redelivery writes no second row.
- Acceptance: on Agenta, a rendered choice is answered by clicking and the agent
  receives the resolved value.

## Done when

- `ChannelEventKind.ACTION` is reachable from a real payload on both channels.
- A choice is answerable by click and by number, and both produce one event.
- `F38` and `F13` closed.

## Out of scope

Modals. `rendering.md` excludes them deliberately: building them means the richest
surface gets a feature the others cannot have, and every message path then has two
shapes forever.

Forms as a primitive. A form is a *sequence* of choices on the thread — the same
mechanism repeated, needing nothing new here.
