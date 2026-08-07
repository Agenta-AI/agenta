# WP12 tasks — Bridge

## Registration handshake

- [ ] Implement `hello.py`: send/receive `bridge.hello`, parse
  `protocol.versions`, `bridge.{name,version}`, and `capabilities`.
- [ ] Implement normalisation at the boundary for the received declaration:
  clamp absurd values, default a declared zero, drop unknown keys, and never
  read any trust-bearing flag from the wire (`capabilities.md` §4).
- [ ] Pin a protocol version for this package's first cut (**`"0.1.0"`** — the
  contract is unproven until a non-Slack channel ships on it, so `1.0` would claim
  a stability it has not earned) and reject a `bridge.hello` that does not include
  it in `protocol.versions`.
- [ ] Test: the worked `bridge.hello` example from `contract.md` §4 — with
  `identity.keys: {"space": ["chat_id"], "thread": []}` added per
  `specs-wp12.md` — registers correctly and its declaration round-trips
  through normalisation unchanged (it is already within bounds).
- [ ] Test: a declaration with an absurd value (e.g. `buttons.max: 999999`)
  clamps; a declared `0` for something clamp-worthy takes the default; an
  unknown key is dropped without error.
- [ ] Test: register this bridge's declaration and run WP2's contract suite's
  identity assertions against it — distinctness and canonicalisation using
  the bridge's own fixture locators, incompleteness on a locator missing
  `chat_id`, and the no-threads assertion returning `None` at `THREAD` grain
  (since this bridge declares `"thread": []`).

## Inbound envelope

- [ ] Implement `envelope.py` inbound: parse the CloudEvents-shaped wrapper,
  extract `data.space`, `data.sender`, `data.content`, `data.addressed`,
  `data.native`.
- [ ] Map `data.space.locator` (the bridge's own platform fields, e.g.
  `{"chat_id": "grp_456"}`) straight onto the `ChannelInboundEvent` locator.
  Never write it into core's `external_key` column — that column holds the
  `uuid5` `compose_external_key` derives from the declared `identity.keys` subset.
- [ ] Implement the must-ignore rule: an unrecognised top-level field is
  dropped silently; an unrecognised `type` is ignored rather than raising.
- [ ] Wire `addressed` straight through as the bridge's own trigger/fill
  answer (D9) — no reinterpretation on this package's side.
- [ ] Test: the worked inbound example from `contract.md` §5 parses correctly, and
  its `data.space.locator` lands in the locator, with nothing string-typed reaching
  a `UUID` field.
- [ ] Test: an envelope with an added unknown field parses and the field is
  discarded, not surfaced as an error.
- [ ] Test: an envelope with an unrecognised `type` is ignored, not raised.

## Outbound envelope, idempotency, receipt

- [ ] Implement `receipt.py`: derive `idempotency_key` per the
  `key`/`updated_at` shape in `entities.md` §2.6 — stable across a retry of
  one command, different for a distinct operation on the same message (post
  vs. edit).
- [ ] Implement receipt parsing: accept `bridge.receipt` carrying
  `idempotency_key` and a structured `external_locator`; store the locator
  opaquely, never read inside it.
- [ ] Implement `adapter.py`'s post/edit calls to always attach the derived
  `idempotency_key`, and to never assume a bridge deduplicates — the
  responsibility is documented as the bridge's, not enforced by this side.
- [ ] Test: a post then an edit of the same outbox row send two distinct
  `idempotency_key` values.
- [ ] Test: an unmodified retry re-sends the identical `idempotency_key`.
- [ ] Test: a `bridge.receipt` with a Slack-shaped locator and one with a
  Discord-shaped locator both store and replay opaquely.

## Signing, both directions

- [ ] Implement `signature.py` for inbound verification (bridge → us) and
  outbound signing (us → bridge), both HMAC with timestamp replay protection,
  `hmac.compare_digest` on the receiving side.
- [ ] Test: valid signature within the replay window verifies in both
  directions.
- [ ] Test: a stale timestamp and a tampered signature are rejected
  identically, with no differentiating detail in the response.

## Credential scope

- [ ] Implement the bridge credential check as transport-only authorisation —
  confirms "this is a registered bridge," never "this user may act."
- [ ] Confirm no code path in this package treats the bridge credential as
  sufficient to authorise a human action — that check stays in identity
  links (WP7), untouched by this package.
- [ ] Test: an inbound event signed with installation A's credential but
  addressed at installation B's connection is rejected.

## Failure reporting

- [ ] Implement the adapter's handling of an explicit bridge-reported failure
  (a typed error in the delivery response) as distinct from a normal receipt
  — this package surfaces the bridge's own diagnosis rather than inferring
  failure from an empty or missing field.
- [ ] Test: a bridge-reported failure surfaces as a failure to the caller,
  not as a successful delivery with an empty locator.

## Versioning discipline

- [ ] Confirm the envelope parser and the outbound serialiser both key off
  the event type name for versioning, never off field-shape sniffing.
- [ ] Document (in code, one line, no prose) that a future `.v2` type is a new
  type name, never a reshaping of `.v1`'s fields.

## Definition of done

Restating `plan.md` WP12's exit condition verbatim: **a bridge outside the
repo can register, receive delivery commands and return receipts, against a
pinned version — published externally only once a non-Slack channel has
shipped on it.**
