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
| 2 | Provisioning, incl. both app models | **partial** | `provisioning.md`; credentials belong in `secrets` — see `journeys.md` |
| 3 | Rendering across unequal surfaces | **written** | `rendering.md` |
| 4 | Identity linking | **written** | `identity.md` |
| 5 | Agenta as a channel | **written** | `agenta-channel.md` |
| 6 | The configuration surface | **partial** | `agenta-channel.md` drives it credential-free |
| 7 | Button clicks — the parsing half | **partial** | `rendering.md` resolves; `agenta-channel.md` gives it a route |
| 8 | What the connection key identifies | **written** | `channel-connections.md` |
| 9 | The bridge | **decided: keep** | measured, below |
| 10 | User journeys | **written** | `journeys.md` — Agenta + Slack, step by step |
| 11 | `channel_connections` table + `external_key` | **written** | `channel-connections.md` |
| 12 | Where an agent may answer: grants by kind, allow/deny | **written** | `grants.md` |

**Keep this table current.** It is the only status record — when a design lands,
change the row, and when a decision is taken, say what was decided rather than
deleting the row. Statuses reported in conversation and not written here are lost.

## What blocks going back to implementation

The gate is not "finish the list". `journeys.md` writes the Agenta and Slack flows
step by step, and writing them settled most of what was open — the remaining gate is
below.

**Decide before the packages are written.**

| what | why it blocks | where |
| --- | --- | --- |
| **`F3`/`F41` — who publishes session events** | the one dependency channels cannot ship around, it is not channels work, and it has been unowned since C3 | ledger |
| The hosted-app model: do we offer one at all | it is a product decision, and it also settles a security-posture contradiction | `provisioning.md` §0 |
| The request-context interface change | `channel-connections.md` and `agenta-channel.md` both need it, and it edits a frozen interface at a checkpoint | both |
| `F49` — the interface's `verify_signature` is a lie | any package written against the declared contract breaks at the ingress | ledger |
| `F38` — button-click parsing | the last partial design item; the route exists, the parser does not | `rendering.md`, `agenta-channel.md` |

**Reconciliation debt, and it is the risk this session already demonstrated.**
Several documents now contain superseded material and still read as current, so
anyone designing from them cold gets a wrong answer — which is exactly what happened
here before the source was read. Each needs a supersession note at minimum:

| document | superseded by | on what |
| --- | --- | --- |
| `entities.md` §1 | `channel-connections.md` | the connection is reused, no channels-specific columns |
| `entities.md` §2.5 | `grants.md` | grants are instance-level only |
| `provisioning.md` | `journeys.md` §0 | credentials encrypted on the connection; the Slack setup shape |
| `capabilities-v2.md` §1 | `journeys.md` §0 | the credential schema as a new field-list mechanism |
| `connection-identity.md` | `channel-connections.md` | already noted at the top; the rest stands |

**Settled by writing the journeys**, and worth recording because each was on this
list as open:

- **Credentials live in `secrets`**, referenced by the connection — not encrypted
  into a new column. The table is project-scoped with a `PGPString` column that
  encrypts in Postgres. This is what `architecture.md` §8.2 meant by the vault;
  `provisioning.md` says otherwise and is superseded on that point.
- **Channels gets a `CHANNEL_SECRET` kind**, not `CUSTOM_SECRET`, and the kind is
  **nested** the way `PROVIDER_KEY`/`StandardProviderKind` already is: `data.kind` is
  the channel and decides the body's shape. **That nesting is the credential
  schema** — the store already validates it, so `capabilities-v2.md`'s proposed field
  list shrinks to what the form renders.
- **The credential schema is two fields for Slack and zero for Agenta.** The rule
  that shrank it: *ask for what only a human can copy, discover the rest.*
  `auth.test` returns `team_id` and `bot_user_id`; `api_app_id` is on the page they
  are already copying from, or comes back from `oauth.v2.access`.
- **Setup is customer-owned-app first.** Better rate limits, works self-hosted, no
  OAuth app of ours. **But the manifest is not the general mechanism** — it is a
  document the *user* applies, and Discord has none while Telegram has no app at all.
  Each channel declares its own setup shape.
- **We never own or create the customer's app.** They build it, click it into
  existence, or ask BotFather for it. Telegram's `setWebhook` is the one call we make
  on their bot, and it does not breach this.
- **A connection is verified before it is stored**, never after.
- **Teardown archives the channels rows and leaves the sessions**, since sessions
  outlive channels and the transcript stays readable in web.

**Blocks finishing, not starting.**

| what | why | where |
| --- | --- | --- |
| `F3` / `F41` — session events unowned and the stream round trip unproven | the outbox cannot leave polling | ledger |
| `F46` — the unscoped lookup needs its global constraint | `channel-connections.md` decides it; it lands with the table | ledger |
| `F38` — nothing parses a button click | item 7's parsing half; Agenta gives it a home first | ledger |
| Item 6's per-platform half | needs item 1 | `provisioning.md` |

**Cheap and worth taking with the first package**, because each is a guard that is
currently lying: `F48` (the keyword-only check cannot see sync methods), `F42`/`F43`
(a queue with no producer, a registry missing the mock adapter), `F50`+`F28`
(vestigial locators, and a bug in one of them that cannot bite).

**Two contradictions between documents**, both needing a decision rather than a
design:

- `architecture.md` §8.1 says *"there is no shared vendor app to compromise"*;
  `provisioning.md` §0 designs one. A security-posture claim and a product decision
  disagree.
- `entities.md` §1 says the connection is reused and takes no channels-specific
  columns; `channel-connections.md` reverses it. Recorded in that document, but
  `entities.md` still reads as current.

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

**Written**: `agenta-channel.md`. It is a real first-party channel, not a harness —
same registry, same port, same ingress-to-outbox path. The **API is permanent and
the UI is throwaway**, built together so the API is not designed against nothing.

Three questions it forces, all answered there: a connection is a bot in a project
(no credentials at all, which the credential schema should survive); a space is a
conversation; and **the ingress is the same one** — `/channels/agenta/events/` is an
ordinary literal route that is simply absent from the public-endpoint list, so auth
applies and the same `_ingest` runs. Exactly one step differs, in implementation
rather than shape: verification proves the caller may speak for the connection, and
a session proves that as well as an HMAC does. Nothing after the inbox row may
branch on the channel.

The UI goes **in web behind a feature flag**, using the per-user atom mechanism that
already carries two flags, because the thing being tested is our node vocabulary and
rebuilding that outside the app would test a second implementation of it.

The mock adapter is the warning this answers: real, complete, and with no surface,
so no journey can be driven with it.

**The earlier framing here was "a usable channel UI, not a throwaway harness".**
That is refined rather than reversed: the split is between the two halves. The
**API** is the permanent, usable thing and gets the tests; the **UI** is explicitly
throwaway, kept behind a flag until web implements it properly. Both are built
together, because an API designed against no consumer is how the mock adapter ended
up complete and undriveable.

This is what makes items 2, 3 and 8 testable without a platform.

Both comparable products treat their own surface as a channel alongside Slack. Doing
the same makes this a **first-party channel** rather than a mock — which is why it
needs no credentials and can drive the whole journey.

It also sets the capability ceiling from the other end: we own the surface, so it
renders everything, and every platform degrades from it.

To settle: whether this replaces the existing chat/session UI or sits beside it —
new surface, or re-plumbing of one that exists. Web already has an agent chat, and
if a channel conversation is a session viewed differently, these may be one surface
with two entry points.

### 6 — The configuration surface

What a user actually sees: which agents on which spaces, which commands enabled,
which spaces discovered. `provisioning.md` assumes this exists.

**Partly answered by item 5.** Creating a bot, a roster and grants is the same
configuration flow every channel needs, and the Agenta channel is the first that can
drive it with no credentials — so the flow gets exercised before any platform is
involved. What remains is the per-platform half: the credential form generated from
the declared schema, the manifest and its drift state, and the verification step.
Those need item 1's credential schema, which is why 1 blocks this.

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
