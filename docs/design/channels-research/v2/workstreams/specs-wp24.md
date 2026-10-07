# WP24 — The Agenta channel

A first-party channel whose platform is us. Same registry, same port, same public
ingress, same inbox and outbox. It is not a harness and not a mock.

Design: `agenta-channel.md`, `journeys.md` §1.

## Why this exists

Four checkpoints in, **no message has travelled the whole path**. Every other
channel needs credentials from a platform we do not control, and the mock adapter —
which is real and complete — has no surface, so nothing can drive it over HTTP.

This channel needs no platform account, so C5's exit condition is provable on a
laptop. It is also the honest generality test of the port: `plan.md` says the port's
review comes from the first non-Slack channel, and this is the cheapest one that
exists.

## The credential is an API key, and the route is public

`/channels/agenta/events/` is registered in `_PUBLIC_ENDPOINTS` exactly as Slack and
the bridge are — four trailing-slashed spellings. The adapter verifies its own
credential, which is an Agenta API key on the request.

| | Slack | bridge | Agenta |
| --- | --- | --- | --- |
| credential | signing secret | bridge secret | **an API key** |
| verified by | HMAC | HMAC | key validation |
| returns | installation id | bridge id | the connection's key |
| a bad one | 401, no detail | 401, no detail | 401, no detail |

`verify_signature` means *prove the caller may speak for this connection and return
the id it speaks for*. It was never intrinsically an HMAC.

**Why not leave the route off `_PUBLIC_ENDPOINTS` and lean on session middleware:**
that would make Agenta the one channel whose credential the adapter does not check,
and would leave the whole credential path unexercised until Slack lands a wave
later. Both earlier drafts of this design did a version of that and both were wrong.

So `_ingest` has **no branch at all**.

## What differs, precisely

Four facts about the platform. None of them reaches `_ingest`, the inbox worker,
routing, policy, threads, offsets or the outbox — and if one ever does, that is the
finding this package exists to produce.

- **The credential is the caller's, not the installation's.** Which is why identity
  linking is skipped (`identity.md`): the account is known from the credential.
- **We are both ends.** `discover_spaces` returns rows we hold; `post_message`
  writes where the read route can see it rather than making an outbound call.
- **Delivery is pull.** The outbox still calls `post_message`; that method just
  terminates in our own store, and the surface polls.
- **Setup is empty.** All three slots of the setup declaration unfilled.

## Entities

- **connection** — a bot in a project. `connection_locator` is
  `{"project": …, "bot": …}`; no credential row.
- **space** — one `private` space per user, get-or-created on first contact. Not
  configured, not enumerated; permitted by one `(agent, ALLOW, kind=private)` grant
  (WP22).
- **thread** — one per agent within it, which is what "a conversation" means here.
  `!new` appends, latest wins.

Shaped exactly like a Slack DM, deliberately.

## The read route

`GET /channels/agenta/conversations/{id}` — `VIEW_CHANNELS`, authenticated
normally. The space's inbox log plus what the outbox posted back, in order.

Polling first. Streaming is a later change behind the same route and nothing in the
vocabulary depends on it.

## Files

- `core/channels/adapters/agenta/{adapter,capabilities,__init__}.py`
- `middlewares/auth.py` — the four `_PUBLIC_ENDPOINTS` lines
- `apis/fastapi/channels/ingress.py` — one route registration, no logic
- `apis/fastapi/channels/router.py` — the read route

## Capability declaration

We own the surface, so it declares **everything**: threads, buttons, edits,
markdown, files both directions. That sets the ceiling every platform degrades
*from*, which is the opposite of calibrating the vocabulary to Slack.

`identity.keys` names `project` and `bot` at `CONNECTION` grain, `user` at `SPACE`,
`thread` at `THREAD`.

## Tests

- Unit: the contract suite, unmodified, against `AgentaAdapter`.
- Unit: a bad API key, a missing one, and one whose project does not own the
  connection all refuse identically — same status, same body.
- Integration: post to the public route, assert one inbox row and a 202.
- Acceptance: the whole path — post, invoke, session events, outbox, read route
  returns the answer.
- **The test that matters:** `grep` the ingress, inbox worker and outbox for
  `"agenta"`. Zero occurrences outside the adapter's own directory and the route
  registration.

## Done when

- A message posted with an API key produces an answer readable from the read route.
- The contract suite passes with no adapter-local overrides.
- `_ingest` contains no channel-specific branch.
- A DM-shaped space resolves with no space row pre-created (WP22's grant rule,
  exercised here for real).

## Out of scope

The UI (WP25). Button parsing (WP20) — this package renders a choice; resolving a
click is WP20's.

Streaming. Polling is sufficient for C5 and the route does not change when
streaming lands.
