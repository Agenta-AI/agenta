# WP29 tasks — the bridge, re-verified

Spec: [specs-wp29.md](specs-wp29.md). Read `contract.md` §4, `decisions.md`
**D37**, `review-findings.md` **F60** and **F45**, and `journeys.md` "The
provisioning contract: three slots, any of them empty" before starting.

Starts after WP26 merges (M1) — the create form and the per-channel setup
route it lands are what this package's create-response change extends.

**Two halves, and they do not share a starting point.** Half one is new work;
half two is mostly a check with one real gap inside it. Do half one first —
half two's differential test is more useful once the create/setup path it
might exercise is settled, and there is no dependency the other direction.

## Half one — the document slot

- [ ] Add `ChannelSecretSettingsDTO`... no — do **not** add `delivery_url`
  there. Confirm it stays a vault-stored credential shape
  (`bot_token`, `signing_secret` only) and instead give `delivery_url` a home
  on `ChannelConnectionCreate.data` (`core/channels/dtos.py:440`), the plain
  non-secret bucket every channel already has. State this explicitly in the
  DTO's docstring/comment: the bridge's own address is not a credential we
  verify, it is where we call, not who is calling us.
- [ ] In `create_connection` (`core/channels/service.py:96`), special-case the
  bridge channel: when no `credentials.signing_secret` was supplied, generate
  one (`secrets.token_urlsafe`, or the project's existing convention if one
  exists in `core/gateway/connections/utils.py` — check before adding a
  second way to mint a random token).
- [ ] Write the generated secret through `_write_credential_secret`
  (`core/channels/service.py:396`), using `ChannelSecretKind.BRIDGE`
  (`core/secrets/enums.py:16`) — already declared, never yet written by
  anything. Confirm `_channel_secret_kind("bridge")` resolves to it without a
  change; the enum member's value already matches the channel string.
- [ ] Keep the plaintext secret in a local variable in `create_connection`
  long enough to hand it to the one-time document builder below. Do not
  re-read it from the vault or from `connection.data` afterward — the whole
  point is that this is the only moment it exists outside encrypted storage.
- [ ] In `core/channels/adapters/bridge/adapter.py`, add a bridge-local
  function — not a `ChannelAdapterInterface` method — that takes
  `request_url` and the plaintext secret and returns the one-time
  `ChannelSetupDoc`: our inbound URL (`/channels/bridge/events/`, absolute)
  and the secret, in whatever plain-text shape a bridge operator would drop
  into their process's config. Do not put a real-looking secret in any
  docstring or test name — use an obviously fake value everywhere.
- [ ] Override `BridgeAdapter.build_setup_document` (the shared interface
  method, used only by the GET path) to return a document with our inbound
  URL and instructions, but **never** the secret — not even the hydrated one
  sitting in `connection.data`. This is the method `get_connection_setup`
  calls; it must be structurally incapable of leaking, not merely trusted not
  to.
- [ ] Add `setup: Optional[ChannelSetup] = None` to `ChannelConnectionResponse`
  (`core/channels/dtos.py:825`). Every other channel's create response stays
  identical — the field is `None` and `response_model_exclude_none=True`
  already drops it.
- [ ] In `create_channel_connection` (`apis/fastapi/channels/router.py:440`),
  after `create_connection` returns, attach the one-time document (built
  above) to the response only when one was generated. No new route — this is
  the existing create route's response widening, per the spec.
- [ ] Confirm `_hydrate_connection` still resolves `signing_secret` onto
  `connection.data` at delivery time — `_bridge_secret` and `_deliver` must
  keep working exactly as today; this package changes *how the secret is
  minted and shown*, not how it is used once stored.

## Half two — re-verified

### The two-bridge test — confirm, do not rebuild

- [ ] Run `bridge_process/test_bridge_two_bridges.py` and read it against
  `channel-connections.md`'s prediction (one shared declaration, second
  bridge's locator validated against the first's fields). Confirm in the
  report that `BridgeAdapter.fetch_capabilities` now reads
  `connection.data.get("capabilities")` per call — the fix F45 already
  records — and that the test's `xfail(strict=True)` is gone, not merely
  loosened.
- [ ] Confirm `bridge_process/conftest.py::make_connection` composes each
  row's `external_key` via `compose_external_key(..., ChannelKeyGrain.CONNECTION, ...)`
  on `channel_connections`, not a value carried over from the old shared
  `gateway_connections` table. This is the "new connection identity" the wave
  is named for — check it, do not assume it because the test passes.
- [ ] If either check fails, that is a real regression, not a re-verification
  — file it and fix it before moving on; do not let this package's "already
  fixed" framing paper over an actual break.

### The in-process-versus-bridged comparison — this one has to be built

- [ ] Confirm first, and say so plainly in the report: no
  `tests/.../channels/differential/` directory exists, no test anywhere
  drives Slack in process and Slack over the bridge against the same input
  and compares the outcome. `waves.md` calling this "re-verified" does not
  match the code for this half.
- [ ] New directory `api/oss/tests/pytest/acceptance/channels/differential/`.
  Reuse, do not reimplement: `tests/pytest/unit/channels/slack/fake_slack.py`
  for the in-process arm's platform double, `bridge_process/harness.py` and
  `bridge_process/server.py` for the bridged arm's subprocess.
- [ ] The bridged arm's subprocess must talk to the **same**
  `FakeSlackWorkspace` instance the in-process arm uses — not two separate
  fakes that happen to behave alike. That is what makes a divergence
  attributable to the bridge rather than to two fakes disagreeing.
- [ ] One scenario, driven twice: a DM arrives, the in-process/bridged
  `SlackAdapter` posts a reply, the reply is edited. Assert both arms produce
  the same thread identity, the same posted content, the same
  `external_locator` reused for the edit.
- [ ] A second scenario exercising capability-driven degradation: tell the
  fake workspace to report a lower button limit than the default and assert
  both arms degrade the same way. This is what proves the bridge carries
  capability negotiation faithfully, not just message bytes.
- [ ] State in the report what this test does **not** prove — `plan.md`'s own
  words: transport correctness, not schema generality. Do not claim the
  contract is ready to publish; that gate is a non-Slack channel shipping on
  it, untouched by this package.

## Tests

- [ ] Unit: bridge secret generation and vault write, with a faked
  `VaultService` — no DB, no network. Assert `ChannelSecretKind.BRIDGE` is
  what gets written and that `credentials.signing_secret` (if a caller
  somehow supplies one) does not silently override the minted value in a way
  that contradicts "only we can mint this."
- [ ] Unit: `BridgeAdapter.build_setup_document` never returns the secret,
  for a connection whose hydrated `data` already contains one — this is the
  test that would have caught a naive "just pass connection through" fix.
- [ ] Unit: the one-time document builder embeds the given secret and our
  inbound URL, and is never called from anywhere but the create path (grep
  for callers as part of the test, the way this project's reachability
  checks already do).
- [ ] Integration: `create_channel_connection`'s response, against a real
  vault-backed write, carries `setup.document` with the secret exactly once;
  a subsequent `GET /connections/{id}/setup` on the same connection does not.
  This needs Postgres (the vault write path), so it is integration, not unit.
- [ ] Acceptance (unchanged, re-run): `bridge_process/test_bridge_two_bridges.py`.
- [ ] Acceptance (new): the differential suite above — two real subprocesses
  (bridge harness + fake-Slack-backed server) plus the in-process adapter
  against the same fake, so it needs the full acceptance stack, not a mock at
  the boundary.

## Definition of done

- [ ] A bridge connection's create response, and only that response, carries
  the plaintext signing secret.
- [ ] `GET /connections/{id}/setup` never carries it, on the bridge's first
  call or any later one, asserted by a test rather than left to review.
- [ ] `ChannelSecretKind.BRIDGE` has a writer for the first time.
- [ ] `delivery_url` lives on `ChannelConnectionCreate.data`, not inside
  `credentials` / `ChannelSecretSettingsDTO`.
- [ ] The two-bridge acceptance test passes unmodified in intent, confirmed
  against the CONNECTION-grain `external_key`.
- [ ] The differential suite exists, passes, and both scenarios (message +
  edit, capability degradation) run through the same fake workspace from
  both arms.
- [ ] `ruff format` then `ruff check --fix` clean in `api/`.

## Report explicitly

- [ ] Whether `_bridge_secret` reads the vault or the connection row —
  neither, precisely: it reads `connection.data`, which the service hydrates
  from the vault on every `fetch_connection`. Say this exactly; "reads the
  vault" and "reads the row" are both half-true and this is where a reader
  gets it wrong.
- [ ] That `delivery_url` passed through `credentials` today is silently
  dropped by the real write path (extra field on `ChannelSecretSettingsDTO`),
  and that the acceptance fixture never caught it because it bypasses
  `create_connection` entirely.
- [ ] That the two-bridge test already existed and was already fixed under
  F45 — this package confirmed it, it did not build it.
- [ ] That the in-process-versus-bridged comparison did not exist before this
  package, contradicting `waves.md`'s "re-verified" framing for that half
  specifically.
- [ ] What was *not* proven: the wire contract's generality across platforms.
  That gate stays closed until a non-Slack channel ships.

## Out of scope

- Rebuilding or re-authoring the two-bridge test — confirm it, do not touch
  its assertions unless a real regression is found.
- Any second bridge implementation, or any named non-Slack platform.
- Publishing the wire contract externally.
- The Slack setup routes (WP26/WP27) and the grants configuration surface
  (WP28).
