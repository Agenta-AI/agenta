# WP17 — A bridge process, at test level

> **Rescoped for wave 4, and ordered last.** This is no longer only a bridge harness:
> it is **the process that drives channels end to end**, and therefore the only honest
> driver for the commands, fill and mock capabilities WP18 wires. It also hosts WP11's
> differential. Depends on WP18 (the wiring it exercises), WP19 (the protocol it
> asserts) and WP12 (the adapter it talks to).

A **real out-of-process bridge**, run as a test fixture, that speaks the wire
contract over HTTP and drives channels end to end. Where WP12 implements the
core-side adapter that talks *to* a bridge, this implements the other end of the
wire — the thing a third party would write.

The three fakes in this project sit on different axes and none substitutes for
another:

| Package | Fakes | Runs |
| --- | --- | --- |
| WP15 | a channel that does not exist | in process |
| WP16 | Slack's own HTTP API | in process, fake transport |
| **WP17** | **a bridge, i.e. the far side of the wire** | **its own process, real HTTP** |

WP16 proves the Slack adapter survives Slack. WP17 proves *core* survives a
bridge: real sockets, real signing, real clock skew, real concurrency, and a
counterpart core does not control.

## Why a process and not another fake transport

Every fake so far runs inside the test's own event loop, which quietly removes
the failure modes a bridge actually has. A separate process restores them:

- **The signature is verified across a real boundary**, so a clock-skew or
  canonicalisation bug cannot hide behind a shared Python object.
- **Concurrency is real.** Two inbound events arriving while an outbound
  delivery is in flight is the ordering case `contract.md` §7 legislates for and
  no in-process fake exercises.
- **Retries and duplicate delivery are real.** The bridge can genuinely resend,
  which is the only honest test of the idempotency ledger.
- **It is the first consumer of the contract that is not us.** A contract only
  one side implements is a data structure, not a contract.

## Many bridges is the point, and it is a wire-contract property

One route for every bridge is correct and deliberate: `POST
/channels/bridge/events/` is the only bridge endpoint there will ever be. The
multiplicity lives in **the wire contract**, not in the route table — a bridged
platform has no literal path of its own, which is exactly what makes it a bridge.

So the demultiplexing happens on the envelope. The contract already carries the
identifying fields — `"source": "bridge/acme-wecom"` inbound, and
`bridge.name` in `bridge.hello` — but **never says what core does with them**,
which is `F37`. Nothing in the code reads `source`.

**WP19 settles that decision before this package starts**, and WP12 implements it.
This package holds them to it — it does not decide, and it does not guess.

Its central test is **two bridges at once**:

- two bridge processes, two credentials, two different declared capability sets,
  two different `source` values — **behind the one route**
- an event from each, interleaved
- each resolving to its own connection, its own agent, its own thread
- an outbound delivery for each arriving at the right bridge and no other
- a bridge whose `source` disagrees with its credential: refused, or the
  credential wins and `source` is ignored — whichever the contract decides, the
  behaviour is asserted rather than left to chance

If that test cannot pass without a core change, the finding is the deliverable
and the fix is a checkpoint conversation — not something this package patches
into someone else's file.

## The process

A small ASGI app (the same server the repo already runs), started and stopped by
a fixture, on an ephemeral port.

- `hello` — answers the registration handshake with a declaration supplied by the
  test, so one process covers every capability shape, exactly as WP15's
  constructor parameters do.
- inbound — posts signed envelopes on demand; the test says when, so ordering is
  deterministic.
- outbound — accepts signed delivery commands, records them, answers a receipt.
- **rejects what it must**: a bad signature, a stale timestamp, an unknown event
  type, a malformed envelope. A bridge that accepts anything proves nothing —
  the lesson `F28` taught, where a permissive stub let a real defect sit in a
  green suite.

**Determinism.** No wall clock and no randomness in anything asserted: `ts`,
receipts and idempotency keys come from a seeded counter, per WP15's rule. The
one exception is the signature's own timestamp, which is what makes replay
protection testable — inject it rather than reading the clock.

## Files

- `tests/.../channels/bridge_process/app.py` — the bridge ASGI app
- `tests/.../channels/bridge_process/harness.py` — start/stop, ephemeral port,
  readiness wait, signed-request helpers
- `tests/.../channels/bridge_process/` tests alongside

No source file changes. By the time this runs, WP19 has restructured the ingress and
WP12 has built the adapter — so a failure here is a finding about *their* work, and
belongs in a report rather than in a patch to their files.

## Test layer

**Acceptance, not unit.** This starts a process and opens sockets, so by the
repo's rule — runtime dependencies decide the layer — it cannot be a unit test.
It needs the api running, and Postgres, to resolve a connection and write the
inbox log. Put it in `tests/pytest/acceptance/`, and do not run it in a worktree
with no deployment.

The bridge process itself is a dependency the tests start, not one the
environment must provide.

## Depends on

- **WP19** — the `source` decision, which determines what the two-bridge test asserts.
- **WP12** — core needs a `BridgeAdapter` before anything can talk to a bridge; this
  package supplies the counterpart, not the adapter.
- **WP18** — the wiring this process exercises. Without it, commands, fill and the mock
  adapter have no callers and driving them proves nothing.

It also **hosts WP11's differential**: in-process Slack against bridged Slack, both
pointed at WP16's fake. WP11 lands after this one.

## Done when

- Two bridges, two credentials, two declarations, interleaved events, each
  resolving to its own connection and thread — or `F37` reported as confirmed
  with the failing assertion as evidence.
- Every wire message in `contract.md` exercised in both directions.
- The bridge rejects a bad signature, a stale timestamp and a malformed envelope,
  each asserted.
- A duplicate inbound delivery produces no second turn; a duplicate outbound
  command produces no second post.
- Capability degradation driven by the *declaration the process sends*, not by a
  hand-built object.

## Out of scope

- WP12's adapter — this is its counterpart, not a second copy of it.
- Deciding the `source` protocol; that is WP19's, and this package asserts it.
- A production bridge, or any bridge for a named platform. This is the reference
  implementation a bridge author would read, living in tests.
- Fixing `F37`. Prove it, report it.
