# WP10 tasks — Fill

## Setup

- [ ] Branch from WP4 (depends on it per `plan.md`). Confirm
      `fetch_latest_trigger`, `query_events_since`, `record_inbox_events`,
      `mark_space_backfilled` are reachable through the DAO interface.
- [ ] Add `core/channels/fill.py` skeleton: a backfill-fetch function and a
      forwardfill-range function, no logic yet.

## Forwardfill

- [ ] Implement the range read: `fetch_latest_trigger` for the offset, then
      `query_events_since` ordered `(origin, id)`. No trigger row yet returns
      the whole log.
- [ ] Wire into WP4's `compose_input` call path so the range becomes the
      turn's input when `policy.forwardfill` is true.
- [ ] Implement the off-path: return only the addressing event when
      `policy.forwardfill` is false. Confirm no write is skipped — only the
      read.
- [ ] Test: toggling forwardfill on after messages have accumulated
      immediately surfaces them on the next trigger, no backfill re-run.

## Backfill

- [ ] Implement the guard check: read `channel_spaces.flags.is_backfilled`
      before attempting anything.
- [ ] Implement the capability gate: skip entirely if
      `fill.backfill.supported` is false — no attempt, no `Status` write.
- [ ] Implement the fetch call through the adapter port, capped by
      `AGENTA_CHANNELS_BACKFILL_LIMIT` (default 50).
- [ ] On a successful fetch (including an empty result): call
      `record_inbox_events` with `origin = PULLED`, then
      `mark_space_backfilled`. Test: flag becomes true even when zero rows
      were returned.
- [ ] On a refused fetch: do NOT call `mark_space_backfilled`. Write the
      refusal onto the trigger row's `Status` via the caller
      (`transition_inbox_trigger`, owned by WP1 — this package supplies the
      `Status` payload). Test: flag stays false; next addressing retries.
- [ ] Test: a second agent addressed in the same space after a successful
      backfill reads the same `PULLED` rows — no second fetch attempt
      (assert the fetch mock is called exactly once across both agents).

## Concurrency

- [ ] Test: two workers racing the same addressing — one wins
      `record_inbox_trigger`, the other observes `None` and does not invoke
      or re-run backfill.

## Ordering

- [ ] Test: `query_events_since` returns `PULLED` rows before `PUSHED` rows
      regardless of insertion wall-clock time, per the `(origin, id)` sort.

## Definition of done

Messages sent between mentions arrive as context on the next trigger, and a
platform declaring no history support is never asked for it.
