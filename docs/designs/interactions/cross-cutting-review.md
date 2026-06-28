# Cross-cutting review — the five session worktrees

> Reviews `mounts`, `transcripts`, `sessions-persistence`, `runner-scalability`,
> `interactions` together for completeness, soundness, consistency, security, scalability.
> Lives here for now (the in-flight worktree); each finding names the worktree(s) it touches.
> Findings are **raised for discussion**, not yet folded into the individual specs.

## The shape they form

All five are **facets of a session**, keyed by `session_id` (a filter param, never a mid-path
id), each with **its own row id** + a route under the `sessions` namespace:

| Worktree | DB table | own pk | DB / store | API resource | Beyond sessions |
|---|---|---|---|---|---|
| mounts | `mounts` | `mount` id (uuid7) | core | `/mounts/` **+** `/sessions/mounts/` | project-level & shared mounts; external mounts later |
| transcripts | `transcripts` | uuid7 (ordering key) | **tracing** | `/sessions/transcripts/` | parallels spans/events; retention |
| sessions-persistence | `session_states` | `state_id` (uuid7) | core | `/sessions/states/` | — |
| runner-scalability | `session_runners` | `runner_id` (uuid7) | core | `/sessions/runners/` + control verbs | multi-replica fleet; future `runners` registry; **detached invoke** |
| interactions | `interactions` | `interaction_id` (uuid7) + `token` | core | `/sessions/interactions/` | webhooks/notifications; **triggers detach** |

**Endpoint convention (settled):** a **`sessions` namespace** with fixed sub-paths —
`/sessions/states/`, `/sessions/runners/`, `/sessions/mounts/`, `/sessions/transcripts/`,
`/sessions/interactions/` — each keyed/filtered by `session_id`. **No id mid-path**
(`/sessions/{id}/X` is wrong; the codebase only deep-nests key-based catalogs). `…/query` for
many, `…/{own_id}` for one. Mounts ALSO keeps a standalone `/mounts/` (mounts with no session).

**Per-facet ids (settled):** each facet has its **own uuid7 pk** (`state_id`, `runner_id`,
`interaction_id`, mount id, transcript id), with `session_id` a **bare correlator column** (not
the pk, not an FK). Interactions additionally carries `token` (the harness reply key) as an
indexed VARCHAR, separate from `interaction_id`.

The findings below are the seams between the five.

---

## A. `session_id` is NOT a foreign key — and that's by design (DEFERRED)

**Worktrees: all five.** Every facet carries a `session_id`, but **no worktree owns a
`sessions` table, and `session_id` deliberately is NOT a foreign key** — for the same reason
`trace_id` / `span_id` aren't FKs. **We will host observability/sessions for agents running
OUTSIDE Agenta**, so a `session_id` may reference a session that isn't ours. It can't FK to a
row that may not exist. (A span has its own table because the span *is* our data; a session id
is a correlator, like trace id, not an owned entity.)

Consequences, all **deferred — keep as is for now:**

- **No `ON DELETE CASCADE` from a `sessions` row** (there's no such row). Interactions'
  "session deleted" cleanup therefore leans on what already exists: the **`project_id`
  `ON DELETE CASCADE`** (every facet is project-scoped), plus interactions' own **cancel** and
  **TTL** mechanisms. A *session-level* cascade may come later, anchored on **`session_states`**
  (see B2) — note that `session_states` has no id of its own *other than* `session_id`, which is
  why it's the natural anchor if we ever want one.
- **No user owns a session.** Ownership is **`project_id`**, full stop (not created_by/user).
  SEC-8 checks = project scope.
- **The overlay has no session id resource to hang off** — it's a pure read-time join, no
  `GET /sessions/{id}`. Deferred (finding B4).

**Decision: do NOT add a `sessions` table now.** Revisit only if/when we want a real
session-level delete-cascade across facets — and even then it must tolerate `session_id`s that
are external (not ours). Tracked in the deferred-work file (see end).

---

## B. Consistency findings

### B1. `sandbox_id` vs `sandbox_live` — state the split, pick one source of truth
**sessions-persistence + runner-scalability.** `session_states.sandbox_id` = **which sandbox to
resume** (durable pointer). `session_runners.sandbox_id`+`sandbox_live` = **is one up / must we
kill it** (ephemeral). → ties into B2: if state+runner merge, this is moot (one row). If they
stay split, make `session_states.sandbox_id` the resume source of truth and have
`session_runners` reference the session, not re-own the id.

### B2. Are `session_states` and `session_runners` the SAME table? (think about it)
**sessions-persistence + runner-scalability.** `session_states` has no id of its own beyond
`session_id`; `session_runners` is also keyed by `session_id`. If `session_runners` is **just
liveness** (attached / sandbox_live / last_seen / runner_id) with no independent state, it's
unclear why it's a separate table from `session_states` — they're both "the row for session S."
→ **Open question B2 (real):** merge into one `session_states` row (columns: durable `record` +
`sandbox_id` + the liveness fields) vs keep two. Trade-off: **merge** = one row, simpler, B1
disappears, one cleanup path; **split** = the hot liveness writes (D1) don't churn the durable
record's row/`updated_at`, and the lifecycles differ (record is rare, liveness is constant).
The split was recommended on lifecycle grounds (D1), but if liveness writes are throttled
(D1's fix) the churn argument weakens → merge may win on simplicity. **Decide deliberately.**

### B3. Cleanup: `project_id` cascade already covers it; session-level deferred
- transcripts → tracing retention (entitlement + cron), different DB/governance.
- interactions → cancel + TTL-predicate, **plus** the `project_id` cascade.
- `session_states` / `session_runners` → the **`project_id` `ON DELETE CASCADE`** (every facet
  has it) + `session_runners`' orphan sweep for liveness.
→ So there's no *gap*: deleting a project cascades all facets today. A **session-level** "delete
this session and everything attached" is a **later** user-facing feature (an endpoint that
internally deletes the corresponding mount/transcript/state/runner/interactions), anchored on
`session_states` if we add the cascade. Deferred — in the deferred-work file.

### B4. Session-overlay endpoint — ownerless in 3 specs → defer, each does its part
No session id resource exists (finding A), so there's no `GET /sessions/{id}` head. → **Each
worktree just does its own facet now**; the **overlay is a post-five task** (read-time join, or
a thin aggregator). Recorded in the deferred-work file; dropped from the individual specs' Qs.

---

## C. Security findings

### C1. Path injection + id hashing on path-bound values (sharpest SEC-8 case)
**mounts (and any id-in-path).** Mount `prefix`/`bucket`/`session_id` flow into a real
filesystem/object path on the runner (PoC fed `session_id` into the geesefs mountpoint). And a
`session_id` may be **external** (finding A) — we don't control its shape. So:
- **Validate** `prefix`/`bucket` shape at create AND re-assert at mount time — no `..`, no
  absolute paths, charset/length cap. Precedent: `folders` uses `fullmatch(r"[\w -]+", …)`
  (`api/oss/src/core/folders/service.py`); skills also validate paths — reuse that style.
- **Hash any id used in a path.** Whenever an id (esp. a possibly-external `session_id`) becomes
  part of a path/prefix/bucket, use a **deterministic hash** of it (compact, large-base encoding
  — e.g. base32/base62 of a digest) rather than the raw value. Deterministic so it's
  comparable/reversible-to-lookup; compact so paths stay bounded; and it neutralizes unexpected
  characters from an id we didn't mint. (Our own ids are uuid7/uuid5; external ones are
  arbitrary — hashing makes both safe-by-construction in a path.)

### ~~C2. Cross-DB ownership for transcripts~~ — WITHDRAWN (not a real issue)
RBAC already covers tracing: `VIEW_SPANS` / `VIEW_EVENTS` etc. are tracing permissions — RBAC
is **not** core-DB-only. A transcript read enforces the same way spans/events reads do (project
scope + the tracing view permission). No special cross-DB story needed.

### C3. Webhook SSRF — DEFERRED with webhooks
**interactions.** Detached webhook delivery reuses the `webhooks` domain (audit SEC-5: SSRF
default-open). **Webhooks work is deferred** entirely for now, so interactions v1 ships
**inbox-only** detached surfacing; webhook fan-out lands when webhooks (and its SSRF fix) do.

### C4. Respond = workflow-run authority; re-authorize, and start with an interactions worker
**interactions.** Respond builds a `/invoke` from the stored `references`/`selector` — model it
on how triggers do it (`tasks/asyncio/triggers/dispatcher.py`: resolve references → build
`WorkflowServiceRequest` → `invoke_workflow`). Two notes:
- **Re-authorize at respond time** — the responder must still have access to that
  revision/connection; a captured ref must not outlive the grant.
- **First implementation = an interactions worker** that does this invoke. Until **detached
  invoke** exists, the worker handles the run; **once detached invoke lands, interactions
  becomes the FIRST place we use it — and the template for triggers** to drop their worker too
  (finding D3).

---

## D. Scalability findings

### D1. `session_runners` heartbeat write amplification — AGREED
**runner-scalability.** Redis is the hot heartbeat; write the durable row **lazily** — on state
*change* + a coarse periodic checkpoint (~once/min), not every Redis refresh. (Also weakens the
split rationale in B2.) **Decided.**

### D2. Transcript ingestion: add a queue/worker (don't write synchronously)
**transcripts + runner-scalability.** Two related points:
- uuid7 ordering means a steer handoff A→B keeps *order* correct; the only residue is a possible
  *gap* if A dies mid-drain (B re-drives from the transcript) — acceptable, but pick the fix
  that balances **ordering safety vs how fast B can take over**.
- More importantly: **transcript ingest should be a QUEUE, like spans/events**, not a
  synchronous write per event. A **transcript worker** consuming an ingestion queue
  (Redis-Streams, as spans do) gives backpressure, decouples the runner from DB latency, and is
  consistent with the rest of tracing. → **elevate the transcripts ingest path (Q1) to "queue +
  worker," matching spans/events.**

### D3. Detached invoke — interactions is the first user; triggers follow
**runner-scalability owns detached invoke; interactions is its FIRST consumer; triggers next.**
Start: interactions responds via an **interactions worker** → once detached invoke exists,
interactions uses it (no worker held open) → that becomes the **proof/template for triggers** to
detach and shed their worker. Elevate detached invoke to a **named deliverable**. **Decided.**

---

## E. Smaller / completeness notes

- **E1 — mounts `read_only`: DEFERRED.** Drop from v1. It returns later as a **flag in
  `flags`** (alongside the external-mount fields). No v1 consumer needs the shared-writable vs
  shared-read-only distinction yet.
- **transcripts ingest path**: → **queue + worker** (Redis-Streams, like spans/events). See D2.
- **transcripts privacy erase**: a session-level delete is a deferred post-five feature
  (finding B3 / deferred-work file); for now project-cascade + tracing-retention cover it.
- **interactions `tool_call` kind**: confirm schema-only for v1 (still open, fine).
- **endpoint naming SETTLED**: `sessions` namespace, fixed sub-paths
  (`/sessions/states/`, `/sessions/runners/`, `/sessions/mounts/`, `/sessions/transcripts/`,
  `/sessions/interactions/`), keyed/filtered by `session_id`; mounts also keeps standalone
  `/mounts/`. No `/sessions/{id}/X`.
- **per-facet ids SETTLED**: each facet has its own uuid7 pk; `session_id` is a bare correlator;
  interactions adds a separate `token` column.

---

## Resolved this pass

- **A — no `sessions` table / `session_id` not an FK** (external sessions, like trace/span ids);
  session-level cascade deferred; ownership = `project_id`; no user owns a session; overlay has
  no id resource. **Deferred.**
- **B2 — close the liveness "open question" but raise the real one:** is `session_runners` even
  a separate table from `session_states`, or one row? (Both keyed only by `session_id`.)
- **C2 — withdrawn** (RBAC covers tracing: `VIEW_SPANS`/`VIEW_EVENTS`).
- **C3 — webhooks deferred**; interactions v1 = inbox-only detached.
- **D1 — agreed** (lazy durable writes). **D3 — agreed** (interactions first, then triggers).
- **E1 — `read_only` deferred** to a future `flags` boolean.

## Resolved (round 4)

- **B2 — keep `session_states` + `session_runners` SPLIT.** Demo separated them (durable record
  / Postgres vs liveness / Redis); different durability tiers; states 1:1, runners 1:1 (below).
  The `/sessions/` namespace unifies them at the API.
- **B1 — `sandbox_id` single source of truth in `session_states`** (the resume pointer).
  `session_runners` reads/references it for the sweep; it does NOT re-own the id.
- **`session_runners` is 1:1** per session (unique `session_id`, current-liveness, PoC-style);
  own `runner_id` pk for consistency only. (1:many assignment-log is a later option.)
- **D2 — transcript ingest = DEDICATED queue + worker** (own transcript stream, NOT reusing the
  spans/events pipeline — everything independent). Confirmed.
- **interactions outlive-its-run — NO.** Run cancel/steer cancels its pending interactions.

## Resolved (round 5)

- **Interactions kinds**: wire all three (`user_approval`/`user_input`/`tool_call`) in
  schema+protocol; only `user_approval` *implemented* in v1.
- **Affinity = coordinate via Redis** (not route). Runner connects to the same Redis.
- **Redis coordination = ONE contract, TWO implementations.** Python↔Node has no shared
  runtime, so we can't share code — author one **contract** (keys, TTLs, channel shapes,
  release-if-owner Lua) as the source of truth, implement it in Python (API) + TS (runner), and
  pin them with a cross-language **golden-fixture contract test** (like `protocol.ts ↔ wire.py`).
- **No Redis cache for `session_states`** — premature; Postgres only. (The ONLY Redis is the
  coordination plane.)
- **Concurrency cap ~1000 per container; over-limit → `429`** (scale out = more containers,
  not a queue). Tune the number later.
- **`data` is JSON, not JSONB** (the `DataDBA` mixin is `JSON`; only `status`/`flags`/`tags` are
  JSONB). The SDK record (session_states) and the request/references/selector/resolution
  (interactions) all live opaque **inside `data`** — no dedicated columns for them.
- **session_states record validation/versioning + transcript privacy-erase: DEFERRED.**
- **Mounts**: cwd mount = the session-bound one; shared/non-bound mounts NOT implemented v1
  (`session_id` already optional). Provisioning = create at mount-time (lazy).
- **Retention windows DEDICATED per signal** — transcripts ≠ spans ≠ events, each its own.
- **Transcript payload truncation** — per-line max size, mirroring how spans truncate.
- **Routes**: `/sessions/state/…` form (per the namespace), no `-state` suffix.

## Consolidated open questions (for our discussion)

**None.** All design questions across the five worktrees are settled — they're ready to build.
(Two items are explicitly DEFERRED, not open: session_states record validation/versioning, and
transcript privacy-erase — both revisit later.)

## Deferred to AFTER the five PRs (see `big-agents-audit/sessions-integration-deferred.md`)

- A real **session-level delete** endpoint that cascades mount + transcript + state + runner +
  interactions, tolerating external `session_id`s.
- The **session overlay** read endpoint (join across facets; no `sessions` id resource).
- **Webhooks / notifications** for interactions detached delivery (+ the SSRF fix dependency).
- **Triggers shed their worker** once detached invoke is proven by interactions.
