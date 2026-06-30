# Interactions (approvals & human-in-the-loop) — specs

> Status: **draft for discussion**. Fifth piece alongside mounts / records /
> sessions-persistence / runner-scalability. Grounded in the `big-agents` branch runner
> (`services/agent/src/responder.ts`, `protocol.ts`) and the audit
> (`big-agents-audit/` — FUN-6, PER-4, the Gumloop comparison gap #3). Not implemented.

## Problem

A harness doesn't only emit tool calls — it raises **reverse-RPC interaction requests** that
something must answer: a permission gate today, **elicitation (input)** and **client-side
tools** later. The runner already models this as an `interaction_request` event of
`kind: "permission" | "input" | "client_tool"` with an `id` (the reply token), and already
resolves them cross-turn (`HITLResponder`: stored decision by tool-call id, or by tool
name+args for cold-replay).

What's missing is everything **on the Agenta side of that boundary**: there is no durable
record of a pending interaction, no API to list/resolve them, and no way to reach a user when
**no session is attached**. The audit calls this out directly:

- **FUN-6** — approval model is coarse; no decoupled/programmatic (webhook + resolve) approvals.
- **PER-4 / F-S6-5** — approval pause replays cold (eases once durable sessions land — the
  sessions-persistence worktree).
- **Gumloop gap #3** — "decoupled, durable, programmatic approvals": webhook +
  `POST /approvals/{id}/resolve` + a Postgres state machine. Their model is approval-only and
  bespoke; ours should be the general **interactions** primitive, with approvals as kind #1.

## The three kinds — named by "what we expect back"

All three are reverse-RPC: the harness pauses and waits for the user/client to supply
something. They differ only in what's expected back, so we name them that way:

| domain `kind` | runner wire | what's asked | answer shape |
|---|---|---|---|
| `user_approval` | `permission` | "may I do this action?" (a tool call, a write) | a **decision** (allow/deny, maybe "always") |
| `user_input` | `input` (elicitation) | "I need information to continue" (a question) | a **value** (text/choice/form) |
| `tool_call` | `client_tool` | "run this tool on your side, give me the result" | a **tool result** |

The prefix asymmetry is deliberate: `user_*` answers come from a human; `tool_call` is
answered by the **client**, not necessarily a human (browser-side capability the sandbox
lacks). The `data` body and the `resolution` shape therefore vary by kind. The runner wire
names map to these at the ingest seam. **v1 implements `user_approval` only**; `user_input`
and `tool_call` exist in the schema/protocol but are not wired.

(Domain `interactions`, like mounts generalized "session mount" → "mount": one table, `kind`
discriminator, not a bespoke approvals-only table we'd widen the moment elicitation lands.)

## Single source of truth + single writer (the consistency model)

Two facts collapse the consistency problem:

**1. The record renders the question; the interaction record holds the answer-state.**
An `interaction_request` is **already a record event** (records worktree). A client —
attached live, OR attaching late, OR re-opening the session — renders the conversation
(including the question) by **replaying the record** (`sessions/records`, eventually
also surfaced via the invoke/inspect paths). So we do **not** need the interactions table to
*render* anything. The interactions table answers a different question: **is this request
still actionable, and what was the answer?**

- record = "what was asked" (append-only, replayable).
- interaction = "what's the answer / is it still open" (mutable state machine).

> Caveat (the one to keep): a replayed record contains `interaction_request` events from
> any point in history, some long since resolved/expired. So a client renders from the
> record but must **reconcile each `interaction_request` against the interactions state**
> to know which are still `pending` (actionable) vs terminal (show as already-answered/dead).
> Render from record; gate *actionability* on interactions.

**2. The runner is the single writer of the state machine; resolution flows through `/invoke`.**
"Resolving" an interaction is **not** a competing write to the table — it is **sending the
next turn's message via `/invoke`**, carrying the decision/value/result in the message
history (the runner's existing cross-turn HITL resolve, keyed by the `token`). The
playground does this as a steer/detached `/invoke`; an API caller does the **same** detached
`/invoke`. So:

- **The runner writes every state transition** — `pending` when it raises the request;
  `resolved` when it consumes the answer on the next turn; `cancelled`/`superseded` when the
  run dies/steers/replays (the runner-scalability side, which is "the runner system," not the
  API).
- **The interactions API is read + deliver only**: query the inbox, fan out webhooks/
  notifications when detached. It does **not** mutate the state machine in the normal path.
- **Serialization is the run lock, not the interactions row.** Multiple attached tabs and an
  API caller all answering = multiple `/invoke`s racing at runner-scalability's `alive`/steer
  lock. The first answer the runner consumes wins and flips state to `resolved`; later
  `/invoke`s see a terminal interaction (or a moved-on turn) and are no-ops/steers. One
  writer, one serialization point → consistent by construction. (This is why the earlier
  "resolve vs cancel race" disappears: both are handled by the same owner at the same lock.)

**The `token` is the idempotency anchor.** Re-delivering the same answer (in-band AND via
webhook) can't double-apply: the runner's resolve is a compare-and-set on status keyed by the
`token` (`pending → terminal`); the second arrival sees terminal. (`interaction_id` is our pk;
`token` is the matching key — see schema.)

### Detached delivery (Mechanism B) — what the API *does* own

When **no** session is attached (driver left, or a triggered/unattended run), the durable
`pending` record (always written — see below) lets Agenta reach someone:

- **inbox**: `POST /sessions/interactions/query` (filter by `session_id`) — pending/resolved.
- **webhook**: reuse the existing `webhooks` domain to notify an external system.
- **notification**: in-product channel (TBD — Open questions).

Resolving still goes through `/invoke` (detached), which routes to the runner. The decoupled
recipient either (a) responds detached (the runner picks up the stored decision on resume —
sessions-persistence), or (b) opens/attaches the session and responds in-band. Both are the
same `/invoke`; both end at the runner as the single writer.

### Resolution = stored refs + a detached `/invoke` — exactly like triggers

The "answer via `/invoke`" path is **the same pattern triggers already use**. A
`TriggerSubscription` / `TriggerSchedule` stores `references` (the bound workflow, the
`/retrieve` shape) + `selector` + `inputs_fields`, and the dispatcher resolves them and calls
`workflows_service.invoke_workflow(...)` (`api/oss/src/core/triggers/dtos.py`,
`tasks/asyncio/triggers/dispatcher.py`). Interactions mirror this:

- the interaction record **stores the same `references` (+ `selector`)** captured when it was
  raised — i.e. **the exact workflow revision that produced the question**.
- "respond to interaction X with decision/value/result" = build a `WorkflowServiceRequest`
  from those stored references + the answer payload, and call `invoke_workflow` — a detached
  `/invoke` against **that revision**, not whatever is latest. (Same reason triggers pin the
  revision: the continuation must run the same workflow that paused.)
- the runner consumes the answer (keyed by `token`) and CAS-writes `resolved`.

So the interaction carries a **bound-workflow reference family** the same way a subscription
does. This is the concrete content of the "resolution endpoint calls `/invoke` underneath."

### Detached invoke ⇒ no worker needed (cross-cutting; affects triggers too)

Today the trigger **worker** holds a connection for the whole run because invoke is
synchronous-ish. Once **detached `/invoke`** lands (a sessions/runner-scalability capability —
"kick off the turn, return immediately, the run continues server-side"), the caller does
**not** stay connected:

- **Interactions**: resolving fires a detached `/invoke` and returns — no worker, no held
  connection, even for a long continuation.
- **Triggers**: a trigger is *always* detached (nobody is watching) — so once sessions +
  detached invoke exist, **triggers should detach too**, and the long-lived trigger worker may
  become unnecessary (fire-and-forget the detached invoke instead of a worker babysitting the
  run). There is no point keeping a worker attached to what could be a very long session.

**Action carried into these PRs:** (1) interactions resolution uses detached `/invoke` once
available; (2) flag the trigger dispatcher/worker for the same detach treatment — likely in
runner-scalability (which owns detached invoke) or a trigger follow-up. Captured in tasks +
cross-worktree notes so it isn't lost.

### Always-persist, conditional fan-out (decided, not open)

The record is **always** written `pending` when the request is raised (one source of truth),
marked whether it was delivered in-band, and **fan-out (webhook/notify) fires only when
detached** (or after a grace period). This is what makes "detach, then someone attaches
later" consistent: the late attacher renders the question from the record and learns it's
still `pending` from the record — no special path, no double-send to reconcile.

> **Who writes the `pending` row on raise — runner or backend-on-ingest?** Either works as
> long as it's one of them; since the runner is the state-machine owner, the cleanest is: the
> runner emits the `interaction_request` (→ record) AND posts the `pending` interaction to
> the backend in the same step. See tasks Open question.

## Proposed schema (core DB)

Durable, queryable, config-DB-shaped (it's awaited state, not append-only telemetry). Reuse
the shared mixins.

| Field | Source | Notes |
|---|---|---|
| `id` (`interaction_id`) | `Identifier` (uuid7) | **our own** row id, minted by us — the clean pk. NOT the token. |
| `token` | column (VARCHAR, indexed) | the runner/harness-emitted token (the ACP reply-matching key + idempotency anchor). Externally-shaped → VARCHAR, indexed, never the pk. Unique `(project_id, session_id, token)`. |
| `project_id` | `ProjectScope` | tenant scope / ownership (SEC-8); FK `ON DELETE CASCADE`. |
| `session_id` | top-level | which session raised it. **Bare column, NOT an FK** (sessions may be external — finding A). Part of the scoped key. |
| `run_id` | column | **which run/turn raised it** — the cancel scope. A cancel targets a run; its pending interactions → `cancelled`. (NOT just session_id: a steer replaces the run but keeps the session.) |
| `kind` | column | `user_approval` \| `user_input` \| `tool_call` (runner wire `permission`/`input`/`client_tool` mapped at ingest) |
| `status` | `StatusDBA` (JSONB state machine) | `pending → resolved \| denied \| cancelled`. (This is the case `StatusDBA` exists for; contrast mounts, which had none.) **No `expired`/`superseded`** — TTL is a computed read-filter; project-delete is the `project_id` cascade (see below). |
| `data` | `Data`/`DataDBA` (**JSON**, not JSONB) | everything body-shaped, inside the one `data` field (mirrors `TriggerSubscription.data`): the **request** (tool name+args / prompt+schema / tool spec, by kind), the **bound `references` + `selector`** (the workflow revision to re-invoke), and the **`resolution`** once answered (decision/value/result + who/when/via). |
| lifecycle | `Lifecycle` | created/updated/deleted + `*_by_id` (incl. `deleted_at`, used for archival). TTL is a separate **computed read-filter** on `created_at`, NOT a `deleted_at` write; no `expires_at` column. |
| `flags` | `Flags` | small booleans (e.g. `delivered_webhook`, `delivered_in_band`) |

### `interaction_id` (our pk) vs `token` (the reply key) — distinct

Two separate identifiers, deliberately:

- **`interaction_id`** — our own minted uuid7 (`IdentifierDBA`), the clean primary key. Always
  well-formed; never of unknown shape.
- **`token`** — the harness-emitted reply-matching key (ACP permission id, reused as the
  `interaction_request` event id — `responder.ts`). Externally-shaped → a VARCHAR, **indexed**,
  used for reply matching + idempotency. **Never the pk.**

Uniqueness for idempotency: **`(project_id, session_id, token)`** unique (the resolve CAS keys
on this). The pk stays `interaction_id`. This drops the earlier "token-as-pk" awkwardness
(unknown chars / per-project uniqueness worries) — the token is just a lookup column.

This `<facet>_id` + `session_id` (bare correlator) pattern is uniform across all facets:
`state_id`/`runner_id`/`interaction_id` own ids; `session_id` the correlator; facet columns
(`record`, `sandbox_id`, `token`) alongside.

### States

- `pending` — raised, awaiting an answer.
- `resolved` — the runner consumed the answer (via `/invoke`). (`denied` may be a sibling
  terminal if we want to distinguish a no-decision; minor.)
- `cancelled` — **the run/turn was cancelled/interrupted**. The session still exists; this run
  was stopped, so its pending interactions are marked cancelled.

```text
pending ─runner consumes answer (next /invoke turn)─► resolved | denied
   └─runner: run/turn cancelled ────────────────────► cancelled
```

Status transitions are runner writes, CAS keyed on the token
(`WHERE project_id=$p AND session_id=$s AND token=$tok AND status='pending'`), admin-only — one
writer, the runner. `cancelled` is **nothing special**: it's the runner
kicking off a state update, the same path as resolve. (No `superseded`/`expired` status — see
below.)

### Three cleanup mechanisms — never leave an un-clearable `pending`

A `pending` row with no path out is a stuck question. Three mechanisms cover it, each matching
a different event — and **only one is a status write**:

1. **Project deleted → DB `ON DELETE CASCADE`** on the `project_id` FK (every facet has it).
   `session_id` is **NOT** an FK (sessions may be external — finding A), so there is no
   *session*-level cascade; project deletion is the structural cascade. (A user-facing
   session-level delete is deferred — see `big-agents-audit/sessions-integration-deferred.md`.)
2. **Run/turn cancelled → `status = cancelled`.** An ordinary runner write (same path as
   resolve). The session lives; just this run was interrupted.
3. **TTL → query-time predicate, NO job, NO write.** A pending row past a **hardcoded constant
   TTL** stops being *actionable* via the read filter:

   ```sql
   status = 'pending' AND deleted_at IS NULL
     AND created_at > now() - INTERVAL '<PENDING_INTERACTION_TTL const>'
   ```

   It ages out on its own — no engine, no cron, nothing to keep alive (matters: the backstop
   must work even when the runner is dead — a pure filter has nothing to die). Postgres has no
   native row-TTL; a computed predicate avoids needing `pg_cron`/a worker.

   - **Constant, not configurable** — a hardcoded `PENDING_INTERACTION_TTL` (days). No
     per-project state, no migration to change it. Per-project only if a real need appears.
   - **No `expired` status / `expires_at` column** — "expired" is *computed*, not stored.
   - **Physical cleanup is decoupled** — if aged rows should be physically removed for storage,
     that's an independent lazy pass, NOT part of correctness.

**Coverage:** project gone → cascade; run cancelled → `cancelled` write; everything else
(incl. a cancel-write that never happened because the runner died, or an abandoned session) →
the TTL filter ages it out. Only `cancelled` is a status write; the other two need no runner
and no job. A missing/failed endpoint can never strand a `pending`.

## Writes are admin-only ⇒ Option A is safe

The runner has (or can be given) access to the **admin** endpoints. So the interaction
**write** surface (ingest: create `pending`, transition to terminal) is an **admin** endpoint
— **users cannot mutate interaction state directly**. That's exactly what makes Option A (the
runner is the single writer) hold by construction: there is no user-facing state-write to race
the runner. Users get **read** (inbox) + **respond** (which is a `/invoke`, not a state write).

## Endpoints (proposed)

Two tiers:

Resource is **`/sessions/interactions/`** (fixed sub-path under the `sessions` namespace —
NOT `/sessions/{id}/…`; `session_id` is a filter param). Two tiers:

**Admin (runner-only) — the state writer:**

- ingest / transition (admin): create the `pending` interaction on raise; CAS to terminal on
  resolve/cancel. The runner reflecting its own state. Not user-reachable.

**User-facing — read + respond (no direct state write):**

- `POST /sessions/interactions/query` — the inbox: filter by `session_id` / kind / status;
  cursor pagination.
- `GET /sessions/interactions/{interaction_id}` — one interaction + current state (by our pk).
- **respond**: a user-facing "respond to interaction X" affordance, but underneath it is a
  detached/steer **`/invoke`** carrying the answer (decision/value/result), built from the
  interaction's **stored `references` + `selector`** (re-invokes the same workflow revision —
  the trigger pattern). Playground and API caller use the **same** `/invoke`. The runner
  consumes it (keyed by `token`) and (via the admin write) sets `resolved`. The user never
  writes the state machine directly.
- outbound: webhook (deferred — v1 inbox-only).

## Relationship to the other four worktrees

- **runner-scalability** owns **attached vs detached** (the `attached` lock) AND is the
  **state-machine writer** (it raises `pending`, and its cancel/steer drives `cancelled`). This
  worktree defines the record + inbox + delivery; the
  transitions are authored on the runner side. **The run lock is the single serialization
  point for competing answers** (multiple tabs + API) — there is no second lock on the
  interactions row.
- **sessions-persistence** — detached-resolve works because the decision rides `/invoke` and
  the next turn resumes (`HITLResponder` reads it). Without durable sessions it replays cold
  (PER-4) — still correct, slower.
- **records** — the `interaction_request` is a record event and is the **render
  source** (replay the record to show the question). The interaction record is the
  **answer-state**, reconciled against the replayed events to know which are still actionable.
  Don't conflate: record = append-only log; interaction = mutable state machine.
- **mounts** — orthogonal.

## What we take / don't take from Gumloop

- **Take**: decoupled webhook + programmatic `resolve` + a real status state machine incl.
  `expired`. (Their gap #3, our FUN-6.)
- **Generalize**: they do approvals only; we model `interactions` with approvals as kind #1,
  because the runner already raises `input`/`client_tool`.
- **Don't take**: their 4 fixed presets and read/write auto-classification as *prerequisites*
  — those are policy sugar on top (see runner's `permission: allow|ask|deny` + `auto|deny`
  policy). Auto read/write classification is a separate, later enhancement (audit FUN-6 tail).

## Decided (moved out of Open questions)

- **Always-persist, conditional fan-out** — record always written `pending`; webhook/notify
  only when detached.
- **Render from record, gate actionability on the interaction record** — no separate
  interactions-render path.
- **Single writer = runner, via admin-only writes.** The state-write surface is an admin
  endpoint (the runner has admin access); users can't touch it. Users get read + respond
  (respond = `/invoke`). This makes **Option A** safe by construction. → resolves the old
  "admin direct mutation" question: any admin mutation IS the runner's own write path; there is
  no user-facing state write.
- **Resolution = stored `references`/`selector` + detached `/invoke`** — exactly the trigger
  pattern; re-invokes the **same workflow revision** that raised the interaction.
- **`interaction_id` (our uuid7 pk) + `token` (the harness reply key, VARCHAR indexed)** —
  distinct. Idempotency CAS keys on `(project_id, session_id, token)` unique; pk is the clean
  `interaction_id`. (Replaces the earlier token-as-pk.)
- **Kinds named by what's expected back**: `user_approval` / `user_input` / `tool_call`.
- **A question does NOT outlive its run** — cancelling/steering the run **cancels its pending
   interactions** (`status='cancelled'`). No survive-and-resume-later; if the user still wants
   the action, they re-run. (Simplest/correct now; survive+resume is a possible later feature.)
- **TTL constant ≈ 7 days** (`PENDING_INTERACTION_TTL`). Hardcoded; per-project only if needed.
- **Notifications deferred** — v1 = inbox + webhook (via `webhooks`). Notification surface later.
- **RBAC**: new `VIEW_INTERACTIONS` (read inbox) + `RUN_INTERACTIONS` (respond) actions,
  initially granted to the same roles that hold `VIEW_/EDIT_/RUN_` on workflows/services
  (respond ≈ running a workflow; viewing ≈ viewing one). Cross-tenant blocked (SEC-8).
- **Three cleanup mechanisms, only one a status write.** (1) **project** deleted → DB
  `ON DELETE CASCADE` on `project_id` (no write/sweeper); `session_id` is NOT an FK
  (sessions may be external — finding A), session-level delete deferred; (2) run/turn cancelled
  → `status='cancelled'` (ordinary runner write); (3) TTL → hardcoded constant baked into the
  actionable read predicate (`created_at > now() - INTERVAL '<const>'`, no job, no write).
  States = `pending / resolved / cancelled` (+ maybe `denied`). No `expired`/`superseded`
  status, no `expires_at`, no sweeper. Guarantees no un-clearable pending even if the runner
  died (cascade + TTL-filter need no runner).

## Open questions (for discussion)

None — interactions v1 is fully specced. (All three kinds exist in schema+protocol; **only
`user_approval` is implemented** in v1 — `user_input` and `tool_call` are schema-ready, not
wired.)
