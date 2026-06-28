# Tasks — Detached invoke

> Ordered, design-first. Built on `feat/add-sessions`. `[ ]` = not started.
> ALL missing demo behavior for detach lands in THIS branch.

## 0. Decided (settled — do not re-litigate)

- [x] **Transport = runner keeps the session alive** (PoC model), NOT backgrounding the blocking
      `invoke_workflow`. Run lives on the runner; caller detaches after a started guarantee.
- [x] **"Started" signal = the alive-lock-acquisition handshake**, not a new event. Return
      `run_id`+accepted once `alive` is held and the run is owned by a heartbeating runner.
- [x] **Both triggers (subscription + schedule) and interactions respond go detached.**
- [x] **KEEP BOTH workers.** Detached invoke is seconds-long and network-bound (run spin-up +
      alive-lock handshake + possible drain-before-attach on a steer). That wait must stay OFF the
      API process and OFF the provider ack path. So both the triggers worker AND the interactions
      worker remain; respond fires detached from the interactions worker, NOT inline on the API
      request thread. (Triggers worker additionally owns the durable `/composio/events/` queue.)
- [x] **Triggers delivery** = write `dispatched`/accepted at fire time (record run_id); terminal
      outcome observable via trace/transcript. No awaiting.
- [x] No new permissions (RUN_SESSIONS covers respond; triggers system-authored).

## 1. Runner-side: own the coordination plane (MISSING from integration — port from demo)

- [ ] Runner acquires + self-refreshes the `alive` lock for the run's lifetime (port the PoC
      sidecar watchdog, `poc-persistent-sessions/.../sidecar/run-lock.js`). Survives the caller
      disconnecting.
- [ ] Runner heartbeats the stream/owner: wire the unused `HEARTBEAT_INTERVAL_SECONDS`
      (`services/agent/src/sessions/contract.ts`) to actually call the admin heartbeat
      (`/admin/sessions/streams/heartbeat`) + `refresh_owner`. Drives `session_streams`
      running→ended + orphan sweep.
- [ ] Acceptance: kill the caller connection mid-run → `alive` stays held, heartbeat continues,
      stream row stays `running` then transitions `ended` at completion.

## 2. Runner-side: producer-driven persistence (MISSING — the biggest gap)

- [ ] Runner persists every event to the transcript ingest **independently of any client
      connection** (port the PoC sidecar's retrying, per-session-ordered `/events` chain →
      the transcripts Redis-Stream ingest). Today persistence is consumer-driven over the held
      `/run` connection and is lost on disconnect.
- [ ] Keep `stripReplay` + coalescing already specced in transcripts; ensure they apply on the
      producer path.
- [ ] Acceptance: a detached run with NO client connected still produces a complete transcript.

## 3. Make `_start_run` actually dispatch (MISSING — it's a hollow stub today)

- [ ] `core/sessions/streams/service.py` `_start_run`: after `acquire_alive` + writing the row,
      **hand the run to the runner** (dispatch bound refs via the runner start path). Today it
      returns `run_id` having executed nothing — fix for BOTH detached and non-detached.
- [ ] Branch on `detached`: detached → return `run_id`+accepted on the alive-held handshake (do
      not drain the stream); non-detached → existing attached/streaming behavior.
- [ ] Runner needs a start path that acquires alive, hands off, and confirms started without
      holding the caller's connection (fire-and-forget start, or "start → confirm alive → run in
      background" on `/run`).

## 4. Consumers → detached

- [ ] **Interactions respond**: build `WorkflowServiceRequest` from stored refs+answer, invoke
      **detached**, return. Re-authorize refs at fire time. Interaction marked `resolved` by the
      runner (single writer). Respond fires via the **interactions worker** (KEEP it), NOT inline
      on the API request thread — the seconds-long network-bound detach handshake stays off the API.
- [ ] **Triggers dispatch** (`tasks/asyncio/triggers/dispatcher.py` `_run`): replace the awaited
      `invoke_workflow` with detached invoke. Write delivery = `dispatched` at fire time. Preserve
      `is_test` (no invoke) and `is_valid`/no-refs (failed delivery) branches unchanged.

## 5. Triggers delivery reconciliation

- [ ] Write the delivery `dispatched`/accepted with run_id at fire time. Terminal status is NOT
      awaited — observable via trace/transcript/stream row. Document this is the intended contract
      for triggers ("accepted" is the meaningful outcome).

## 6. Worker shape

- [ ] **KEEP** the interactions worker — respond fires the detached invoke from the worker, off
      the API request thread (the alive-handshake + possible drain wait is seconds-long and
      network-bound). Do NOT delete it.
- [ ] **KEEP** the triggers worker (consume side) — it still drains the durable queue and now
      fires detached (fast, non-blocking) instead of awaiting. The seconds-long network-bound
      detach handshake runs here, off the API + off the provider ack path.

## 7. Tests

- [ ] Detached invoke returns immediately on the alive-held handshake (does not await the run);
      non-detached still streams/returns outputs.
- [ ] Detached run persists a full transcript with no client connected (producer-driven).
- [ ] Caller disconnect mid-run → run continues, alive held, heartbeats, ends normally.
- [ ] Interaction respond → detached → run proceeds → resolved by runner (not by caller).
- [ ] Trigger sub/schedule → detached → delivery `dispatched`; `is_test`/invalid unchanged.
- [ ] Regression: existing trigger + interaction + streams tests on integration still pass.

## 8. Merge back

- [ ] When green, merge `feat/add-detached-invoke` into `feat/add-sessions` (clean branch merge,
      not a GitHub PR). Re-verify the integration session test suite.

## Dependency / scope note

- §1–§3 are runner-side wiring the demo has but the integration branch does NOT (verified). They
  overlap the runner-scalability surface but were left runner-side-unwired — they are part of THIS
  work. Detached-invoke is not safe/complete without them.
- Big-agents audit (external): `../../../../big-agents-audit/big-agents-assessment.md`.
