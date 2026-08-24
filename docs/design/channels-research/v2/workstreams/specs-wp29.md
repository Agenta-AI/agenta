# WP29 — The bridge, re-verified

Two unrelated halves under one name. Keep them apart: half one is a real gap in
the bridge's configuration surface, half two is proof that things believed fixed
are actually fixed, against the identity model this wave shipped them on.

Design: `contract.md` §4, `journeys.md` "The provisioning contract: three slots,
any of them empty", `decisions.md` **D37**, `review-findings.md` **F60**.

## Half one — the document slot

`F60` read as a gap: every other channel declares `setup.fields`, the bridge
declares none, so nothing looks collectible. **`D37` says the premise was
wrong.** `setup.fields` is empty because there is nothing only the operator can
give us — there is no platform issuing a bridge credential, only we can mint
one. Empty is correct, the same discipline `capabilities.md` already uses for
`backfill.supported: false`: a declaration, not an omission.

What is actually missing is the **document** slot, not the fields slot. The
document is what we hand the operator to apply to their own bridge process: our
inbound URL and a signing secret we generate for this one connection. Checked
against the code — `BridgeAdapter` inherits
`ChannelAdapterInterface.build_setup_document`'s default (`None`) and never
overrides it. `SlackAdapter.build_setup_document` (`adapters/slack/adapter.py:96`)
is the model to follow: it takes only `request_url` and returns a
`ChannelSetupDoc`. The bridge's document cannot copy that shape verbatim,
because Slack's manifest needs no connection-specific secret and the bridge's
does — that difference is the actual work of this half.

### The secret is minted here, and shown exactly once

Checked, not assumed: `_bridge_secret` (`adapters/bridge/adapter.py:44`) reads
`connection.data.get("signing_secret")`. That `data` dict is never the raw row —
`ChannelsService._hydrate_connection` (`core/channels/service.py:187`) resolves
`data["credential_secret_id"]` against the vault on every `fetch_connection`
call and merges the decrypted `ChannelSecretDTO.channel` fields on top. So the
adapter itself touches neither the vault nor the row directly; it reads
whatever the service most recently hydrated onto `data`. **Nothing today writes
that secret.** No code path generates one, and `ChannelSecretSettingsDTO`
(`core/secrets/dtos.py:82`) only declares `bot_token` and `signing_secret` — no
`delivery_url` field at all. The acceptance fixture that exercises two bridges
(`bridge_process/conftest.py::make_connection`) inserts a `ChannelConnectionDBE`
row directly with a hand-picked secret and skips `create_connection` and the
vault entirely, which is exactly why this gap has never been caught by a green
run: the one place that would have caught it is bypassed by construction.

D37's two consequences, restated as what must be true of the finished code:

- **Shown once, never again.** "Reads never return a secret" is the rule —
  not "the first read is free." The GET route,
  `/connections/{connection_id}/setup` → `ChannelsService.get_connection_setup`
  (`core/channels/service.py:357`), must never be the place the plaintext
  appears, on the first call or the hundredth. The only body that may ever
  carry the plaintext is the response to the **create** call itself,
  `POST /connections/` → `create_channel_connection`
  (`apis/fastapi/channels/router.py:440`), because that is the one moment the
  value exists as a plain Python string before anything encrypts or discards
  it. Lost means rotate, exactly like an API key — there is no recovery
  endpoint to build.
- **Per connection, not per channel.** Slack's document is one manifest,
  identical for every installation, needed before any connection row exists
  (`F62`, WP26's route). The bridge's document is the opposite: it cannot be
  built until the row exists, because the secret it carries is generated for
  that row. Both are real setup routes; which one a channel uses follows from
  what the document depends on, not from a rule that picks one route for
  everyone.

### The shape this forces

`create_connection` (`core/channels/service.py:96`) does not currently mint
anything — it verifies caller-supplied credentials and stores them. For the
bridge it must instead generate the secret itself when none was supplied,
write it to the vault under the new `ChannelSecretKind.BRIDGE` (already added —
checked in `core/secrets/enums.py:16` — and currently unused by any writer),
and hand the plaintext to whatever builds the create response, once, before
it is gone from memory.

`build_setup_document(*, request_url: str)` cannot do this alone: its signature
carries no connection and no secret, which is exactly right for the GET path
(it must never be able to reconstruct the plaintext) and exactly wrong for the
create path (it has nothing to embed). Resolve this by keeping
`build_setup_document` as the GET-only, secret-free path — for a bridge
connection it renders our inbound URL and instructions, and says the secret
was already shown, not what it was — and adding a second, bridge-local
function that only `create_connection` calls, taking the freshly generated
plaintext as an argument and returning the one-time `ChannelSetupDoc`. Do not
widen the shared interface method to accept a secret: every other adapter
would inherit a parameter that means "leak this," which is the wrong default
to give every future channel.

`ChannelConnectionResponse` (`core/channels/dtos.py:825`) has no `setup` field
today — `count` and `connection` only. Add one,
`setup: Optional[ChannelSetup] = None`, populated by
`create_channel_connection` only when the adapter actually generated a
one-time document (the bridge; nothing else does yet). Every other channel's
create response is unchanged, because the field is `None` and
`response_model_exclude_none=True` already drops it.

`delivery_url` is not a secret and does not belong in
`ChannelSecretSettingsDTO` — it is where *we* push outbound commands, the
operator's own address, not a credential the platform issued. It belongs on
`ChannelConnectionCreate.data`, the same plain bucket Telegram's locator fields
would use, never inside `credentials`. Passing it through `credentials` today
is silently dropped by the real write path (extra fields on
`ChannelSecretSettingsDTO` are ignored) — the acceptance fixture never notices
because it does not go through that path at all.

## Half two — re-verified against the current identity

This half proves two things the wave's name promises and neither one is new
work in the sense half one is — both are checks, and both turned out to need
one real fix and one real gap.

### The two-bridge test

`review-findings.md` **F45** records the defect `channel-connections.md`
predicted: a stateless, shared `BridgeAdapter` instance served every
connection from one baked-in declaration, so a second bridge's locator was
validated against the first bridge's identity keys. **Checked against the
code: this is fixed, and closed.** `BridgeAdapter.fetch_capabilities`
(`adapters/bridge/adapter.py:84`) reads `connection.data.get("capabilities")`
per call, with `_DEFAULT_CAPABILITIES` only as the fallback for a connection
with no recorded `hello`. The proof already exists —
`bridge_process/test_bridge_two_bridges.py` — and is a real acceptance test:
two real bridge subprocesses, two real signing secrets, one shared
`ChannelAdapterRegistry` instance exactly as production constructs it,
asserting each event lands on its own connection, its own space, its own
agent, its own thread. The `xfail(strict=True)` F45 left on it is gone. This
package's job on this test is to confirm it still holds — it does — and to
confirm it exercises the identity this wave actually ships.

It does: `bridge_process/conftest.py::make_connection` calls
`compose_external_key(_DEFAULT_CAPABILITIES, ChannelKeyGrain.CONNECTION, ...)`
to build each row's `external_key`, the same CONNECTION-grain composition
`create_connection` uses, on the dedicated `channel_connections` table
(`channel-connections.md` — channels stopped sharing `gateway_connections`
before this wave). Nothing here needs to change; state plainly in the report
that it was checked rather than assumed.

### The in-process-versus-bridged comparison

This is not a re-verification of existing work — it does not exist.
`plan.md` describes it as **WP11**, owned by `tests/.../channels/differential/`
per `workstreams/README.md`'s file-ownership table; that directory is not in
the tree, no test compares Slack driven in process against Slack driven over
the bridge anywhere in the suite, and `specs-wp17.md` says outright that
"WP11 lands after this one" — after WP17, which shipped without it. `waves.md`
calling this package's half "re-verified" is accurate for the two-bridge test
and inaccurate for this one; say so in the report rather than let the name
stand as a claim already met.

Build it here, because a working bridge with nothing to prove it is a *port*
rather than a second implementation is not verified — the two-bridge test
proves isolation between bridges, not equivalence with the in-process
adapter it fronts. Reuse what already exists rather than inventing new
double-ended infrastructure:

- `SlackAdapter`, driven directly (in process) against
  `tests/pytest/unit/channels/slack/fake_slack.py`'s `FakeSlackWorkspace` /
  `FakeSlackTransport` — no network, deterministic, already proven against the
  real Slack adapter code path.
- `BridgeAdapter`, driven over the wire, fronting a small bridge process
  (`bridge_process/harness.py`'s `run_bridge`, `bridge_process/server.py`)
  that itself talks to the **same** `FakeSlackWorkspace` instance instead of
  the real Slack API — so both arms face an identical platform, which is the
  entire point per `plan.md`'s WP11 section: "any divergence is the bridge's,
  and cannot be blamed on a platform disagreeing with Slack."

One conversation — a DM arriving, a reply posted, that reply edited — driven
through both arms, asserting the same thread gets created, the same content
lands, the same edit reuses the same external locator, and the same
capability-driven degradation applies when the fake is told to reject a
button count. Divergence here is a contract or bridge defect, full stop —
never a platform disagreeing with itself.

**What this does not buy**, stated in `plan.md`'s own words because getting
this wrong is how a wire contract ships wrong: it tests the transport, not
the port's generality. The contract stays unpublished until a non-Slack
channel ships on it, regardless of how clean this comparison comes back.

## Files

- `api/oss/src/core/channels/adapters/bridge/` — the secret-minting path, the
  one-time document builder, the GET-path document (secret-free)
- `api/oss/src/core/channels/service.py` — `create_connection`'s bridge-secret
  generation and vault write
- `api/oss/src/core/channels/dtos.py` — `ChannelConnectionResponse.setup`,
  `ChannelConnectionCreate.data` as `delivery_url`'s home
- `api/oss/src/apis/fastapi/channels/router.py` — only to thread the one-time
  document into `create_channel_connection`'s response; the setup GET route
  itself is untouched
- The bridge contract and comparison tests — new files under
  `api/oss/tests/pytest/unit/channels/bridge/` and a new
  `tests/pytest/acceptance/channels/differential/` this package creates

## Out of scope

- Rebuilding the two-bridge test — it exists, is closed, and this package
  confirms it rather than rewriting it.
- Any second bridge implementation, or any named non-Slack platform.
- Publishing the wire contract — gated on a non-Slack channel, not on this
  package (`plan.md`, `contract.md` §7).
- The Slack setup routes (WP26/WP27) and the grants configuration surface
  (WP28) — this package only fills the document slot beside them.

## Done when

- A bridge connection's create response carries a one-time `ChannelSetup`
  with a real document: our inbound URL and a signing secret generated for
  that connection, present in the create response body and nowhere else.
- The same connection's `GET /connections/{id}/setup`, called any number of
  times afterward, never carries the secret — asserted by a test, not left to
  inspection.
- The signing secret is stored through the vault under
  `ChannelSecretKind.BRIDGE`, not hand-inserted into a row's `data` outside
  the write path.
- The two-bridge acceptance test still passes, unchanged in intent, confirmed
  to run against the CONNECTION-grain composed `external_key`.
- A new differential test drives one conversation through in-process Slack
  and bridged Slack against the same fake workspace and asserts the same
  thread, the same posted content, and the same edit-in-place from both arms.
