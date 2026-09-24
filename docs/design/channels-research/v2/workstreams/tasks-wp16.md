# WP16 tasks — Slack over mock

Read `specs-wp16.md`, then `specs-wp15.md` (this reuses its scripted-workspace
technique), then `c1-merge-notes.md`.

**Ordered after WP15.** Same relationship as WP11 to WP12: harness first, real
adapter through it second.

## The fake

- [ ] `fake_slack.py`: an `httpx.AsyncBaseTransport` with scripted workspace state
  (channels, messages, threads). Deterministic — `ts` from a seeded counter, no
  wall clock, no randomness.
- [ ] `chat.postMessage` — assign a `ts`, store the message, return
  `{ok: true, channel, ts}`.
- [ ] `chat.update` — require an existing `(channel, ts)`; `message_not_found`
  when absent.
- [ ] `conversations.list` — scripted channel set with cursor paging.
- [ ] `conversations.replies` / `conversations.history` — return what was posted.
- [ ] Error shapes, each returnable on demand: `missing_scope`, a bare `403`,
  `channel_not_found`, `ratelimited` with `Retry-After`, `invalid_auth`.
- [ ] **Reject what Slack rejects** — missing `channel`, missing bearer token,
  unknown endpoint. This is the property `_StubTransport` lacks and the reason the
  package exists; a fake that answers anything proves nothing.

## Tests (unit only — a fake transport needs nothing running)

- [ ] Every `SlackAdapter` method: success path plus at least one error shape.
- [ ] `fetch_history` → `ChannelBackfillRefused` driven by a real `missing_scope`
  body, and again by a `403`. Not a hand-raised exception.
- [ ] Post-then-edit asserted against the fake's **stored message**, not the
  adapter's request log.
- [ ] `conversations.list` paging across more than one cursor page.
- [ ] A malformed request answered with Slack's error, and the adapter's handling
  of it asserted.
- [ ] `ratelimited` with `Retry-After`: assert what the adapter actually does. **If
  it does nothing, that is a finding to report, not a test to write around.**

## Definition of done

- [ ] Success and error coverage for every `SlackAdapter` method.
- [ ] The fake rejects a request Slack would reject.
- [ ] Tests pass with **nothing running** — no Postgres, no Redis, no api.
- [ ] No new test depends on `_StubTransport`. If it is now redundant, say so in
  the report; do not delete WP6's tests unilaterally.

## Report explicitly

- [ ] Any adapter bug the fake found. This package exists to find them, so finding
  none is itself worth stating — and worth doubting.
- [ ] Whether `SlackAdapter` needed a source change. It should not: the
  `http_client` seam already exists. If it did, that is a testability finding.

## Out of scope

- The bridge (WP12) and bridged Slack (WP11) — a different axis: this fakes the
  *platform*, those fake the transport between core and adapter.
- Changing `SlackAdapter`.
- Replacing the live acceptance test — it stays as the only path to real Slack.
