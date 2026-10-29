# WP20 — tasks

Spec: [specs-wp20.md](specs-wp20.md). Design: `rendering.md`.

Starts after WP24 merges. Design against Agenta first, Slack second — the order is
the point.

## The pending choice

- [ ] Shape on `ChannelThreadData`: the choices in order, a short token each, and
      when it was posted.
- [ ] Written when a choice is rendered, by the outbox.
- [ ] Superseded when a newer choice is posted on the same thread. Newest wins;
      older ones stop accepting.
- [ ] The token is ours and never shown; the label is the agent's own words.

## Resolution — one event from two arrivals

- [ ] A reply whose text matches a pending choice's number resolves to that choice.
- [ ] A click carrying a token resolves to the same.
- [ ] Both produce **one** inbound event of kind `ACTION`, with the resolved value
      as content. Assert this equality directly — it is the whole design.
- [ ] A stale, superseded or unknown token is **ignored**, not refused. Log it, post
      nothing.
- [ ] The inbox worker treats `ACTION` as an ordinary addressing event.

## Agenta

- [ ] A choice is answered by posting the token as an ordinary message — the poorest
      possible shape, which is what keeps the mechanism portable.

## Slack

- [ ] `parse_event` handles `block_actions` — it currently returns `None` for
      anything that is not `event_callback`.
- [ ] Extract the token from the action's `value`.
- [ ] **Fix `F13` here**: the renderer currently drops WP5's `value`, so no token
      reaches the payload and nothing can come back.
- [ ] Locators come from the payload's `container`, not from `event`.
- [ ] `external_id` for dedup is the action's own id, not the message's — Slack
      redelivers.

## Tests

- [ ] Click and numbered reply produce identical inbound events.
- [ ] Superseded choice: the old token stops resolving once a new choice posts.
- [ ] Unknown token is ignored, not refused.
- [ ] Slack `block_actions`: token extracted, locators right, redelivery writes no
      second row.
- [ ] Acceptance on Agenta: render a choice, click it, the agent receives the
      resolved value.

## Done when

- [ ] `ChannelEventKind.ACTION` is reachable from real payloads on both channels.
- [ ] `F38` and `F13` closed with the verification recorded.

## Watch for

- **Do not shape this around `block_actions`.** If the mechanism needs a field only
  Slack supplies, it is wrong — a numbered reply carries nothing but the number.
- **Modals are excluded, not deferred.** `rendering.md` says why. Do not add a modal
  path because Slack makes it easy.
