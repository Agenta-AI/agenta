# Runner scalability — specs

> Status: **draft for discussion**. Distilled from `poc-persistent-sessions`
> (`sessions/demo/`) and the big-agents assessment
> (`big-agents-audit/big-agents-assessment.md`). Not implemented.

## Problem

Today there is **one shared runner process**. Run state — who owns a session, the cancel /
steer channel, whether a browser is attached — lives in that one process's memory. The
moment we run more than one runner replica (which we must, exactly as we scale the API
container), a run becomes **invisible to the other replicas**: you cannot cancel, steer, or
attach to a run that a *different* box is driving. The assessment calls this the root cause:

- **SCA-1 (Critical)** — single-process run state; multi-replica makes a run invisible to
  other processes.
- **SCA-2 (High)** — no concurrency cap on the runner → unbounded runs → OOM → skipped
  cleanup → leaked sandboxes.
- **SCA-6** — orphaned-sandbox sweep missing.
- **SEC-8 (High)** — no per-session ownership checks; unvalidated session id flows into the
  runner's durable path (IDOR + path injection once sessions are exposed).
- Plus the **session-affinity / cancel-channel** requirement called out in the assessment's
  scaling section.

The PoC already prototyped the coordination model (alive/attached locks in Redis,
send/steer/cancel/attach/detach, reattach) for a *single* sidecar. This worktree's job is to
**lift that model into a shared, multi-replica-correct coordination plane** and add the
durability/correctness state Agenta needs to manage runners and sandboxes.

> Constraint for this iteration: **plain docker-compose, no gVisor, no per-tool isolation.**
> The goal is *correctness* when 2–3 runner replicas run behind the service — not the full
> isolation/autoscale story (that's the larger roadmap item). We make multi-replica *correct*,
> not yet *hardened*.

## The coordination plane: Redis (proper)

Redis is the shared brain that makes run state visible across replicas. (The PoC's
`run-lock.js` + `locks.py` are the prototype; here they become a real, documented schema.)
**Coordinate via Redis** (the PoC's instinct), not direct replica routing: a cancel/steer lands
on any API replica → published to a Redis channel → the **owning runner is subscribed** and
reacts. So **the runner connects to the same Redis** (for the cancel/displacement subscription +
its own lock refresh); durable `session_runners` writes still go **through the API** (the runner
doesn't touch Postgres).

### One contract, two implementations (the language barrier is real)

API is Python, runner is Node/TS — there is **no shared runtime**, so we **cannot** share the
coordination code. Don't pretend to. Instead: **the contract is the single source of truth; the
implementation is deliberately duplicated.**

- **One authored contract** (the canonical spec): key names (`alive:session:<id>`,
  `attached:session:<id>`, `owner:session:<id>`, `displaced:session:<id>`), **TTL constants**,
  the **displacement-channel payload shape**, the **release-if-owner Lua**. This document is the
  source of truth; both sides are derived from it.
- **Two implementations** — Python in the API, TS in the runner — each a faithful build of the
  contract, living where each consumer needs it (API utils / runner utils). Duplication is
  accepted: it's the language barrier, not a smell.
- **A golden-fixture contract test** both sides assert against, so the duplication can't drift —
  same mechanism as the existing `protocol.ts ↔ wire.py`.

Three concerns live on this plane:

1. **Global session run lock (`alive`)** — at most one in-flight run per session, owned in
   Redis (not a single process's memory). `force` cancels the current holder and takes over;
   no-force gets `409 in_use`. This is what makes cancel/steer work across replicas.
2. **Attach / watch (`attached`)** — "is a client currently watching this run's live view",
   with a short TTL + displacement pub/sub so a steal tears down the prior watcher
   immediately. Dropping `attached` (detach) must **never** cancel the run or stop
   persistence (those are producer-driven; see records worktree).
3. **Session → runner sticky affinity** — which replica currently owns a session, with a
   TTL. New turns / control signals for that session route to (or are coordinated through)
   the owning replica. This is the missing piece that makes steer/cancel reach the right box.

The DATA/FORCE control matrix from the PoC is the protocol (clean, keep it):

| data | force | action |
|---|---|---|
| prompt | F | **SEND** (409 if a run is alive) |
| prompt | T | **STEER** (cancel holder, run new prompt) |
| none | F | **CANCEL** (cancel holder, run nothing) |
| none | T | **ATTACH** (steal `attached`, watch live run) |
| conn closes | — | **DETACH** (drop `attached`, run keeps going) |

## Durable correctness state: `session_runners` (Postgres)

Redis is fast but ephemeral. Agenta also needs **durable, queryable** knowledge of what is
running, to manage liveness and clean up — i.e. an endpoint and a table, not just Redis keys.

Proposed `session_runners`:

| Field | Type | Notes |
|---|---|---|
| `id` (`runner_id`) | uuid7 | **own pk** (`IdentifierDBA`) — consistent with the other facets' own ids. |
| `session_id` | str | **bare correlator, NOT an FK** (sessions may be external — finding A). **Unique — 1:1** (current liveness, PoC-style). |
| `project_id` | UUID | tenant scope / ownership; FK `ON DELETE CASCADE` |
| `replica_id` | str? | which runner replica/process currently owns it (affinity, mirrors Redis). Distinct from the row pk `runner_id` — `replica_id` = the container; `runner_id` = this row. |
| `attached` | bool | is a client watching (mirrors Redis `attached`, durably observable) |
| `sandbox_live` | bool | do we believe the sandbox is alive → do we need to kill it? (`sandbox_id` itself lives in `session_states` — single source of truth; not duplicated here.) |
| `last_seen_at` | ts | heartbeat; drives the orphan sweep + live-TTL |
| `status` | enum | `running` \| `detached` \| `idle` \| `ended` |
| `created_at` / `updated_at` | ts | |

Why durable *and* Redis: Redis is the hot path (locks, sub-second routing); `session_runners`
is the **source of truth for cleanup and observability** — "which sandboxes does Agenta
think are alive but whose runner died?" → kill them (SCA-6 orphan sweep). A crashed replica's
Redis TTLs expire; the durable row + heartbeat is how a sweeper finds the orphaned sandbox to
reap.

### Naming — `session_runners`, and why it does NOT generalize like `mount` did

`mount` dropped its `session_` prefix because a mount is a **standalone resource** — a
durable directory that genuinely pre-exists and outlives any binding; the `session_id` is an
*optional pointer*. The noun survives without the session.

A runner does not generalize the same way, because **two different nouns** hide under the
word:

1. **The runner process/replica** — "container #2 of the agent-runner deployment." This has
   meaning with no session: an id, host, concurrency cap, health. This is a **fleet
   registry** (`runners`) — a *different table* we may add later, not this one.
2. **The assignment — "runner R is handling session S"** — this is what the PoC's locks
   actually track. It is *intrinsically* a `(runner, session)` binding; it has **no meaning
   without the session**, because it **is** the binding.

What this worktree needs now is noun #2 — and unlike a mount, an assignment does not
pre-exist its session. So the prefix is **correct, not incidental**: this is the
session-runner *assignment/liveness facet*, parallel to `session_states` (the state-of facet).

→ **`session_runners`** (prefixed). If the fleet registry (noun #1) is ever needed, it lands
as a **separate** bare `runners` table (process id, host, cap, health) and `session_runners`'
`replica_id` becomes an FK into it. The two coexist; they are not the same row renamed.
Surfaced at the API as **`/sessions/runners/`** (under the `sessions` namespace, keyed/filtered
by `session_id`; NOT `/sessions/{id}/runner`), alongside `/sessions/states/` /
`/sessions/records/` / `/sessions/mounts/` / `/sessions/interactions/`. (See
sessions-persistence "Naming" for the shared facet rationale.)

### Relationship to `session_states` (sessions-persistence worktree)

- `session_states.record` = **durable agent record** (resume-shaped, rarely changes); owns
  `sandbox_id` (the resume pointer — **single source of truth**).
- `session_runners` = **ephemeral run/liveness** (changes constantly, runner-owned); carries
  `sandbox_live` only, references the session, does NOT re-own `sandbox_id`.

**Decided: separate tables** (different durability tiers — record is the source of truth,
liveness is lossy/derived). A convenience overlay joins them at read time; no merge.

## Concurrency + backpressure (SCA-2)

- **Per-replica concurrency cap**: max concurrent runs per runner box; over the cap →
  `429` / queue, not an OOM. (PoC has no cap; the assessment lists it as planned.)
- Global view via `session_runners` so the service can refuse/route when the fleet is
  saturated.

## Orphan sweep (SCA-6)

- A periodic sweeper reads `session_runners` for rows whose `last_seen_at` is stale but
  `sandbox_live` is true → the owning runner died mid-run → kill the leaked sandbox (PoC
  `/kill` is idempotent) and mark the row `ended`.
- Aligns with the PoC's `SANDBOX_LIVE_TTL_SECONDS` live-badge heuristic, made authoritative.

## Ownership / safety (SEC-8)

- Every session-scoped control endpoint validates the `session_id` shape (regex/length cap)
  and enforces project ownership before touching Redis or the runner. No raw id into a
  filesystem path (mounts worktree must receive a validated id).

## What we clean up from the PoC

- `run-lock.js` (single-process Redis usage) → documented multi-replica lock schema + sticky
  affinity.
- `locks.py` ad-hoc keys/pub-sub → proper key namespace, TTLs, displacement channel.
- In-runner-only liveness → durable `session_runners` + heartbeat + orphan sweep.
- `live` badge TTL heuristic → authoritative `sandbox_live` + `last_seen_at`.
- Keep: the DATA/FORCE matrix, displacement-on-steal, detach-never-cancels,
  drain-before-done coupling (the latter owned by records).

## Decided

- **`session_runners` vs `session_states`: separate tables** (different durability tiers).
  Liveness here; durable agent record in `session_states`.
- **`sandbox_id` single source of truth = `session_states`** (the resume pointer);
  `session_runners` carries `sandbox_live` only, doesn't re-own it.
- **`session_runners` is 1:1** per session (unique `session_id`); own `runner_id` pk for
  consistency only (1:many assignment-log is a later option).
- **Detached `/invoke` is a named deliverable of this worktree** — interactions (respond) and
  triggers (detach) both block on it.
- **Heartbeat: throttled durable writes** (Redis hot; Postgres lazy — on state-change + coarse
  checkpoint, not every refresh).
- **Affinity = coordinate via Redis** (not route-to-owner / no replica addressing). Runner +
  API share the coordination utils from the SDK; cross-language contract test pins the wire.
- **Concurrency cap = per-container, start ~1000; over-limit → `429`** (scale out = more
  containers, not a queue). Tune the number after measuring per-run resource use.
- **Drain across a steer handoff**: drain-before-done stays; if a runner dies mid-drain that's
  fine (uuid7 keeps order; the next owner re-drives from the record). No extra guard.

## Open questions (for discussion)

None — runner-scalability v1 is fully specced. (Cap over-limit = `429`, scale out with more
containers; everything else decided above.)

> The **combined session overlay** + **`sessions` table** are deferred (cross-cutting findings
> A, B4; `big-agents-audit/sessions-integration-deferred.md`).

## References

- `big-agents-audit/big-agents-assessment.md` — SCA-1, SCA-2, SCA-6, SEC-8, the scaling
  section ("the runners have to share state... session affinity, cancel channel").
- PoC: `sessions/demo/sidecar/run-lock.js`, `api/locks.py`, `api/main.py` (`_watch_attached`,
  the control matrix), `sandbox-provider.js`, `provider-modal.js`.
