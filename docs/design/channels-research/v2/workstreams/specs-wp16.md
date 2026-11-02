# WP16 — Slack over mock

A **fake Slack API** the real `SlackAdapter` runs against unchanged. Paired with
WP15 the way WP11 is paired with WP12: WP15 gives us a channel-shaped harness,
this points the same technique at a real adapter.

`SlackAdapter` already accepts an injected `http_client`, so no source file
changes — the seam exists.

## What already exists, and why it is not enough

WP6's unit tests contain `_StubTransport`, which records requests and pops a
scripted response body per call. That proves the adapter *sends* something. It
cannot prove the adapter survives Slack:

- it answers **any** request with the next canned body, so a call to the wrong
  endpoint, with the wrong payload, in the wrong order, passes;
- it never returns a Slack **error** shape, so every `ok: false` branch in the
  adapter is unexercised;
- it holds no state, so "edit the message I just posted" is asserted by reading
  the recorded request rather than by the fake actually holding a message.

The live acceptance test (`test_slack_adapter_live.py`) would catch these, but it
is `skipif`-gated on a real workspace and skips by default.

## The fake

`fake_slack.py`: an `httpx.AsyncBaseTransport` plus a small scripted workspace.

**Endpoints**, answering as Slack does:

- `chat.postMessage` — assigns a `ts`, stores the message, returns
  `{ok: true, channel, ts}`
- `chat.update` — requires an existing `(channel, ts)`; returns
  `{ok: false, error: "message_not_found"}` when absent
- `conversations.list` — the scripted channel set, with cursor paging
- `conversations.replies` / `conversations.history` — messages held for that
  channel or thread

**Failure shapes it must be able to return**, because each drives an adapter
branch:

- `{ok: false, error: "missing_scope"}` and a bare `403` → `fetch_history` must
  raise `ChannelBackfillRefused`, distinct from returning an empty list
- `{ok: false, error: "channel_not_found"}`
- `{ok: false, error: "ratelimited"}` with a `Retry-After` header
- `{ok: false, error: "invalid_auth"}`

**It must reject what Slack rejects.** A missing `channel`, a missing bearer
token, an unknown endpoint — answered with Slack's own error rather than the next
canned body. This is the property `_StubTransport` lacks and the reason this
package exists.

**Stateful.** A posted message is retrievable; an edit changes it in place; a
history read returns what was posted. So "post then edit produces one message"
is asserted against the fake's state, not against the adapter's own request log.

## Files

- `api/oss/tests/pytest/unit/channels/slack/fake_slack.py` — the transport and
  its workspace state
- tests alongside it, driving every `SlackAdapter` method against the fake

No source file changes. If a source change turns out to be needed, that is a
finding about the adapter's testability, not a licence to edit WP6's files —
report it.

## Determinism

No wall clock, no randomness. `ts` values come from a counter seeded in the
constructor, so an idempotency key or a receipt asserted in a test is the same
on every run. Same rule as WP15.

## Tests

Unit only — a fake transport needs nothing running.

- Every `SlackAdapter` method: success path, plus at least one Slack error shape.
- `fetch_history` raising `ChannelBackfillRefused` driven by a real
  `missing_scope` body and by a `403`, not by a hand-raised exception.
- Post-then-edit asserted against the fake's stored message, not the request log.
- `conversations.list` paging across more than one cursor page.
- A malformed request (missing `channel`) answered with Slack's error and handled
  by the adapter, not silently accepted.
- Rate limiting: `ratelimited` with `Retry-After` — assert the adapter's actual
  behaviour, and if it has none, that is a finding to report rather than a test to
  write around.

## Done when

- Every `SlackAdapter` method has success and error coverage against the fake.
- The fake rejects a request Slack would reject.
- No test in this package depends on `_StubTransport`; if that stub becomes
  redundant, say so in the report rather than deleting WP6's tests unilaterally.

## Out of scope

- The bridge (WP12) and bridged Slack (WP11) — a different axis entirely: this
  fakes the *platform*, those fake the *transport between core and adapter*.
- Changing `SlackAdapter`. The seam already exists.
- Replacing the live acceptance test. It stays as the only thing that talks to
  real Slack.
