# WP5 — Outbox worker

Consumes turn lifecycle (polling until WP0 lands), folds a turn's records with
the same `fold()` the attached batch path uses, renders per the channel's
capability declaration, posts or edits, and records the receipt. One outbox
row lives for its whole life; an edit finds it by `key` and updates in place.

## Files

New:

- `api/oss/src/tasks/asyncio/channels/outbox.py` — fold, render, post, record the
  receipt. Entity-agnostic and self-contained, driven directly by tests without a
  broker.
- `api/oss/src/tasks/taskiq/channels/outbox_worker.py` — the `@broker.task` entry
  point that calls it. Thin by construction, following `triggers`.
- `api/oss/src/core/channels/render/` — the rendering module (event vocabulary →
  per-capability output).

## The chain

Ordered steps, from `architecture.md` §6:

1. **Turn started.** Post an indicator message. Store the platform's receipt
   in `data.external_locator` on the outbox row.
2. **Turn ended**, carrying `session_id` and `turn_id`. The worker checks
   whether it holds a thread for that session (one indexed lookup) — this is
   how it tells a channel-originated turn from any other, since no marker is
   threaded through invoke.
3. The worker **queries that turn's records** by `turn_id` — they carry
   `turn_id`, so "this turn's events in order" is a direct read.
4. It calls **the same `fold()`** the attached batch path calls
   (`sdk/agents/fold.py`, called as `fold(events, stop_reason=result.stop_reason)`
   at `sdks/python/agenta/sdk/agents/fold.py` / `handler.py:399` inside
   `agent_batch`). `fold()` returns
   `{messages, stop_reason, pending_interaction}`; `pending_interaction` is
   already populated when `stop_reason == "paused"`.
5. The result is either the answer or what the agent is paused on. The worker
   **edits the indicator into it** — same row, found by its stored `key`.

Until WP0 ships turn-started/turn-ended events, this worker polls the records
and turns queries with the same fold — workable, wasteful, deletable the
moment the events exist (§6.1).

## Interfaces

Calls into `ChannelsService` (`entities.md` §8):

```python
async def enqueue_output(self, *, project_id, thread_id, turn_id, items) -> List[ChannelOutboxEvent]: ...
async def deliver(self, *, project_id, event_id) -> ChannelOutboxEvent: ...
```

DAO methods reached through the service for the edit path (`entities.md` §7):

```python
async def fetch_outbox_event_by_key(self, *, project_id, key: UUID) -> Optional[ChannelOutboxEvent]: ...
async def transition_outbox_event(self, *, project_id, event_id, state, status=None, data=None) -> Optional[ChannelOutboxEvent]: ...
async def claim_outbox_events(self, *, project_id=None, limit=100) -> List[ChannelOutboxEvent]: ...
```

The runtime call this package does not own but depends on:

```python
def fold(events: Iterable[FoldedEvent], *, stop_reason: Optional[str] = None) -> Dict[str, Any]
# returns {"messages": ..., "stop_reason": ..., "pending_interaction": ...}
```

Verified at `sdks/python/agenta/sdk/agents/fold.py`. The batch call site is
`handler.py`'s `agent_batch`: `fold(events, stop_reason=result.stop_reason)` —
**that exact call is what WP5 makes**, so approvals and answers come out of one
function with no second path.

## Contracts this package must honour

- **One row for its whole life** (D28). The indicator is edited in place,
  found by its stored `key` — never by re-deriving the row id, which is an
  arbitrary `uuid7` precisely so it survives the edit.
- **The idempotency key is derived, never stored.**
  `idempotency_key = uuid5(_CHANNELS, f"{key}:{updated_at.isoformat()}")`,
  computed at send time from `key` and the row's current `updated_at` (D27).
  A retry of one send re-derives the same token (the row is unchanged); an
  edit gets a new token because the edit is what moved `updated_at`.
- **Rendering degrades per the capability declaration**
  (`capabilities.md` §3 rendering block): buttons where `rendering.buttons.supported`
  is true, numbered text where it is false or the option count exceeds
  `rendering.buttons.max`; a message longer than `rendering.text.max_chars`
  is split; a new message where `rendering.message_update` is false (editing
  unavailable).
- **Two hard exclusions.** Model reasoning never leaves as channel content —
  only messages `fold()` surfaces, never thoughts/usage/internal reasoning.
  No raw pass-through of runtime payloads — the render module maps to a fixed
  vocabulary, never forwards an ACP or record payload verbatim.
- **Built against polling; the polling is deleted, not disabled, when WP0
  lands.** No feature flag straddling both paths indefinitely — WP0's arrival
  is a follow-up commit removing the poll loop, not a config toggle.

## Tests

- Turn-started produces exactly one outbox row (`state=CREATED`), posts an
  indicator, and records the receipt into `data.external_locator` on
  `state=SENT`.
- Turn-ended for the same turn edits that same row (assert one row, `id`
  unchanged) rather than inserting a second.
- A redelivery of the same turn-ended signal (re-run of the polling pass or a
  duplicate event) does not double-post: `fetch_outbox_event_by_key` finds
  the existing row and the worker edits, it does not create.
- `pending_interaction` from a paused turn renders as a card built from the
  recorded tool call (`architecture.md` §6.3), never from model-composed
  text.
- A response exceeding `max_chars` is split into multiple posts/rows (items
  0, 1, ... — each independently editable per D27/D28's "different thing vs
  same thing later" test).
- Assert no test fixture ever contains a raw thought/usage event or a raw
  ACP payload string in what gets posted.
- Idempotency key differs between the initial post and the edit for the same
  row, and is stable across a retry of either individual send.

## Out of scope

- Turn-started/turn-ended as real events (WP0) — this package polls until
  they exist.
- Backfill/forwardfill (WP10) — outbound only.
- Command parsing (WP9).
- The Slack-specific mapping of buttons/text/threads (WP6) — this package
  renders to the capability-declared vocabulary; the adapter maps that
  vocabulary to platform calls.

## Checkpoint

WP5 feeds **C2 — A mention becomes a turn** (against polling; WP0 is needed
for its final form, gating C4 instead). Exit condition, verbatim from
`plan.md`:

> **Exit condition:** end to end with a fake adapter — mention in, answer out,
> in the right thread, attributed to the linked user. An unaddressed message
> writes its log row and nothing else. Two agents in one thread run
> independently. A mention during a running turn is retried until accepted,
> never dropped, never duplicated.

WP5's own done-when, also from `plan.md`: "a completed turn appears in the
target space, an approval renders as a card built from the recorded tool
call, and a redelivery does not double-post." Its final form (WP0-backed,
polling deleted) is required for **C4**'s exit condition: "WP5's polling is
deleted, not disabled."
