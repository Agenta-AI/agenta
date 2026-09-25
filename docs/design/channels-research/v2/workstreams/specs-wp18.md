# WP18 — Connect what wave 3 built

Wave 3 shipped five capabilities and connected one. This package connects the rest.
No new domain surface: every file it touches already exists, and every capability it
reaches already works in isolation.

The findings it closes: `F36` (four of five capabilities have no callers), `F29`
(backfill has never run), `F31` (`streams:sessions` has no consumer), and `F32` (half
of `!use:<id>` is unimplementable).

## Why this is one package and not four checkpoint edits

The call sites are the same two files, and the ordering questions interact. Commands
parse *before* `compose_input`; backfill runs *before* `open_turn`; both need a
resolved thread, which only exists inside `dispatch_event`. Splitting them would mean
three agents editing one function.

## What must end up true

### The adapter registry knows `mock`

`routers.py` builds `ChannelAdapterRegistry(adapters={"slack": SlackAdapter()})`.
Add `mock`. One line, and it is what lets everything below be driven without
credentials — which is wave 4's whole exit condition.

`MockAdapter`'s constructor takes every varying value as a parameter, so the
registered instance needs a declaration. Registering it with `capabilities.full()` is
the obvious default; say so if a different one is chosen.

### Commands are parsed and dispatched

`core/channels/commands.py` is imported by nothing. Its call site is
`dispatch_event` (`inbox.py:155`), which is the only place holding a resolved thread —
`!sessions`, `!use` and `!stop` are all thread-scoped.

**Two parses, run in sequence, neither owning the other.** `_parse_sigil`
(`service.py:859`) reads the **agent** sigil and already runs inside `resolve()`;
`parse_command` reads the **command** sigil. Different vocabularies, different
timing: the agent sigil decides which thread exists at all, so it goes first. A
message carrying both (`~triage !stop`) is unambiguous under that order.

### Backfill runs

`run_backfill` has no callers, so `space.flags.is_backfilled` is read but never set
and no space has ever been backfilled.

**The ordering tension `F29` records must be settled here.** Backfill must run before
the turn opens, but its refusal `Status` wants a trigger row that does not exist yet
at that point. Either open the trigger first, or hold the status until after
`open_turn`. Pick one and write down why.

### The outbox subscribes, and `poll_turn` is deleted

The consumer **already exists**: `ChannelsOutboxWorker.on_turn_started`
(`outbox.py:101`) and `on_turn_ended` (`:136`) are distinct methods. `poll_turn` only
*infers* which to call — re-reading the thread, re-reading `latest_turn`, branching on
`turn.end_time is None`. WP0's event carries `kind` and `turn_id` directly, so the
inference deletes and the two handlers are driven by the payload.

This is the "deleted, not disabled" exit condition WP5 was built for, and it is a
**correctness gain, not a tidy-up**: `latest_turn` can return a different turn than
the one whose tick is being handled, so the poll path can act on the wrong turn under
concurrency. An event carrying its own `turn_id` cannot.

Two facts that are easy to get wrong:

- The entrypoint is **`worker_streams.py`**, not the `worker_queues.py` that `CU-1`
  edited. This is a Redis **stream**, not a taskiq queue — a different composition
  root, with `ALL_STREAMS` currently `("records", "events", "spans")`.
- WP0's payload is **not zlib-compressed**, while the sibling `records` and `events`
  streams are. A consumer copying a sibling's `zlib.decompress` will fail.

WP0 shipped a `SessionEventsWorker` scaffold that only logs. It is a
proof-of-observability, not the production consumer — the outbox is.

### `!use:<id>` either works or is scoped down

`F32`: `create_thread` exists on the DAO interface with no service method in front of
it, and `commands.py` may not call a DAO directly. Add the service method, or scope
`!use` to validation-only and document that. Not silently half-working.

Note `!new` works only because closing the current row makes the next `resolve()`
open a fresh one. That indirection is unavailable to `!use`, which must target a
*specific* prior session.

## Files

Owned: `api/entrypoints/routers.py`, `api/entrypoints/worker_streams.py`,
`api/oss/src/tasks/asyncio/channels/{inbox,outbox}.py`, and
`api/oss/src/core/channels/service.py` **only** for the `F32` service method.

These are collision files that no package owns in the normal way — which is exactly
why this is a checkpoint package rather than four separate edits.

## Test layer

The wiring itself is asserted at **integration** level: it needs Postgres and Redis
running. A unit test cannot see whether a registry has an entry that the composition
root put there.

**`F27` is the constraint.** `entrypoints/routers.py` cannot be imported outside a
container, so nothing can currently assert this wiring at all — that is precisely why
`F1` and `F36` both survived green suites. `CU2-5` fixes it; if it has not, say so
and fall back to asserting each piece as close to the seam as possible.

## Done when

- `registry.get("mock")` resolves in the deployed app.
- A command sent through a channel changes session state.
- A space is backfilled exactly once, guarded by the flag and never by a row count,
  and a refusal leaves the flag false.
- `poll_turn` **does not exist in the tree**, and turn events drive the outbox.
- `streams:sessions` has a registered consumer group.
- Canonical run green from the repo root.

## Out of scope

- The bridge, in any form — WP19 and WP12.
- Any new capability. If something needs building rather than connecting, that is a
  finding, not this package's licence to grow.
