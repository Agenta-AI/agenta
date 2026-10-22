# Design: agent and session sharing (M3)

## Context

M3 adds the resource policy step of `AccessService.decide` (CONTRACT.md section 6) for kinds `agent` and `session`, and the ownership rule of CONTRACT.md section 7. The specs hold roles, locks and approvals; this design gives mechanisms. The interface and file-level plan is in `docs/design/sharing-program/interfaces/m3/`.

## Decisions

### D1. Storage

Agents use an optional `agent_access` row per workflow artifact; no row means project-visible and ownerless, and prompts and evaluators never get one. Sessions use two columns on `session_streams` (no join for lists) and `session_grants`. The core sees one `AccessPolicy` shape for both. Owner columns have no foreign key, like `created_by_id`: an unknown owner is not an active member, so the item locks.

### D2. One function computes the initial policy

`SharingService.initial_policy(principal, origin, sender_user_id, kind, requested)` computes every new item's policy on the server. `origin` is the RunContext origin for a run, and `web` (Bearer session) or `api` (ApiKey) for a direct request. The owner is, in order (CONTRACT.md section 7): the human sender of a `web` or `api` turn; the `human` principal of a `web` request; the `human` principal of a `schedule` run; else none. So every API key, installation, subscription, child run and evaluation run gives no owner. `kind=channel_session` always gives project-visible with no owner. Without an owner, a requested `private` is not applied and there is no refusal.

### D3. Atomic agent creation

`is_agent` is on the revision, and `GitDAO.create_artifact` commits alone and suppresses errors. A new `WorkflowsDAO(GitDAO)` inserts the artifact and its `agent_access` row in one transaction, through a non-committing insert helper in `GitDAO`, and raises a typed `AgentCreationFailed` after a rollback. An ownerless policy inserts no row. When the first agent revision is committed to an artifact with no row and D2 gives an owner, the commit adds a `project` row with that owner (insert if absent). That artifact was already visible, so this write can be separate.

### D4. Four session insertion paths

Each path passes a required `AccessPolicy` to the insert, never to a conflict arm.

| Path | Policy input |
| --- | --- |
| Turn start (`_start_turn`) | request principal and sender, requested visibility |
| Rename before the first turn (`set_header` create arm) | request principal, optional `visibility` query parameter |
| Trigger claim (`claim_trigger_delivery`) | schedule or subscription principal (M2); insert arm only |
| First heartbeat (`_heartbeat_locked`) | principal, origin and sender from the run envelope (M2) |

`/w` creates its chat through the rename create arm with `visibility=project` before it invokes, so the heartbeat finds the row.

### D5. Locked and rechecked sharing writes

An agent write locks the `workflow_artifacts` row, because an agent may have no access row. A session write locks the `session_streams` row and applies a delta (visibility, grants to add, grants to remove), so concurrent invites do not overwrite each other. The core passes the policy it decided on as `expected`. Inside the lock the DAO compares it with the current policy. If they differ, it raises `SharingConflict` and writes nothing, and the core decides again once. Making an agent private also sets `flags.is_active = false` on its channel agents in the same transaction.

### D6. Read scopes from the principal

`owner_user_id` in the scope is `principal.id` for a `human` principal and `None` otherwise, so an API key never lists its creator's private items. Grants are filtered by owner membership in the core.

### D7. Execution admission

Browser runs reach the agent service directly and bypass `_prepare_invoke`; the SDK exchange checks only `run_service`. So one function, `RunAdmission.admit(envelope, session_id, agent_artifact_id)`, checks the existing session (`RUN_SESSIONS`) and the execution target of the current turn (`RUN_WORKFLOWS`) through `decide`. It runs on every heartbeat that lacks verified continuity (see below), at queued dispatch, at approval resume, on a channel turn, at trigger dispatch (agent only) and at child invocation (agent only). The runner already refuses a turn whose first beat gets a 4xx, so the runner and the SDK do not change.

The checked agent is the revision the turn runs, never the session's stored `references` (first-write attribution) and never a trigger's stored `artifact_id`. Server paths pass the artifact of the revision that `_prepare_invoke` resolves (M2 `resolve_request_target`); a trigger resolves its target on every tick (M2 F6). The heartbeat passes the artifact that the beat's own `references` resolve to; the most specific reference wins. A turn with no agent reference (the `workflow` and `application` families, each with `_variant` and `_revision`, and `environment`) is a draft run and checks only the session. A turn whose reference resolves to nothing is denied (`AgentReferenceUnresolved`, 404); it never falls back to the session check.

Every heartbeat is authorized before it touches a lock, writes, or answers. `_heartbeat_locked` already reads the session row (`prior_stream`); M3 moves that read to the top, before the supersession check, and reuses it. A beat that finds no row checks the agent, then inserts the row (with its initial flags and policy) before any liveness lock. If the insert conflicts (a rename, a send or another beat created it first), the beat reads the winning row and authorizes it as an existing row before any lock, update or response. A beat for an existing row is checked (`RUN_SESSIONS` on the session, plus the agent for a running beat) unless it has verified continuity: it is running, its `turn_id` equals the row's `turn_id`, and its credential's principal equals the principal that a Redis admission record holds for that turn. The record is written only after the beat passed authorization for the row it actually uses, and its TTL is renewed on each verified beat (one `GETEX`), like `bind_turn`. A verified beat costs that one Redis call, no Postgres read and no access decision. Any other beat is checked, and a failed record read means a full check, never continuity. A refused beat changes no lock and no row and returns one canonical not-found body (or 403 when the caller can read the session).

### D8. Required resource policy

`ResourcePolicyInterface` lives in `core/access/interfaces.py`. `AccessService` takes it as a required constructor argument, and every composition root passes `SharingService`, so a root without it fails at startup.

### D9. Legacy marker

`session_streams.visibility` is nullable with no default. New code always writes it; only pre-M3 code writes `NULL`. The migration assigns every `NULL` row once, and the first direct access on a new pod assigns a `NULL` row written by an old pod during the deploy. A null owner is never the marker, so new ownerless rows are never claimed. Agents created by old pods during the deploy stay ownerless and project-visible (no marker is possible without a column on `workflow_artifacts`).

### D9a. Cached policy reads

`SharingService` reads agent and session policy through Redis (`sharing_agent_access`, `sharing_session_access`, TTL `AGENTA_CACHE_TTL`), as M2 does for membership, so a warm decision reads no Postgres row. "No agent row" is cached as a tagged entry; a session entry holds the policy and its grants; a missing session is not cached. One helper, `invalidate_sharing_caches`, runs after every sharing write commits (`set_agent_policy`, `set_session_sharing`, `create_agent_artifact`, `ensure_first_agent_access`) and after a session delete. Sharing writes read the current policy from the DAO under the row lock, never from the cache. Known limit: a read that races a write can refill the old entry for at most `AGENTA_CACHE_TTL`.

### D10. Audit

Sharing changes publish an event through the existing events stream (`publish_event`, `EventType.AGENTS_SHARING_CHANGED` and `SESSIONS_SHARING_CHANGED`) with the before and after policy, the grant delta, the principal, the credential kind and the request id. Denials are structured log lines. No credential value is recorded.

## Data structures

- `agent_access`: PK `(project_id, artifact_id)`, FK to `workflow_artifacts` ON DELETE CASCADE; `visibility` and `owner_user_id` NOT NULL (no FK); lifecycle columns.
- `session_streams`: `visibility` nullable, no default (`NULL` = legacy); `owner_user_id` nullable, no FK; check: `private` needs an owner.
- `session_grants`: PK `(project_id, stream_id, user_id)`, FK to `session_streams` ON DELETE CASCADE; `role` (`viewer` | `participant`). The owner is never a grant.

## Interfaces

The full signatures are in `docs/design/sharing-program/interfaces/m3/interfaces.md`. The main names:

- `core/sharing/`: `AccessPolicy`, `SessionSharingChange` (a delta), `UserSessionGrant`, `SharingDAOInterface` (every method `@abstractmethod`, DTO returns), `SharingService` (implements `ResourcePolicyInterface`), `RunAdmission`.
- `core/access/interfaces.py`: `ResourcePolicyInterface.evaluate(*, principal, action, project_id, resource) -> Optional[DecisionReason]`.
- `MembershipsService.query_project_members(project_id, search, windowing)` (M1 domain) backs `POST /sharing/members/query`; it applies the M1 resolver policy and never reads workspace members.
- Errors: `resource_denied` is internal. Routers answer 404 `not_found` for an item the caller may not read, and 403 `access_denied` for an action it may not take on an item it can read. Sharing responses carry `count` and a named payload.
- `Permission.MANAGE_AGENT_OWNERSHIP` (Admin role) only allows taking ownership of a project-visible agent with no active owner.

## Migration and mixed versions

One schema revision and one data revision in `core_oss`, run by the Helm hook before new pods start. The schema revision creates `agent_access` and `session_grants`, and adds the `session_streams` columns, the check (`NOT VALID`, then validate) and the index (concurrently). The data revision runs once: it adds a `project` row owned by `created_by_id` for each agent artifact with an `is_agent` revision and a non-null creator, and assigns every `NULL`-visibility session in batches: `project`, with the owner from the first turn's M2 attribution (CONTRACT.md section 7 rule), else the stream creator, else the first turn creator; channel sessions get no owner. There is no post-rollout script.

- Old pods on the new schema write sessions with `visibility NULL` and agents without a row. New pods list those sessions as project-visible and assign them at first direct access (D9).
- Old pods do not enforce visibility on reads (see Rollout).

## Rollout

M3 ships in one release (CONTRACT.md section 7): enforcement, admission, private writes, the owner default for an omitted visibility, the `/m` sharing UI, the disclosure, and the audit events. `/w` creates project-visible chats and agents until it is retired; its edits are an explicit exception to the `web/AGENTS.md` rule for `web/oss`. Accepted risk: rolling back to pre-M3 code, or an old pod during the rolling deploy, makes private items visible to their project.

## Risks

A missed read path leaks a private item; task 1.2 inventories the paths, and the parity and admission tests cover them. Latency is a hard requirement: warm decisions read Redis only (D9a), and heartbeats after the first beat of a turn add no read (D7). Traces (until M9) and unexpired storage credentials stay readable, and the UI and docs say so.

## Decided (former open questions)

Pre-M2 API-key items go to the key creator in the backfill. Grantees of a departed owner's private session lose access. Only sessions that reference an agent can be shared. A running turn finishes after its sender loses access. Human-schedule sessions are private to that human; subscriptions and child runs give no owner. Ownerless sessions keep today's rename, archive and delete rule.
