# Channels: the bridge contract

How a surface we cannot build gets built by someone else.

---

## 1. The situation

A self-hosting customer needs their agent in a platform we cannot build or even
test — WeCom and Feishu require verified Chinese enterprise tenants we cannot
obtain, and there is a long tail of internal and regional systems beyond them.
They must be able to add it themselves, keep it independent of our code, and
maintain it across our upgrades.

## 2. Why a wire contract

The mechanism is a **versioned wire contract**: language-agnostic,
crash-isolated, and upgrade-independent — the strangers building against it
never touch our release train, and it is the only mechanism a hosted cloud can
also offer safely. An in-process plugin would be code execution inside the
process holding every platform token: RCE-equivalent trust, which is
unacceptable for code we cannot test.

## 3. Transport

The bridge is reachable over HTTP, both directions signed. Inbound events arrive at
**`POST /channels/bridge/events/`**, verified by HMAC with timestamp replay
protection; outbound delivery commands are signed the same way.

Every bridge shares that one route, where a first-party channel gets a literal
route of its own (`/channels/slack/events/`). The asymmetry is structural rather
than a special case: a first-party channel key is known when the route table is
built and says so in its path, while a bridge's is not — that is what makes it a
bridge. So the channel is resolved from the **bridge credential**, which the
receiver must verify anyway, and verifying it is the same act as identifying which
bridge is calling. HTTP is the
default because Agenta's posture is not egress-only — public webhook receivers
already exist and are already routed. A bridge that genuinely cannot accept
inbound connections is a real case, but it is a variant to add on demand rather
than the shape the contract is built around.

## 4. Introduction and capabilities

On registration the bridge declares itself and what it can do, using the same
declaration every first-party adapter answers (`capabilities.md`):

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
    "identity": { "scope": "tenant", "stable": true },
    "commands": ["new", "sessions"]
  }
}
```

Values are **normalised, never trusted** (`capabilities.md` §4). The declaration
then drives rendering exactly as for a first-party channel: a three-button limit
means an approval with more options degrades to numbered text automatically, and
`backfill.supported: false` means core never attempts it.

## 5. Events

A versioned envelope around the same activity schema core uses internally.

**Three version fields appear here, at three granularities, and conflating them is
how a wire contract becomes unevolvable.** They are:

| field | versions | who bumps it |
| --- | --- | --- |
| `specversion` | the CloudEvents envelope spec — **not ours** | the CNCF |
| `protocol.versions` | this contract as a whole, in `bridge.hello` | us, at a checkpoint |
| `.v1` in `type` | one event's `data` shape | us, per event type |

**`specversion`, `id`, `type`, `source`, `time` and `data` are CloudEvents' own
field names** and are spelled its way, `specversion` included. Renaming it to
`version` would forfeit the interop and every off-the-shelf validator for
cosmetics — and it would collide with the two versions that *are* ours. It reads
`1.0` because CloudEvents is at 1.0, which is unrelated to our `0.1.0`.

**Ours start at `0.1.0`**, because the contract is unproven until a non-Slack
channel ships on it (§7) and `1.0` would claim a stability we have not earned.

**Parsers are per event type, not per protocol version.** Both directions dispatch
on `type` — `io.agenta.channel.message.received.v1` selects one inbound parser, and
a future `.v2` selects another that lives beside it rather than replacing it.
`protocol.versions` is negotiation, not dispatch: it says *which event types and
rules this bridge understands at all*, so core can refuse a bridge it cannot talk
to and stop offering event types that bridge never learned. Bumping the protocol
does not invalidate a `.v1` parser — that is exactly why the shape version lives in
the type name (§6).

Inbound:

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

`addressed` is the bridge's answer to "was this a trigger or is it fill" (D9) —
the bridge knows its own platform's addressing conventions; core does not.

**A bridge sends a `locator`, never an `external_key`.** The locator is the
platform's own fields, and core composes `external_key` from the subset the bridge
declared in `identity.key_fields` (`entities.md` §2.2). The distinction is not
pedantic: `external_key` is a `uuid5` that core owns, and a bridge that sent a raw
platform string under that name would be writing a value of the wrong type into a
uniquely-indexed column. Sending the locator and letting core key it is also what
keeps *"one function composes it, no exceptions"* true across the wire.

Outbound the two directions of identity meet, and the contract must keep them
apart (`entities.md` §2.6):

- Core sends a delivery command carrying an **`idempotency_key`** — a token the
  bridge must use to **drop a command it has already accepted**. It is stable
  across retries of *one* command, and **deliberately different when core asks for
  something new about the same message** — posting it and later editing it are two
  commands with two tokens. So a bridge deduplicates on this token and nothing
  else: keying on the payload double-posts on retry, and keying on the target
  message drops every edit.
- The bridge answers with a **receipt**: an `external_locator`, a structured
  object, not a bare id. Editing needs `(channel, ts)` on Slack,
  `(channel_id, message_id)` on Discord and Telegram; a bridge returns whatever
  its own platform needs to address that message again, and core stores it
  opaquely.

```json
{ "type": "bridge.receipt",
  "idempotency_key": "…",
  "external_locator": { "chat_id": "grp_456", "message_id": "98241" } }
```

The receipt is load-bearing: editing a progress message and updating a resolved
approval both require knowing what the platform called the message we posted. A
bridge that cannot supply one declares `message_update: false`, and core stops
offering edits rather than silently losing them.

**Following Linear's example**, a bridge that can cheaply supply prior context
should include it on the event that creates a thread, and never afterwards.
Pushing context is strictly better than making core fetch it, and the platform is
the only party that knows what is cheap.

## 6. The rules that make it operable by strangers

Written into the specification rather than assumed, because bridge authors we
will never meet depend on them.

- **Delivery is at-least-once in both directions, but deduplication has two
  different owners.** Every inbound event carries a stable external id, and *our*
  ledger deduplicates on it — so a bridge may retry inbound freely. Every
  outbound command carries an idempotency key, and **the bridge** must
  deduplicate on it, because we cannot: only the platform knows whether a message
  was already posted. A bridge that ignores the key will double-post on every
  retry we make.
- **Ordering is guaranteed per thread only.** This matters more than it
  looks: fill must land before the trigger that depends on it (D9).
- **Evolution is additive, under a written must-ignore rule.** Senders may add
  fields; receivers must ignore unknown fields and unknown event types. Version
  lives in the event type name, never in field shapes. This is the discipline
  that kept a comparable schema compatible for a decade.
- **Platform-specific extras ride in named, versioned extension blocks**, never
  an open bag. An open free-form field is where normalisation goes to die: core
  quietly starts depending on one platform's contents and the abstraction is
  gone.
- **The bridge credential authorises the transport, nothing else.** Humans are
  authorised per invocation through identity links, exactly as for a first-party
  channel. One bridge credential cannot speak for another installation.
- **Failure is the bridge's to detect.** Some platforms fail silently — a call
  that succeeds while returning nothing usable. Core cannot distinguish that from
  an empty thread, so the bridge must, and must report it.

## 7. First-party adapters use the same contract

Our own adapters are the same interface reached by a process call instead of a
wire call, speaking the same activity schema and declaring capabilities the same
way. This is the only known way to keep a third-party contract honest: a contract
only strangers use rots immediately.

**Practical consequence for sequencing.** Two separate gates, and conflating them
is how a wire contract ships wrong.

**Correctness** is proved by running the *first* adapter both ways — in process and
bridged — against the same platform install. The in-process behaviour is the
expected output, so any divergence is the transport's and nothing else can be
blamed for it (`plan.md` WP11).

**Generality** is not proved that way, and the contract is **not published for
external use** until a second platform ships on it. A schema exercised by one
platform over two transports has met one platform, and a contract shaped around
that platform can be platform-shaped without anyone noticing. The six studied here
disagree with each other enough — tokenisation, visibility gating, threading,
editing, identity scope — that the second *platform*, not the second transport, is
where the real design review happens.

## 8. Deliberately deferred

Distribution and a community catalogue — verified tiers, a directory, discovery.
The contract makes distribution independent of us, which is the point; building a
marketplace is a separate product decision.

One pre-commitment regardless of how that lands: **community code is never
auto-installed.**
