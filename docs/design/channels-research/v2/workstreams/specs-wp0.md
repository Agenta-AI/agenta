# WP0 — Session events

**Not channels code, but channels' work to do.** It touches the sessions turns
service, so it needs the sessions owner's review — but channels is its only
consumer, and C4 cannot complete without it: the exit condition is that WP5's
polling is *deleted*. This was listed as an external dependency for three waves
while every plan for C4 required it; that framing is withdrawn. It is in wave 3.

**Nothing in the runner changes.** `SessionTurnsService.append_turn` and
`complete_turn` already exist, are already thin DAO passthroughs, and the
runner already calls both today — append at the start of a turn, complete at
the end. This package adds a publish call inside each method, server-side, in
the service layer. Every existing caller gets the event with no code of theirs
changing.

**WP5 is built against polling first, on purpose,** so this package never sits
on channels' critical path (`plan.md` "Integration checkpoints", C4). Polling
must ship for internal development and demos only — **it must not ship to
customers.** WP5's polling is deleted, not disabled, once this package lands
(`plan.md` C4 exit condition).

This package delivers exactly two publishes and nothing else: `append_turn`
publishes a turn-started event, `complete_turn` publishes a turn-ended event,
both onto the same kind of internal queue `records` and `tracing` already
publish onto. No new webhook type, no customer-facing subscription, no
delivery log.

## Files

Per `workstreams/README.md`'s ownership table, WP0 owns:

- `api/oss/src/core/sessions/turns/service.py` — **edited**. Publish only; the
  DAO calls and control flow are untouched.
- `api/oss/src/tasks/asyncio/sessions/` — **new files** inside this existing
  directory: the stream-side event dtos/serialization and a consumer-facing
  worker module, mirroring `api/oss/src/core/sessions/records/streaming.py`
  (the `publish_record` / `xadd(name="streams:records", ...)` pattern) and
  `api/oss/src/tasks/asyncio/sessions/records_worker.py` (the `StreamConsumer`
  subclass pattern already used by `RecordsWorker` and `EventsWorker`).

WP0 does **not** touch `api/entrypoints/routers.py`, any channels path, or
anything under `core/channels/`. It has no collision with any other package.

## Interfaces

```python
# core/sessions/turns/service.py — SIGNATURES UNCHANGED, bodies gain a publish

class SessionTurnsService:
    async def append_turn(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        #
        turn: SessionTurnCreate,
    ) -> SessionTurn:
        """Existing DAO passthrough. Adds: publish turn-started after append,
        carrying session_id and turn_id."""
        ...

    async def complete_turn(
        self,
        *,
        project_id: UUID,
        #
        turn: SessionTurnComplete,
    ) -> SessionTurn:
        """Existing DAO passthrough. Adds: publish turn-ended after complete,
        same payload shape (session_id, turn_id)."""
        ...
```

```python
# tasks/asyncio/sessions/streaming.py (new) — mirrors records/streaming.py

async def publish_turn_started(*, project_id: UUID, session_id: str, turn_id: str) -> None: ...
async def publish_turn_ended(*, project_id: UUID, session_id: str, turn_id: str) -> None: ...
```

Both publish functions follow `publish_record`'s exact shape: resolve the
durable Redis engine via `get_streams_engine()`, `xadd` onto a dedicated stream
(distinct from `streams:records` and `streams:events` — a new
`streams:sessions` or equivalent name is this package's to choose), log and
no-op if Redis is not configured (matching `publish_record`'s
"Durable Redis not configured; event not published" behaviour) rather than
raising and failing the turn.

The consumer side (a `SessionEventsWorker(StreamConsumer)` alongside
`RecordsWorker` and `EventsWorker` in `tasks/asyncio/sessions/`) is WP0's to
provide as the thing WP5 subscribes to — WP5 owns its own consumption, WP0
owns only that the events exist and are observable.

## Contracts this package must honour

- **Publish is additive, not a precondition.** `append_turn` and
  `complete_turn` must return exactly what they return today even if the
  publish fails or Redis is unavailable — a turn must never fail because an
  event could not be published. Matches `publish_record`'s own
  fail-open posture.
- **Two events, not one** (architecture.md §6.1, D22). Turn-started carries
  `session_id` and `turn_id` so a surface can post a working indicator;
  turn-ended carries the same pair so a consumer knows which turn's records to
  fold. Neither event carries turn content — a consumer queries records by
  `turn_id` itself (architecture.md §6.1 step 3).
- **This rides an internal queue, of the kind `records` and `tracing`
  already use — never the webhook subsystem** (architecture.md §6.1, D22).
  Webhooks carry subscriptions, signing, retries and delivery logs built for
  customer URLs; an in-process consumer needs none of that. Riding the
  internal queue does not imply these ever become customer-facing webhook
  event types — that is a separate decision, out of scope here.
- **No marker or flag distinguishing "this turn came from a channel."**
  (architecture.md §6.1.) The event names the session; the consumer (WP5)
  decides for itself whether it holds a thread for that session. This
  package must not add a channels-aware branch anywhere in the turns service.
- **The runner is not touched.** `append_turn` is already called at turn
  start and `complete_turn` already called at turn end by the runner today.
  This package changes nothing about when or how those calls happen — only
  what the service does after the DAO call returns.
- **Polling must not ship to customers.** This is not a testable code
  contract so much as a release gate: WP5's polling fallback exists so this
  package does not block the critical path, but it is a temporary,
  internal-only path, and this package's completion is what retires it.

## Tests

- `append_turn` still returns the same `SessionTurn` it returns today, with
  Redis publish mocked to raise — the turn creation succeeds regardless.
- `complete_turn` still raises `SessionTurnNotFound` under the same condition
  it does today (DAO returns `None`), independent of publish success.
- A turn-started event is observable on the stream carrying `session_id` and
  `turn_id`, matching the turn just appended.
- A turn-ended event is observable on the stream carrying the same
  `session_id` and `turn_id`, matching the turn just completed.
- No event is published for any other DAO call on `SessionTurnsService`
  (`fetch_turn`, `query_turns`, `latest_turn`, `latest_turn_per_harness_kind`,
  `delete_by_session_id`).
- With the durable Redis engine unset, both methods log and continue rather
  than raising (mirrors `publish_record`'s existing behaviour under the same
  condition).
- A consumer attached to the stream can observe a turn's start and end without
  polling `session_records` or `session_turns` at all.

## Out of scope

- Consuming these events to render anything — that is WP5's outbox worker,
  which builds its own consumer and its own `fold()` call over the turn's
  records (`architecture.md` §6.1).
- Deleting WP5's polling code — WP5 owns that deletion, gated on this package
  landing (`plan.md` C4).
- Any channels table, route, or domain object. WP0 touches only the sessions
  turns service and the sessions task-queue directory.
- Any change to the runner's ACP calls, timing, or the caller-supplied
  `turnId` convention (`architecture.md` §5 step 6) — those are unaffected and
  unowned here.
- Making these events customer-facing webhook types — a separate decision,
  not this package's to make (architecture.md §6.1).

## Checkpoint

WP0 is **not** an integration checkpoint gate — `plan.md`'s "What is not a
checkpoint" section names it explicitly alongside WP14. It merges whenever it
merges, on its own review, with no other package waiting on it to reach any
of C0–C3 or C5.

It is needed **inside C4** ("It is pleasant") to retire WP5's polling
fallback. C4's exit condition, verbatim from `plan.md`:

> Each command works in a real space; messages sent between mentions arrive as
> context on the next trigger; the flag — never a count of `PULLED` rows —
> guards the one-time fetch, and a refusal leaves it false. WP5's polling is
> deleted, not disabled.

WP0's own done condition, verbatim from `plan.md`:

> Both events are published, and a consumer can observe a turn's start and end
> without polling.
