# WP6 tasks — Slack adapter

## Setup path (do first — everything else calls into a real Slack app)

- [ ] Draft the Slack app manifest: event subscriptions (`message.channels`,
  `message.im`, `message.mpim`, `message.groups`, `app_mention`), scopes
  (`chat:write`, `channels:history`, `groups:history`, `im:history`,
  `mpim:history`, plus whatever read scope each space kind needs), the
  interactivity request URL, and no slash command registration in-thread
  (`channels.md` §3 Slack "Reset" — slash commands cannot be invoked in
  threads, so none is registered as the reset mechanism).
- [ ] Confirm against Slack's current documentation the exact signing-secret
  verification header names and the signed base string. Record the confirmed
  values as a one-line comment at the top of `signature.py` — no verbose
  rationale, just the header names and the base-string format, since no v2
  design doc carries them.
- [ ] Write up the install flow: app creation from the manifest, workspace
  installation (OAuth), where the bot token and signing secret land in the
  vault, and which of them the adapter reads at request time versus at
  install time.

## Signature verification

- [ ] Implement `signature.py`: extract the signature and timestamp from the
  request, recompute the HMAC over the confirmed base string using the
  connection's signing secret, compare with `hmac.compare_digest`, reject on
  mismatch or on a timestamp outside the replay window.
- [ ] Test: valid signature within the window verifies.
- [ ] Test: valid signature, stale timestamp — rejected.
- [ ] Test: tampered body, original signature — rejected.
- [ ] Test: both rejection paths are indistinguishable to the caller (same
  exception, `ChannelSignatureInvalid`, no differentiating detail).

## Capability declaration

- [ ] Implement `capabilities.py` returning the `channel: "slack"` value
  block verbatim as specced in `specs-wp6.md` §Interfaces.
- [ ] Test: the declared value matches `capabilities.md`'s Slack worked
  example field for field.

## Inbound mapping

- [ ] Implement sigil tokenisation: extract `~agent` and `!command[:arg]`
  from message text that also carries Slack's own `<@U…>` mention rewriting,
  without either sigil colliding with the rewritten token.
- [ ] Implement space-kind classification: `is_im` → `private`, `is_mpim` →
  `group`, private channel → `topic` per D8 (verify against the actual event
  shape which container flag maps to which `ChannelSpaceKind`), public
  channel → `topic`.
- [ ] Implement thread-unit recognition: `thread_ts` present → thread scope;
  absent → space scope.
- [ ] Implement `external_key` composition inputs: hand the structured
  `(team, channel, thread_ts)` locator to core; do not compose the key
  string here (`entities.md` §2.2 — one function composes it, core-side).
- [ ] Implement bot-authored message marking, so the domain never treats the
  adapter's own posts as input (D23).
- [ ] Implement speaker-attribution formatting at the boundary only — no
  `sender` field emitted (D11).
- [ ] Test: each of the four container kinds classifies correctly.
- [ ] Test: a threaded message and a channel-level message resolve to
  different unit scopes.
- [ ] Test: a message from the bot's own identity is marked bot-authored.

## Outbound mapping

- [ ] Implement post (`chat.postMessage`) returning the structured receipt
  `(channel, ts)`.
- [ ] Implement edit (`chat.update`) against a stored receipt.
- [ ] Implement button rendering up to `buttons.max`; degrade to numbered
  text above it.
- [ ] Implement `max_chars` splitting across multiple posts.
- [ ] Implement approval-card rendering sourced only from the recorded tool
  call, never from model-composed text (`architecture.md` §6.3).
- [ ] Test: post-then-edit produces one message, edited in place, not two
  messages.
- [ ] Test: an approval with more options than `buttons.max` degrades to
  numbered text; one within the limit renders as buttons.
- [ ] Test: content over `max_chars` splits rather than truncates.

## Fill

- [ ] Implement backfill: `conversations.replies` call, clamped to
  `AGENTA_CHANNELS_BACKFILL_LIMIT`, clamped further to whatever the install's
  actual rate/page limit permits.
- [ ] Implement the adapter's own detection of a backfill refusal (403 or
  equivalent) versus a legitimately empty page — the two must be
  distinguishable to the caller (`channels.md` §4).
- [ ] Test: a refused fetch and an empty-but-successful fetch produce
  different outcomes to the caller.
- [ ] Test: a page request is clamped correctly against both the
  configuration default and a simulated tight rate tier.

## Contract compliance

- [ ] Register `SlackAdapter` against WP2's contract test suite and run it
  to green — every declared capability demonstrated, no silent no-op.
- [ ] Fix any divergence found by the suite in this package, not by softening
  the declaration unless the declaration was actually wrong.

## Definition of done

Restating `plan.md` WP6's exit condition verbatim: **a mention in a Slack
channel produces an answer in the same thread, and an approval resolves from
a button click without opening a browser.**
