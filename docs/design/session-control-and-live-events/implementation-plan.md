# Implementation plan

> AGENT-GENERATED, low weight. Written on the night of 2026-09-02 from the RFC, the two
> reviews, and the four spikes. Mahmoud decides. `plan.md` remains the design discussion plan;
> this file is the build plan for version one and the order of the work after it.

## What version one delivers

A user presses Stop. Within five seconds the runner cancels the harness turn. The sandbox and
the native harness session stay warm. The turn ends with one terminal record that says
`cancelled`. Every browser shows the turn as stopped. The next message resumes in the same
sandbox. A second message during a running turn is refused with a clear conflict, and nothing is
destroyed. A turn whose runner or sandbox dies ends within about 90 seconds with a terminal
record, and the session accepts new messages.

This closes GitHub issues #5160, #5982, #6417, #5539, #5538, and bounds #6418, #6100, #6099,
#5327, #6103, #6315.

## Work packages

Each package is one branch, one PR, and one live test. Packages in the same row do not touch the
same files and can be built in parallel. Every package sits on the RFC branch tip; the final
stack order is the merge order below.

| Package | Branch | What it changes | Depends on | State on 2026-09-03 morning |
|---|---|---|---|---|
| A. Warm cancel in the runner | `spike/session-cancel-warm` | A user Stop sends the real harness cancel on Pi, Claude Code, and Codex, waits for idle, ends the turn as `cancelled`, keeps `stopReason` in the terminal record, and parks the sandbox. Other aborts still destroy. The vendored sandbox-agent client is patched to allow `session/cancel`. | Nothing | See `spike-a-sandbox-cancel.md` and the protocol. |
| B. Single-turn admission | `feat/session-single-turn-admission` | The runner claims the turn with the API's atomic lock before it touches the keepalive pool; a busy session answers 409 at once; the supersede branch that destroyed the busy turn is removed; the desktop keeps the typed text on 409. This is `on_busy: reject`. | Nothing | See `slice-admission.md`. |
| C. Execution watchdog | `feat/session-execution-watchdog` | Runner: a turn fails itself when its sandbox or sandbox-agent connection is gone, so the heartbeat stops. API: the sweep settles a row whose heartbeat is older than 90 s while it still claims to run, writes a `lost` terminal record, clears the owner's Redis keys, publishes the watch notification. | Nothing | See `slice-watchdog.md`. |
| D. Stop guard | `feat/session-stop-guard` | Optional `expected_execution_id` on the cancel request; a late Stop never supersedes a turn that started after it; Stop cancels pending interactions; Stop is exempt from the concurrency limit; the desktop awaits the call and surfaces a 409; mobile Stop on the user's own turn calls the server. | Nothing | See `slice-stop-guard.md`. |
| E. Records durability | `fix/records-worker-ack-after-commit` | The records worker acknowledges Redis only after the Postgres batch commits; one bad record does not discard its batch; the enterprise retention job stops raising. | Nothing | See `slice-records-ack.md`. |
| F. Durable Stop command with the direct-call adapter | `feat/session-durable-cancel` (planned) | `session_commands` table, command state machine, `POST /sessions/{id}/cancel` public route, the control-delivery port with the direct adapter (runner `POST /cancel` beside `/kill`), the outcome route, settlement that leaves `alive` to its TTL, watch notification. The old cancel mode becomes a thin wrapper. | A (the runner cancel function), D (the guard rules move into the command) | Starts after A returns. |
| G. Long-poll adapter | later | The runner claim loop and the API long-poll route from `spike-b-durable-commands-design.md` section 5. | F, and Mahmoud's transport decision | Deferred. |

## Merge order

1. E. It is independent and it fixes silent data loss.
2. A. The park rule is the point of the Stop work.
3. B. Closes the double send. Touches the runner coordinator, not the engine.
4. C. Bounds every hang. Touches the sweep and the runner heartbeat.
5. D. Touches the existing cancel branch and the clients.
6. F. Replaces the cancel branch with the command. Rebase on D.

Land PR #6384 (approval revert on a failed resume) before D and F, because all three touch the
interactions path.

## Live tests that gate each package

Each package adds one wire-level cell to the agent release gate. The gate has only the steer
cell today.

| Cell | Steps | Pass when |
|---|---|---|
| stop-warm | Start a turn with a 40 s tool. Stop after 5 s. Send a second message. | The runner log shows `cancelled` and a park, not a destroy. The second message runs in the same sandbox id with the same native session. The terminal record carries `cancelled`. Stop reaches the runner in under 5 s (F) or under 30 s (A alone). |
| double-send | Start a 40 s turn. Send a second message at 5 s. Send a third after the first ends. | The second send returns 409 at once. The first turn finishes and its sandbox is not destroyed. The third message runs. |
| runner-gone | Start a 60 s turn. Restart the runner container. | Within about 90 s a `lost` terminal record exists, the Redis keys are clear, and a new message runs. |
| sandbox-gone | Start a 60 s turn. Kill the sandbox process. | The runner ends the turn with a terminal record and stops heartbeating. |
| stale-stop | Start turn one, let it end, start turn two, send Stop with turn one's id. | 409, turn two keeps running. Without an id: turn two is not tombstoned. |
| stop-approval | Start a turn that asks for approval. Stop. Answer late. | The interaction row is `cancelled`, the late answer is refused, the card is closed in the browser. |
| records-outage | Run a turn while Postgres is down for 20 s. | Every record lands after Postgres returns, and the Redis stream is drained. |

## After version one

In this order, each with its own design pass before code:

1. **Producer fix for early tool-call flush** (Spike D). The runner writes a tool call before its
   arguments arrive and repairs it later. Fix the producer, then the upsert can become immutable.
   This is the gate for the records repair.
2. **Records repair, option A** (Spike D recommendation): stable producer event ids for every
   record type, immutable inserts, a commit-ordered cursor. Reopens the records ordering
   decision on purpose.
3. **Snapshot and replayable event endpoints** (RFC "Durable events and replay"), then the
   detached sender and the shared client engine.
4. **Queue and steer** with server-held pending inputs, on top of the command table from F.
5. **Long-poll adapter** when a second runner or a user-operated runner is real.

## Decisions that shape the plan

Listed in `review-2026-09-02.md`. The two that block F: the default transport adapter (the
plan assumes `direct`), and whether Stop leaves the Redis `alive` key to its TTL (the plan
assumes yes, as Spike B designed).
