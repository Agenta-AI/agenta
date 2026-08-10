# Open design items

The list the redesign works from. Written at C4, after wave 4 and after reading a
comparable stack built independently.

Target surfaces, in order: **Slack, Telegram, Discord**. Designed against a
text-only floor, because the surfaces are unequal and the poorest one is what stops
the design drifting into Slack's feature set.

## The list

Maintained here. Status is one of **decided** (settled, no doc needed), **written**
(a design exists, awaiting review), **partial** (some of it is written), or **open**
(nothing written yet).

| # | Item | Status | Where |
| --- | --- | --- | --- |
| 1 | Capabilities: needs, fallbacks, per-connection | **written** | `capabilities-v2.md` |
| 2 | Provisioning, incl. both app models | **written** | `provisioning.md` |
| 3 | Rendering across unequal surfaces | **written** | `rendering.md` |
| 4 | Identity linking | **written** | `identity.md` |
| 5 | Agenta as a channel | **open** | — |
| 6 | The configuration surface | **open** | — |
| 7 | Button clicks — the parsing half | **partial** | `rendering.md` decides resolution |
| 8 | What the connection key identifies | **written** | `channel-connections.md` |
| 9 | The bridge | **decided: keep** | measured, below |
| 10 | User journeys | **open** | three to write, below |
| 11 | `channel_connections` table + `external_key` | **written** | `channel-connections.md` |

**Keep this table current.** It is the only status record — when a design lands,
change the row, and when a decision is taken, say what was decided rather than
deleting the row. Statuses reported in conversation and not written here are lost.

**Dependency, not priority.** Item 1 blocks 2, 3 and 6, because a credential schema
and per-connection declarations are what they read. Item 5 unblocks 6, 7 and the
first two journeys, since a first-party surface needs no credentials to drive.

Everything else in this file is the detail behind a row.

## The detail

### 1 — Capabilities

**Written.** It declares what a channel can do, and must also declare what it
**needs** (the credential schema), what to do **instead** (the per-node text
fallback), and all of it **per connection** rather than per channel — two app models
differ in capability, and a workspace can decline a scope at install.

Same type, same call site, so one change rather than three. Absorbs the old item 5.

### 2 — Provisioning

One declared credential schema, three per-platform flows. The Slack manifest is
generated from the configuration rather than from code, with the installed hash
stored so drift is visible.

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

### 3 — Rendering across unequal surfaces

Degrade to text, never to nothing. A node vocabulary where every node declares its
text fallback; a pending choice answerable by clicking *or* by replying with a
number; forms as sequences of questions; modals excluded.

### 4 — Identity linking

**Written.** The read path exists and nothing creates a link, so every platform user
is permanently unlinked. A short-lived single-use token posted in-thread, redeemed
against the user's own authenticated session. Agenta-as-a-channel skips it entirely
— which is a reason not to treat web as proof that identity works.

### 5 — Agenta as a channel

The mock adapter is real but has no surface — nothing posts to it over HTTP, so no
journey can be driven end to end without a platform.

The ask is a **usable channel UI**, not a throwaway harness: it drives
provisioning-time *and* run-time, so the whole journey is testable before Slack
credentials exist. Since it must render our node vocabulary and answer choices, it
is the same work as a web surface — so build it as a web package rather than a
scratch app. It is then the reference renderer for the vocabulary, and plausibly a
product surface later.

This is what makes items 2, 3 and 8 testable without a platform.

Both comparable products treat their own surface as a channel alongside Slack. Doing
the same makes item 6 not a mock but a **first-party channel** — which is why it
needs no credentials and can drive the whole journey.

It also sets the capability ceiling from the other end: we own the surface, so it
renders everything, and every platform degrades from it.

To settle: whether this replaces the existing chat/session UI or sits beside it —
new surface, or re-plumbing of one that exists.

### 6 — The configuration surface

What a user actually sees: which agents on which spaces, which commands enabled,
which spaces discovered. `provisioning.md` assumes this exists. Related to 6 — the
same web work.

### 7 — Button clicks

Nothing parses a click. The adapter returns early on anything that is not
`event_callback`, and a click arrives as `block_actions`. `rendering.md` decides
*how* a choice resolves — thread plus short token, so a numbered reply and a click
are the same event. What remains is the parsing and the event kind.

Note this is what made C4's exit condition unreachable as originally written.

### 8 — What the connection key identifies

**Written**: `channel-connections.md`. `connection-identity.md` holds the platform
research it was built from, and is superseded on its conclusion.

Three results from the platforms' own docs changed the design:

- **Telegram carries no bot identity on the payload at all** — confirmed against the
  full `Update` field list. The bot is identified by the transport, so the mechanism
  is `setWebhook`'s `secret_token`, echoed on every request as a header. This
  **forces an interface change**: `installation_hint(body)` cannot answer, because
  it never sees headers or path.
- **Slack has two payload shapes** — flat `team_id` on events and slash commands,
  nested `team.id` on interactivity. An extractor reading only `team_id` returns
  nothing for a button click, which is the path we have not built yet.
- **Discord has no tenant for DMs** — `guild_id` is absent, so a tenant-qualified
  key is undefined exactly when someone messages the bot directly.

A fourth result **overturned the rule those three suggested.** "The bot is the key
and the tenant is a qualifier" is wrong: an Enterprise Grid org-wide install is one
installation with one token spanning many workspaces — no tenant to qualify with —
and the two install models **coexist for one app**, so `team_id` cannot be in the
identity at all. The bridge disproves the other half: it has no bot.

The rule that actually holds: **core does not know what identifies a connection —
the adapter declares it and one function composes it**, exactly as `SPACE` and
`THREAD` already work.

Settled while designing: an org-wide install is **one** connection, and Slack does
not permit installing one app twice into a workspace — so two bots in one workspace
are two apps, separated by `api_app_id`.

### 9 — The bridge: keep

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

---

## Decided and designed: `channel_connections`

**The design is `channel-connections.md`.** What follows is the decision that led to
it, kept because it records why. Three things changed while designing it:

- **The scope claim was checked.** All eight channel tables live in one head
  revision, so a ninth is an edit to a file no released database has run.
- **The global constraint got a precise statement.** The table is project-scoped;
  the *external identity* is global. Consistent, because one platform installation
  exists once in the world and so belongs to exactly one project.
- **`installation_hint(body)` becomes `connection_locator(headers, path, body)`**
  and returns a locator rather than a string — so core composes the key here as
  everywhere else.

The original decision, kept because it records why:

**Decided.** Channels stops sharing `gateway_connections` and gets its own
`channel_connections` table, with `external_key` rather than `integration_key`.

Two reasons, in order:

- **Alignment.** Every other external identity in channels is a `*_locator` plus an
  `external_key` composed over the fields the adapter declares. A connection is the
  third grain of the same thing, and it should read identically.
- **Independence.** The gateway may not survive in its current form. Channels should
  not be coupled to a table whose future is someone else's decision.

Nothing is released, so the existing migration is **edited in place**. No
backward compatibility, no shims, no rename migration on the shared table.

Scope is small: only four channels files touch the gateway connection today —
`core/channels/service.py`, `core/channels/dtos.py`,
`apis/fastapi/channels/router.py`, `dbs/postgres/channels/dao.py`.

### What this unblocks that the shared table could not

- **A globally-unique constraint on `external_key`.** Ingress resolves the tenant
  *from* this key, so it must be unique across projects. That constraint is wrong
  for the gateway, where two projects legitimately connect to the same product.
- **A credential schema per channel**, without imposing one on Composio's rows.
- **`slug` out of the identity.** Two rows differing only by slug are two names for
  one connection, which is what makes the current `LIMIT 1` resolve ambiguous.

### The grain, corrected

The grain is **`CONNECTION`**, not `BOT`. Grains name the row they key — `SPACE`
keys a space, `THREAD` keys a thread. "Bot" is the product word and belongs in the
UI, not in the enum.

```
CONNECTION → connection_locator → external_key
SPACE      → space_locator      → external_key
THREAD     → thread_locator     → external_key
```

`compose_external_key` is already generic over grain and needs no change.

### What `external_key` identifies is provider-defined

Not "a bot" — that was a Slack shape generalised into a rule, and it is wrong for
the bridge. Each provider declares what its unit is:

| provider | the unit a connection is to |
| --- | --- |
| slack | a bot in a workspace — `api_app_id` + workspace or enterprise |
| telegram | a bot — identified by a secret token on the header, not the body |
| discord | an application; the guild is a qualifier and absent in DMs |
| bridge | **a bridge**, fronting a platform we do not know, with its own spaces |
| agenta | a bot in a project |

The bridge row is the one that disproves any universal "bot" framing: many bridges,
many connections, one `provider_key`.

### Still to design

- `connection_locator(request)` replacing `installation_hint(body)` — it must see
  headers and path, because Telegram carries no identity in the body at all.
- Whether an Enterprise Grid org-wide install is one connection or many.
- What moves with the table: credentials, status, verification state.
