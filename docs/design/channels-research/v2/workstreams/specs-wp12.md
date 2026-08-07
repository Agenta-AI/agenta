# WP12 — Bridge

Makes the wire contract in `contract.md` real: HTTP both directions, signed;
`bridge.hello` answering the same capability declaration a first-party
adapter answers; the versioned event envelope inbound; the delivery command
and receipt outbound. This is a first-party implementation of
`ChannelAdapterInterface` reached over HTTP instead of a process call — same
interface, same declaration, same core (D16) — built specifically so that
WP11 can hold it against WP6's in-process Slack adapter as the reference.

## Files

New, under WP12's owned path (`core/channels/adapters/bridge/`, per
`workstreams/README.md`):

- `core/channels/adapters/bridge/adapter.py` — `BridgeAdapter(ChannelAdapterInterface)`,
  the process-side implementation that speaks the wire contract outward
- `core/channels/adapters/bridge/hello.py` — registration handshake:
  send/receive `bridge.hello`, normalise the returned declaration at the
  boundary (never trust it — `capabilities.md` §4)
- `core/channels/adapters/bridge/envelope.py` — the versioned event envelope:
  serialise outbound delivery commands, deserialise inbound events, the
  must-ignore rule for unknown fields and unknown event types
- `core/channels/adapters/bridge/signature.py` — HMAC signing/verification for
  both directions, with timestamp replay protection
- `core/channels/adapters/bridge/receipt.py` — receipt parsing
  (`external_locator`) and idempotency-key derivation for outbound commands
- `core/channels/adapters/bridge/__init__.py`

No file outside `core/channels/adapters/bridge/` is edited by this package.

## Interfaces

The wire messages, reproduced faithfully from `contract.md` — this package
does not redesign them, it implements them.

**`bridge.hello`** (`contract.md` §4) — sent by the bridge on registration,
carrying the same declaration shape every first-party adapter answers
(`capabilities.md` §2):

```json
{
  "type": "bridge.hello",
  "protocol": { "versions": ["0.1.0"] },
  "bridge": { "name": "acme-wecom", "version": "1.2.0" },
  "capabilities": {
    "addressing": { "sigils": { "agent": "~", "command": "!" }, "mention": true },
    "spaces": { "private": true, "group": true, "topic": false },
    "conversation": { "units": ["space"], "default_unit": "space" },
    "fill": { "backfill": { "supported": false },
              "forwardfill": { "supported": true } },
    "rendering": {
      "message_update": true,
      "buttons": { "supported": true, "max": 3 },
      "text": { "format": "plain", "max_chars": 2048 },
      "files": { "receive": true, "send": false, "max_bytes": 10485760 }
    },
    "identity": {
      "scope": "tenant",
      "stable": true,
      "key_fields": { "space": ["chat_id"], "thread": [] }
    },
    "commands": ["new", "sessions"]
  }
}
```

`key_fields.thread: []` matches `conversation.units: ["space"]` above — this
bridge has no thread grain, so thread-grain composition returns `None`
(§Interfaces "addressed", below, and `entities.md` §2.2). `key_fields` is a
declaration from the bridge like any other adapter's, normalised at the
boundary like every other block (`contract.md` §4 "normalised, never
trusted") — this package does not compose `external_key` itself, and does
not trust the bridge's field set without running it through WP2's
normalisation and contract suite.

**The versioned event envelope, inbound** (`contract.md` §5) — a CloudEvents-
shaped wrapper around the activity schema core uses internally:

```json
{
  "specversion": "1.0",
  "id": "wecom-msg-98234",
  "type": "io.agenta.channel.message.received.v1",
  "source": "bridge/acme-wecom",
  "time": "2026-07-20T10:00:00Z",
  "data": {
    "space": { "locator": { "chat_id": "grp_456" }, "type": "group" },
    "sender": { "id": "wecom-user-1", "display_name": "Wei" },
    "content": [ { "type": "text", "text": "@agent deploy v2" } ],
    "addressed": true,
    "native": { "message_id": "98234" }
  }
}
```

**A bridge sends `locator`, never `external_key`** (`contract.md` §5). The wire
field was renamed for exactly this reason: `external_key` now means a core-composed
`uuid5`, and a bridge sending a raw platform string under that name would be putting
a value of the wrong type into a uniquely-indexed column. The bridge sends its
platform's own fields; core composes the key from the subset the bridge declared in
`identity.key_fields`. That is what keeps §2.2's *"one function composes it, no
exceptions"* true across the wire.

`addressed` is the bridge's own answer to "trigger or fill" (D9) — the bridge
knows its platform's addressing conventions; core does not, and this package
must not attempt to second-guess it.

**Outbound**, a delivery command carrying an `idempotency_key`, and **the
receipt** answering it:

```json
{ "type": "bridge.receipt",
  "idempotency_key": "…",
  "external_locator": { "chat_id": "grp_456", "message_id": "98241" } }
```

The `idempotency_key` is stable across retries of *one* command and
deliberately different when core asks for something new about the same
message — post and a later edit are two commands with two tokens
(`contract.md` §5, `entities.md` §2.6's `key`/`idempotency_key` derivation).
`external_locator` is a structured object, never a bare id, because editing
needs different fields per platform — `(channel, ts)` on Slack,
`(channel_id, message_id)` on Discord/Telegram (`contract.md` §5,
`entities.md` §2.6).

## Contracts this package must honour

These rules are the deliverable, not documentation of it (`contract.md` §6,
`plan.md` WP12).

- **At-least-once delivery, with two different dedup owners.** Every inbound
  event carries a stable external id; *our* ledger (`channel_inbox_events`,
  WP1) deduplicates on it, so this package may let a bridge retry inbound
  freely without adding its own dedup. Every outbound command carries an
  `idempotency_key`; **the bridge** must deduplicate on it, because only the
  platform side knows whether a message was already posted — this package's
  job is to always send the key, never to assume a bridge honours it.
- **Ordering is guaranteed per thread only.** This package must not impose or
  assume any cross-thread ordering guarantee; fill must land before the
  trigger that depends on it (D9) within one thread, and that is the only
  ordering contract that holds.
- **Evolution is additive, under a written must-ignore rule.** Senders may
  add fields; this package's envelope parser must ignore unknown fields and
  unknown event types rather than rejecting them. Version lives in the event
  type name (`io.agenta.channel.message.received.v1`), never in field shapes.
  A version bump to `.v2` is a new type name, not a reshaped `.v1`.
- **Named extension blocks, never an open bag.** Platform-specific extras ride
  in named, versioned extension blocks. This package must not introduce or
  accept a free-form catch-all field on the envelope — that is exactly the
  shape that lets core start depending on one platform's contents by
  accident, defeating D16.
- **The bridge credential authorises the transport, and nothing else.**
  Humans are authorised per invocation through identity links (WP7), exactly
  as for a first-party channel — this package's credential check gates only
  "is this a request from a registered bridge," never "is this user allowed
  to act." One bridge credential cannot speak for another installation, and
  this package must not build a mechanism that would let it.
- **Failure is the bridge's to detect and report.** Some platforms fail
  silently — a call that succeeds while returning nothing usable. This
  package cannot distinguish that from an empty thread on its own; it trusts
  the bridge's own reporting of failure and does not invent heuristics to
  guess at it.
- **Two gates, and this package sits behind only the first.** WP11 verifies
  this package by holding it against WP6's known-good in-process adapter on
  the same Slack install — that is what makes the contract *safe to build
  on*. It is **not published externally** at that point, and stays
  unpublished until a non-Slack channel ships on it — that is what makes it
  *safe to publish*. The two gates are separate because a schema exercised by
  one platform over two transports has met exactly one platform; whether the
  schema *generalises* is a question WP11 cannot answer no matter how
  thoroughly it passes, because it never varies the platform.

## Tests

- `bridge.hello` round-trips: a bridge declaring the worked example above is
  registered, and its declaration is normalised at the boundary exactly as
  `capabilities.md` §4 specifies — a declared zero becomes the default,
  absurd values clamp, unknown keys are dropped, trust-bearing flags are
  never read from the wire.
- `bridge.hello`'s `identity.key_fields` survives normalisation unchanged
  (`{"space": ["chat_id"], "thread": []}` in, same out) — WP2's contract
  suite, run against this package's registered bridge adapter, passes the
  no-threads assertion (`compose_external_key` at `THREAD` grain returns
  `None`) and the distinctness/canonicalisation/incompleteness assertions
  using this bridge's own fixture locators.
- An inbound envelope's `data.space.external_key` (the bridge's native space
  id, a string) is mapped into the locator this package hands to core, never
  written directly to a `channel_spaces.external_key`/
  `channel_threads.external_key` column and never passed to
  `compose_external_key` as anything other than one field of the locator.
- An inbound envelope with an unknown extra top-level field is accepted and
  the field is ignored.
- An inbound envelope of an unrecognised `type` is ignored rather than
  raising.
- Two deliveries of the same inbound `id` do not double-invoke (relies on
  WP1's ledger, exercised through this package's inbound path).
- A post followed by an edit of the same message sends two different
  `idempotency_key` values.
- A retry of the same unmodified command re-sends the identical
  `idempotency_key`.
- The receipt's `external_locator` round-trips opaquely — this package never
  reads inside it, only stores and replays it.
- Signature verification on both directions rejects a stale timestamp and a
  bad signature identically, with no differentiating detail leaked.
- A bridge credential presented against a different installation's inbound
  event is rejected — the credential authorises transport for its own
  registration only.

## Out of scope

- **The `/channels/bridge/events/` route itself — WP3 owns it.** Every bridge
  shares that one literal path, because a bridge's channel key is not known when
  the route table is built (`entities.md` §9). This package supplies the
  credential verification that resolves *which* bridge is calling; the route that
  hands it the request is WP3's.
- Running WP6's Slack adapter behind this bridge and asserting behavioural
  equivalence — that is the harness, WP11.
- Publishing the contract externally — gated on a non-Slack channel shipping,
  which is a follow-up, not a package (`plan.md` "Not packages").
- Any non-HTTP transport variant for bridges that cannot accept inbound
  connections — noted in `contract.md` §3 as a case to add on demand, not
  built here.
- A bridge marketplace, distribution, or verified tiers (`contract.md` §8,
  `plan.md` "Not packages").
- The capability declaration's shape itself, and its normalisation rules —
  owned by WP2; this package consumes them.
- Identity linking of the humans behind bridge-delivered events — WP7.

## Checkpoint

WP12 feeds **C5 — the bridge is proved**, ordered *before* WP11 within that
checkpoint (`plan.md`: "WP12, then WP11 … WP11 runs WP6's adapter behind
WP12's wire and cannot start until it exists"). `plan.md`'s exit condition
for C5, quoted verbatim:

> the bridged Slack adapter and the in-process one are observationally
> indistinguishable on the same install — same thread, same content, same
> edit-in-place, same degradation, same refusal text. Every difference found
> was fixed in the bridge or the contract, never accommodated in the harness.
>
> The contract is still not published here. That waits on a non-Slack
> channel, which is a follow-up rather than a package.

WP12's own done condition (`plan.md` WP12), quoted verbatim:

> a bridge outside the repo can register, receive delivery commands and
> return receipts, against a pinned version — published externally only once
> a non-Slack channel has shipped on it.
