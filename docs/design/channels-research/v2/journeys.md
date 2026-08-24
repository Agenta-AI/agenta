# Journeys

Agenta and Slack, written together, because designing either alone puts it in the
air. Every step names the screen, the call, the row written and the credential
moved. Where something does not exist yet, it says so.

Sources: the secrets domain in this codebase, Slack's own manifest and OAuth
documentation, and the setup flows of five comparable products in `v1/raw/`.

## Two axes

**Config time** is an operator wiring a channel up, changing it, and taking it
down. **Runtime** is somebody using it — a message, an answer, a choice. They have
different users, different permissions and different failure modes, and conflating
them is what produced a system that was runnable and unconfigurable.

|  | **config time** | **runtime** |
| --- | --- | --- |
| **Agenta** | §1.1 — bot, roster, grants, teardown | §1.2 — open a conversation, talk, choose |
| **Slack** | §2.1 — app, credentials, spaces, roster, drift, rotation, removal | §2.2 — mention in a thread, answer, choose |

Telegram is the third column later, and it is the cheap test of whether the config
column generalises — one field and a `getMe`.

**Read the runtime rows across, not down.** §1.2 and §2.2 must be the same code
reached two ways; if either needs a branch on the channel, the port is wrong. The
config rows are where the channels genuinely differ, and the whole design effort is
about keeping that difference contained there.

Permissions split on the same line: config time is `EDIT_CHANNELS`, runtime is
`RUN_CHANNELS`.

---

## Part 0: what already exists

Checked, not assumed. This is what the journeys are allowed to build on.

**A working encrypted secret store.** `secrets` is a project-scoped table whose
`data` column is `PGPString` — a SQLAlchemy type that calls Postgres'
`pgp_sym_encrypt` on write and `pgp_sym_decrypt` on read, with the key supplied per
request from a context variable. It has a service with create/get/list/update/delete,
a nullable `slug` unique per project, and a `SecretKind` enum.

**This is what channel credentials should use**, and it changes the credential
design: `provisioning.md` says credentials are stored encrypted on the connection.
They should instead be a **secret row, referenced by the connection**, because the
encryption, the key handling and the never-echo behaviour already exist and are
already tested.

`architecture.md` §8.2 already said so — *"tokens live in the vault, encrypted at
rest, referenced by connections"*. The vault is `secrets`.

**Channels gets its own kind: `CHANNEL_SECRET`.** Not `CUSTOM_SECRET`, which is the
kind for arbitrary user-named secrets a person creates for themselves. A channel
credential is neither arbitrary nor user-named: its fields are dictated by the
channel, it is written by the setup flow rather than by a user, and it is
meaningless outside the connection that references it. Reusing `CUSTOM_SECRET` would
put machine-managed rows in the bucket a user browses and deletes by hand.

### The kind is nested, and that nesting is the credential schema

The store already has this shape. `SecretKind.PROVIDER_KEY` is the outer kind, and
`data.kind` is an inner enum — `StandardProviderKind` — that decides what the body
must contain, validated in one discriminator. `CUSTOM_PROVIDER` does the same with
`CustomProviderKind`.

Channels is the same two levels:

| outer `kind` | inner `data.kind` | body |
| --- | --- | --- |
| `CHANNEL_SECRET` | `slack` | `bot_token`, `signing_secret` |
| `CHANNEL_SECRET` | `telegram` | `bot_token`, `webhook_secret` |
| `CHANNEL_SECRET` | `agenta` | empty |

**This is the credential schema**, and it is worth saying plainly because it was
being designed twice. `capabilities-v2.md` proposes declaring a field list — name,
type, secret, required, label — as a new mechanism on the capability declaration.
The inner kind already *is* the stored contract, validated the way four other kinds
are validated. The declaration's job shrinks to what the **form** renders: labels,
help text, and which field is a password box. What is *stored* and what is *valid*
is the secrets discriminator's job, and it already exists.

The nesting also gives per-channel shapes for free, which a flat `{str: primitive}`
map could not: Slack's two fields and Telegram's two are different fields, not a
shared bag.

**Follow the existing envelope.** Every branch wraps its payload — `data.provider`
for the three provider kinds, `data.secret` for custom. Channels uses
`data.channel`, so the inner DTO is `ChannelSecretSettingsDTO` under
`ChannelSecretDTO`, matching the four that exist.

**What a kind costs:** one enum member, one inner enum, one typed DTO branch in the
discriminator, and one migration line —
`ALTER TYPE secretkind_enum ADD VALUE IF NOT EXISTS 'CHANNEL_SECRET'`. Postgres
cannot drop an enum value, so the downgrade leaves the label behind, as the existing
migration records for its own addition.

**A correct Slack manifest builder with no callers.** `build_slack_manifest(request_url)`
produces scopes matching exactly what the adapter calls, the five bot events, and
`socket_mode_enabled: false`. It is right, and nothing invokes it.

**What does not exist:** any route that writes a connection, any provisioning UI,
any OAuth handling, any verification call, and the Agenta adapter.

### The provisioning contract: three slots, any of them empty

Setup differs per platform, and the differences are **fillings of one contract**
rather than shapes needing their own code paths. Three slots, each optionally empty:

- **instructions** — what the operator must do, which we can only describe
- **a document we generate** — for them to apply, in whatever form the platform takes
- **calls we make** — with the credential, once we hold it

Checked against the platforms' own documentation:

| channel | instructions | document | our calls |
| --- | --- | --- | --- |
| Slack | create the app, install it, copy two values | manifest, YAML or JSON | `auth.test` |
| Teams | sideload the package | `manifest.json` in a zip, with icons | — |
| Discord | create the app, **toggle the Message Content intent**, invite the bot | — | — |
| Telegram | `/newbot` to BotFather, paste the token | — | `setWebhook`, `getMe` |
| Agenta | — | — | — |

**Empty is not a special case, it is a declaration.** This is the discipline the
design already uses everywhere else: Telegram declares `backfill.supported: false`
and core never asks — no branch, just an empty answer. A channel with nothing to
generate answers with nothing, and Agenta, which fills no slot at all, is the
degenerate case of the contract rather than an exception to it.

So there is no new mechanism here. It is the declaration-plus-adapter-method pattern
already used for capabilities: the setup page renders what is declared, and the
adapter answers what it can generate and performs what it must call.

Deprovisioning is the same three slots. Slack has **no** call — we cannot uninstall
their app, and the removal page must say so rather than implying otherwise. Telegram
has `deleteWebhook`, which we can and should call. One slot, filled in one channel
and empty in the other.

**One ordering note, which is about what a call does rather than about shape.**
Slack's setup call only reads (`auth.test`), while Telegram's writes to their
platform (`setWebhook` registers our URL and mints the per-bot secret). So a
Telegram setup that fails midway can leave a webhook pointing at us with a secret we
never stored. The rule that covers it is the one S3 already states — **verify, then
store** — extended: where a call writes, store first, then call, then verify, so
nothing is left pointing at a row that does not exist.

What holds across every channel, and is worth stating because it decides UI copy:

> **We never own or create the customer's app.** They build it, click it into
> existence, or ask BotFather for it. We describe what it must contain, take what
> only they can give us, and configure what their token entitles us to configure.

**Corrected: this holds for every channel except the hosted Slack app.** It was
written before `provisioning.md` §0 admitted the second app model, and it is exactly
wrong for that one — we own the app, and the customer never sees a manifest at all.
Read it as scoped to customer-owned Slack, Telegram and Discord.
[`hosted-app.md`](hosted-app.md) is the other column, and it differs in more than
the click.

---

## Part 1: Agenta

First, because it needs no external account and it is what makes the Slack journey
testable before a workspace exists.

## §1.1 — Agenta at config time

### A1 — Create a bot

**Screen:** Settings → Channels → New bot.

**What the user does:** picks a name (`Support`), and that is all. No credentials —
this channel has none.

**What happens:**

1. `POST /channels/connections/` — the route that does not exist yet and is the
   first thing to build.
2. Service composes `external_key` at `CONNECTION` grain from
   `connection_locator = {"project_id": …, "bot": "support"}`.
3. One `channel_connections` row: `channel="agenta"`, `slug="support"`, no
   credential reference, `status` verified immediately — there is nothing to verify.

**What this proves:** the connections write path, the `CONNECTION` grain, and the
credential schema surviving an empty set. All three are needed by Slack and all
three are exercised here with nothing external.

### A2 — Give it an agent

**Screen:** the bot's page → Agents → Add.

**What the user does:** picks a workflow, gives it the slug people will type
(`~triage`), and marks it default.

**What happens:** `POST /channels/agents/` — this route **exists**. Writes
`channel_agents` with `data.references` pointing at the workflow and
`flags.is_default = true`.

### A3 — Change it, and take it down

The half every design skips, and the half that produces support tickets.

**Rename or re-slug.** The slug is a label, unique per `(project, channel)`, and
**not part of the identity** — that is exactly why `channel-connections.md` takes it
out of the key. So renaming is an ordinary edit and no thread, space or offset
moves.

**Disable without deleting.** `flags.is_active = false` on the connection. Inbound
still resolves — a message is not lost — but the agent does not answer. This is what
someone wants when a bot misbehaves at 3am, and it is one flag rather than a
teardown.

**Delete.** Archive, not a hard delete, following the house rule for lifecycle
columns. The question the design must answer is what happens to the conversation
history underneath: threads point at sessions, and sessions outlive channels. So
**archiving a connection archives its channels rows and leaves the sessions alone** —
the transcript remains readable in the web app, which is where it was always also
visible.

**What is deliberately hard:** re-pointing a bot at a different project. The
`external_key` is globally unique, so the same bot cannot exist twice, and moving it
means archiving and recreating. That is the honest answer rather than a migration
nobody would test.

## §1.2 — Agenta at runtime

### A4 — Open a conversation

**Screen:** the bot's chat, behind the feature flag.

**What the user does:** clicks "New conversation".

**What a conversation is: a thread, not a space.** The two are different grains and
an earlier draft of this document conflated them:

| | what it is | per |
| --- | --- | --- |
| space | the place — owns the message log and the backfill guard | the user, here |
| thread | one agent's session in that place | the agent |

`channel_threads` carries `agent_id` in its lookup key, which is what lets two
agents in one place run independently over one shared log.

So Agenta is shaped exactly like a Slack DM: **a `private` space per user, and a
thread per agent within it.**

**What happens:** the space is got-or-created on first contact — kind `private`,
`external_locator` `{"user": "<id>"}` — and the thread likewise, per agent. Neither
is configured in advance, and neither needs to be: `grants.md` permits them with one
rule, `(agent, ALLOW, kind=private)`, written once at config time and covering every
user without enumeration.

"New conversation" on an existing space is then just `!new` — append a thread row,
latest wins (D12). No new mechanism.

**An earlier draft had this step creating a space and called the permission
difference deliberate.** It was neither: nothing in the design says a conversation
creates a space, and it would have let anyone with `RUN_CHANNELS` create the row that
grants permission. The permission belongs on the grant, which is what `grants.md`
fixes for every channel rather than for this one.

### A5 — Say something

**What the user does:** types "hello" and hits enter.

**What happens:**

1. `POST /channels/agenta/events/` — a public route exactly like
   `/channels/slack/events/`, registered in `_PUBLIC_ENDPOINTS` the same four ways.
2. `_ingest` runs unchanged. `connection_locator` reads the bot from the request;
   `verify_signature` validates the **API key** on the request and returns the
   connection's key. A missing or wrong key, or one whose project does not own the
   connection, refuses identically to a bad signature — 401, no detail.
3. `parse_event` builds the inbound event. One `channel_inbox_events` row. 202.
4. The inbox worker resolves space, agent, policy, thread; mints a `turn_id`;
   invokes detached.
5. Turn events arrive; the outbox worker folds, renders, and calls the adapter's
   `post_message`, which for this channel writes where the read route can see it.
6. The UI polls and shows the answer.

**What this proves:** the entire path, with no credentials. That is C4's exit
condition.

### A6 — Answer a choice

**What the user does:** the agent asks something with two buttons; the user clicks
one.

**What happens:** the click posts a message whose content is the choice token — the
same route, the same inbox row, the same everything. `rendering.md` says a click and
a reply of "1" are the same event; this is where that stops being a claim.

---

## Part 2: Slack

**There are two setup flows, and they are genuinely different — not one flow with a
branch.** Every comparable product in the research offers one or both, and nobody
has invented a third:

| | hosted app (ours) | own app (theirs) |
| --- | --- | --- |
| who owns the Slack app | us | the customer |
| how the credential arrives | OAuth returns it | the user copies and pastes it |
| what the manifest is for | nothing — the app already exists | the description they build from |
| works self-hosted | no | yes |
| commands, modals, event subscriptions | no — they belong to the app | yes |
| backfill rate limit | 15 objects/min | 1,000 per call at 50+/min |

**Own app first**, because it is the only one that works self-hosted and the only
one that gets the useful rate limits. The hosted flow is the easier click and needs
infrastructure we do not have yet.

## §2.1 — Slack at config time

### S1 — Give them the app description

**Screen:** Settings → Channels → Add Slack → *Use your own Slack app*.

**What the user sees:** the manifest, and what to do with it. **We do not create a
Slack app for anyone** — the manifest is a description a human takes to Slack, and
building the app is their step, in their workspace, under their control.

`build_slack_manifest(request_url=<this deployment>/channels/slack/events/)` produces
it. Show it two ways, because both are just conveniences over the same document:

- **copy the YAML** and paste it into Slack's own *Create App → From a manifest* form
- **or follow a link** that pre-fills that form:
  `https://api.slack.com/apps?new_app=1&manifest_json=<url-encoded>`

The link saves typing. It is not a mechanism of ours and nothing depends on it.

**What must be true:** the request URL has to be reachable from Slack. On a local
deployment that means a tunnel, and the page must say so — otherwise the failure
arrives as no event ever showing up, which is the hardest kind to diagnose.

**Why this is the posture, not a fallback:** the app is issued by their workspace to
their deployment and its tokens never transit our infrastructure. That is
`architecture.md` §8's bring-your-own-app story, and it is why this flow is first.

### S2 — Install and copy two secrets

**What the user does, in Slack:** clicks *Install to Workspace*, approves the
scopes. Then copies two values from their new app's settings:

- **Bot User OAuth Token** (`xoxb-…`) — Settings → Install App
- **Signing Secret** — Settings → Basic Information

**What they do next, back in Agenta:** pastes both into two fields, which are the
fields the **credential schema** declares:

| field | type | secret | required |
| --- | --- | --- | --- |
| `bot_token` | text | yes | yes |
| `signing_secret` | text | yes | yes |

Two fields, not four. `team_id` and `bot_user_id` are **discovered, not asked for**
— `auth.test` returns both. Asking a human to find a team id when the API will tell
us is the kind of setup step people abandon.

### S3 — Verify, and only then store

**What happens when they click Save:**

1. Call Slack `auth.test` with the pasted bot token. It returns `team_id`,
   `user_id` (the bot user), and `url`.
2. **If it fails, nothing is written.** The error is shown as-is — an invalid token
   says so, and that is a legitimately useful message rather than a leak.
3. Compose `external_key` at `CONNECTION` grain from
   `{"api_app_id": …, "team_id": …}`.
4. Write **one secret row**: `kind=CHANNEL_SECRET`, `data={"bot_token": …,
   "signing_secret": …}`, encrypted by `PGPString`.
5. Write **one `channel_connections` row** referencing that secret by id, with
   `connection_locator = {"api_app_id": …, "team_id": …}`, and the discovered
   `bot_user_id` in `data`.
6. Status: verified.

**The order matters.** Verify, then store. A connection that exists but was never
proven is the thing that later reads as configured and silently never works.

**Where `api_app_id` comes from — settled.** `auth.test` does not return it, which
made this look like an open question. It is not:

- **own app** — the App ID is on the same *Basic Information* page the user is
  already on, copying the signing secret. It is a third field on a form they are
  already filling, not a new errand.
- **hosted app** — `oauth.v2.access` returns `app_id`, so nothing is asked at all.

Neither flow needs the first-inbound-event fill, and no connection is ever stored
with an incomplete key.

### S4 — Say where it may speak

**Screen:** the connection's page → Where it answers.

**What the user does:** answers three questions, not one list.

| | typical answer | written as |
| --- | --- | --- |
| Direct messages? | yes | `(agent, ALLOW, kind=private)` |
| Group chats? | usually no | — |
| Which channels? | a few, picked from a list | `(agent, ALLOW, space=#ops)` … |

**Why it is not one list.** DMs and group chats cannot be enumerated — a DM exists
because someone opened it, and there is one per user. Only topics are few, named and
pre-existing enough to pick from. `discover_spaces` still calls
`conversations.list` and still populates the channel picker; it just does not have
to enumerate the other two kinds, which it never could.

**Exclusions are expressible**, which the list could not do either: *any channel
except this one* is `(ALLOW, kind=topic)` plus `(DENY, space=#secrets)`, and deny
wins. `grants.md` has the evaluation.

**Default-deny is unchanged.** An unanswered question means no allow rule, which
means refused.

**Then, in Slack:** `/invite @Agenta` in each channel. Without it, calls fail with
`not_in_channel` — a real error every comparable product's docs mention, so the UI
should name it before it happens. Note this is genuinely separate from the grant: a
grant says *may*, the invite makes it *able*, and both are required.

### S5 — Change it, rotate it, take it down

Everything in A3 applies unchanged — rename, disable, archive — because none of it
is platform-specific. Slack adds four things that are.

**The manifest drifts.** The user enables a command later; the manifest changes and
their installed app does not. So we store the hash of the manifest last known
installed, compare it against the current one, and show the difference with the new
manifest to re-apply. Without that comparison, enabling a command in our UI produces
something that reports healthy and never fires — the exact defect shape this project
keeps finding.

**A credential is rotated.** The user regenerates the signing secret or reinstalls
for a new bot token. This is an update to the `CHANNEL_SECRET` row, re-verified by
`auth.test` before it replaces the old one — same rule as S3, and for the same
reason. The connection's `external_key` does not move, because `api_app_id` and
`team_id` did not.

**A credential is revoked from their side.** The token stops working with no warning
and nothing tells us. It surfaces as delivery failures, which is why
`ChannelDeliveryState` has `ABANDONED` — the operator needs to see that a reply was
never delivered rather than find a silently missing row. The connection's `status`
carries the last failure, and the UI has to show it; a channel that quietly stopped
working is worse than one that visibly broke.

**They remove the app in Slack.** Events simply stop. We cannot detect it except by
trying, so it looks the same as revocation and gets the same treatment. Deleting the
connection on our side does **not** uninstall their app — we never owned it — so
the removal page must say what it does and does not do, and tell them to remove the
app in Slack too if that is what they meant.

### S6 — The roster

Identical to A2. Same routes, same rows, nothing Slack-specific — which is the point
of doing Agenta first, because this part is already proven by then.

The grants are S4, and they are the same rows too: what differs is only which kinds
an operator says yes to. Agenta answers DMs and nothing else; Slack typically
answers named channels and DMs. One mechanism, two configurations.

## §2.2 — Slack at runtime

### S7 — Say something

`@Agenta ~triage what broke?` in an invited channel.

**What happens:** Slack POSTs to `/channels/slack/events/`. `_ingest` runs — the
same one Agenta ran, with the same steps — except `connection_locator` reads
`team_id` from the body and `verify_signature` checks the HMAC using the signing
secret fetched from the secret row.

Everything after that is identical to A4 steps 3–6.

**What this proves, and it is the real reason to build them in this order:** if
anything between the inbox row and the posted answer needs to know which channel it
came from, the port is wrong. Two journeys through one path is the test.

---

## What the two journeys jointly settle

| question | answered by |
| --- | --- |
| Where do credentials live? | a `CHANNEL_SECRET` row in `secrets`, referenced by the connection |
| What is the credential schema? | the nested `data.kind`, which the store already validates |
| What is asked vs discovered? | ask for what only a human can copy; discover the rest |
| Where does `api_app_id` come from? | the page they are already on; or `oauth.v2.access` |
| When is a connection routable? | after `auth.test`, never before |
| Does the port hold? | §1.2 and §2.2 are the same code reached two ways |
| How is a choice answered? | A6, on our own surface, before Slack's payload shape |
| What happens on teardown? | archive the channels rows, leave the sessions |
| Where may an agent answer? | a grant by kind or by id, deny-first — not a pre-created row |
| What is a conversation? | a thread; the space is the place, per user here |
| Do we own their app? | never — and the removal page has to say so |

**What the grid exposed** that neither journey alone would have: writing Agenta's
runtime beside Slack's made it obvious that permission cannot come from a
pre-created space row, because Agenta's spaces are per user and Slack's DMs are too.
That is `F51`, it is live in the tree, and `grants.md` is the fix — one rule per
kind, no enumeration, for both channels.

## What is still open after this

- **The Agenta-owned app model.** Everything above is customer-owned. The shared-app
  variant needs an OAuth callback, an app we operate, and a decision about the
  15-per-minute backfill cap. It is also what `architecture.md` §8.1 currently says
  we do not have.
- **Where the setup pages live in web.** The bot chat is behind a feature flag;
  provisioning is real UI and needs a real home.
- **The setup-shape declaration.** Established above as a fifth thing a channel
  declares, but not designed: a manifest, a downloadable package, a checklist, or a
  call we make. Telegram and Discord are what force it, and neither is designed here.
- **Telegram as the third column**, which is the cheapest proof that the config
  column generalises — and the one that tests `setWebhook` being ours to call.
