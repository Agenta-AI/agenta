# The hosted app

The Agenta-owned Slack app, installed into many workspaces through OAuth. Designed
during wave 5 for wave 6, because `waves.md` schedules it there and says why:
without it WP-S2 starts blocked.

`provisioning.md` §0 established that both app models exist and that the difference
is structural. `journeys.md` §2.1 designed the customer-owned flow end to end. This
document is the other column, and it turns out to differ in more than the click.

## What is actually different

| | customer-owned | hosted |
| --- | --- | --- |
| who owns the Slack app | them | us |
| the manifest | a document they build from | ours, static, invisible to them |
| how the bot token arrives | pasted | `oauth.v2.access` returns it |
| **the signing secret** | **theirs, per connection** | **ours, one for every connection** |
| `api_app_id` | a third field on the form | `app_id` from the exchange |
| uninstall | we cannot see it, and cannot do it | we get an event, and we can do it |
| commands, modals, event subscriptions | yes | no |
| self-hosted | the only option | not offered |

The signing-secret row is the one that changes code rather than copy, and it was not
visible from §0.

### The signing secret is per app, not per connection

`oauth.v2.access` returns a bot token. It does not return a signing secret, and
there is nothing for it to return: the signing secret belongs to the **app**, and in
this model the app is ours. One value verifies every event from every workspace that
installed it.

So the two models store different credential bodies for the same channel:

| model | the `CHANNEL_SECRET` body |
| --- | --- |
| customer-owned | `bot_token`, `signing_secret` |
| hosted | `bot_token` only |

And signature verification must source its secret from two places — the connection's
secret row for a customer-owned connection, the deployment's configuration for a
hosted one. That is a branch on the ingress path, which is the one place this design
otherwise refuses to branch. It is unavoidable: the secret genuinely lives somewhere
else. What can be contained is *where* the branch sits — the adapter resolves the
verification secret, core does not learn that app models exist.

**The absence must not read as a misconfiguration.** A hosted connection with no
`signing_secret` is complete. Code that treats a missing field as "not set up yet"
will refuse every managed connection, silently, which is this project's most common
defect shape wearing a new hat.

## Where our own credentials live

The client id, the client secret and the signing secret are one deployment's, not
one project's. They do not go in the vault: the vault is project-scoped, and a row
in it would be a project-owned copy of a credential that belongs to the deployment.

They are deployment configuration, read through the shared `env` object like every
other API setting.

This is what `architecture.md` §8.1 already requires of this model — *"the secret
held only where tokens are minted, per-installation tokens stored and rotated
separately, and the ability to revoke one installation without touching the
others."* The split falls out: our credentials in configuration, every workspace's
token in its own vault row.

**A deployment that sets none of them does not offer the hosted flow.** The option is
absent from the UI and the routes refuse. Absent and declared, not present and
broken — the same discipline as an empty setup slot in `journeys.md` §0.

## The flow

### 1. Start

An operator on *Settings → Channels → Add Slack → Use the Agenta app* clicks once.
We mint an install record, then redirect to Slack's authorize URL with our client id,
our scope set, the redirect URL, and the state token.

### 2. State reuses the signing helper that already exists

`core/gateway/connections/utils.py` already carries `make_oauth_state` and
`decode_oauth_state`: an HMAC-signed, base64url token holding `project_id`,
`user_id`, a nonce and a timestamp, rejected on a bad signature or an expired age.
That is exactly the payload this flow needs, so this flow uses it rather than
inventing a second state mechanism. Shorten the age for an install; an hour is
generous for a redirect that takes seconds.

**The state, not the session, says which project this installation joins.** The
callback can legitimately arrive in a different browser from the one that started
the install — an admin sends the link to whoever can approve the scopes in that
workspace. So the signed state is the whole of the authorisation on this route.
Without it, anyone who can reach the callback can attach a workspace they control to
a project they do not.

**Single use comes from Slack, not from us**, and this is worth stating because a
signed token is replayable within its lifetime by construction. An authorization
code is single-use at Slack's end, so a replayed callback fails at the exchange
rather than producing a second install. That is adequate, and it is adequate for a
reason rather than by luck — if a later channel's codes are replayable, that channel
needs a consumed-state record and this one does not.

### 3. Callback

Slack returns `code` and `state`, or `error=access_denied` when the user declines.
A decline is a normal outcome and ends with a page saying so, not an error.

### 4. Exchange

**This is the first authorization-code exchange in this repo**, and the nearest
precedent misleads: the gateway's OAuth flow delegates the handshake to a managed
provider, and its callback only decodes the state and activates a connection
somebody else completed. Nothing here has ever exchanged a code for a token. Plan
the exchange, its error handling and its secret handling as new code, not as another
callback route.

`oauth.v2.access` with the code and our client credentials. What we read from the
response:

| field | what it is for |
| --- | --- |
| `app_id` | the `api_app_id` half of the identity |
| `access_token` | the bot token, stored |
| `bot_user_id` | loop hygiene, stored on the connection |
| `team.id` | the identity discriminator, when not an org install |
| `enterprise.id` | the identity discriminator, when it is |
| `is_enterprise_install` | which of the two above applies |
| `scope` | what the workspace actually granted |

### 5. Verify, then store

`auth.test` with the new token, exactly as `journeys.md` §2.1 S3 specifies. The
exchange already proves the token works, so this is not strictly necessary — and it
is still done, because **verified must mean one thing**. Two ways of becoming
verified is how a flag ends up set by one path and checked by another.

### 6. Compose the identity

The same function, the same declaration, no new code: `api_app_id` from `app_id`,
and the discriminator is `enterprise.id` when `is_enterprise_install` is true and
`team.id` otherwise. `channel-connections.md` settled this; the hosted flow is the
first caller that gets both fields handed to it rather than reconstructed.

### 7. Upsert, never insert

**This is the step that is easy to get wrong and silent when wrong.** A reinstall —
after a token revocation, after adding a scope, after someone clicks the button
twice — arrives as a new code for an installation we already have.

If it inserts, the operator gets a second connection. The first keeps every grant,
every space and every thread, and stops receiving events. The second receives them
and has no grants, so it answers nothing. Nothing reports either half.

So: compose the key, look it up, and if it exists replace the secret body and keep
the row — its id, its grants, its spaces, its threads. Re-verify. The connection's
identity did not move, because `api_app_id` and the discriminator did not.

### 8. Record the granted scopes

A workspace can decline a scope at install. The granted `scope` string is therefore
a per-connection fact about what this installation can do, and it is one of the two
inputs to the per-connection capability declaration below.

## The capability difference, declared rather than discovered

Commands, modals and event subscriptions belong to the app, and our app has one
manifest. A shared app cannot carry per-customer commands — every installation would
share one command set. So a hosted connection **cannot** offer them.

`capabilities-v2.md` §3 already moves the declaration from per-channel to
per-connection, and names this as one of the three reasons. This design is the
reason becoming real. Two inputs narrow one channel declaration:

- the app model — a hosted connection declares no commands, no modals
- the granted scopes — a declined scope removes what it entitled

**Refused at configuration time — and today there is nothing to refuse, which is
exactly when to do it.** Slack declares `commands.native: true` and a command list,
and no surface yet lets an operator enable one; native slash commands are still
parsed as noise and dropped (`F52`). So the obligation is to the declaration rather
than to a control: a hosted connection declares no native commands, so whatever
surface eventually reads the declaration cannot offer a command that can never fire.

Narrowing it now costs one line. Narrowing it when the toggle arrives means the
toggle ships first and the narrowing follows a bug report — present-and-inert, which
is the defect this whole project keeps finding. Here it is predictable in advance, so
it does not get to happen once first.

## Our manifest is static, and the drift machinery does not apply

`provisioning.md` §2 generates the manifest from the configuration and compares a
stored hash against the current one. That is entirely a customer-owned concern.

Ours is one manifest we maintain. Its scope set is the union of what any customer
might need, which is a real cost — a workspace approves more than it uses — and it
is the price of the one-click install. Changing it means every workspace re-approves,
so a scope addition is a release event, not a configuration change.

The drift indicator must therefore not render on a hosted connection. There is
nothing for the operator to re-apply, and telling them there is would send them
looking for an app they do not own.

## Uninstall, in both directions

The customer-owned removal page has to say that we cannot uninstall their app. The
hosted one is the opposite in both directions, and the copy has to differ:

**They remove the app in Slack.** We receive `app_uninstalled`, and `tokens_revoked`
when only the token goes. Either sets `flags.is_active = false` on the connection.
**Deactivate, never delete** — the grants, spaces and threads are the operator's
work, and a reinstall should restore service rather than ask them to redo it. The
routing refusal for an inactive connection already exists, so this adds no new
refusal path.

**They remove the connection in Agenta.** We own the app, so we can and should
revoke the installation on Slack's side as well. Leaving a live token behind after
an operator asked us to remove the connection is a credential nobody is watching.

This is the third slot of the provisioning contract — *calls we make* — filled for
deprovisioning where the customer-owned flow leaves it empty. Which is the contract
working: same three slots, different fillings, no branch in core.

## Enterprise Grid is not exotic here

`channel-connections.md` established that an org-wide install and per-workspace
installs of one app coexist. With a customer-owned app that is a rare configuration.
With a shared app, **every customer is on the same `api_app_id`**, so the
coexistence is the normal state of the world rather than an edge case.

The identity handles it, because the discriminator is chosen per install. What is
not proven is the event side: `F53` records that the `authorizations` shape was
reconstructed from documentation and never observed, and its failure mode is a bare
401 indistinguishable from a bad secret. This is the wave that must capture one real
payload of each install kind. The hosted flow makes that both easier and more urgent.

## Failure modes

| what happens | what the operator sees |
| --- | --- |
| the user declines the scopes | a page saying the install was cancelled |
| the state is unknown, expired or reused | refused, with no exchange attempted |
| `oauth.v2.access` returns an error | Slack's error, shown as-is |
| `auth.test` fails after a successful exchange | nothing is stored; the error is shown |
| the deployment has no client credentials | the option is not offered at all |
| the workspace declined a scope | the connection works, narrowed, and says which |

## What this does not add

- **No OAuth-per-user.** The credential is the installation's, not the caller's.
  Identity linking is separate and already exists. Unchanged from `provisioning.md`.
- **No hosted credential plane.** Tokens still live in our vault. Unchanged.
- **Not available self-hosted**, by construction rather than by policy.

## One statement elsewhere that this contradicts

`journeys.md` §0 closes the provisioning contract with:

> **We never own or create the customer's app.** They build it, click it into
> existence, or ask BotFather for it.

That was written before §0 of `provisioning.md` admitted the second app model, and
it is now false for one of the two. It holds for customer-owned Slack, Telegram and
Discord, and it is exactly wrong for the hosted app — we own it, and the customer
never sees a manifest at all. The sentence needs its scope, and the reconciliation
belongs to wave 6's CU-A.

## Decisions

Recorded in `decisions.md` as **D32**–**D36**.

- **D32.** The hosted app's own credentials are deployment configuration, not vault
  rows. A deployment that does not set them does not offer the flow.
- **D33.** Install state is the existing HMAC-signed state token, not a second
  mechanism, and it — not the session — decides which project the installation
  joins. Replay is stopped by the authorization code being single-use at Slack's
  end, which is stated rather than assumed.
- **D34.** An install is an upsert on the composed connection identity. A reinstall
  keeps the row, its grants, its spaces and its threads.
- **D35.** The signing secret is per app, not per connection. A hosted connection
  stores a bot token and nothing else, and the missing field is completeness rather
  than misconfiguration.
- **D36.** Uninstall deactivates the connection and never deletes it. Removal from
  our side revokes the installation on Slack's side, because we own the app.
