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

## What the integration branch already has vs what's MISSING (verified)

The integration branch (`feat/add-sessions`) has the **API-side coordination scaffolding**, but
the **runner-side behavior that makes detach actually work is missing**. Verified against the code:

**Present (API side):** Redis locks (`acquire_alive`, `force_cancel_alive`, `get_session_liveness`,
`refresh_owner`, `steal_attached`, `release_attached`); the DATA/FORCE matrix + `detach()` in
`SessionStreamsService`; `session_streams` table + status; the cross-language Redis contract
(`contract.ts` + golden fixture); the transcripts ingest table/worker; the `WorkflowServiceRequest`
bound-refs invoke pattern; the `detached` flag plumbed end-to-end (but inert).

**MISSING — the real body of work for this worktree (port from the demo `poc-persistent-sessions`):**

1. **`_start_run` dispatches no run.** It acquires `alive`, writes the row, and returns a `run_id`
   — but never hands a run to the runner. send/steer execute nothing today. (`streams/service.py`
   ~260–305.)
2. **The runner is not wired into the coordination plane.** It never acquires/refreshes `alive`
   and never heartbeats the owner — `HEARTBEAT_INTERVAL_SECONDS` is defined in `contract.ts` with
   **zero callers**. (PoC: the sidecar owns `alive` + a refresh watchdog.)
3. **Persistence is consumer-driven, not producer-driven.** The runner streams events over the
   held `/run` connection and the Python service drains them; there is no independent POST to the
   transcript ingest. A detached run would persist nothing once the connection drops. (PoC: the
   sidecar's retrying `/events` chain persists every event regardless of any client — port this.)

These three are prerequisites for detach to be safe and are part of THIS work (they overlap the
runner-scalability surface but were left runner-side-unwired). See the big-agents audit at
`../../../../big-agents-audit/big-agents-assessment.md` (outside the repo, sibling of `vibes/`).

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

### DECIDED — the handoff transport + the "started" signal

**Transport = the runner keeps the session alive (PoC model).** NOT "background the blocking
`invoke_workflow` on the API process" — there is no long-running work in the API to background;
the run lives on the runner, which owns `alive` and heartbeats. The caller starts the run, gets a
**started guarantee**, then drops its connection; the runner carries it.

**The "started" signal = the alive-lock-acquisition handshake, NOT a new event.** Verified against
the PoC: there is no explicit `run_started` event — the runner emits content events
(`message_start`, `tool_call`, …) and a terminal `done`, but nothing that means "the run is now
live" distinct from the first content (which races model latency / sandbox cold-start). The PoC's
started guarantee is **synchronous and implicit**: the sidecar acquires `alive` *before* opening
the stream, so "acquired (non-409)" *is* "the run started and is owned." We adopt the same: on the
detached path, return `run_id` + accepted the moment **`alive` is held and the run is handed to a
runner that owns + heartbeats it** — not when the first event arrives. A dedicated `run_started`
event is explicitly rejected (weaker: ties "started" to holding the stream, races cold-start).

### DECIDED — detached flows through the workflow-service hop (streaming), not a direct bypass

The PoC's FastAPI talks **directly** to the sidecar's streaming `/run`. Our topology has an extra
hop: API → deployed **workflow-service** `/invoke` → SDK streaming (`deliver_http_stream`, NDJSON)
→ runner `/run`. Decision: **keep that one topology for all invokes** — do NOT add a direct
API→runner bypass for sessions. Instead make the hop support an early-return detached mode:

- **Deployed workflow-service `/invoke`** gains a detached mode: it starts the run on the runner
  over the existing streaming path, and **returns a "started" marker once the run is accepted/owned
  (alive held)** — NOT after the run completes. The run keeps executing + persisting on the runner.
- **API `invoke_workflow`** gains the matching detached/streaming path: today it only does batch
  (`_post_service_json` awaits the full result) even though `WorkflowServiceStreamResponse` is in
  its return union but never produced. Wire the detached path so it returns `run_id`+started.
- **`dispatch_fn`** (injected into both consumers) calls this detached `invoke_workflow`, gets the
  `run_id`, returns. No `asyncio.create_task`-of-blocking-invoke; no phantom run_id.

This spans the SDK workflow-service (`sdks/python/...`) + the API + the entrypoint. The runner-side
pieces (alive watchdog, producer-driven persistence via the ingest endpoint, survive-disconnect)
are already built and engage once the run is owned by the runner. **Live round-trip is validated on
the stack post-merge** (test & fix at home).

The flow:

```text
caller (interactions respond / triggers dispatch)
  → streams invoke (detached=True)
  → _start_run (detached branch): acquire_alive → write session_streams row=running →
    hand the run to the runner (the MISSING dispatch) → runner owns+refreshes alive + heartbeats
  → return run_id + accepted  ← "started" = alive held + run owned   (the handshake)
  → caller disconnects (never awaits)
  → runner continues; persists transcript producer-side; heartbeats running→ended
  → outcome observable via trace / transcript / stream row
```

This is why detach is **seconds-long and network-bound** (spin-up + alive handshake + possible
drain-before-attach on a steer) — and therefore stays on the workers, off the API (see Worker fate).

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

## Worker fate — DECIDED: keep BOTH workers (the reason matters)

Both workers stay. The deciding reason is **NOT** any of the ones first floated, which were
wrong or misattributed:

- ~~"workers exist to await the long run"~~ — false; detached invoke removes all awaiting.
- ~~"triggers worker = durable inbox for un-re-fetchable webhooks"~~ — that was conflating the
  **separate, untouched outbound `webhooks` worker** (`tasks/taskiq/webhooks/`) with the
  **triggers** worker. Different subsystem; not relevant here.

The real reason: **detached invoke is not instantaneous — it is seconds-long and network-bound,
and that work must stay off the API process and off the provider's inbound request.**

Even detached, the dispatch path must:

1. start the run on the runner (spin-up latency),
2. **wait for the "session started" signal** before it can safely detach (signal latency), and
3. if the invoke is a steer/displacement that **takes the session over from another driver**,
   perform **drain-before-attach** first — inherently several seconds.

So the dispatch is a **seconds-long, network-bound** operation. The API process is
request/CPU-bound and must stay responsive; the Composio inbound endpoint (`/composio/events/`)
must **ack-fast**. Keeping the dispatch on **dedicated workers** isolates that network-bound wait
from the API — different resource profile, scaled independently. This applies to **both**:

- **Triggers worker** (`tasks/taskiq/triggers/worker.py`) — KEEP. The inbound `/composio/events/`
  endpoint verifies + ack-fast + enqueues; the worker drains and runs the (now seconds-long,
  detached) dispatch off the request path.
- **Interactions worker** (`tasks/asyncio/sessions/interactions_worker.py`) — KEEP. Respond also
  incurs the start-signal + possible drain-before-attach wait; keep that network-bound work off
  the API request thread on the worker.

This is a **standing decision, not deferred**: detached invoke removes the *await*, but the
seconds-long network-bound detach handshake is exactly the kind of work that belongs on a
separate, network-bound worker — not inline on the API or the provider ack path.

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
