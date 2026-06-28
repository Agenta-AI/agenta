# Tasks — Detached invoke

> Ordered, design-first. Built on `feat/add-sessions`. `[ ]` = not started.
> Keep both workers (removal deferred); add the detached path + recommend.

## 0. Decided / constraints
- [x] Both triggers (subscription + schedule) and interactions respond go **detached**.
- [x] **Keep** the triggers worker and the interactions worker in this PR; only stop *awaiting*
      the run and add the detached path. Removal = deferred follow-up with a written recommendation.
- [x] No new permissions (RUN_SESSIONS already covers respond; triggers are system-authored).
- [x] Non-detached callers (playground steer, direct API invoke) keep the blocking path.

## 1. Investigate the handoff transport (BLOCKING design decision — do first)
- [ ] Determine how `workflows_service.invoke_workflow` executes today (in-process sync? does it
      already hand to the runner?). Read `core/workflows/service.py` `invoke_workflow` + the
      runner invoke path.
- [ ] Choose the detach mechanism (spec options A/B/C): async-task vs runner
      `/sessions/streams/invoke` vs durable queue. Document the choice + why in the design.
- [ ] Confirm whether detach can reuse `streams.service._start_run`'s `detached` flag end-to-end
      (it's currently inert) or needs a new path. Wire `detached` so it actually means
      fire-and-forget.

## 2. Make streams' detached invoke real
- [ ] In `core/sessions/streams/service.py`, branch `_start_run` (or `invoke`) on `detached`:
      start the run via the chosen transport and return `run_id` + accepted status WITHOUT
      awaiting completion. Non-detached path unchanged.
- [ ] Ensure the runner drives the run + heartbeats the stream + persists the transcript with no
      caller connection held (verify against the streams Redis coordination plane + heartbeat).
- [ ] Acceptance: a detached invoke returns immediately with run_id; the stream row goes
      running→ended via heartbeat; transcript captures events — all without the caller awaiting.

## 3. Interactions respond → detached
- [ ] `core/sessions/interactions/service.py` (or the respond endpoint): build the
      `WorkflowServiceRequest` from stored `references`/`selector` + answer (as today) but invoke
      **detached** — fire and return. Do NOT await the run.
- [ ] The interaction is marked `resolved` by the runner (single state-machine writer) when it
      consumes the answer — confirm this still holds on the detached path (no await needed here).
- [ ] Re-authorize stored refs at respond time (existing rule) before firing.
- [ ] Keep `InteractionsWorker` in place (do not delete) — it may collapse later; note the
      recommendation.

## 4. Triggers (subscription + schedule) → detached
- [ ] `tasks/asyncio/triggers/dispatcher.py` `_run`: replace the awaited
      `invoke_workflow(...)` with the detached invoke. Preserve the `is_test` (no invoke) and
      `is_valid`/no-refs (failed delivery) branches exactly.
- [ ] **Delivery record**: write it as `dispatched`/accepted at fire time (record run_id); do
      NOT block on terminal status. Decide + implement how terminal status is reconciled
      out-of-band (runner reports vs trace-observed) — document it. This is the main triggers
      wrinkle; get it right.
- [ ] Keep the triggers taskiq worker in place (it owns inbound dedup + delivery + queue, not
      just the invoke) — note in the recommendation that detach removes the *await*, likely not
      the worker.

## 5. Worker-fate recommendation (the answer to the open question)
- [ ] Write `docs/designs/sessions/detached-invoke/worker-recommendation.md` (or a section in
      specs): with evidence from the investigation, state whether each worker can be retired:
      - triggers worker: likely KEEP (owns dedup/delivery/queue) — detach removes the await only.
      - interactions worker: likely RETIRE (collapses into respond→detached-invoke inline) — but
        deferred.
- [ ] Add the deferred removals to a deferred-work note.

## 6. Tests
- [ ] Unit: detached invoke returns immediately (does not await run completion); non-detached
      still blocks/returns outputs.
- [ ] Integration: interaction respond fires detached → run proceeds → interaction resolved by
      runner (not by the respond caller).
- [ ] Integration: trigger subscription/schedule fires detached → delivery written as
      dispatched → terminal status reconciled out-of-band. `is_test`/invalid paths unchanged.
- [ ] Regression: the existing trigger + interaction tests on the integration branch still pass.

## 7. Merge back
- [ ] When green, merge `feat/add-detached-invoke` back into `feat/add-sessions` (clean branch
      merge, not a GitHub PR). Re-verify the integration branch's session test suite.

## Cross-references
- streams invoke / DATA-FORCE matrix: `docs/designs/sessions/streams/specs.md`
- interactions respond pattern: `docs/designs/sessions/interactions/specs.md` +
  `cross-cutting-review.md` (interactions = first detached-invoke consumer; triggers follow)
- trigger dispatcher: `api/oss/src/tasks/asyncio/triggers/dispatcher.py`
