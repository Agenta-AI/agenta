# Sessions domain — identifier glossary

> One authoritative list of every id/correlator across the five session facets
> (states / streams / transcripts / interactions / mounts), the coordination plane,
> and the execution wire. Written before Phase 2 so we don't conflate terms or carry
> redundant ones. Each entry says **what it points to**, **who mints it**, **its
> lifetime/cardinality**, and **how it relates to the others**.
>
> The headline issues this surfaces are in §"Conflations & redundancies to resolve".

## The shared scope ids (every facet carries these)

| id | type | what it points to | source of truth |
|---|---|---|---|
| `project_id` | UUID | the tenant/project that owns the row; FK → `projects.id`, `ON DELETE CASCADE`. The minimum scope on every read/write. | platform |
| `session_id` | str | **the conversation.** A bare string correlator, **NOT an FK** — sessions may be external/SDK-minted, so no table owns it. Every facet keys off it; it is the join key across all five facets and the coordination plane. | the caller / SDK |
| `<row>.id` | UUID (uuid7) | each facet row's **own primary key** (`IdentifierDBA`). Named per-facet below (`state_id`, `stream_id`, …). Exists for row identity/lineage; the *business* key is almost always `session_id`. | the facet DAO |

`session_id` is the spine. Everything else is either (a) a facet's own row pk, (b) a
pointer into another system (sandbox), or (c) a coordination-plane correlator (turn /
watcher / replica).

## Facet row ids (one own-pk per facet)

| id | facet | table | cardinality vs session | notes |
|---|---|---|---|---|
| `state_id` | states | `session_states` | **1:1** (unique `session_id`) | own uuid7 pk; the business key is `session_id`. The durable agent record lives here. |
| `stream_id` | streams | `session_streams` | **1:1** (unique `session_id`) | own uuid7 **pk**; the durable run/liveness mirror of the Redis nest, created **once per conversation**. The business key is `session_id`. **Distinct from `turn_id`**: the stream row is the 1:1 durable home; `turn_id` is the ephemeral *running* correlator stamped into its `turn_id` column, replaced each turn. One `stream_id` outlives a *succession* of `turn_id`s. |
| `transcript event id` (`id`) | transcripts | `session_transcripts` | **1:many** | own uuid7 pk per event; ordered within a session by `event_index`. |
| `interaction_id` (`id`) | interactions | `session_interactions` | **1:many** | own uuid7 pk per interaction (one pending question/answer cycle). |
| `mount_id` (`id`) | mounts | `mounts` (standalone) | **1:many**, optional session | own uuid7 pk; a mount is a standalone durable directory whose `session_id` is an *optional* pointer (it can outlive any session). |

> Note the asymmetry: states and streams are **1:1 with the session** (the session has one
> durable record and one liveness mirror), while transcripts, interactions, and mounts are
> **1:many** (a session accrues many events, many interactions, and may bind several mounts).

## Pointers into other systems

| id | type | what it points to | owned by | notes |
|---|---|---|---|---|
| `sandbox_id` | str | the **remote sandbox** (Daytona/E2B/Modal/local) that holds the durable cwd — the resume pointer. | `session_states` (**single source of truth**) | streams does NOT re-own this; the dropped `sandbox_live` bool used to live on streams and was removed. Killing a sandbox needs this id + the provider. |
| mount `path` / `uri` | str | a file/prefix inside a mount's durable directory. | mounts | not an id per se, but the addressing key inside a mount; listed so it isn't confused with `mount_id`. |

## Coordination-plane correlators (the nest + affinity)

These are **not row pks** — they are Redis lock *values* that the streams facet mirrors.
All three are scoped by `session_id` (the lock keys are `<role>:session:<session_id>`).

| id | role in the nest | what it identifies | who mints it | lifetime / cardinality |
|---|---|---|---|---|
| `turn_id` | **alive + running** lock value | the **currently-running stream** — `turn_id ⟺ running`. One execution of the agent loop. Born when a run *starts running*, replaced when running restarts (steer), gone when running *stops* (cancel/end). **Attach does NOT mint one** — it reads the turn already running. | **whoever starts the run owns it**: the coordination plane in `_start_turn` (uuid7) for send/steer commands, OR the runner when it starts a session-owned execution-plane run (uuid4 via `randomUUID` — a turn_id is a *lock value, not a pk*, so v4 is fine; consistency with `_start_turn`'s v7 is cosmetic). | one per turn; a session sees a *sequence* of `turn_id`s. **One name everywhere** — DTOs, interactions, the wire (`turnId`), lock helpers (`run_id`/`runId` gone). **Mirrored to a `session_streams.turn_id` column** (Postgres mirror of the Redis lock value) so an attaching/fetching client reads the current turn from the row. |
| `replica_id` | **owner** lock value (affinity) | the **runner container/process** — the *producer* side. **Distinct from `turn_id`.** | the runner, **once per process** (`AGENTA_AGENT_RUNNER_REPLICA_ID` or a uuid). | **one per container**; many turns share it. With 2+ containers each holds its own, so a control signal routes to the box running the session. |
| `watcher_id` | **attached** lock value | one **client socket** watching the live view — the *consumer* side. | the API in the ATTACH command (uuid7). | many over a turn's life: clients attach, detach, and get displaced on steal. NOT `token_id` (that name collides with the interaction `token`). |

The nest invariant: `attached ⟹ running ⟹ alive`, i.e. a `watcher_id` only exists while a
`turn_id` holds running, which only exists while alive is held.

**Producer vs consumer**, the one-line distinction:
`replica_id` = *who is running this turn* (producer; owns `owner`/`alive`/`running`).
`watcher_id` = *who is watching this turn* (consumer; owns `attached`).

## Interaction correlators

| id | type | what it points to | relationship |
|---|---|---|---|
| `token` | str | the **interaction's own external correlator** — the opaque handle a tool/agent uses to refer to a pending question ("respond to *this* prompt"). Distinct from `interaction_id` (the row pk): `token` is the agent-facing name, `interaction_id` is the DB pk. | one per interaction. This is why the watcher correlator is `watcher_id`, **not** `token_id` — `token` is already taken, and means something unrelated. |
| `turn_id` | str (optional) | on an interaction, the **turn** that raised it — the *same* `turn_id` the streams facet and the wire use. | links an interaction back to the turn that produced it. **Now one name** (was `run_id`; renamed in lockstep). |

## Execution-wire ids (runner `/stream` request)

| wire field | maps to | notes |
|---|---|---|
| `sessionId` | `session_id` | the conversation; the runner owns "the live id across turns". |
| `turnId` | `turn_id` | the turn's coordination-plane id — proves alive-lock ownership on heartbeat. **Renamed from `runId`** in lockstep (protocol.ts + wire.py + wire_models.py + both contract tests). |
| `projectId` | `project_id` | set alongside `turnId` on session-owned runs. |

The heartbeat (`POST /admin/sessions/streams/heartbeat`) now carries **both** `replica_id`
(the container — refreshes `owner` affinity) and `turn_id` (refreshes `alive`/`running` —
proves the turn still owns the lock). That is what makes the design correct for 2+ containers.

## Conflations & redundancies — RESOLVED

1. **`turn_id` is now the single name everywhere.** Was three names (`turn_id` streams /
   `run_id` interactions / `runId` wire) for one concept. **Resolved**: renamed to `turn_id`
   across interactions (DTO/DBE/dao/mappings + migration `oss000000009`), the lock helpers
   (`acquire/refresh/release_alive`), and the wire (`turnId` — protocol.ts + wire.py +
   wire_models.py + both golden contract tests, in lockstep). No `run_id`/`runId` remains in
   the sessions/agent path (the evaluations-domain `run_id` is unrelated and untouched). ✅

2. **`replica_id` is a distinct stable container id.** Was conflated with `turn_id` in the POC
   (`alive.ts` sent `replica_id: runId`). **Resolved**: the runner mints `REPLICA_ID` once per
   process (`AGENTA_AGENT_RUNNER_REPLICA_ID` or a uuid) and heartbeats it *alongside* `turn_id`.
   `replica_id` drives `owner` affinity (container), `turn_id` drives `alive`/`running` (turn).
   **The design is correct for 2+ containers today** — affinity routes control signals to the
   box running the session, and the box proves its turn ownership separately. ✅

3. **`watcher_id` vs `token`** — deliberately distinct, not a conflation. `watcher_id` =
   attached-lock value (consumer socket); `token` = interaction external handle. Naming the
   watcher `token_id` would collide — avoided. ✅

4. **`<facet>.id` vs `session_id` as "the id"** — every facet has its own uuid7 pk, but the
   *business* key is `session_id` for the 1:1 facets (states/streams). Don't expose the row pk
   as the primary handle in the web layer; key the inspector tabs off `session_id`, surface the
   row pk only where lineage matters (transcript events, interactions). (guidance, not a bug) ✅

5. **`sandbox_id` single-owner** — lives only in `session_states`; streams dropped
   `sandbox_live`. Do not reintroduce a sandbox pointer on streams. ✅

## Quick map (how an inspector tab resolves ids)

```
session_id ──┬─→ session_states   (state_id, sandbox_id)        [1:1]
             ├─→ session_streams  (stream_id, flags, turn_id)   [1:1]   ← Redis nest mirror
             ├─→ session_transcripts (event id, event_index…)   [1:many]
             ├─→ session_interactions (interaction_id, token, turn_id) [1:many]
             └─→ mounts            (mount_id, path…)             [1:many, optional]

coordination plane (Redis, keyed by session_id):
   alive:<sid>     = turn_id      (the turn proves ownership)
   running:<sid>   = turn_id
   owner:<sid>     = replica_id    (the container — distinct id, stable per process)
   attached:<sid>  = watcher_id    (consumer holds it)
```
