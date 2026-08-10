# Agenta as a channel

The channel that makes the rest real. Every other surface needs credentials from a
platform we do not control, so nothing can be driven end to end today — four
checkpoints in, no message has travelled the whole path.

This one needs no credentials, because we own both ends.

## What it is, and what it is not

**It is a real first-party channel**, not a test harness. It registers in the
adapter registry beside `slack` and `bridge`, answers the same
`ChannelAdapterInterface`, declares capabilities the same way, and its events go
through the same ingress, the same inbox, the same worker, the same outbox. If it
needed a special path anywhere, that would be a defect in the port, and finding
that is half the point.

**The UI is throwaway. The API is not.** That asymmetry is the whole shape of this
work:

- the **adapter** and its **API surface** are permanent — they are how any web
  surface talks to channels, including the real one web will build
- the **UI** is a stand-in that exists to prove the API, and is deleted when web
  implements properly

Building them together is what stops the API being designed against nothing. The
mock adapter is the warning: it is real, complete, and has no surface, so no journey
can be driven with it.

## Why it is worth doing before Slack

Three things it settles that Slack cannot.

**It is the only surface where we control the capability ceiling.** We own it, so it
renders everything — every node in the vocabulary, buttons, choices, forms as
sequences. Every platform then degrades *from* it. Without it, the richest declared
surface is Slack, and a vocabulary calibrated to Slack is exactly what
`rendering.md` is written to prevent.

**It closes the loop with no external account.** C4's exit condition is a message
travelling the whole path with no credentials of any kind. The bridge test-drive
process proves the wire; this proves the product.

**It is the honest test of the port.** `plan.md` is explicit that the port's
generality review comes from the first non-Slack channel, and expects the adapter
interface to change — *"that is the follow-up working, not failing"*. Agenta is the
cheapest possible non-Slack channel, so it buys that review early and without a
platform.

One thing it deliberately does **not** prove, and `identity.md` already says so: the
user is already authenticated on our own surface, so the account is known before the
message exists and identity linking is skipped entirely. **Agenta working is not
evidence that identity works.**

## The three questions it forces

Each is a design question the other channels let us defer, and each has an answer.

### 1. What is a connection, when there is no platform?

Every other channel's connection is an installation somewhere else. Here there is no
elsewhere. The connection is **a bot in a project**: a named agent-facing surface an
operator creates, with a roster, spaces and grants like any other.

This is also the cleanest demonstration of why the connection key is
provider-defined (`channel-connections.md`). Its `connection_locator` is
`{"project_id": …, "bot": …}` and its `external_key` composes from that. No
credentials block at all — the credential schema declares an empty set, which is
itself a useful case for the schema to survive.

**It confirms the multi-bot shape from the other end.** One project may hold several
Agenta bots exactly as it may hold several Slack bots, and the same constraint keeps
them apart.

### 2. What is a space, when there is no workspace?

A space is where agents may answer. Here the natural unit is **a conversation the
user opens** — one space per conversation, of kind `private`, since it is one person
talking to their project's agents.

That is a real answer and not a degenerate one: it exercises the space-resolution
path, default-deny, grants, and the space's own backfill flag, without a platform.

The open sub-question is whether an operator pre-configures spaces here or whether
opening a conversation creates one. Every other channel discovers spaces from the
platform and an operator picks from the list. Here we *are* the platform, so
creation-on-open is available and is probably right — but it is the one place this
channel could diverge structurally from the others, so it is called out rather than
assumed.

### 3. What does the ingress verify, when the caller is us?

The one genuinely awkward question, and the reason this needs designing rather than
just building.

Every other channel's ingress is public and unauthenticated at the middleware level,
verifying an HMAC instead. Agenta's caller is a logged-in user with a session, so
the ingress would be verifying a signature nobody needs, over a request that already
carries a stronger proof of identity.

**So Agenta's inbound does not go through the public ingress.** It goes through the
authenticated channels API — an ordinary project-scoped route with the normal
permission check — and writes the same inbox row the ingress would have written.

This is a deliberate divergence and it should be recorded as one. Justification:

- the public ingress exists to *establish* a tenant from an untrusted request, and
  here the tenant is already established by the session
- verifying an HMAC we both generated and checked proves nothing
- `RUN_CHANNELS` is the real check, and it is one the platform channels cannot make
  because they have no session

What must **not** diverge is everything after the row is written: routing, policy,
addressing, threads, offsets, invoke, outbox. If any of those needed a branch on
`channel == "agenta"`, the port is wrong.

`connection_locator` still has a job here — it names which bot the message is for —
so the adapter implements it against the authenticated request rather than against a
signature.

## The API surface

Permanent, and the deliverable web builds against later.

Three routes, all authenticated, all project-scoped, all under the existing channels
router:

- **send** — post a message into a conversation as the user. Writes the inbox row,
  returns the id. `RUN_CHANNELS`.
- **read** — the conversation's messages, which is the inbox log for a space plus
  what the outbox has posted back. `VIEW_CHANNELS`.
- **answer a pending choice** — resolve a choice by token, which is the same event
  as a click and as a numbered reply (`rendering.md`).

The third one is the one worth having early. It is the only place in the system
where a choice is answered by an API call rather than by a platform's click payload,
so it is where the choice mechanism gets designed properly rather than around
Slack's `block_actions` — the gap `F38` left open at C3.

**Delivery to the UI is polling first.** The outbox posts by calling the adapter, and
this adapter's post is "write it where the read route can see it". Streaming is a
later change behind the same route, and nothing in the vocabulary depends on it.

## The UI

A stand-in, and it should look like one.

**In web, behind a feature flag** — not a separate app. The repo already has the
mechanism: `web/oss/src/state/settings/featureFlags.ts` holds per-user
`atomWithStorage` flags, surfaced as switches on the settings page, and two flags
already ride it. A third costs one atom and one row, defaults off, and is invisible
to anyone who does not turn it on.

Why in web rather than Streamlit, given it is throwaway:

- **it must render our node vocabulary**, which is the thing being tested, and
  rebuilding that outside the app means testing a second implementation of it
- **the flag makes it free to keep** — off by default, no route exposed, deletable
  in one commit
- **a separate app needs auth**, and re-solving login outside web is more work than
  the UI itself
- when web builds the real surface, they replace the component and keep the API

The scope is deliberately small: pick a bot, pick or open a conversation, type,
see the answer, click a choice. No design work, no polish — it is a probe.

**It is throwaway in exactly one direction.** The UI is disposable; what it proves —
that the vocabulary renders, that a choice resolves, that the API is sufficient — is
not. So the tests that matter sit on the API and the adapter, not on the component.

## What this closes

- **Item 5** — Agenta as a channel: this document.
- **Item 6** — the configuration surface: partly. Creating a bot, a roster and
  grants is the same configuration flow every channel needs, and this is the first
  one that can be driven without credentials.
- **Item 7** — button clicks: the answer-a-choice route is the parsing half's
  counterpart, and designing it here rather than in Slack's payload shape is what
  keeps it general.
- **The capability ceiling**, from the top rather than from Slack.

## Still open

- **Whether it replaces or sits beside the existing chat/session UI.** Web already
  has an agent chat. If a channel conversation is a session, and the web chat is a
  view onto a session, these may be the same surface with two entry points — which
  would make the real version a re-plumbing rather than a new page. Worth deciding
  before web builds anything permanent, and not something this stand-in settles.
- **Space creation on open**, per question 2.
- **Whether the authenticated-inbound divergence should be a general mechanism.**
  A first-party surface is unlikely to be the last thing that wants to inject an
  inbox row with a session rather than a signature.
