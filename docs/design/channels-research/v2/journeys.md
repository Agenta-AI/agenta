# Two journeys, step by step

Agenta and Slack, written together, because designing either alone puts it in the
air. Every step names the screen, the call, the row written and the credential
moved. Where something does not exist yet, it says so.

Sources: the secrets domain in this codebase, Slack's own manifest and OAuth
documentation, and the setup flows of five comparable products in `v1/raw/`.

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
channel's declared schema, it is written by the setup flow rather than by a user,
and it is meaningless outside the connection that references it. Reusing
`CUSTOM_SECRET` would put machine-managed rows in the same bucket a user browses
and edits, where the two are indistinguishable and either can be deleted by hand.

The precedent is exact: `WEBHOOK_PROVIDER` is a domain-owned kind used by the
webhooks service for the same reason. Channels is the second instance of an existing
pattern.

**What a kind costs:** one enum member, one typed DTO branch in the secrets DTO
discriminator, and one line in a migration —
`ALTER TYPE secretkind_enum ADD VALUE IF NOT EXISTS 'CHANNEL_SECRET'`. Note that
Postgres cannot drop an enum value, so the downgrade leaves the label behind, as the
existing migration records for its own addition.

**A correct Slack manifest builder with no callers.** `build_slack_manifest(request_url)`
produces scopes matching exactly what the adapter calls, the five bot events, and
`socket_mode_enabled: false`. It is right, and nothing invokes it.

**What does not exist:** any route that writes a connection, any provisioning UI,
any OAuth handling, any verification call, and the Agenta adapter.

---

## Part 1: the Agenta journey

First, because it needs no external account and it is what makes the Slack journey
testable before a workspace exists.

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

### A3 — Open a conversation

**Screen:** the bot's chat, behind the feature flag.

**What the user does:** clicks "New conversation".

**What happens:** a `channel_spaces` row of kind `private`, whose
`external_locator` is `{"conversation": "<uuid>"}` — we are the platform, so we mint
it. Then a grant so the agent may answer there.

**The open question this settles by doing:** every other channel discovers spaces
from the platform and the operator picks from a list. Here, opening a conversation
creates the space. That is the one structural difference, and it is contained in
`discover_spaces` returning what the project already has.

### A4 — Say something

**What the user does:** types "hello" and hits enter.

**What happens:**

1. `POST /channels/agenta/events/` — a literal route beside
   `/channels/slack/events/`, and **not** in `_PUBLIC_ENDPOINTS`, so ordinary auth
   applies.
2. `_ingest` runs unchanged. `connection_locator` reads the bot from the request;
   `verify_signature` checks the session's project owns that connection and returns
   its key. No session, or the wrong project, refuses exactly as a bad signature
   does.
3. `parse_event` builds the inbound event. One `channel_inbox_events` row. 202.
4. The inbox worker resolves space, agent, policy, thread; mints a `turn_id`;
   invokes detached.
5. Turn events arrive; the outbox worker folds, renders, and calls the adapter's
   `post_message`, which for this channel writes where the read route can see it.
6. The UI polls and shows the answer.

**What this proves:** the entire path, with no credentials. That is C4's exit
condition.

### A5 — Answer a choice

**What the user does:** the agent asks something with two buttons; the user clicks
one.

**What happens:** the click posts a message whose content is the choice token — the
same route, the same inbox row, the same everything. `rendering.md` says a click and
a reply of "1" are the same event; this is where that stops being a claim.

---

## Part 2: the Slack journey

Two models. **Customer-owned app first**, because it is the only one that works
self-hosted, it needs no infrastructure from us, and it gets the better rate limits
(1,000 objects per call at 50+/min, against 15 per minute for a shared distributed
app that is not Marketplace-approved).

### S1 — Start setup

**Screen:** Settings → Channels → Add Slack.

**What the user sees:** an explanation that they will create a Slack app in their
own workspace, and a button.

**What happens when they click:** we build the manifest with
`build_slack_manifest(request_url=<this deployment>/channels/slack/events/)` and
send them to:

```text
https://api.slack.com/apps?new_app=1&manifest_json=<url-encoded manifest>
```

That URL drops them into Slack's app-creation flow with every scope, every event
subscription and our request URL already filled in. They review and click Create.

**Why this and not OAuth:** OAuth needs an app *we* own and a public redirect. This
needs neither, works for a self-hoster on a private network, and is the posture
`architecture.md` §8 calls the genuinely strong story.

**What must be true:** the request URL has to be reachable from Slack. For a local
deployment it is a tunnel, and the page must say so rather than letting someone
discover it when no event ever arrives.

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

**Where `api_app_id` comes from:** `auth.test` does not return it. It is on every
inbound event, and it is in the app's own settings page. Either we ask for it as a
third field, or the first inbound event fills it in. **Asking is worse but simpler;
the first-event fill is right but leaves a window where the key is incomplete.** This
is the one genuinely open question in the Slack journey and it needs deciding before
the package is written.

### S4 — Pick where it may speak

**Screen:** the connection's page → Spaces.

**What the user does:** picks channels from a list.

**What happens:** `discover_spaces` calls `conversations.list`, and the user picks.
Each pick writes a `channel_spaces` row. Default-deny means an unlisted channel is
one the agent will not answer in, even after being invited there.

**Then, in Slack:** `/invite @Agenta` in each of those channels. Without it, calls
fail with `not_in_channel` — a real error every comparable product's docs mention,
so the UI should name it before it happens.

### S5 — Roster and grants

Identical to A2. Same routes, same rows. Nothing Slack-specific — which is the point
of doing Agenta first, because this part is already proven by then.

### S6 — Say something

`@Agenta ~triage what broke?` in an invited channel.

**What happens:** Slack POSTs to `/channels/slack/events/`. `_ingest` runs — the
same one Agenta ran, with the same steps — except `connection_locator` reads
`team_id` from the body and `verify_signature` checks the HMAC using the signing
secret fetched from the secret row.

Everything after that is identical to A4 steps 3–6.

**What this proves, and it is the real reason to build them in this order:** if
anything between the inbox row and the posted answer needs to know which channel it
came from, the port is wrong. Two journeys through one path is the test.

### S7 — When it drifts

The user enables a command later. The manifest changes; their installed app does
not.

**What happens:** we store the hash of the manifest last known installed, compare
it to the current one, and show the difference with a link to re-apply. Without
this, enabling a command in our UI produces something that reports healthy and
never fires — which is the exact defect shape this project keeps finding.

---

## What the two journeys jointly settle

| question | answered by |
| --- | --- |
| Where do credentials live? | a `CHANNEL_SECRET` row in `secrets`, referenced by the connection |
| What does the credential schema hold? | two fields for Slack, zero for Agenta |
| What is asked vs discovered? | ask for what only a human can copy; discover the rest |
| When is a connection routable? | after `auth.test`, never before |
| Does the port hold? | S6 and A4 are the same code |
| How is a choice answered? | A5, on our own surface, before Slack's payload shape |

## What is still open after this

- **`api_app_id` at S3** — asked for, or filled by the first event. Needs deciding.
- **The Agenta-owned app model.** Everything above is customer-owned. The shared-app
  variant needs an OAuth callback, an app we operate, and a decision about the
  15-per-minute backfill cap. It is also what `architecture.md` §8.1 currently says
  we do not have.
- **Where the setup pages live in web.** The bot chat is behind a feature flag;
  provisioning is real UI and needs a real home.
- **Telegram**, which is one field and a `getMe`, and is the cheapest proof the
  credential schema generalises beyond Slack.
