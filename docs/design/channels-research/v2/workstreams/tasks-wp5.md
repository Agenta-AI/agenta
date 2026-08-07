# WP5 tasks — Outbox worker

## Setup

- [ ] Branch from the seed commit (C0). Confirm `ChannelsService`,
      `ChannelOutboxEvent*` DTOs, `ChannelDeliveryState` import cleanly.
- [ ] Add `tasks/asyncio/channels/outbox.py` worker skeleton and
      `core/channels/render/` module skeleton (no logic yet).

## Polling loop (interim, deleted at WP0)

- [ ] Implement a poll loop over turns/records queries standing in for
      turn-started/turn-ended, isolated behind a single call boundary so the
      later swap to real events touches one seam.
- [ ] Mark the poll loop with a comment naming WP0 as the removal trigger —
      not a flag, a follow-up deletion.

## Turn started

- [ ] On turn-started (polled), check whether a `channel_threads` row exists
      for the session (one indexed lookup) — skip if not a channel turn.
- [ ] Call `enqueue_output` to create the outbox row (`state=PENDING`, item 0).
- [ ] Render an indicator per the capability declaration and post it.
- [ ] Call `deliver`/`transition_outbox_event` to set `state=SENT` and store
      `data.external_locator` from the receipt.
- [ ] Test: turn-started produces exactly one `PENDING`→`SENT` row with a
      receipt.

## Turn ended

- [ ] On turn-ended (polled), query the turn's records by `turn_id`.
- [ ] Call `fold(events, stop_reason=...)`; assert the shape consumed is
      exactly `{messages, stop_reason, pending_interaction}`.
- [ ] Find the existing outbox row via `fetch_outbox_event_by_key` using the
      derived `key` (not the row id).
- [ ] Render the fold result per capability (buttons vs numbered text, split
      at `max_chars`, card from `pending_interaction`'s recorded tool call).
- [ ] Edit the platform message using the stored `external_locator`; compute
      a fresh `idempotency_key` from `key` + current `updated_at` before
      sending.
- [ ] Call `transition_outbox_event` to update `data.processed` and state,
      keeping the same row.
- [ ] Test: turn-ended edits the same row created at turn-started (assert
      `id` unchanged, one row).

## Degradation rendering

- [ ] Implement buttons-supported path: render approval as buttons up to
      `rendering.buttons.max`.
- [ ] Implement numbered-text fallback: buttons unsupported or option count
      exceeds `max`.
- [ ] Implement `max_chars` split: multiple posts as distinct items
      (0, 1, ...), each with its own `key` and independently editable.
- [ ] Implement `message_update: false` fallback: post a new message instead
      of editing.
- [ ] Test each degradation path against a fake capability declaration
      toggling the relevant field.

## Hard exclusions

- [ ] Test: no thought/usage/internal-reasoning event from a fixture turn
      ever appears in rendered output.
- [ ] Test: no raw ACP/record payload string appears verbatim in rendered
      output — only the fixed render vocabulary.

## Idempotency and redelivery

- [ ] Test: redelivering the same turn-ended signal does not create a second
      row (`fetch_outbox_event_by_key` returns the existing row; worker
      edits, does not insert).
- [ ] Test: idempotency key for the initial post differs from the key for
      the edit; a retry of either individual send re-derives its own
      unchanged key.

## Wiring

- [ ] Prepare the `api/entrypoints/routers.py` diff block for this worker's
      registration, held for the C2 serialised merge (merged as one edit
      together with WP4's).

## Definition of done

A completed turn appears in the target space, an approval renders as a card
built from the recorded tool call, and a redelivery does not double-post.
Feeds C2 against polling; feeds C4's exit condition once WP0 lands and the
polling code is deleted (not disabled).
