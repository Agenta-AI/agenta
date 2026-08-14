# WP18 tasks — connect what wave 3 built

Read `specs-wp18.md`, then `findings.md` for `F36`, `F29`, `F31`, `F32`, then
`c1-merge-notes.md`.

**Nothing here builds a capability.** Every function you call already exists and
already passes its own tests. If something needs writing rather than wiring, that is
a finding — report it rather than growing this package.

## Register the mock adapter

- [ ] Add `mock` to `channels_adapter_registry` in `routers.py` beside `slack`.
- [ ] `MockAdapter` takes its declaration as a constructor parameter; pick one
  (`capabilities.full()` is the obvious default) and say which in the report.
- [ ] Verify `registry.get("mock")` resolves **in the deployed app**, not only in a
  test that builds its own registry.

## Wire commands

- [ ] Call `parse_command` / `dispatch_command` from `dispatch_event`
  (`inbox.py:155`) — the only place holding a resolved thread.
- [ ] Order: the **agent** sigil parse (`_parse_sigil`, inside `resolve()`) runs
  first, because it decides which thread exists; the **command** sigil parse runs
  after. Do not merge the two functions.
- [ ] Assert a message carrying both (`~triage !stop`) behaves as that order implies.
- [ ] An unknown or undeclared command must not become a turn, and must not silently
  vanish either — check what `dispatch_command` already does and assert it.

## Wire backfill

- [ ] Call `run_backfill` from `dispatch_event` after `resolve()` succeeds and before
  `compose_input` / `open_turn`.
- [ ] **Settle `F29`'s ordering tension and write down why.** Backfill must run before
  the turn opens, but its refusal `Status` wants a trigger row that does not exist
  yet. Either open the trigger first, or hold the status until after `open_turn`.
- [ ] The guard is `space.flags.is_backfilled`, **never** a count of `PULLED` rows.
- [ ] A refusal leaves the flag false, so a later attempt can retry.
- [ ] An empty-but-answered fetch still sets the flag.

## Subscribe the outbox and delete `poll_turn`

- [ ] Add `sessions` to `ALL_STREAMS` in **`worker_streams.py`** (not
  `worker_queues.py` — this is a Redis stream, not a taskiq queue) and build its
  consumer, following the three `StreamConsumer` subclasses already there.
- [ ] The consumer routes `turn_started` → `on_turn_started` and `turn_ended` →
  `on_turn_ended` from the event's own `kind`, passing its `turn_id`.
- [ ] **WP0's payload is not zlib-compressed** while the sibling `records`/`events`
  streams are. A copied `zlib.decompress` will fail.
- [ ] **Delete `poll_turn` and `channels.outbox.poll`.** Deleted, not disabled, not
  left unreferenced — the exit condition is that it is gone from the tree.
- [ ] The `channels-outbox` queue and its broker may now be dead too. Check before
  removing: something else may enqueue onto it.
- [ ] WP0's `SessionEventsWorker` only logs. Decide whether it stays as an
  observability scaffold or is replaced by the outbox consumer, and say which.

## `!use:<id>`

- [ ] `F32`: `create_thread` is on the DAO with no service method in front of it, and
  `commands.py` may not call a DAO directly. Either add the service method to
  `core/channels/service.py`, or scope `!use` to validation-only.
- [ ] Whichever you pick, it must not be silently half-working. State the choice.

## Tests

- [ ] The wiring assertions are **integration** — they need Postgres and Redis. A unit
  test cannot see what the composition root registered.
- [ ] Command parsing and dispatch logic stay **unit** where they already are.
- [ ] If `CU2-5` fixed `F27`, add a test that imports the composition root and asserts
  the registry and the stream set. **That test is the guard against a third recurrence
  of this exact defect** — F1 at wave 2, F36 at wave 3.
- [ ] If `F27` is not fixed, say so and assert each piece as close to the seam as you
  can reach.

## Definition of done

- [ ] `registry.get("mock")` resolves in the deployed app.
- [ ] A command sent through a channel changes session state.
- [ ] A space backfills exactly once; a refusal leaves the flag false.
- [ ] `poll_turn` does not exist in the tree; turn events drive the outbox.
- [ ] `streams:sessions` has a registered consumer group.
- [ ] Canonical run green **from the repo root**:
  `load-env hosting/docker-compose/ee/.env.ee.dev` then
  `py-run-tests --logs --api -uia`.

## Report explicitly

- [ ] **Whether a message actually travelled the path, or whether it is only wired.**
  "Wired" is not "works". Four disconnections survived a green suite at wave 2 and
  four more at wave 3; the honest answer here is worth more than a confident one.
- [ ] The `F29` ordering decision and its reason.
- [ ] What you did about `!use`, and about WP0's scaffold worker.
- [ ] Every interface you asserted about a collaborator you faked, even where tests
  pass.

## Out of scope

- The bridge in any form (WP19, WP12).
- New capabilities. Connecting only.
- `F10`'s catalog path — deferred by decision; it is in both regenerated clients now.
