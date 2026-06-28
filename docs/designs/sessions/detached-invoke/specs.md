# Detached invoke — specs

> Status: **draft for discussion**. Built on the integration branch `feat/add-sessions`
> (all five session sub-domains merged + restructured). Not yet implemented.

## Problem

Two consumers need to start a workflow run that may be **long-running and unattended**, and
neither should hold a connection open for the run's lifetime:

1. **Interactions respond** — a human answers a parked approval; the run resumes and may take
   minutes. Today `InteractionsWorker.respond()` calls
   `workflows_service.invoke_workflow(...)` and **awaits the full result**.
2. **Triggers** (subscriptions + schedules) — an inbound event/schedule fires a bound workflow.
   Always unattended. Today `TriggersDispatcher._run()` calls the same blocking
   `invoke_workflow(...)` and awaits the full response (to write a delivery record).

Both are **fire-and-forget by nature** — nobody is waiting on the HTTP side. Holding a worker
(or a request) open for the whole run is the wrong shape: it ties up a connection/worker slot
for the run's duration and couples the caller's lifetime to the run's.

The streams sub-domain already exposes the *intended* mechanism — `POST /sessions/streams/invoke`
with a `detached` flag — but **`detached` is currently inert**: `streams.service._start_run()`
accepts the flag, acquires the alive lock, writes the stream row, and returns a `run_id`, but
does **not** branch on `detached` to actually hand the run off to the runner and return without
awaiting completion. Detached invoke is a stub.

## Goal

1. Make streams' invoke **actually detach**: when `detached=True`, start the run on the runner
   (fire-and-forget), return immediately with the `run_id`, and let the runner drive the run +
   persist the transcript + heartbeat the stream — with no caller connection held.
2. Route **interactions respond** and **triggers** (subscription + schedule dispatch) through the
   detached path instead of the blocking `invoke_workflow`.
3. **Investigate + recommend** whether the dedicated **triggers worker** and **interactions
   worker** are still needed once everything is detached. (Decision for this PR: **keep both
   workers**; removal is a follow-up — see "Worker fate".)

## What "detached" must mean (the mechanism)

Synchronous `invoke_workflow` (today): caller → `workflows_service.invoke_workflow` → blocks →
returns outputs/status. The dispatcher uses the returned status to write a delivery record.

Detached invoke (target): caller → enqueue/hand the run to the runner → return `run_id` (+ an
accepted status) immediately. The run executes on the runner; its outcome is observed
**out-of-band**, not via the caller's return value:

- the **stream row** reflects run state (running → ended) via the runner's heartbeat;
- the **transcript** captures the events;
- for triggers, the **delivery record** must still be written — but it records *"dispatched"*
  (accepted) at fire time, and the terminal outcome is reconciled later (see "Triggers delivery"),
  NOT by awaiting the run.

The detach handoff reuses the existing bound-refs → invoke pattern
(`WorkflowServiceRequest(references, selector, data)`), just on a non-blocking path.

### Open question — the handoff transport (resolve during design)

`invoke_workflow` today runs the workflow in-process/synchronously. "Detached" needs a way to
start the run **without awaiting** it. Candidate mechanisms (pick one, document why):

- **A — async task on the same process**: schedule `invoke_workflow` as a fire-and-forget
  asyncio task / background task and return immediately. Simplest, but the run's lifetime is
  still tied to *this* process (dies if the process restarts mid-run) — acceptable only if the
  runner itself owns the long-running execution and `invoke_workflow` just kicks it off.
- **B — runner streams invoke**: POST to `/sessions/streams/invoke` with `detached=True` against
  the runner replica that owns (or will own) the session; the runner executes and heartbeats.
  This is the design intent ("detached = the runner keeps going"). Requires the runner endpoint
  to actually start a run from bound refs, not just a prompt.
- **C — durable queue**: enqueue the invoke onto a Redis stream / taskiq broker the runner (or a
  shed worker) consumes. Survives process restarts. This is essentially what the triggers worker
  does today via taskiq.

The investigation must determine whether `invoke_workflow` can be made non-blocking cleanly, or
whether detach genuinely requires routing through the runner's `/sessions/streams/invoke`. The
answer drives the worker-fate decision below.

## Consumers

### Interactions respond → detached
`InteractionsWorker.respond()` builds `WorkflowServiceRequest` from the interaction's stored
`references`/`selector` + the answer, then invokes. Change: invoke **detached** — fire and
return; do not await the run. The interaction is marked `resolved` by the runner (the single
state-machine writer) when it consumes the answer, NOT by awaiting the invoke here.

### Triggers (subscription + schedule) → detached
`TriggersDispatcher._run()` builds `WorkflowServiceRequest` from the entity's bound
`references`/`selector` + resolved inputs, then invokes and **awaits the response to write the
delivery record's terminal status**. Change: invoke **detached**.

**Triggers delivery (the wrinkle):** today the delivery record gets the run's terminal
status/outputs from the awaited response. Detached means there's no terminal status at fire time.
Resolution: write the delivery as **`dispatched`/accepted** at fire time (record the run_id), and
reconcile the terminal status out-of-band — either the runner/run reports completion against the
delivery, or the delivery is left as "dispatched" and terminal status is observed via the
trace/transcript. **This is a required design decision** — do not silently drop the delivery's
terminal-status semantics. Preserve `is_test` (no invoke) and `is_valid`/no-refs (failed
delivery, no invoke) paths unchanged — only the actual-invoke branch goes detached.

## Worker fate (the open question this work answers)

Once **both** consumers are always-detached, the dedicated workers may be redundant:

- **Triggers worker** (`tasks/taskiq/triggers/worker.py`) — a long-lived taskiq consumer.
- **Interactions worker** (`tasks/asyncio/sessions/interactions_worker.py`) — currently a thin
  respond-via-invoke wrapper (no broker wired; called directly).

If detach = "hand to the runner and return," then neither needs a held-open worker to await a
run. The spec must **analyze and recommend**:
- Does the triggers taskiq worker still serve a purpose (durable retry/queue for inbound events)
  beyond awaiting the run? (Likely yes — it owns dedup + delivery + the inbound queue, not just
  the invoke.) So "detached invoke" may remove the *awaiting*, not the *worker*.
- Does the interactions worker have any reason to exist once respond fires detached directly from
  the request path? (Likely no — it can collapse into the respond endpoint calling detached
  invoke inline.)

**Decision for THIS work: keep both workers in place.** Add the detached path alongside; do not
delete either worker. The recommendation (with evidence) goes in the design + a deferred-work
note, so removal is a separate, deliberate change once detach is proven in practice.

## Cross-cutting

- **RBAC**: detached invoke is a RUN-class action → `RUN_SESSIONS` for the user-facing respond;
  trigger dispatch is system/admin-authored (unchanged). No new permissions.
- **Detach does not change ownership/auth**: re-authorize stored refs at fire time (the captured
  ref must not outlive the grant) — same rule interactions already states.
- **replica affinity**: if detach routes to the runner (mechanism B), it must target/observe the
  owning replica via the Redis owner-lock; reuse the streams coordination plane, don't reinvent.

## Out of scope (this work)

- **Removing** either worker (deferred; this work only stops *awaiting* and adds the detached
  path + recommendation).
- New webhook/notification fan-out for interactions (already deferred).
- Changing the synchronous `invoke_workflow` contract for non-detached callers (playground steer,
  direct API invoke) — those keep the blocking path.
