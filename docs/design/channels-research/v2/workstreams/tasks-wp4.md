# WP4 tasks — Inbox worker

## Setup

- [ ] Branch from the seed commit (C0). Confirm `core/channels/interfaces.py`,
      `dtos.py`, `types.py` import cleanly and `ChannelsService` is reachable
      via DI.
- [ ] Add `tasks/asyncio/channels/inbox.py` with the worker skeleton: imports,
      constructor taking `channels_service: ChannelsService`, no logic yet.

## Routing

- [ ] Implement step 2 (route): call `channels_service.resolve(...)`; on
      `None` from an unconfigured space, mark the event skipped and return.
      Test: unconfigured space produces no thread, no trigger row.
- [ ] Implement step 3/4 inside the resolve call path (owned by WP1's service,
      but write the worker-side test): an unaddressed message causes `resolve`
      to return `None`; assert the worker writes nothing beyond the existing
      log row.
- [ ] Test: agent with grants rows, space not among them, refuses silently;
      assert no trigger row and the refusal message matches D17's wording
      test (identical across the three causes, from WP7's fixture set).

## Backlog + invoke

- [ ] Implement step 5: call `channels_service.compose_input(...)` to get the
      range of events since the thread's last offset. Test: no trigger row
      yet returns the whole log; an existing offset returns only events after
      it.
- [ ] Mint `turn_id` (uuid) in the worker, before any service call that needs
      it.
- [ ] Implement step 6a: call `channels_service.open_turn(...)` with the
      minted `turn_id`; assert the trigger row is written at `STARTED` before
      invoke is called (use a fake invoke that raises, assert the row already
      exists).
- [ ] Wire the invoke call: pass the minted `turn_id` as `turnId` on the run
      request. Test against a fake runner client that echoes back the
      `turnId` it received, asserting it matches the minted value exactly (no
      server-side regeneration).
- [ ] Implement step 6b: call `channels_service.settle_turn(...)` on
      completion (`SETTLED`) and on failure (`FAILED`).

## Retry on refusal

- [ ] Detect a refused overlapping turn from the invoke call (the runner's
      409/refusal signal). On refusal: retry the same invoke with the same
      `turn_id`, no coalescing, no alternate path. Test: a burst of two
      mentions to the same running agent results in exactly one accepted
      invoke plus retries, never two turns.
- [ ] Test: retry loop terminates once the runner accepts (no infinite retry
      in the test double).

## Concurrency

- [ ] Test: two workers racing the same addressing collide on
      `(thread_id, event_id)` in `record_inbox_trigger`; one gets `None` back
      and must not invoke.

## Independence

- [ ] Test: mentioning `~triage` then `~deploy` in one thread's space
      produces two independent thread rows and two independent trigger rows;
      `~deploy`'s turn does not appear on `~triage`'s thread, and vice versa.

## Wiring

- [ ] Prepare the `api/entrypoints/routers.py` diff block for this worker's
      registration (dispatch wiring), held for the C2 serialised merge — do
      not apply outside the checkpoint.

## Definition of done

End to end with a fake adapter — mention in, answer out, in the right thread,
attributed to the linked user. An unaddressed message writes its log row and
nothing else. Two agents in one thread run independently. A mention during a
running turn is retried until accepted, never dropped, never duplicated.
