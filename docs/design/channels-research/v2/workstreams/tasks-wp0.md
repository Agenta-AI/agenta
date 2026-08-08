# WP0 tasks — Session events

**Not channels code, but channels' work to do** — in wave 3, C4. Channels is its
only consumer and C4's exit condition ("WP5's polling is deleted, not disabled")
cannot be met without it.

It edits `core/sessions/turns/service.py`, which channels does not own: that needs
the sessions owner's review before merge. Flag it early rather than at the
checkpoint.

Nothing in the runner changes; `append_turn` and `complete_turn` already exist and
are already called by the runner at turn start/end.

## Publish plumbing

- [ ] Add `tasks/asyncio/sessions/streaming.py` with `publish_turn_started(*, project_id, session_id, turn_id)` and `publish_turn_ended(*, project_id, session_id, turn_id)`, each resolving the durable Redis engine via `get_streams_engine()` and calling `redis.xadd(name="streams:sessions", ...)`, mirroring `core/sessions/records/streaming.py`'s `publish_record`.
- [ ] Match `publish_record`'s fail-open behaviour exactly: if the durable Redis engine is not configured, log a warning ("Durable Redis not configured; event not published") and return without raising.
- [ ] Define the on-wire event shape (`SessionTurnStartedEvent` / `SessionTurnEndedEvent`, or one event type with a `kind` discriminator) carrying only `project_id`, `session_id`, `turn_id` — no turn content, no record payload.
- [ ] Write a serialize/deserialize pair for the event shape, matching `core/sessions/records/streaming.py`'s `serialize_record`/`deserialize_record` pattern (orjson, no custom envelope beyond what `StreamConsumer` expects).

## Wire the publish into the turns service

- [ ] In `core/sessions/turns/service.py`, call `publish_turn_started(project_id=project_id, session_id=turn.session_id, turn_id=turn.turn_id)` inside `append_turn`, after the DAO's `append` call succeeds, before returning.
- [ ] In `core/sessions/turns/service.py`, call `publish_turn_ended(project_id=project_id, session_id=completed.session_id, turn_id=completed.turn_id)` inside `complete_turn`, after the DAO's `complete` call succeeds and after the existing `SessionTurnNotFound` check, before returning.
- [ ] Wrap both publish calls so a raised exception is caught and logged, never propagated — `append_turn`/`complete_turn` must return their existing value regardless of publish outcome.

## Consumer scaffold

- [ ] Add a `SessionEventsWorker(StreamConsumer)` in `tasks/asyncio/sessions/`, consuming `streams:sessions` with its own consumer group, following `RecordsWorker`'s and `EventsWorker`'s constructor shape (`redis_client`, `stream_name`, `consumer_group`, `consumer_name`, batch/block/delay knobs).
- [ ] Give the worker a minimal `process_batch` that deserializes each event and logs it — enough for WP5 (or a test) to attach and observe start/end without polling. WP5 owns building its own real consumer against this stream; this scaffold only proves the stream is observable.

## Tests

- [ ] Test: `append_turn` returns the same `SessionTurn` as today when the publish call is mocked to raise.
- [ ] Test: `complete_turn` still raises `SessionTurnNotFound` under the same DAO-returns-`None` condition, independent of publish.
- [ ] Test: a turn-started event appears on `streams:sessions` carrying the correct `session_id`/`turn_id` after calling `append_turn`.
- [ ] Test: a turn-ended event appears on `streams:sessions` carrying the correct `session_id`/`turn_id` after calling `complete_turn`.
- [ ] Test: no event appears on the stream after calling `fetch_turn`, `query_turns`, `latest_turn`, `latest_turn_per_harness_kind`, or `delete_by_session_id`.
- [ ] Test: with the durable Redis engine unset, both methods complete normally (matching `publish_record`'s documented behaviour under the same condition).

## Definition of done

Both events are published, and a consumer can observe a turn's start and end
without polling (`plan.md` WP0 "Done when"). This unblocks — but does not
itself complete — C4's exit condition: **WP5's polling is deleted, not
disabled.**
