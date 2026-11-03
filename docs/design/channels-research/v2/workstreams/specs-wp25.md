# WP25 — The Agenta surface

The web UI that drives WP24, behind a feature flag. **Throwaway by intent; the API
under it is not.**

Design: `agenta-channel.md`, `journeys.md` §1.2.

## Why this exists, and why it is disposable

An API designed against no consumer is how the mock adapter ended up complete,
correct and undriveable. This surface exists so WP23's and WP24's routes are proven
by use before web builds anything permanent.

It is **not** a design deliverable. No polish, no design review, no responsive work.
When web implements the real surface they replace the components and keep the API,
and this deletes in one commit.

## Why in web and not Streamlit

The thing being tested is **our node vocabulary** — text, buttons, select, fields,
table, image, and each one's text fallback (`rendering.md`). Rebuilding that
outside the app means testing a second implementation of it, which proves nothing
about the renderer that ships.

Two further reasons: a separate app has to re-solve authentication, and the flag
makes keeping this free — off by default, no route exposed, invisible to anyone who
does not turn it on.

## The flag

`web/oss/src/state/settings/featureFlags.ts` already carries two flags as per-user
`atomWithStorage` atoms surfaced as switches on the settings page. Add a third the
same way. Default **off**.

## Scope

Five things, and nothing else:

1. **Pick a bot** — the connections list, filtered to `channel = "agenta"`.
2. **Open or resume a conversation** — a thread; "New conversation" is `!new`.
3. **Send a message** — `POST /channels/agenta/events/` with the user's API key.
4. **Read the reply** — poll the read route; render the node vocabulary.
5. **Answer a choice** — click a button, which posts the choice token as an
   ordinary message.

## Rendering is the deliverable

Every node type in `rendering.md`, rendered richly here because this surface
declares full capability. It is the **reference renderer** — the shape every
platform degrades from — so getting the vocabulary right matters even though the
components do not.

Include the degraded forms too, behind a toggle or a query parameter: a numbered
list where buttons are unavailable, `label: value` lines where fields are. That is
how *degrade to text, never to nothing* gets exercised without a text-only platform
to hand.

## Configuration, minimally

Enough to reach step 1 without curl: create a bot, add an agent by slug, and set the
one grant (`ALLOW`, `kind=private`). Three forms over WP23's routes.

This is deliberately the thinnest possible config surface. The real one is C6's, and
it needs the credential form this channel does not have.

## Files

`web/oss/src/…` entirely — this package owns its repo area and touches no API file.

## Tests

Package unit tests per the repo's frontend conventions. The tests that *matter* live
on the API and the adapter (WP23, WP24), not here — a throwaway component with a
thorough test suite is the wrong investment.

What is worth asserting: each node type renders, and each degraded form renders.
Those outlive the components.

## Done when

- With the flag on: create a bot, open a conversation, send, read the answer, click
  a choice.
- With the flag off: nothing is reachable and nothing is rendered.
- Every node in the vocabulary has been rendered at least once, both richly and
  degraded.

## Out of scope

Design. Polish. Mobile. Streaming. Anything a real surface would need — that is the
point of the flag.

The Slack setup pages (C6).
