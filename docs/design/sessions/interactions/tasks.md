# Tasks — Interactions (approvals & HITL)

> Ordered, design-first. No implementation until [specs.md](./specs.md) open questions are
> resolved. `[ ]` = not started.

## 0. Decided (was blocking — now settled)

- [x] Always-persist `pending`, conditional webhook/notify fan-out (detached only).
- [x] Render question from **record**; gate actionability on the interaction record.
- [x] **Runner is the single state-machine writer; resolution flows through `/invoke`** (API =
      read + deliver). CAS-on-token idempotency; run lock = only serialization point.
- [x] Kinds named by expected answer: `user_approval` / `user_input` / `tool_call`.
- [x] **Cleanup = 3 mechanisms, one status write**: **project** deleted → `project_id`
      `ON DELETE CASCADE` (`session_id` is NOT an FK — sessions may be external; session-level
      delete deferred); run cancelled → `status='cancelled'` (runner write); TTL → hardcoded
      const in the actionable read predicate (no job/write). States =
      pending/resolved/cancelled(+denied). No `expired`/`superseded`, no `expires_at`, no sweeper.

- [x] **TTL ≈ 7 days** (`PENDING_INTERACTION_TTL`, hardcoded). Notifications deferred (v1 =
      inbox + webhook). RBAC = `VIEW_INTERACTIONS`/`RUN_INTERACTIONS`, granted to the
      workflow/service VIEW/EDIT/RUN roles. **pk = own `interaction_id` (uuid7); `token` is a
      separate indexed VARCHAR**; idempotency unique `(project_id, session_id, token)`.

- [x] **A question does NOT outlive its run** — run cancel/steer cancels its pending
      interactions (`status='cancelled'`). No survive+resume.
- [x] **Only `user_approval` implemented in v1**; `user_input` + `tool_call` are schema/protocol
      only (not wired).

## 1. Domain skeleton (`interactions`)

- [ ] `api/oss/src/core/interactions/dtos.py` — `Interaction`, `InteractionQuery`,
      `InteractionData` body, `kind` (`user_approval`/`user_input`/`tool_call`) + `status` enums.
      Plus `references: Dict[str,Reference]` + `selector` (bound workflow revision — mirror
      `TriggerSubscription.data`).
- [ ] `api/oss/src/core/interactions/types.py` — exceptions (`InteractionNotFound`,
      `InteractionAlreadyTerminal`, `InteractionCrossTenant`).
- [ ] `api/oss/src/core/interactions/interfaces.py` — DAO interface.
- [ ] `api/oss/src/core/interactions/service.py` — persist / query / **transition** (CAS on
      status keyed by `token`; `pending → resolved|denied|cancelled`). NOTE: transitions are
      **admin/runner-authored**; no public "resolve" write — user respond = `/invoke` built
      from the stored `references`/`selector`. `cancelled` is just a runner write (like resolve).

## 2. Persistence (core DB)

- [ ] `api/oss/src/dbs/postgres/interactions/dbes.py` — `InteractionDBE` composing
      `IdentifierDBA` (pk = own `interaction_id` uuid7), `ProjectScopeDBA, LifecycleDBA,
      StatusDBA, DataDBA, FlagsDBA` + `session_id` (bare correlator) + `run_id` (cancel scope) +
      `token` (VARCHAR, indexed) + `kind`. The **request + bound `references`/`selector` +
      `resolution` all live inside `data` (`DataDBA` = JSON, not JSONB)** — mirrors
      `TriggerSubscription.data`. Unique `(project_id, session_id, token)`. **`project_id` FK
      `ON DELETE CASCADE`**; **`session_id` NOT an FK**. **No `expires_at`/`superseded`.**
      **`status` IS a real state machine.**
- [ ] DAO: persist, get (by `interaction_id`), **CAS transition** (`WHERE project_id=$p AND
      session_id=$s AND token=$tok AND status='pending'`), and the **actionable query predicate** =
      `status='pending' AND deleted_at IS NULL AND created_at > now() - INTERVAL
      '<PENDING_INTERACTION_TTL const>'` (TTL is in the filter, NOT a sweeper). `project_id`
      enforced everywhere.
- [ ] `PENDING_INTERACTION_TTL` constant ≈ **7 days** — hardcoded, not per-project config.
- [ ] RBAC: define `VIEW_INTERACTIONS` + `RUN_INTERACTIONS` actions, granted to the same roles
      that hold workflow/service VIEW/EDIT/RUN. (`api/oss/src/core/access/`.)
- [ ] Mappings + migration for `interactions` (incl. the FK cascade).

## 3. API layer — two tiers

- [ ] **Admin (runner-only) write**: ingest/transition endpoint(s) — create `pending`, CAS to
      terminal. Behind the admin auth the runner already uses. **Not user-reachable.**
- [ ] **User-facing read**: `POST /sessions/interactions/query` (filter `session_id`),
      `GET /sessions/interactions/{interaction_id}`. Under the `/sessions/` namespace (fixed
      sub-path, NOT `/sessions/{id}/…`).
- [ ] **User-facing respond**: affordance that builds a detached/steer `/invoke` from the
      interaction's stored `references`/`selector` + the answer (the trigger-dispatcher pattern,
      `tasks/asyncio/triggers/dispatcher.py`: resolve refs → `WorkflowServiceRequest` →
      `invoke_workflow`). Same path for playground + API caller. **Re-authorize the stored refs
      at respond time** (responder must still have access to that revision/connection — a
      captured ref must not outlive the grant).
- [ ] Validate `id`/`session_id` shape + project ownership; enforce `VIEW_INTERACTIONS` (read)
      and `RUN_INTERACTIONS` (respond).
- [ ] Mount in `api/entrypoints/routers.py`.

## 4. Delivery mechanisms

- [ ] **Mechanism A (attached)**: runner's in-band `interaction_request` stream unchanged; the
      `pending` record is written alongside (always-persist) and flagged `delivered_in_band`.
      Late attachers render the question from the **record** and reconcile actionability
      against the record.
- [ ] **Mechanism B (detached)**: when `attached == false`, v1 = **inbox only** (the always-
      available query). Webhook/notification fan-out is **deferred** (webhooks work + its SSRF
      fix are out of scope now).
- [ ] Respond BOTH go through `/invoke` built from stored refs (playground steer/detached, API
      detached): the runner consumes the answer (keyed by interaction `id`) and admin-writes
      `resolved`. The run lock serializes competing answers — no second lock on the row.

## 5. Runner / state-machine-writer seam (lives on the runner side)

- [ ] Runner emits the `token` (we mint our own `interaction_id`); accepts the stored decision keyed
      by tool-call id / name+args (`responder.ts` — already implemented).
- [ ] Runner writes `pending` on raise (admin endpoint), capturing `run_id` + `references`/
      `selector`, in the same step it emits the record event.
- [ ] On run/turn cancel the runner writes that `run_id`'s pending interactions → `cancelled`
      (ordinary write, same path as resolve). **Depends on Open question 1.**
- [ ] **First impl = an interactions worker** that does the respond invoke. Once **detached
      `/invoke`** lands (runner-scalability), interactions becomes the FIRST consumer of it (no
      worker held open) — and the template for triggers to shed their worker. See cross-worktree.

## 5b. Cleanup — three mechanisms, only one a status write (orphan prevention)

- [ ] **Project deleted → DB `ON DELETE CASCADE`** on `project_id`. `session_id` is NOT an FK
      (sessions may be external); a session-level delete is deferred
      (`big-agents-audit/sessions-integration-deferred.md`).
- [ ] **Run/turn cancelled → `status='cancelled'`** — ordinary runner write (§5), same path as
      resolve. Session still exists; just this run was interrupted.
- [ ] **TTL → query-time predicate, NO job**: bake `created_at > now() - INTERVAL
      '<PENDING_INTERACTION_TTL const>'` into the actionable query (§2). No cron, no
      `deleted_at` write — a pending row ages out of actionability on its own, works even if the
      runner is dead. This is the backstop for a cancel-write that never happened.

## 6. Entitlements (if gated)

- [ ] Decide whether decoupled/programmatic approvals are a plan-gated feature (Gumloop treats
      it as a platform feature). If so, add a `Flag`/`Counter` in
      `api/ee/src/core/access/entitlements/types.py`; OSS keeps the in-band attached path
      ungated.

## 7. Tests

- [ ] Unit: resolve idempotency (re-resolve terminal = no-op, returns existing); status
      transitions reject illegal moves.
- [ ] Integration: DAO CAS transition under concurrent answers (two `/invoke`s → one wins,
      other sees terminal); run-lock serialization holds.
- [ ] Acceptance: attached run raises `user_approval` → answer via in-band `/invoke` →
      continues. Detached run raises it → appears in **inbox** → answer via detached `/invoke`
      → run continues. Both editions. (Webhook fan-out deferred — inbox only in v1.)
- [ ] Acceptance: late-attacher renders the pending question from the **record** and sees
      it as actionable (record=`pending`); an already-answered one renders as resolved.
- [ ] Security: cross-tenant inbox read blocked; double-answer (two `/invoke`s) cannot
      double-resolve (CAS-on-token).
- [ ] Cleanup: project delete cascades interactions away (`project_id` FK); run cancel →
      `cancelled`; a row older than the TTL constant is absent from the actionable query (no job
      ran). No interaction stays actionable with no path out, even with the runner dead.

## Cross-worktree dependencies

- **runner-scalability**: the `attached` signal (A vs B) + who continues a detached run +
  **detached `/invoke`** (respond uses it). Also owns the trigger-detach change below.
- **sessions-persistence**: detached-resolve relies on stored-decision + resume; cold-replay
  fallback (PER-4) without it.
- **records**: `interaction_request` is a record event; the interaction record is a
  separate mutable projection — keep them distinct.

## Cross-cutting: interactions is the FIRST detached-invoke user; triggers follow

The respond-via-`/invoke` here is the SAME "stored refs → `invoke_workflow`" pattern triggers
use (`tasks/asyncio/triggers/dispatcher.py`). Sequence:

- [ ] v1: an **interactions worker** does the respond invoke.
- [ ] once **detached `/invoke`** lands (runner-scalability), interactions is its **first
      consumer** — respond fires detached + returns, no held connection even for a long run.
- [ ] that proves the pattern → **triggers detach too** (always unattended; fire-and-forget),
      and their long-lived worker may become unnecessary. Deferred-work file + flagged in
      runner-scalability.

## Out of scope (v1)

- `tool_call` interactions (schema-ready, not wired).
- Read/write tool auto-classification (Gumloop's gap #4) — later policy enhancement.
- **Webhook + notification fan-out** (deferred with webhooks work + its SSRF fix) — v1 is
  inbox-only for detached.
- Web UI for the approvals inbox (frontend follow-up; this worktree is API + runner seam).
