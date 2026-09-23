# WP6 — Slack adapter

Implements `ChannelAdapterInterface` for Slack: inbound/outbound mapping,
signature verification with timestamp replay protection, the capability
declaration with Slack's real values, and Slack's own setup path (app
manifest, scopes, install flow). This is the first real channel and the proof
that WP2's port is the right shape — everything platform-specific for Slack
lives here and nowhere else in core.

## Files

New, under WP6's owned path (`core/channels/adapters/slack/`, per
`workstreams/README.md`):

- `core/channels/adapters/slack/adapter.py` — `SlackAdapter(ChannelAdapterInterface)`
- `core/channels/adapters/slack/mapping.py` — inbound/outbound content mapping,
  sigil tokenisation, formatting-based attribution (D11)
- `core/channels/adapters/slack/signature.py` — HMAC verification with replay
  protection
- `core/channels/adapters/slack/capabilities.py` — the declared
  `ChannelCapabilities` value for `channel: "slack"`
- `core/channels/adapters/slack/manifest.py` — the app manifest (scopes, event
  subscriptions, interactivity, slash command registration)
- `core/channels/adapters/slack/__init__.py`

No file outside `core/channels/adapters/slack/` is edited by this package.
Registration of the Slack key into the `channel_key → adapter` registry is a
call into WP2's registry from this package's own init/wiring, not an edit to
a file WP2 owns.

## Interfaces

`SlackAdapter` implements every method `ChannelAdapterInterface` declares
(seeded verbatim at C0 from `entities.md` §4–§7 and `capabilities.md`, frozen
per `workstreams/README.md`'s collision table). The design docs specify this
surface **behaviourally** (`architecture.md` §4–§6, §8; `capabilities.md` §2;
`contract.md` §4–§5) rather than as a literal method list — the seed commit is
where the exact signatures are fixed, and WP6 conforms to whatever that commit
declares. The categories below are load-bearing regardless of final naming:

- **Signature verification** — verify an inbound request's signature against
  the connection's signing secret, with timestamp replay protection. Mirrors
  the shape the DAO/service layer already uses elsewhere in the codebase for
  inbound HMAC verification (header carrying the signature, header or embedded
  field carrying a timestamp, `hmac.compare_digest`, a bounded freshness
  window) — see "Contracts this package must honour" below for what is and is
  not confirmed for Slack specifically.
- **Inbound mapping** — external event (message, button click, reaction) →
  the internal message shape core consumes. Includes: tokenising `~agent` and
  `!command` sigils out of text that already carries Slack's own mention
  rewriting; stamping speaker attribution as formatting only, never a `sender`
  field (D11); marking bot-authored messages so the domain never treats its
  own posts as input (D23); classifying `is_im` / `is_mpim` / private channel /
  public channel into `ChannelSpaceKind` (`private | group | topic`, D8);
  recognising `thread_ts` as the thread unit.
- **Outbound mapping** — post a new message, edit an existing message by its
  receipt, render buttons or degrade to numbered text, split content over
  `max_chars`. Approval cards render from the recorded tool call only, never
  from model-composed text (`architecture.md` §6.3).
- **Fill** — fetch a space's history (`conversations.replies` /
  `message.channels`, gated by `channels:history`) for backfill; no separate
  forwardfill fetch (forwardfill filters the already-delivered
  `message.channels` stream by `thread_ts`, `channels.md` §3 Slack).
- **Capability declaration** — a fetchable, static `ChannelCapabilities` value
  (`capabilities.md` §2), filled in with Slack's real values from
  `channels.md` and `capabilities.md`'s own worked Slack example:

  ```json
  {
    "channel": "slack",
    "protocol": { "versions": ["0.1.0"] },
    "addressing": {
      "sigils": { "agent": "~", "command": "!" },
      "mention": true,
      "commands": { "native": true, "in_conversation": false }
    },
    "spaces": { "private": true, "group": true, "topic": true },
    "conversation": { "units": ["thread", "space"], "default": "thread" },
    "fill": {
      "backfill":    { "supported": true, "requires_permission": "channels:history" },
      "forwardfill": { "supported": true, "requires_permission": "channels:history" }
    },
    "rendering": {
      "controls": { "update": true, "ephemeral": true },
      "buttons": { "supported": true, "max": 5 },
      "text": { "format": "markdown", "max_chars": 4000 },
      "files": {
        "send":    { "supported": true, "max_bytes": 1073741824 },
        "receive": { "supported": true, "max_bytes": 1073741824 }
      }
    },
    "identity": {
      "scope": "workspace",
      "stable": true,
      "keys": {
        "space":  ["team", "channel"],
        "thread": ["team", "channel", "thread_ts"]
      }
    },
    "commands": ["new", "sessions", "use"]
  }
  ```

  `commands.in_conversation: false` because slash commands cannot be
  invoked in threads (`channels.md` §3 Slack, "Reset"). `commands` lists only
  what this adapter implements per D13/WP9's vocabulary — `stop` is
  deliberately not claimed here unless WP9's text convention is the only path,
  matching `capabilities.md` §3 "commands": a bridge or adapter declares only
  what it implements.

## Contracts this package must honour

- **Signature verification with timestamp replay protection.** Every inbound
  Slack request is verified before any row is written (`architecture.md` §5
  step 1, `contract.md` §3). The verification must reject a stale timestamp
  and a bad signature identically and without detail in the response
  (`ChannelSignatureInvalid` "carries nothing but the channel",
  `entities.md` §5) — an attacker must not learn which check failed.
  **Flagged, not asserted**: `channels.md` does not state Slack's actual
  signature header name, the timestamp header name, or the exact string that
  gets signed. Do not invent these from general Slack knowledge; confirm them
  against Slack's own current signing-secret documentation before
  implementation, and record the confirmed values in this package's own code
  comments (not verbose prose, one line) since no design doc carries them.
  The replay window is a bounded freshness check, mirroring the shape already
  proven in this codebase for inbound provider webhooks (a timestamp compared
  against `now` within a configured tolerance, plus `hmac.compare_digest` —
  never `==` — over the signed string).
- **The capability declaration must be true.** WP2's contract test suite
  (`plan.md` WP2, `capabilities.md` §5) exists specifically to catch an
  adapter lying about its own declaration — the studied failure mode is the
  silent no-op. `SlackAdapter` claiming `controls.update: true` must
  demonstrably edit a message (`chat.update` against a stored receipt);
  claiming `buttons.max: 5` must reject or degrade a sixth button rather than
  dropping it silently; claiming `backfill.supported: true` must actually
  call the history API rather than declaring it supported and no-op'ing.
  This package is held to the suite, not exempt from it.
- **`@`-tokenisation is what forces the sigil design.** Slack rewrites
  `@mention` into an opaque token before the event ever reaches the adapter
  (`channels.md` §3 Slack, "Addressing"; `channels.md` §6). There is no
  recovering the original `@agent` text. The adapter therefore parses `~` and
  `!` sigils from otherwise-untouched text, never `@` — this is not a style
  choice, it is the only mechanism that survives Slack's client-side rewrite.
- **Slack's native threads are the thread unit.** `thread_ts` is orthogonal to
  `channel` — a thread is not a fifth container type (`channels.md` §3 Slack,
  "Containers"). The adapter declares `identity.keys.thread =
  ["team", "channel", "thread_ts"]` and `identity.keys.space = ["team",
  "channel"]` (`entities.md` §2.2, `capabilities.md`'s identity section) —
  the adapter's job stops at supplying the locator and this declared field
  set; **core composes `external_key`** by calling
  `compose_external_key(capabilities, grain, locator)`, never the adapter.
  `conversation.default_unit` is `thread`, matching U3 (`channels.md` §1) —
  the universal default every studied vendor ships.
- **Slack's permission model makes backfill a per-attempt question, not a
  per-channel constant.** `channels:history` gates both `conversations.replies`
  (backfill) and `message.channels` (forwardfill) identically — there is no
  thread-scoped permission (`channels.md` §3 Slack, "Follow-ups"). The adapter
  declares `backfill.supported: true` unconditionally and lets each attempt
  discover whether *this install* is currently permitted (D10) — it never
  hardcodes a page size. How much to ask for is
  `AGENTA_CHANNELS_BACKFILL_LIMIT` (default 50), which the adapter clamps to
  whatever the install's rate tier actually permits — 15 objects/minute for a
  commercially-distributed non-Marketplace app, 1,000 at 50+/minute for a
  custom or internal app (`channels.md` §3 Slack, "Fill" table). A short page
  is a normal outcome the adapter must not treat as an error.

## Tests

- A validly signed request within the replay window verifies; the same body
  with a stale timestamp is rejected; the same body with a tampered signature
  is rejected; both rejections produce the same outward behaviour.
- `chat.postMessage` followed by a `turn ended` produces exactly one
  `chat.update` against the stored receipt, never a second `chat.postMessage`.
- An approval with 6+ options degrades to numbered text under
  `buttons.max: 5`; an approval with 3 renders as buttons.
- A message over 4000 characters is split into multiple posts, not truncated
  silently.
- `~agent` and `!command` are correctly extracted from text carrying Slack's
  rewritten mention tokens alongside them.
- A DM (`is_im`), a group DM (`is_mpim`), a private channel and a public
  channel each classify to the correct `ChannelSpaceKind`.
- A message inside an existing thread produces a locator carrying `team`,
  `channel`, `thread_ts`; a message with no `thread_ts` produces a locator at
  the space unit — the adapter hands core the locator, and calling
  `compose_external_key` with the declared `identity.keys` against each
  produces the correct grain's key (composition itself is core's, not this
  package's, per §Interfaces).
- Two distinct Slack threads in the same channel (same `team`/`channel`,
  different `thread_ts`) compose to two distinct `external_key`s via
  `compose_external_key` and this adapter's declared `keys.thread` —
  proof that `["team", "channel", "thread_ts"]` is not too small a field set
  for Slack's own locator shape.
- Backfill against a install with `channels:history` denied returns a refusal
  the caller can distinguish from "fetched and empty" — the adapter's own
  detection of a 403, never inferred from an empty page (`channels.md` §4
  degradation table).
- The full WP2 contract suite passes against `SlackAdapter` with no declared
  capability left undemonstrated.
- The app manifest as published matches the scopes the adapter actually calls
  — no scope requested that no adapter code path uses, no adapter code path
  calling a scope absent from the manifest.

## Out of scope

- The ingress route and its wiring into `_PUBLIC_ENDPOINTS` (WP3).
- Routing, resolution, and the inbox worker's invoke (WP4).
- Rendering/fold/outbox worker mechanics beyond what this adapter's
  post/edit/degrade calls are invoked with (WP5).
- Identity linking (WP7).
- The configuration API and UI (WP8, WP13).
- Command parsing and the `!` grammar itself — this package only supplies the
  sigil characters in its declaration (WP9).
- Backfill/forwardfill orchestration (the range read, the offset, the
  one-time-fetch guard) — this package only supplies the fetch call and its
  capability declaration (WP10).
- Running this adapter behind the bridge wire, and the differential harness
  (WP11).
- The bridge itself (WP12).

## Checkpoint

WP6 feeds **C3 — Slack works**, together with WP8. `plan.md`'s exit condition,
quoted verbatim:

> a mention in a real Slack workspace produces an answer in the same thread;
> an approval resolves from a button click without opening a browser; an
> operator can configure a connection end to end over the API.

WP6's own done condition (`plan.md` WP6), quoted verbatim:

> a mention in a Slack channel produces an answer in the same thread, and an
> approval resolves from a button click without opening a browser.
