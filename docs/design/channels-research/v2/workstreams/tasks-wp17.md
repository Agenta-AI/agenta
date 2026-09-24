# WP17 tasks — a bridge process, at test level

Read `specs-wp17.md`, then `contract.md` in full (this package implements the far
side of it), then `specs-wp12.md` (the near side), then `c1-merge-notes.md`.

**Ordered after WP12.** Nothing here can be driven until core has a
`BridgeAdapter`. Same relationship as WP16 to WP15.

## The process

- [ ] `bridge_process/app.py`: an ASGI app answering the wire contract. Started
  and stopped by a fixture on an ephemeral port — never a fixed port, or two
  parallel runs collide.
- [ ] `hello`: answer the handshake with a declaration **supplied by the test**,
  so one process covers every capability shape.
- [ ] Inbound: post signed envelopes on demand. The test decides when, so
  ordering is deterministic and interleaving is expressible.
- [ ] Outbound: accept signed delivery commands, record them in an inspectable
  ordered list, answer a receipt.
- [ ] Reject a bad signature, a stale timestamp, an unknown event type and a
  malformed envelope — each with the contract's own error shape.
- [ ] Determinism: seeded counter for `ts`, receipts and idempotency keys. The
  signature timestamp is injected, not read from the clock — that is what makes
  replay protection testable.
- [ ] `harness.py`: start/stop, readiness wait, signed-request helpers. Wait for
  readiness by polling the port, never by sleeping a fixed interval.

## The two-bridge test — the reason this package exists

**One route, many bridges.** All of this happens behind the single
`POST /channels/bridge/events/`; there is no second endpoint and there should
never be one. The demultiplexing is a wire-contract property.

- [ ] **First, read `F37` and check whether the contract question is settled.**
  The envelope carries `source` (`"bridge/acme-wecom"`) and `bridge.hello`
  carries `bridge.name`, but the contract never says what core does with either,
  and nothing reads `source`. Whether `source` is authoritative, or the
  credential is, or the credential wins with `source` as a cross-check, changes
  what these tests assert. **If it is still open, say so and stop** — write the
  process and the single-bridge coverage, and leave the two-bridge assertions
  until the decision exists. Guessing here invents protocol.
- [ ] Two processes, two credentials, two **different** declared capability sets,
  two different `source` values.
- [ ] An event from each, interleaved, each resolving to its own connection,
  agent and thread.
- [ ] An outbound delivery for each arriving at the right bridge and no other.
- [ ] A bridge whose `source` disagrees with its credential — assert whatever the
  settled contract says, refusal or credential-wins.
- [ ] **Expect this to fail today.** The ingress passes the literal
  `channel="bridge"`, so the registry and connection lookups key on that string
  and all bridges collapse into one channel. If it fails, report the failing
  assertion as the evidence — do **not** edit `ingress.py` to make it pass.
- [ ] If it unexpectedly passes, say so and explain what makes it work, because
  the code read says it should not.

## Contract coverage

- [ ] Every wire message in `contract.md`, both directions.
- [ ] `bridge.hello` with a declaration core must normalise and not trust.
- [ ] The versioned envelope, including the must-ignore rule for unknown fields
  and unknown event types.
- [ ] A protocol version core cannot speak → refused, and the refusal asserted.
- [ ] Receipts, including a bridge that declares `controls.update: false` — core
  must stop offering edits.
- [ ] `addressed` decided by the bridge, not by core.
- [ ] A locator, never an `external_key`: assert core composes the key itself and
  a bridge-sent key is not honoured.

## Idempotency and ordering

- [ ] A duplicate inbound delivery produces no second turn.
- [ ] A duplicate outbound command produces no second post.
- [ ] Two inbound events arriving during an in-flight outbound delivery — the
  ordering case `contract.md` §7 legislates for and no in-process fake reaches.

## Test layer

- [ ] **Acceptance.** It starts a process and opens sockets, so it is not a unit
  test under the repo rule. It needs the api and Postgres running.
- [ ] Do not run it in a worktree with no deployment — write it, review it, and
  say plainly that it was not run if it was not.
- [ ] Never write a test that runs `alembic upgrade`/`downgrade`.

## Definition of done

- [ ] The two-bridge test passes, or `F37` is confirmed with evidence.
- [ ] Every contract message exercised both ways.
- [ ] The bridge rejects each of the four bad inputs above.
- [ ] No source file changed. Any core change needed is reported verbatim.

## Report explicitly

- [ ] Whether two bridges can coexist, with the evidence either way.
- [ ] Every place the contract was ambiguous enough that two readings were
  possible — a bridge author will hit exactly those.
- [ ] Anything the contract requires that core does not do, or that core requires
  and the contract never states.
- [ ] Whether the suite was actually run or only written.

## Out of scope

- WP12's adapter and WP11's differential harness.
- A bridge for any named platform.
- Fixing `F37`, or any other core defect this surfaces.
