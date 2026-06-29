# Sessions — design index

The `sessions` domain is the durable + coordination layer for agent sessions. It is composed
of sub-domains that mirror the code layout (`core/sessions/<sub>`, `dbs/postgres/sessions/<sub>`,
one `apis/fastapi/sessions` router), plus the standalone `mounts` domain it delegates to.

| Sub-domain | What it owns | DB | Design |
|---|---|---|---|
| **states** | Durable SDK `SessionRecord` + sandbox resume pointer (1:1 per session) | core DB `session_states` | [states/](./states/) |
| **streams** | Live control/ownership handle for a session's ACP stream — invoke (DATA/FORCE matrix), heartbeat, attach/detach, liveness; Redis coordination plane | core DB `session_streams` + Redis | [streams/](./streams/) |
| **records** | Append-only persisted contents of a session's stream (events) | tracing DB `records` | [records/](./records/) |
| **interactions** | Human-in-the-loop requests raised by running agents (approvals, inputs, tool confirmations) | core DB `interactions` | [interactions/](./interactions/) |
| **mounts** (standalone) | Durable object-store mounts for agent working directories; `sessions/mounts` is a thin session-scoped layer over it | core DB `mounts` | [../mounts/](../mounts/) |

## Cross-cutting

- **RBAC**: one permission family `VIEW_SESSIONS` / `EDIT_SESSIONS` / `RUN_SESSIONS` across all
  sub-domains (granted mirroring the workflow roles). Runner-internal writes (stream
  heartbeat/detach, interaction state transitions) sit behind admin auth, not these.
- **Detached invoke**: interactions (respond) and triggers fire the runner's detached
  `/sessions/streams/invoke` — fire-and-forget, no held connection. See
  [interactions/cross-cutting-review.md](./interactions/cross-cutting-review.md) and the
  detached-invoke design.
- **`replica_id`** (which container owns a stream) is ephemeral routing state — Redis
  owner-lock only, never persisted.
