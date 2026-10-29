# WP4 — Inbox worker

Consumes `channel_inbox_events`, routes and resolves the one addressed agent (or
none), reads the backlog under the resolved policy, mints a `turn_id`, invokes
detached, and records the trigger row's fate. Treats every trigger as one
message — backfill, forwardfill mechanics and command parsing are other packages'
files, called from inside this one.

## Files

New:

- `api/oss/src/tasks/asyncio/channels/inbox.py` — the chain itself, entity-agnostic
  and self-contained, driven directly by tests without a broker.
- `api/oss/src/tasks/taskiq/channels/inbox_worker.py` — the `@broker.task` entry
  point that calls it. Thin by construction, following `triggers`.

## The chain

Ordered steps, from `architecture.md` §5:

1. **Receive** already happened (WP3): a `channel_inbox_events` row exists,
   `space_id` is null.
2. **Route.** Resolve the space by connection + external key. No
   `channel_spaces` row means default-deny: mark the event skipped, stop.
3. **Was anyone addressed?** Parse the sigil for an explicit slug; else the
   space's default grant; else the connection's default agent. At most one
   agent is addressed by one message.
   - If nobody was addressed: **stop here.** The event is already in the log.
     No per-agent row, no session touched, no turn (D9).
4. **Resolve the one agent addressed:**
   - 4a. Grants — if the agent has any `channel_grants` rows and this space is
     not among them, refuse silently and identically across causes (D17).
   - 4b. Policy — intersect agent, space, grant policy against the channel
     defaults and the capability declaration; pure function, not stored.
   - 4c. Thread — get-or-create by `(space, external key, agent)`. Current
     session is the thread's most recent row (D12).
5. **Read the backlog.** Fetch this thread's latest trigger row for the
   offset (its `event_id`). Select the space's events after it, in
   `(origin, id)` order. No trigger row yet reads as "from the beginning."
   Backfill (if the space's flag is unset) happens before this read, guarded
   by the space, not the thread — WP10 owns the fetch itself; this worker
   calls into it. Where `forwardfill` is off, the range read is skipped and
   the turn takes the addressing event alone.
6. **Invoke, detached.** Mint a `turn_id`. `open_turn` writes the trigger row
   at `STARTED`, carrying that `turn_id`, before the agent runs. Invoke once
   with the whole range as new messages, passing the minted `turn_id`. The
   call returns as soon as the run has started. `settle_turn` records the
   fate (`SETTLED` / `FAILED`) once it is known; on a refused overlapping
   turn, retry the invoke and do nothing else.

## Interfaces

Calls into `ChannelsService` (`entities.md` §8):

```python
async def resolve(self, *, project_id, connection_id, event) -> Optional[Resolution]: ...
async def compose_input(self, *, project_id, resolution) -> ChannelTurnInput: ...
async def open_turn(self, *, project_id, resolution, turn_id) -> ChannelInboxTrigger: ...
async def settle_turn(self, *, project_id, trigger_id, state, status=None) -> None: ...
```

`resolve` internally calls the DAO (`entities.md` §7): `fetch_space_by_key`,
`fetch_agent_by_slug`, `fetch_default_grant`, `fetch_default_agent`,
`count_grants`, `fetch_grant`, `fetch_current_thread`, `create_thread`. This
worker calls only the four service methods above — routing detail stays
inside the service.

`compose_input` internally calls `fetch_latest_trigger` and
`query_events_since`, and triggers WP10's backfill fetch when
`flags.is_backfilled` is false and the resolved policy allows it.

Invoke call: pass the minted `turn_id` as the caller-supplied `turnId` on the
run request — the runner accepts a caller-supplied `turnId` and only mints one
via `randomUUID()` when it is omitted (`services/runner/src/server.ts:200-202`,
`:376`). Minting it here means the worker never has to learn the id after the
fact.

## Contracts this package must honour

- **Default-deny on unresolved space.** No `channel_spaces` row means the
  agent may not answer there; mark skipped and stop.
- **If nobody was addressed, STOP** — write nothing beyond the log row already
  written by WP3. No per-agent row, no session touched, no turn (D9).
- **`open_turn` writes the trigger row at `STARTED` before the agent runs.**
  Invoke is detached (D14/D22): nothing holds a transaction across it, so the
  row exists before the run starts, not after.
- **`settle_turn` records the fate whenever it becomes known** — `SETTLED` on
  completion, `FAILED` on error, `REFUSED` when grants/agent resolution
  refused. Nothing holds the worker open waiting for it.
- **Retry on a refused overlapping turn, and nothing else.** Concretely, the
  session raises `SessionTurnInUse` when it is already alive, surfaced as a 409;
  catch that and retry with backoff. **Do not reach for the `force` path** that
  preempts the running turn — interrupting the first agent mid-answer is a worse
  failure than waiting. No coalescing, no
  steer-or-queue — those belong to WP14 (`plan.md` WP4, WP14; `architecture.md`
  §7). Building them here is what would stop that work happening. Adequate
  because only triggers contend for a turn (D9) and triggers are far rarer
  than messages.
- **Two agents in one thread are independent** (D9, D26). Mentioning a second
  agent does not disturb the first's running turn — each has its own thread
  row and its own offset; resolving one never touches the other.
- **The `turn_id` is minted by this worker, never learned after the fact.**

## Tests

- A signed, routed event addressing a configured agent produces a running
  turn on the right session, with the right `turn_id` passed to invoke.
- An event in an unconfigured space (`fetch_space_by_key` returns none) is
  marked skipped; no thread, no trigger row, no invoke.
- An unaddressed event (no sigil, no default grant, no default agent) writes
  nothing beyond its already-existing log row.
- Two agents mentioned in sequence in one thread: mentioning the second does
  not touch the first's `channel_inbox_triggers` row or its session.
- A mention arriving while that agent's own turn is running is retried on
  refusal until accepted; never dropped, never duplicated (assert exactly one
  trigger row for that addressing).
- An agent with grants rows, addressed in a space not among them, refuses
  silently — same message as an unknown agent (D17), no trigger row.
- `open_turn` writes `STARTED` before invoke is called (assert ordering via a
  fake invoke that raises before returning).

## Out of scope

- Backfill fetch mechanics and the forwardfill drain logic itself (WP10) —
  this worker calls into them but does not implement the fetch or the offset
  math beyond what `compose_input` already exposes.
- Command parsing (WP9) — every trigger is treated as a single message.
- Coalescing or steer-or-queue on turn conflict (WP14).
- Rendering or posting any output (WP5).

## Checkpoint

WP4 feeds **C2 — A mention becomes a turn**. Exit condition, verbatim from
`plan.md`:

> **Exit condition:** end to end with a fake adapter — mention in, answer out,
> in the right thread, attributed to the linked user. An unaddressed message
> writes its log row and nothing else. Two agents in one thread run
> independently. A mention during a running turn is retried until accepted,
> never dropped, never duplicated.
