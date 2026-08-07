# WP4 tasks — Inbox worker

## Setup

- [x] Branch from C1 (`channels-c1`, per `launch.md` — wave 2 branches from
      the merged checkpoint, not from a package branch). Confirmed
      `core/channels/interfaces.py`, `dtos.py`, `types.py` import cleanly and
      `ChannelsService` is reachable via DI (constructed directly in tests
      with a fake DAO, fake adapter registry, fake connections service).
- [x] Add `tasks/asyncio/channels/inbox.py`: `InboxDispatcher`, constructor
      taking `channels_service: ChannelsService`, `workflows_service:
      Optional[WorkflowsService]`, `invoke_fn: Optional[Callable]` (tests
      inject a fake here; the default closes over `workflows_service`).

## Routing

- [x] Implement step 2 (route): call `channels_service.resolve(...)`; `None`
      means nothing to do beyond the log row WP3 already wrote — the worker
      returns without writing anything. Tested: unconfigured space produces
      no `compose_input`, no `open_turn`, no invoke call.
- [x] Implemented step 3/4 **inside `ChannelsService.resolve`
      (`core/channels/service.py`)** — see "Ownership note" below: WP1's own
      ledger (`tasks-wp1.md`) left `resolve`/`compose_input`/`open_turn`/
      `settle_turn` raising `NotImplementedError` explicitly for "the owning
      package" to fill in, naming WP4 for these four. Filled in: default-deny
      on no space, the sigil→default-grant→default-agent chain
      (`_addressed_agent`), grant refusal (D17), policy resolution via the
      existing `resolve_policy`, and thread get-or-create (including the
      MESSAGE-scope degeneration, keyed on the event's own id rather than a
      shared platform key). Worker-side test: an unaddressed message (no
      sigil, no default grant, no default agent) causes `resolve` to return
      `None`; the worker writes nothing beyond the existing log row.
- [x] Test: agent with grants rows, space not among them, refuses silently;
      no trigger row. **Not tested against D17's exact wording** — that
      wording is rendered by the outbound path (WP5's job per
      `architecture.md` §6.2's rendering rule; WP4 never composes user-facing
      text), and no WP7 fixture set exists yet to test against (WP7 has not
      landed). What WP4 tests and guarantees: `resolve()` returns `None`
      identically whether the slug is unknown or the agent has grants
      elsewhere — the worker cannot and does not distinguish the two causes,
      which is the load-bearing half of D17 from this package's side.

## Backlog + invoke

- [x] Implement step 5: call `channels_service.compose_input(...)`. Tested:
      no trigger row yet reads the whole log (`after_event_id=None`);
      forwardfill off returns the addressing event alone even when older
      unread events exist in the log (the read is skipped, not the write).
- [x] Mint `turn_id` (`str(uuid4())`) in the worker, before `open_turn`.
- [x] Implement step 6a: call `channels_service.open_turn(...)` with the
      minted `turn_id`. Tested via a fake invoke that raises before
      returning, asserting `open_turn` (and therefore the DAO write) is
      called before invoke, and that the trigger settles FAILED afterward
      rather than leaving the row at STARTED forever.
- [x] Wire the invoke call: `InboxDispatcher._invoke_via_workflows_service`
      calls `WorkflowsService.invoke_workflow_detached(run_id=turn_id, ...)`.
      Tested against a fake `invoke_fn` that echoes back the exact `turn_id`
      it received — no server-side regeneration. **Deviation from the spec's
      literal wording, flagged in the final report**: the real
      `invoke_workflow_detached` has no caller-honoured runner-level
      `turnId` wire field today, only `run_id` (threaded into
      `meta["run_id"]`) and `session_id`. This worker mints one id and passes
      it as `run_id`.
- [x] Implement step 6b: call `channels_service.settle_turn(...)` on
      completion (`SETTLED`) and on failure (`FAILED`).

## Retry on refusal

- [x] Detect a refused overlapping turn from the invoke call. **Deviation,
      flagged in the final report**: no exception reaches
      `invoke_workflow_detached` for this today (`SessionTurnInUse` belongs
      to `core/sessions/streams`, a collaborator `WorkflowsService` does not
      call for a channels-originated turn). The default invoke function
      recognises `SessionTurnInUse` structurally (by class name) and
      re-raises it as this package's own `TurnRefused` marker, so the retry
      loop never has to import `core/sessions/*`. On refusal: retry the same
      invoke with the same `turn_id`, no coalescing, no `force` path. Tested:
      a flaky fake that refuses twice then accepts results in exactly one
      `open_turn` call (one trigger row) and one SETTLED transition.
- [x] Test: retry loop terminates once the runner accepts, and also once a
      refusal never clears (`_MAX_INVOKE_ATTEMPTS = 5`) — settles `REFUSED`
      rather than spinning forever in the test double.

## Concurrency

- [x] Test: two workers racing the same addressing collide on
      `(thread_id, event_id)` in `record_inbox_trigger` (behind `open_turn`);
      the loser gets `None` back from `open_turn` and the dispatcher returns
      without invoking or settling. Covered both as a unit test (fake
      service) and an integration test (real Postgres, two sequential
      `open_turn` calls against the same resolution/event, asserting exactly
      one row and the correct `turn_id` survives).

## Independence

- [x] Test: mentioning `~triage` then `~deploy` in one thread's space (two
      separate `dispatch_event` calls, two independent resolutions) produces
      two independent `open_turn` calls with different `thread_id`s and two
      independent `settle_turn` calls keyed by their own `trigger_id` —
      `~deploy`'s turn never touches `~triage`'s trigger row.

## Wiring

- [x] Prepared the `api/entrypoints/routers.py` / `worker_queues.py` diff
      block for this worker's registration, held for the checkpoint —
      **verbatim text in this package's final report**, not applied here.

## Ownership note (read before the checkpoint)

`core/channels/service.py` is listed as WP1's owned file in
`workstreams/README.md`'s file-ownership table, but WP1's own `tasks-wp1.md`
explicitly left `resolve`/`compose_input`/`open_turn`/`settle_turn` raising
`NotImplementedError`, stating in the same ledger that these four "belong to
WP3/WP4/WP5" and are filled in "by the owning package" in a later checkpoint.
This package (WP4) filled in exactly those four method bodies — no other
method in `service.py` was touched — because leaving them unimplemented would
make WP4 impossible to build or test end to end, and the alternative (forking
routing logic into `tasks/asyncio/channels/inbox.py` against the DAO
directly, bypassing `ChannelsService`) would violate the spec's own
"Interfaces" section, which states the worker "calls only the four service
methods… routing detail stays inside the service." Flag at the checkpoint if
this diff should instead be handed to WP1 to apply, or split differently.

## Interface deviations from the frozen `entities.md` §8 signature

`compose_input(self, *, project_id, resolution, event_id)` and
`open_turn(self, *, project_id, resolution, turn_id, event_id)` both carry an
`event_id` beyond the four-argument signature written in `specs-wp4.md` and
`entities.md` §8. `ChannelResolution` (space, agent, thread, policy) carries
no reference to the addressing event, and "the latest event in the space's
log" is not safely the same row once a second message can race in between
`resolve()` and `open_turn()` — guessing it would occasionally write the
wrong `event_id` into `channel_inbox_triggers`, silently mis-recording the
offset. `InboxDispatcher` holds the event throughout (it is what triggered
`resolve()` in the first place) and threads its `id` through explicitly.
Flag at the checkpoint: either accept this as the real signature, or supply
a different mechanism for `open_turn` to recover the addressing event's id
from `resolution` alone.

## Definition of done

End to end with a fake adapter — mention in, answer out, in the right thread,
attributed to the linked user. An unaddressed message writes its log row and
nothing else. Two agents in one thread run independently. A mention during a
running turn is retried until accepted, never dropped, never duplicated.

**All of the above verified at unit + integration level with fakes standing
in for the DAO, the adapter, and the invoke call** (see the final report for
the exact list of what was faked and the interface each fake asserts).
**Not verified**: "attributed to the linked user" — WP7 (identity links) has
not landed, so there is no platform-user → Agenta-account mapping to
attribute to yet. `_invoke_via_workflows_service` falls back to the agent's
own `created_by_id` as the invoking `user_id`, which is a stand-in for the
mechanism, not the mechanism itself. A true HTTP-level acceptance test
(signed event in → answer out, over the wire) is blocked on the checkpoint's
`routers.py`/`worker_queues.py` wiring, which this package cannot apply
outside the serialised merge (see "Wiring" above) — written as a diff block
in the final report instead of as a runnable acceptance test.
