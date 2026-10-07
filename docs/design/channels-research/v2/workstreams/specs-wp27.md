# WP27 — Slack setup, the hosted app

One Slack app we own, installed into many workspaces in one click. The other column
of `provisioning.md` §0.

Design: `hosted-app.md` — the whole flow, and `D32`–`D36`.

## Why this is not "the same flow with OAuth in front"

Three things differ underneath, and each one is code rather than copy.

**The signing secret is per app, not per connection** (`D35`). `oauth.v2.access`
returns a bot token and no signing secret, because the signing secret belongs to the
app and the app is ours — one value verifies every event from every workspace that
installed it. So the two models store different credential bodies for one channel,
and signature verification must source its secret from the connection's vault row or
from the deployment's configuration depending on which model the connection is.

That is a branch on the ingress path, which is the one place this design otherwise
refuses to branch. It is unavoidable, and what can be contained is *where* it sits:
the adapter resolves the verification secret, and core never learns that app models
exist.

**A hosted connection with no `signing_secret` is complete.** Code that reads a
missing field as *not set up yet* refuses every hosted connection, silently. Say it
in the code once, where the resolution happens.

**An install is an upsert** (`D34`). A reinstall — after a revocation, after a scope
was added, after two clicks — arrives as a new code for an installation we already
have. An insert gives the operator two connections: the first keeps every grant,
space and thread and stops receiving events; the second receives them and has no
grants, so it answers nothing. Neither half reports anything. Compose the key, look
it up, replace the secret body, keep the row.

**The exchange is the first of its kind in this repo.** The nearest precedent
misleads: the gateway's OAuth flow delegates the handshake to a managed provider,
and its callback only decodes the state and activates a connection somebody else
completed. Nothing here has ever exchanged a code for a token. Plan it as new code.

## What it reuses rather than invents

`make_oauth_state` and `decode_oauth_state` already sign a payload carrying project,
user, nonce and timestamp, and reject a bad signature or an expired age. This flow
uses them with a shorter age (`D33`). The state — not the session — decides which
project an installation joins, because the callback can legitimately arrive in a
different browser from the one that started it.

Replay protection comes from the authorization code being single-use at Slack's end,
not from us. That is adequate, and it is stated rather than assumed so that a later
channel with replayable codes gets a consumed-state record instead of inheriting a
gap.

## Where our own credentials live

Client id, client secret and the app's signing secret are one deployment's, not one
project's. They go in `utils/env.py` and are read through the shared `env` object
(`D32`). Not the vault — a vault row is project-scoped, and would be a project-owned
copy of a deployment-owned credential.

**A deployment that sets none of them does not offer the flow.** The button is
absent and the routes refuse. Absent and declared, not present and broken — a
self-hosted deployment declining the hosted app is the normal case, not an error
path.

## The capability difference, refused at configuration time

Commands, modals and event subscriptions belong to the app, and our app has one
manifest, so a hosted connection cannot carry per-customer commands.
`capabilities-v2.md` §3 already moved the declaration per connection and named this
as one of its three reasons. This package is that reason becoming real.

Two inputs narrow one channel declaration: the app model, and the scopes the
workspace actually granted — a workspace can decline one, and the exchange returns
what it granted.

**There is no command toggle to hide, and that is the point.** Slack declares
`commands: {native: true, …}` and a command list, and nothing yet lets an operator
enable one — native slash commands are still parsed as noise and dropped (`F52`). So
this package's obligation is to the **declaration**, not to a control: a hosted
connection must declare `native: false`, so that whatever surface eventually reads
the declaration cannot offer a command that can never fire.

Doing it now costs one narrowing and prevents the shape this project keeps finding.
Doing it when the toggle arrives means the toggle ships first and the narrowing
arrives after somebody reports it.

## The manifest machinery does not apply

`provisioning.md` §2 generates a manifest from the configuration and compares a
stored hash to show drift. That is entirely customer-owned. Ours is one manifest we
maintain, its scope set is the union of what any customer might need, and changing
it means every workspace re-approves — a release event, not a configuration change.

**The drift indicator must not render on a hosted connection.** There is nothing to
re-apply, and telling an operator there is sends them looking for an app they do not
own.

## Uninstall, in both directions

`app_uninstalled` and `tokens_revoked` set `flags.is_active = false` (`D36`).
Deactivate, never delete — the grants, spaces and threads are the operator's work,
and a reinstall should restore service. The routing refusal for an inactive
connection already exists, so this adds no new refusal path.

Removing the connection in Agenta revokes the installation on Slack's side too,
because we own the app. That is the opposite of the customer-owned removal page,
which has to say we cannot. The third slot of the provisioning contract, filled for
deprovisioning where the other model leaves it empty.

## Tests

**Unit** — the verification secret resolves from the vault for a customer-owned
connection and from configuration for a hosted one. Both directions. A branch taken
one way only is a branch nobody tested.

**Unit** — a hosted connection with no `signing_secret` verifies a signature and is
never treated as unconfigured.

**Unit** — a second install for an existing identity updates the row and keeps its
id. Assert the id, not the count; a test that counts rows passes when the upsert
writes the wrong one.

**Unit** — a callback with an unknown, expired or tampered state is refused before
any exchange is attempted. Assert that the exchange was never called, not merely
that the response was an error.

**Unit** — the install route refuses when the deployment sets no client credentials.
Refuses, with a reason. Not a 500.

**Integration** — `app_uninstalled` deactivates the connection and leaves its grants,
spaces and threads in place.

**Acceptance** — CU-C, with a real workspace. `wave6.md` budgets for it, and it is
also where `F53` gets settled: capture the `authorizations` block of an ordinary
event and of an org-wide install, and assert against both.

## Done when

- One click from the Channels settings tab ends in a verified, routable connection.
- Installing twice leaves one connection with its configuration intact.
- Uninstalling in Slack deactivates it; removing it in Agenta revokes it in Slack.
- A deployment with no hosted credentials never shows the button.
- A hosted connection declares no native commands and shows no drift indicator, each
  for a stated reason.

## Watch for

- **Never log the client secret, a code, or a token**, including in an error path.
  The inbox and outbox store a `processed` payload per event, and a platform that
  echoes a credential would put it in our log. Redact on the way in.
- **`api_app_id` is constant across every hosted connection.** The identity's
  discriminator is doing all the work, so a bug that drops it does not merge two
  workspaces noisily — it merges them silently, into whichever row `LIMIT 1`
  returned. That was `F46`'s failure mode and it returns here with a wider blast
  radius.
- **Enterprise Grid stops being exotic.** Every customer is on one `api_app_id`, so
  an org-wide install and per-workspace installs coexisting is the normal state of
  the world rather than an edge case. `F53` is unproven until CU-C observes one.
