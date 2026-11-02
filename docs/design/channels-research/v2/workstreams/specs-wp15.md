# WP15 — Mock channel

Implements `ChannelAdapterInterface` for a channel that does not exist: `mock`.
It declares whatever capability set a test asks for, records what it was told to
post, and replays scripted inbound events. No credentials, no workspace, no
network, no clock.

This is the second first-party adapter, and that is the point. One adapter proves
an interface compiles; two prove it is a port rather than the first platform's
shape with an interface drawn around it. `mock` is also the home for the
capability arms no real platform can reach — a channel with no threads, no
buttons, no history — which today have nowhere to be exercised.

## Why this exists

Slack (WP6) was built before any mock, and three consequences are recorded in
`findings.md`:

- **`F5`** — WP2's contract suite asserts signature behaviour using a fixed fake
  header scheme. No adapter doing real HMAC can satisfy it, so WP6 passes the
  suite only via a test-local subclass that overrides `verify_signature`. A
  `mock` adapter whose signature check *is* whatever the suite says makes the
  suite's shape the thing under discussion instead of each adapter's crypto.
- **Capability coverage** — degradation, buttons-vs-numbered-text, threading
  grains, fill and refusal text are all platform independent by design, but are
  currently proved against `WellBehavedFakeAdapter`, a test fixture rather than a
  registered adapter.
- **`F6`** — the four `connection.data` keys the Slack adapter reads have no
  design-doc basis, and nothing writes them. `mock` needs no secrets at all,
  which makes it the adapter that can be exercised end to end today.

## Files

New, under WP15's owned path (`core/channels/adapters/mock/`):

- `core/channels/adapters/mock/adapter.py` — `MockAdapter(ChannelAdapterInterface)`
- `core/channels/adapters/mock/capabilities.py` — capability *builders*, not one
  constant: `full()`, `no_threads()`, `no_buttons()`, `no_history()`, and a
  `declare(**overrides)` for arbitrary shapes
- `core/channels/adapters/mock/script.py` — scripted inbound events (a list of
  `ChannelInboundEvent`, replayed on demand) and the posted-message recorder
- `core/channels/adapters/mock/__init__.py`

No file outside `core/channels/adapters/mock/` is edited. Registration is a call
into WP2's registry from this package's own wiring, never an edit to WP2's files.

## The adapter

`channel = "mock"`. Every method is deterministic and synchronous in effect:

- `fetch_capabilities` returns whatever the constructor was given, so one adapter
  class covers every declaration a test needs.
- `verify_signature` checks a shared-secret header whose name and value are
  constructor parameters, defaulting to the scheme WP2's contract suite uses.
  This is the `F5` seam: `mock` is the adapter for which the suite's assertions
  are correct by construction.
- `parse_event` pops the next scripted event, or returns `None` when the script
  is exhausted (which is how "the platform sent something we ignore" is tested).
- `post_message` / `edit_message` append to the recorder and return a synthetic
  receipt shaped like a real `external_locator`. The recorder is the assertion
  surface: what content, in what order, with what idempotency key.
- `discover_spaces` returns a configured list.
- `fetch_history` returns a configured list, or raises
  `ChannelBackfillRefused` when the declaration says no history — the arm no real
  adapter can currently exercise.

## Determinism

No `datetime.now()`, no `uuid4()`, no sleeps inside the adapter. Anything that
would vary is a constructor parameter, so a test asserting an idempotency key or
a receipt gets the same value every run. This is what makes `mock` usable in the
contract suite rather than only in bespoke tests.

## Tests

Unit only — `mock` has no runtime dependency by construction, which is the whole
point. `api/oss/tests/pytest/unit/channels/mock/`:

- WP2's contract suite against `MockAdapter`, **unmodified**. If the suite needs
  changing to pass, that change is `F5`'s fix and must be made where WP6's Slack
  adapter still satisfies it — the suite is shared acceptance criteria.
- One test per capability arm: each of `no_threads`, `no_buttons`, `no_history`
  paired against its supported counterpart, asserting the degradation is the one
  `capabilities.md` specifies.
- The recorder's own contract: posts are ordered, edits target the row they say
  they target, and a redelivered idempotency key does not produce a second post.

## Done when

- The contract suite passes against `mock` with no adapter-local overrides.
- Every capability in `capabilities.md` has a `mock` declaration exercising both
  its supported and unsupported arm.
- `mock` is registered and reachable through the normal registry lookup, not only
  from test imports.

## Out of scope

The bridge. `mock` over the wire is WP12's ordering note, not this package —
this one is in-process only. Registering a public ingress route for `mock` is
also out: `_PUBLIC_ENDPOINTS` is WP3's line, and a mock channel receiving real
unauthenticated HTTP is not something to add casually.
