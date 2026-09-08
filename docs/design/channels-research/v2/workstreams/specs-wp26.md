# WP26 — Slack setup, customer-owned

The first real platform credential. An operator takes a manifest to Slack, builds an
app in their own workspace, installs it, and pastes what it gives back.

Design: `journeys.md` §2.1 S1–S3, `provisioning.md` §1–§4.

## What already exists, and it is most of it

Checked, not assumed. This package is smaller than it looks:

- `build_slack_manifest(request_url=…)` produces the manifest — correct scopes, the
  five bot events, `socket_mode_enabled: false` — and it has a caller now:
  `SlackAdapter.build_setup_document`.
- The three-slot contract is a real type. `ChannelSetup` carries `instructions`, an
  optional `document`, and `fields`, and Slack declares all three: four
  instructions, and three fields — `bot_token`, `signing_secret`, `api_app_id`.
- `SlackAdapter.verify_connection` calls `auth.test` and returns what it discovered:
  `team_id`, `bot_user_id`, `api_app_id`.
- `create_connection` already verifies before it writes, sets `is_verified` only
  after the verification returns, composes `external_key` at `CONNECTION` grain,
  writes the credential to the vault, and never lets the raw credential reach the
  connection row.

So the domain is built. **What is missing is a way to reach it**, in the order a
human does the work.

## The defect this package exists to fix

`build_setup_document` is reachable only through
`GET /channels/connections/{connection_id}/setup`, which 404s without a connection.
But the manifest is what an operator needs **before** they have anything to connect:
they take it to Slack, build the app, install it, and only then hold the values a
connection is created from.

The one document the flow depends on sits behind the step it precedes (`F62`).

**A per-channel setup route beside the per-connection one.** The document needs only
a channel name and a request URL, and both are available with no row in hand. The
per-connection route keeps its own job — it is what shows drift for a connection
that exists, and `D37` gives it a second job for the bridge — so this is an
addition, never a replacement.

This is the project's recurring shape wearing a disguise worth naming: the capability
has a caller, so a caller check passes. What fails is whether the caller can be
reached in the order the journey happens.

## The screens

**Settings → Channels → Add Slack → Use your own Slack app.** The Channels settings
tab already exists and is not behind a flag, so this is a section on a permanent
surface rather than a new home. That settles the *"where do the setup pages live"*
question `waves.md` left open.

### Step one — the manifest

Show it two ways, both conveniences over one document: copy the YAML, or follow a
link that pre-fills Slack's *Create App → From a manifest* form. The link saves
typing; nothing depends on it.

**The request URL has to be reachable from Slack.** On a local deployment that means
a tunnel, and the page must say so. Otherwise the failure arrives as no event ever
appearing, which is the hardest kind to diagnose and the most expensive to guess at.

### Step two — the paste form

Rendered **from the declaration**, not hand-written. `setup.fields` gives the name,
the label, whether it is a password box and whether it is required, and a form built
from anything else is a second declaration that will drift from the first.

Three fields, and no more. `team_id` and `bot_user_id` are discovered by `auth.test`
— asking a human to find a team id when the API will tell us is the kind of setup
step people abandon.

### Step three — save

`POST /channels/connections/` with the pasted values as `credentials`. The service
verifies, then stores. **If `auth.test` fails, nothing is written**, and Slack's own
error is shown as-is: an invalid token says so, and that is a useful message rather
than a leak.

## What this package does not touch

**`SlackAdapter` itself.** `verify_connection` and `build_setup_document` are
already right. WP27 adds the two-source verification secret; this package adds no
adapter code at all. Worth stating because the file looks shared and is not.

**The hosted app.** The second button on this page is WP27's, and it branches from
this one.

**Grants.** An operator who finishes this package's flow has a verified connection
that may answer nowhere. WP28 is where it becomes useful, and the two land in the
same wave for exactly that reason.

## Tests

**Unit** — the per-channel setup route returns a document for a channel that
declares one and an empty document for a channel that does not, with no connection
in existence. That is the whole finding, asserted.

**Unit** — the form renders from `setup.fields`: three inputs, two of them password
boxes, all required. A test that hardcodes the three names proves nothing; drive it
from a declaration fixture.

**Integration** — a failing `auth.test` writes no connection row and no secret row.
The "verify, then store" rule is the one that decides whether a misconfiguration is
visible at setup or as a dead thread later, so it is worth a test that reads both
tables afterwards.

**Acceptance** — deferred to CU-C by necessity. Nobody can assert a real Slack app
in a suite; the deployment is where this flow is proven, and `wave6.md` budgets for
it.

## Done when

- An operator with no connection can reach the manifest, copy it, and follow the
  pre-filled link.
- Pasting the three values creates a verified connection, with the credential in the
  vault and never on the connection row.
- A wrong token leaves no row behind and shows Slack's reason.
- The page says what the request URL must be and that a local deployment needs a
  tunnel.

## Watch for

- **The form must come from the declaration.** Hand-writing three inputs is faster
  and is how the declaration becomes decorative. `capabilities-v2.md` §1 already
  narrowed the declaration's job to exactly this; if nothing renders from it, it has
  no job left.
- **`verify_connection` defaults to trivial success** on the interface, and only
  Slack overrides it. That is deliberate — a channel with nothing to verify verifies
  by declaring nothing — but it means `is_verified` is a weaker statement for every
  other channel than it is here. Do not build anything that reads the flag as proof
  of a live credential.
- **Do not add `api_app_id` to the stored credential body.** It is a locator field,
  not a secret, and it already reaches `connection_locator`. The secret DTO ignores
  unknown keys silently, so a field routed to the wrong place disappears without an
  error.
