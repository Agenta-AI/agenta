# Open design items

The list the redesign works from. Written at C4, after wave 4 and after reading a
comparable stack built independently.

Target surfaces, in order: **Slack, Telegram, Discord**. Designed against a
text-only floor, because the surfaces are unequal and the poorest one is what stops
the design drifting into Slack's feature set.

## Written, awaiting review

### 1. Provisioning — `provisioning.md`

One declared credential schema, three per-platform flows. The Slack manifest is
generated from the configuration rather than from code, with the installed hash
stored so drift is visible.

### 2. Rendering across unequal surfaces — `rendering.md`

Degrade to text, never to nothing. A node vocabulary where every node declares its
text fallback; a pending choice answerable by clicking *or* by replying with a
number; forms as sequences of questions; modals excluded.

## To design

### 3. Button clicks

Nothing parses a click. The adapter returns early on anything that is not
`event_callback`, and a click arrives as `block_actions`. `rendering.md` decides
*how* a choice resolves — thread plus short token, so a numbered reply and a click
are the same event. What remains is the parsing and the event kind.

Note this is what made C4's exit condition unreachable as originally written.

### 4. Capabilities — three missing axes, one change — `capabilities-v2.md`

**Written.** It declares what a channel can do, and must also declare what it
**needs** (the credential schema), what to do **instead** (the per-node text
fallback), and all of it **per connection** rather than per channel — two app models
differ in capability, and a workspace can decline a scope at install.

Same type, same call site, so one change rather than three. Absorbs the old item 5.

### 6. A mock channel worth keeping

The mock adapter is real but has no surface — nothing posts to it over HTTP, so no
journey can be driven end to end without a platform.

The ask is a **usable channel UI**, not a throwaway harness: it drives
provisioning-time *and* run-time, so the whole journey is testable before Slack
credentials exist. Since it must render our node vocabulary and answer choices, it
is the same work as a web surface — so build it as a web package rather than a
scratch app. It is then the reference renderer for the vocabulary, and plausibly a
product surface later.

This is what makes items 2, 3 and 8 testable without a platform.

### 7. Multi-tenancy of a platform app

Not one Slack app: **many**. An Agenta-provided app installable by many customers,
plus customers' own apps for their own workspaces. That decides:

- whether credentials are per-connection or shared by an app across connections
- what the connection lookup keys on, which is where an unscoped key already lets
  one tenant's event resolve against another's connection
- whether the manifest is per-installation or per-app

**Partly answered by research** (see `prior-art.md`): a comparable platform offers
both an own-brand app and a customer-owned app, and declares the capability
difference — the shared app cannot do commands, modals or event subscriptions,
because those belong to the app rather than the installation. `provisioning.md` now
carries that as its section 0. What remains is whether we offer both, and how a
customer moves from one to the other.

### 8. Identity linking — `identity.md`

**Written.** The read path exists and nothing creates a link, so every platform user
is permanently unlinked. A short-lived single-use token posted in-thread, redeemed
against the user's own authenticated session. Agenta-as-a-channel skips it entirely
— which is a reason not to treat web as proof that identity works.

### 9. The configuration surface

What a user actually sees: which agents on which spaces, which commands enabled,
which spaces discovered. `provisioning.md` assumes this exists. Related to 6 — the
same web work.

### 10. The bridge: **keep** — decided

Measured rather than assumed: `_ingest` branches on channel **zero** times, and
outside the bridge adapter's own directory the word appears only in docstrings and
one auth entry. The over-wire path *is* the in-process path reached over HTTP.

So cutting it recovers almost nothing — the per-connection capability work is needed
regardless, the moment one customer has two Slack workspaces with different
declarations. The earlier argument to cut attributed a general cost to the bridge.

The argument to keep is the one our own contract already made: the bridge is the
only consumer of the adapter contract that is not us, and a contract only its author
implements is a data structure. The out-of-process counterpart has already earned
this once, by finding the defect that broke Slack too.

### 11. Agenta as a channel

Both comparable products treat their own surface as a channel alongside Slack. Doing
the same makes item 6 not a mock but a **first-party channel** — which is why it
needs no credentials and can drive the whole journey.

It also sets the capability ceiling from the other end: we own the surface, so it
renders everything, and every platform degrades from it.

To settle: whether this replaces the existing chat/session UI or sits beside it —
new surface, or re-plumbing of one that exists.

### 12. The identity key is the bot, not the place

`integration_key` holds Slack's `team_id`, which identifies the **workspace**. Two
bots in one workspace therefore collide, and the ingress lookup takes `LIMIT 1` on
`(provider_key, integration_key)` — so the second bot is unreachable and the first
silently wins.

A connection already **is** one bot, so no new entity and no new column: the field is
right and the value is wrong. It must hold whatever identifies the bot — for Slack
`team_id` plus `api_app_id`.

Two consequences worth stating as rules:

- **The ingress resolve is the one query that cannot be project-scoped**, because its
  job is to *establish* the project. Everything after it is scoped by what it
  returned. So the key must be **globally** unique, not unique per project — today's
  constraint is `(project_id, provider_key, integration_key, slug)`, which permits two
  projects to collide.
- **`slug` should not be part of the identity.** If a connection is a bot and the key
  identifies the bot, two rows differing only by slug are two names for one bot —
  which is exactly what `LIMIT 1` cannot resolve.

Being confirmed against the four platforms' actual payloads before it is written up;
Telegram in particular may carry no bot id at all.

## Explicitly parked

- **The agent-facing event protocol.** Adopting the standard one would mean
  reshaping turns, sessions and the outbox around another event model. Too deep for
  what it buys today.
- **Input sequencing.** Two messages arriving mid-turn. This is the **runner and
  sessions** concern, not a channels one — channels works without it and needs no
  revisit when it lands.
- **Distribution and a community catalogue.** A product decision, and the contract
  already pre-commits that community code is never auto-installed.

## User journeys

Packages alone produced a system nobody can use: coherent, correctly ordered, and
four checkpoints in with no way to configure a channel. So the journeys get designed
alongside the packages, and each one has to name the packages that complete it.

The three to write:

1. **Provisioning** — from "I want my agent in Slack" to a verified connection: app
   created, installed, credentials stored, inbound URL live, event received.
2. **Usage** — a message addressed to an agent, answered in thread; a command; a
   choice answered both by click and by number; backfill on first contact.
3. **Operations** — the manifest drifts from the configuration; a credential is
   revoked; a connection is removed; a platform stops delivering.

Journey 1 is the one that would have caught the provisioning gap in week one.
