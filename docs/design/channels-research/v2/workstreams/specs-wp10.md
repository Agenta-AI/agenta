# WP10 — Fill

Backfill and forwardfill (D21), in the log-and-offsets shape (`entities.md`
§2.4): the range read plus the one-time fetch. No queue, nothing claimed,
nothing marked. Split from WP4 because WP4 is complete and useful without it.

## Files

New:
- `core/channels/fill.py` — backfill fetch + the forwardfill range-select
  helper, called from WP4's `compose_input` path.

## Interfaces

DAO methods this package calls (`entities.md` §7):

```python
async def fetch_latest_trigger(self, *, project_id, thread_id) -> Optional[ChannelInboxTrigger]: ...
async def query_events_since(self, *, project_id, space_id, after_event_id, limit=None) -> List[ChannelInboxEvent]: ...
async def record_inbox_events(self, *, project_id, events: List[ChannelInboxEventCreate]) -> List[ChannelInboxEvent]: ...
async def mark_space_backfilled(self, *, project_id, space_id) -> Optional[ChannelSpace]: ...
```

Reads the capability declaration's fill block for whether the platform
supports the operation at all (`capabilities.md` §3 fill):

```json
"fill": {
  "backfill":    { "supported": true, "requires_permission": "channels:history" },
  "forwardfill": { "supported": true, "requires_permission": "channels:history" }
}
```

Reads `AGENTA_CHANNELS_BACKFILL_LIMIT` (default 50) to cap the one-time
fetch (`capabilities.md` §3 fill) — configuration, not a capability field.

Writes the attempt outcome via `transition_inbox_trigger`
(`entities.md` §7) using `Status` on the trigger row whose turn tried it —
this package does not own that method (WP1 does) but is the caller that
populates `Status` with the backfill attempt's outcome.

## Contracts this package must honour

- **The guard is the flag on the space (`flags.is_backfilled`), never a count
  of `PULLED` rows** (D30). A successful fetch can legitimately return
  nothing — a brand-new thread whose first message is the mention has no
  history — and a row count cannot distinguish that from never having
  fetched. Counting would refetch forever on a tight-cap install.
- **A refusal must leave the flag false** (D10, D30). The flag is set only
  after a fetch the platform actually answered, including one that answered
  with nothing. If the platform refuses (permission denied), do not call
  `mark_space_backfilled`; record the refusal on the trigger row's `Status`
  instead. A permission granted tomorrow must take effect without anyone
  re-running setup.
- **Backfill is per space, not per thread.** A Slack thread has one history:
  the first agent addressed there fetches it and appends with
  `origin = PULLED`; every later agent — same space, different agent —
  reads the same rows via the normal range read, never refetching.
- **Forwardfill reads the thread's latest trigger row for the offset, then
  selects the space's events after it ordered by `(origin, id)`, and invokes
  once with all of them.** This is `fetch_latest_trigger` +
  `query_events_since`, not a per-message loop — WP4 invokes once per
  trigger with the whole returned range as new messages.
- **Turning the policy off skips the READ, not the WRITE.** The log
  accumulates regardless of `policy.forwardfill`; the policy decides only
  whether `compose_input` includes the range or the addressing event alone.
  Enabling forwardfill later starts working immediately over history already
  present — nothing needs to be backfilled retroactively for this switch
  alone.
- **A platform declaring `fill.backfill.supported: false` (or
  `forwardfill.supported: false`) is never asked** — no fetch attempt, no
  trigger-row `Status` write for it, ever. Telegram's absence of a history
  API is not a permission question.
- **Two workers racing the same addressing collide on
  `(thread_id, event_id)` and one loses** (`record_inbox_trigger`'s
  `ON CONFLICT DO NOTHING`) — nothing in this package claims or marks a row
  to prevent the race; the unique constraint is the whole mechanism.

## Tests

- A space's first-ever addressing, capability declares backfill supported:
  fetch runs, rows are appended with `origin = PULLED`, `flags.is_backfilled`
  becomes true, and the range read (§2.4 SQL shape) picks up those rows ahead
  of pushed ones.
- A second agent addressed in the same space afterward: no second fetch;
  reads the same `PULLED` rows the first agent's fetch wrote.
- A backfill attempt that succeeds and returns zero rows still sets the flag
  true (fetched-and-empty is distinguished from never-fetched).
- A backfill attempt that is refused (simulated permission denial) leaves
  the flag false, and the next addressing in that space retries the fetch.
- A platform capability declaring `backfill.supported: false`: no fetch is
  ever attempted, regardless of the space flag's value.
- Forwardfill on: a trigger's `compose_input` returns all events since the
  last trigger's `event_id`, ordered `(origin, id)`, invoked as one turn.
- Forwardfill off: `compose_input` returns only the addressing event; the log
  still accumulates the skipped messages (query the log directly to confirm
  rows exist even though they were not delivered to a turn).
- Toggling forwardfill on later (policy edit) immediately surfaces
  previously-accumulated log rows on the next trigger, no backfill re-run
  needed.
- Two concurrent workers resolving the same addressing: exactly one
  `record_inbox_trigger` succeeds, the other observes `None` and does not
  invoke.
- `AGENTA_CHANNELS_BACKFILL_LIMIT` caps the fetch request size; a platform
  returning fewer than the cap is a normal outcome, not an error.

## Out of scope

- Command parsing (WP9).
- The invoke call itself and trigger-row `STARTED`/`SETTLED` transitions
  outside the backfill attempt's own `Status` (WP4 owns the invoke; this
  package only supplies the range and the fetch).
- Any per-adapter mapping of what "the platform's history API" actually
  calls (WP6, WP12) — this package calls the adapter port's fetch operation
  through the interface, not a specific platform's SDK.

## Checkpoint

WP10 feeds **C4 — It is pleasant**. Exit condition, verbatim from `plan.md`:

> **Exit condition:** each command works in a real space; messages sent
> between mentions arrive as context on the next trigger; the flag — never a
> count of `PULLED` rows — guards the one-time fetch, and a refusal leaves it
> false. WP5's polling is deleted, not disabled.

WP10's own done-when, also from `plan.md`: "messages sent between mentions
arrive as context on the next trigger, and a platform declaring no history
support is never asked for it."
