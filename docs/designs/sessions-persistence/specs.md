# Sessions persistence — specs

> Status: **draft for discussion**. Distilled from `poc-persistent-sessions`
> (`sessions/demo/`), cleaned up for the real stack. Not implemented.

## Problem

The runner opens a **fresh** `SandboxAgent.connect()/start()` on every turn. The SDK's
default persist is in-memory, so across turns it has no record of a session and
`resumeOrCreateSession` always **creates a brand-new agent session** — the harness starts
each turn with no memory of the conversation (only a durable cwd, if any, carries over).

To make a session genuinely resumable we must persist, across cold runner connects, the
**SDK SessionRecord** (the local-id → agentSessionId mapping, sessionInit, modes, model,
…) and the **remote sandbox id** (so a resumed run can reconnect the same sandbox, or
recreate + remount when it's gone). Combined with the durable transcript (other worktree) as
the replay source, this is what makes `resumeOrCreateSession` actually **resume**.

This is audit FUN-1 (durable sessions) + PER-1/PER-2 (cold start / full-history replay).

## Postgres only — no Redis in this worktree

The durable agent record lives in **Postgres** (`session_states`). **This worktree uses no
Redis.** (The PoC cached some of this in an ad-hoc Redis; we drop that — `session_states` is a
tiny one-row read/write per turn, Postgres handles it fine. The *only* Redis in the whole
effort is runner-scalability's coordination plane — locks/affinity/cancel — which is a
different concern.) So: **"persistence" = Postgres here; "coordination" = Redis there.**

### The durable agent record (`session_states`)

The SDK's `SessionRecord` is **small, durable metadata** that rides alongside the transcript.
It is config-shaped (not append-only), so it lives in the **core DB**.

**`session_states` is metadata, not blobs.** The SDK record is a small JSON object
(local-id → agentSessionId, sessionInit, modes, model) stored **opaque under the standard
`data` field** — one row per session keyed by `session_id`. It is **not** content-addressed,
not deduped, not testcase-blob-shaped, and we don't model its internals. So the name
`session_states` is right: it's "the state *of* a session," a dependent facet, exactly one per
session. (The `session_` prefix is correct for the same reason as `session_runners`.)

- DB table stays **`session_states`** (one row per session: `data` (opaque SDK record) +
  `sandbox_id`).
- API = **`/sessions/states/`** (under the `sessions` namespace, fixed sub-path) keyed by
  `session_id` (NOT nested
  `/sessions/{id}/state` — the codebase doesn't nest a domain under `/<parent>/{id}/…`).
  Sibling to `/sessions/transcripts/`, `/sessions/runners/`, `/sessions/interactions/`,
  `/sessions/mounts/`.
- Round-tripped by the runner's persist driver (PoC `session-persist.js` `makePersist`):
  - `getSession(id)` → `GET /sessions/states/{session_id}`
  - `updateSession(record)` → `PUT /sessions/states/{session_id}`
  - `listEvents({sessionId})` → reads the **transcript** (other worktree) — the replay source
  - `insertEvent()` → no-op (the transcript path already writes events; never double-write)

## Naming: `session_states` (+ `session_runners`), surfaced under `/sessions`

There is **no `sessions` table** yet — a "session" is just a UUID that threads through
transcripts, state, mounts, and runner liveness. Each worktree adds one **facet** keyed by
`session_id`. So: do we name the facet tables `session_states` / `session_runners`, or bare
`states` / `runners` (or even fold everything under a real `sessions` entity)?

**Recommendation — split the layers:**

- **API / service layer**: a **`sessions` namespace** with fixed sub-paths —
  `/sessions/states/`, `/sessions/runners/`, `/sessions/mounts/`, `/sessions/transcripts/`,
  `/sessions/interactions/` — each keyed/filtered by `session_id`. **Not** `/sessions/{id}/…`
  (no id mid-path). Mounts ALSO has a standalone top-level `/mounts/` (mounts that aren't
  session-bound); `/sessions/mounts/` is the session-filtered view of the same domain.
- **DB tables (core DB)**: `session_states` and `session_runners` — **prefixed**, because
  they are *dependent facets* with no independent existence (a runner-liveness row is
  meaningless without its session). A bare `runners` table would mislead (it reads like a
  registry of runner *processes/replicas*, a different thing we may also want later).
- **Tracing DB**: `transcripts` stays **bare** (already decided) — it lives in a different
  DB and parallels `spans` / `events`, which are also unprefixed.
- **No `sessions` table, and `session_id` is NOT an FK** — like `trace_id`/`span_id`. We host
  observability/sessions for agents running **outside Agenta**, so a `session_id` may reference
  something that isn't ours; it can't FK to a row that may not exist. Each facet is
  project-scoped (`project_id` cascade) with a **bare `session_id` column**. The "session
  overlay" is a **read-time join** (no backing table). A session-level delete is deferred
  (`big-agents-audit/sessions-integration-deferred.md`).

This keeps us from prematurely answering "what is a session entity" — and correctly models that
a session id is a **correlator**, not an owned entity.

## Resume flow (target)

1. Turn arrives for session `S`.
2. Runner's persist driver `getSession(S)` → `record` from `session_states` (Postgres).
   `sandbox_id` read alongside.
3. `resumeOrCreateSession({ id: S, … })`:
   - record present → resume the prior agent session; SDK calls `listEvents` → transcript →
     replays prior context.
   - record absent → create; first `updateSession` persists the new record.
4. Remote sandbox: reconnect `sandbox_id` if alive; if gone, recreate + remount the durable
   cwd (mounts worktree). Persist the (possibly new) `sandbox_id` back.
5. On turn end the runner `updateSession(record)` so the next turn resumes cleanly.

## Proposed schema (core DB)

Table `session_states` (cleaned from PoC):

| Field | Type | Notes |
|---|---|---|
| `id` (`state_id`) | uuid7 | **own pk** (`IdentifierDBA`), for consistency with the other facets |
| `session_id` | str | **bare correlator, NOT an FK** (sessions may be external); unique (1:1) |
| `project_id` | UUID | tenant scope / ownership; FK with `ON DELETE CASCADE` |
| `data` | `Data`/`DataDBA` (**JSON**, not JSONB) | the SDK SessionRecord, stored **opaque** under the standard `data` field (NO dedicated `record` column, no validation/versioning) — same shape as every other entity |
| `sandbox_id` | str? | remote sandbox id for resume; null = no live sandbox. **Single source of truth** (the resume pointer). |
| `created_at` / `updated_at` | ts | |

> **Decided:** `sandbox_id` (which sandbox to resume) lives **here, as the single source of
> truth**. `session_runners` carries only **liveness** (`sandbox_live`) and references the
> session; it does NOT re-own `sandbox_id`. State and runner stay **separate tables** (different
> durability tiers — see runner-scalability "Naming"/"Relationship").

## Endpoints (proposed)

Under the `/sessions/states/` sub-path, keyed by `session_id` (NOT `/sessions/{id}/state`):

- `GET /sessions/states/{session_id}` (or `?session_id=`) → the row; its `data` is the SDK
  record the driver's `getSession` returns
- `PUT /sessions/states/{session_id}` → upsert (`updateSession` writes the record into `data`)
- `PUT /sessions/states/{session_id}/sandbox-id` → record/clear the remote sandbox id (PoC split
  this out so a *detached* run still records where it ran)

(`listEvents` reads `/transcripts` filtered by `session_id` — transcripts worktree.)

## What we clean up from the PoC

- Ad-hoc Redis cache of the record → dropped; Postgres only (no Redis in this worktree).
- `sandbox_id` living on the `sessions` table → on `session_states` as the **single source of
  truth** (resume pointer); `session_runners` carries only `sandbox_live`.
- The demo's single Postgres → core DB for `session_states`, tracing DB for transcripts.
- The persist driver stays a **thin adapter** over the API (no SQL in the runner).

## Decided

- **Liveness/attached lives in `session_runners`, NOT here.** `session_states` = durable agent
  record; `session_runners` = ephemeral run/liveness. **Separate tables** (different durability
  tiers).
- **`sandbox_id` single source of truth = `session_states`** (the resume pointer);
  `session_runners` carries only `sandbox_live`.
- **`state_id` own uuid7 pk; `session_id` bare correlator (NOT FK), unique 1:1.**
- **No Redis in this worktree** — Postgres only. (The persistence-cache idea is dropped; the
  only Redis in the effort is runner-scalability's coordination plane.)

## Decided (record storage)

- **SDK record stored opaque in `data`** (the standard `Data`/`DataDBA` field, which is **JSON**,
  not JSONB). No dedicated `record` column; no validation/versioning of its internals.

## Open questions (for discussion)

1. **Ownership (SEC-8)**: state/sandbox-id endpoints must enforce project ownership and
   validate the `session_id` shape — same gate as transcripts/mounts.

> The **combined session overlay** + the **`sessions` table / ownership anchor** questions moved
> to the cross-cutting review (findings A, B4) — they span all five worktrees and shouldn't be
> owned by this one alone.
