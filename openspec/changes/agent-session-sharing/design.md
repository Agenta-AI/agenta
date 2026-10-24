# Design: agent and session sharing (M3)

## Context

M3 adds the resource policy step of `AccessService.decide` (CONTRACT.md section 6) for kinds `agent` and `session`, and the ownership rule of CONTRACT.md section 7. The specs hold roles, locks and approvals; this design gives mechanisms. The interface and file-level plan is in `docs/design/sharing-program/interfaces/m3/`. Both are aligned with the implementation plan. CONTRACT.md v3 already holds the M3 contract changes. M3 ships as one implementation PR with ordered commits.

## Decisions

### D1. Storage

Agents use an optional `agent_access` row per workflow artifact; no row means project-visible and ownerless, and prompts and evaluators never get one. Sessions use two columns on `session_streams` (no join for lists) and `session_grants`. The core sees one `AccessPolicy` shape for both. Owner columns have no foreign key, like `created_by_id`: an unknown owner is not an active member, so the item locks.

### D2. One function computes the initial policy

`SharingService.initial_policy(principal, origin, sender_user_id, kind, requested)` computes every new item's policy on the server. `origin` is the RunContext origin for a run, and `web` (Bearer session) or `api` (ApiKey) for a direct request. The owner is, in order (CONTRACT.md section 7): the human sender of a `web` or `api` turn; the `human` principal of a `web` request; the `human` principal of a `schedule` run; else none. So every API key, installation, subscription, child run and evaluation run gives no owner. `kind=channel_session` always gives project-visible with no owner. Without an owner, a requested `private` is not applied and there is no refusal. Every ownerless case returns the constant `OWNERLESS_PROJECT_POLICY`; channel code passes it directly and needs no `SharingService`.

### D3. Atomic agent creation

`is_agent` is on the revision, and `GitDAO.create_artifact` commits alone and suppresses errors. A new `WorkflowsDAO(GitDAO)` inserts the artifact and its `agent_access` row in one transaction, through a non-committing insert helper in `GitDAO`, and raises a typed `AgentCreationFailed` after a rollback. An ownerless policy inserts no row. When an agent revision is committed to an artifact with no row and D2 gives an owner, the commit adds a `project` row with that owner, in one statement that locks the artifact row first and inserts only when no agent revision is earlier by `(created_at, id)`. So the committer of the earliest agent revision owns the agent, whatever order concurrent commits run in. That artifact was already visible, so this write can be separate. `ensure_first_agent_access` lives only on `WorkflowsDAOInterface`, because the commit path owns it; `commit_workflow_revision` and `commit_workflow_revision_checked` both forward the owner.

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

An agent write locks the `workflow_artifacts` row, because an agent may have no access row. A session write locks the `session_streams` row and applies a delta (visibility, grants to add, grants to remove), so concurrent invites do not overwrite each other. The core passes the policy it decided on as `expected`. Inside the lock the DAO compares it with the current policy. If they differ, it raises `SharingConflict` and writes nothing, and the core decides again once. Making an agent private also sets `flags.is_active = false` on its channel agents in the same transaction (`COALESCE(flags, '{}'::jsonb) || ...`, because `flags` can be SQL NULL; a JSON `null` value is replaced by an object first). The agent lock requires an artifact with an `is_agent` revision, and the agent sharing routes check the same before they read the policy, so an unknown id, a prompt or an evaluator answers not-found instead of reading as an ownerless agent. The service writes take the organization id and the request access, because the audit event needs them. A non-owner write on a readable item is a 403; on an unreadable item, a 404. A write that changes nothing commits nothing.

Writes return typed results. `set_agent_policy` returns `AgentPolicyWriteResult(policy, deactivated_channel_agent_ids)`; after the commit the service clears the cached installation principal of each deactivated channel agent through M2's `PrincipalsDAOInterface.invalidate_principal`. `set_session_sharing` returns `SessionSharingWriteResult(state, before, grants, upserted, removed_user_ids)`, so the service invalidates the right user entries and publishes the grant delta without a second read.

Channel activation takes the same lock. `ChannelsService` takes an optional `workflows_service`; an activating write without it fails closed, and only the routers process wires it. `ChannelsDAOInterface.create_agent` and `edit_agent` take `guard_artifact_id`; when it is set, the write transaction first calls `lock_agent_policy` (lock the artifact row, read `agent_access` uncached) and refuses a private agent before it writes the binding. Channel references go through `channel_agent_references`; a binding that names no agent key is refused.

The sharing routes read the policy state, `is_channel` and `references_agent` from the DAO, never from a cache, because `references` is filled once by a later heartbeat and a cached `shareable` would be stale.

### D6. Read scopes from the principal

`owner_user_id` in the scope is `principal.id` for a `human` principal and `None` otherwise, so an API key never lists its creator's private items. Grants are filtered by owner membership in the core. The read scope is required on every agent query method (`query_workflows`, `query_workflow_variants`, `query_workflow_revisions`, `query_workflow_head_revisions`, `SimpleWorkflowsService.query`) and on `SessionsService.query_sessions`. Callers that do not list agents for a person (applications, evaluators, skills, skill import) pass `AgentReadScope(owner_user_id=None)`, which hides every private agent. There is no unrestricted scope.

### D7. Execution admission

Browser runs reach the agent service directly and bypass `_prepare_invoke`; the SDK exchange checks only `run_service`. So one class, `RunAdmission`, checks the existing session (`RUN_SESSIONS`) and the execution target of the current turn (`RUN_WORKFLOWS`) through `decide`. `admit(envelope, session_id, agent_artifact_id)` does the check. `admit_turn` (heartbeat) first resolves the beat's references with `resolve_agent_artifact_id`. `admit_request` (server paths) first resolves the request with M2's `resolve_request_target`, once; `_prepare_invoke` does not resolve again. A refusal raises `AdmissionDenied(AccessDenied)` with `readable` (True when the caller may read the session but not act), so the heartbeat route answers 403 or 404 without a second check. A refused queued dispatch or resume is settled by M2's `_settle_refused_continuation`. It runs on every heartbeat that lacks verified continuity (see below), at queued dispatch, at approval resume, on a channel turn, at trigger dispatch (agent only) and at child invocation (agent only). The runner already refuses a turn whose first beat gets a 4xx, so the runner and the SDK do not change.

The checked agent is the revision the turn runs, never the session's stored `references` (first-write attribution) and never a trigger's stored `artifact_id`. Server paths pass the artifact of the revision that `_prepare_invoke` resolves (M2 `resolve_request_target`); when no target resolves but the references name an agent (an inline revision), that agent is resolved on its own and checked, and an agent reference that resolves to nothing is refused. A trigger resolves its target on every tick (M2 F6). A template start is admitted before anything is claimed. Evaluation runs and the services-layer invoke (no API route; its turns are admitted by the heartbeat) are not admission points. The heartbeat passes the artifact that the beat's own `references` resolve to; the most specific reference wins. A turn with no key of `AGENT_REFERENCE_KEYS` (the `workflow` and `application` families, each with `_variant` and `_revision`, and `environment`) is a draft run and checks only the session. A turn whose reference resolves to nothing is denied (`AgentReferenceUnresolved`, 404); it never falls back to the session check.

Every heartbeat is authorized before it touches a lock, writes, or answers. `_heartbeat_locked` already reads the session row (`prior_stream`); M3 moves that read to the top, before the supersession check, and reuses it. A beat that finds no row checks the agent, then inserts the row (with its initial flags and policy) before any liveness lock. If the insert conflicts (a rename, a send or another beat created it first), the beat reads the winning row and authorizes it as an existing row before any lock, update or response. A beat for an existing row is checked (`RUN_SESSIONS` on the session, plus the agent for a running beat) unless it has verified continuity: it is running, its `turn_id` equals the row's `turn_id`, the turn is the session's current turn, and its credential's principal equals the principal that a Redis admission record holds for that turn. The record (`record_turn_admission`, `get_turn_admission`, `forget_turn_admissions`, next to `bind_turn`) is written only after the beat passed authorization for the row it actually uses. One Lua script returns and renews the record only while the session's `running` key names the turn (one `EVAL` per verified beat). The record is deleted on the end beat, on displacement (cancel, steer, kill), on handover and on stop, and a refused end beat deletes the record of its own principal, so a replay of an ended turn is fully checked. The heartbeat route passes `admission_envelope = request_run_envelope(request)` next to M2's `envelope`, which is `None` for Bearer and ApiKey. A verified beat costs that one Redis call, no Postgres read and no access decision. Any other beat is checked, and a failed record read means a full check, never continuity. A refused beat changes no lock and no row and returns one canonical not-found body (or 403 when the caller can read the session). A beat without a run credential gets the unknown-session answer (403 `session_requires_run_credential`) when it may not read the session. The runner write routes (records, interactions, turns) use the same continuity: a write that names a turn whose admission record holds the caller's principal needs no decision; any other write gets the full session check.

### D8. Required resource policy

`ResourcePolicyInterface` lives in `core/access/interfaces.py`. `AccessService` takes it as a required constructor argument. M1's `bootstrap_access()`, the only composition helper, builds `SharingService`, passes it, and registers it (`register_sharing_service`, `get_sharing_service`), so a root without it fails at startup. `DecisionReason.RESOURCE_DENIED` lands with the sharing contracts, before the rules that return it.

### D9. Legacy marker

`session_streams.visibility` is nullable with no default. New code always writes it; only pre-M3 code writes `NULL`. The migration assigns every `NULL` row once, and the first direct access on a new pod assigns a `NULL` row written by an old pod during the deploy. A null owner is never the marker, so new ownerless rows are never claimed. Agents created by old pods during the deploy stay ownerless and project-visible (no marker is possible without a column on `workflow_artifacts`).

### D9a. Cached policy reads

`SharingService` reads agent and session policy through Redis (`sharing_agent_access`, `sharing_session_access`, TTL `AGENTA_CACHE_TTL`), as M2 does for membership, so a warm decision reads no Postgres row. "No agent row" is cached as a tagged entry; a session entry holds the policy and its grants; a missing session is not cached. A human's grants are cached in `sharing_user_grants` (key project and user, written also when empty), so a warm human session list adds no read. Every nullable field of a cached model has an explicit `= None` default, because the cache serializer drops `None` values. One helper, `invalidate_sharing_caches(*, project_id, artifact_ids, session_ids, grant_user_ids)`, runs after every sharing write commits (`set_agent_policy`, `set_session_sharing`, `create_agent_artifact`, `ensure_first_agent_access`) and after a session delete; session writes pass every user whose grant changed, and a delete passes the deleted session's grantees. A failed invalidation logs a warning and never fails the writer. Killed and archived sessions keep their policy: `fetch_session_policy` reads the row whatever `deleted_at` and `archived_at` hold, and only a hard delete makes the session unknown. Sharing writes read the current policy from the DAO under the row lock, never from the cache. Known limit: a read that races a write can refill the old entry for at most `AGENTA_CACHE_TTL`.

### D9b. Other entry points

Embedded references are checked once, in the universal embeds resolver: each embedded workflow, application or evaluator revision gets rules A1 and A2 for the request's principal, and a hidden one raises the same error as an unknown reference. The project watch stream filters each event by the watcher's resource check and drops a frame whose check fails. Routes where an unknown id creates something (send, header, input admit, uploads, mount sign and create, runner writes) answer the canonical not-found body for a hidden id; every other route answers exactly what it answers for an unknown id. `entry-points.md` lists every route.

### D10. Audit

Sharing changes publish an event through the existing events stream (`publish_event`, `EventType.AGENTS_SHARING_CHANGED` and `SESSIONS_SHARING_CHANGED`) with the before and after policy, the grant delta, the principal, the credential kind and the request id. Denials are structured log lines. No credential value is recorded.

### D11. Web

`/m` builds the sharing UI against the design the owner approved on 2026-10-23. That design changes three points of this change:

1. Addition: "Copy share link" in the share dialog footer and in the session row menu. The link gives no access by itself; it opens only for people who can already read the chat, and anyone else sees the not-found page of an unknown chat.
2. Deviation: the share disclosure is one sentence that names the agent's connected accounts and says that the people added will see everything in the chat. It leaves out the trace readers statement on purpose (traces are out of scope until M9). The API still returns the three disclosure flags, and the UI ignores the trace one. The user docs state the trace limit.
3. Placement: agent privacy is a small dropdown in the playground top bar. The agent overview page is off for now.

Roles show as "Can view" (`viewer`) and "Can send" (`participant`). Share is unavailable until a new chat's first turn has saved its agent reference. `/w` creates project-visible chats and agents: one create wrapper passes `visibility: "project"` (the template load included), and a new chat is pre-created through the header create arm before its first invoke. A template load creates its first session with the requested visibility before the invoke.

## Data structures

- `agent_access`: PK `(project_id, artifact_id)`, FK to `workflow_artifacts` ON DELETE CASCADE; `visibility` and `owner_user_id` NOT NULL (no FK); lifecycle columns.
- `session_streams`: `visibility` nullable, no default (`NULL` = legacy); `owner_user_id` nullable, no FK; check: `private` needs an owner.
- `session_grants`: PK `(project_id, stream_id, user_id)`, FK to `session_streams` ON DELETE CASCADE; `role` (`viewer` | `participant`). The owner is never a grant.

## Interfaces

The full signatures are in `docs/design/sharing-program/interfaces/m3/interfaces.md`. The main names:

- `core/sharing/`: `AccessPolicy`, `OWNERLESS_PROJECT_POLICY`, `SessionSharingChange` (a delta), `UserSessionGrant`, `SessionSharingWriteResult`, `AgentPolicyWriteResult`, `SharingDAOInterface` (every method `@abstractmethod`, DTO returns), `SharingService` (implements `ResourcePolicyInterface`), `RunAdmission`, `AdmissionDenied`, and the pure `build_share_disclosure(*, parameters)` in `disclosure.py`. `SharingService` has no disclosure method and never calls `AccessService`.
- `apis/fastapi/sharing/`: `SharingRouter` with `tags=["Sharing"]` (Fern generates `resources/sharing`, wrapped by `getSharingClient()`); `check_resource(request, *, action, resource) -> ResourceCheck` (`ALLOWED`, `HIDDEN`, `FORBIDDEN`, `NO_CAPABILITY`); the canonical `NOT_FOUND_ERROR`. The router reads the agent's head revision through `WorkflowsService` for the disclosure, and ANDs `can_send` (rule S2 from `SharingService`) with `decide(RUN_SESSIONS, resource=session)`.
- `core/access/interfaces.py`: `ResourcePolicyInterface.evaluate(*, principal, action, project_id, resource) -> Optional[DecisionReason]`.
- `MembershipsService.query_project_members(project_id, search, windowing)` (M1 domain) backs `POST /sharing/members/query`; it applies the M1 resolver policy and never reads workspace members. OSS lists organization members with the organization role; EE lists project rows with the project role, which can be null (`ProjectMemberProfile.role` is optional). Search is a prefix on email or username; the order is email, then id; the route always sends a limit.
- Errors: `resource_denied` is internal. Routers answer 404 `not_found` for an item the caller may not read, and 403 `access_denied` for an action it may not take on an item it can read. Sharing responses carry `count` and a named payload.
- `Permission.MANAGE_AGENT_OWNERSHIP` (Admin role) only allows taking ownership of a project-visible agent with no active owner.

## Migration and mixed versions

One schema revision (`oss000000048`, `down_revision = "oss000000047"`) and one data revision (`oss000000049`) in `core_oss`, run by the Helm hook before new pods start. The schema revision creates `agent_access` and `session_grants`, and adds the `session_streams` columns, the check (`NOT VALID`, then validate) and the index (concurrently). The data revision runs once: it adds a `project` row owned by `created_by_id` for each agent artifact with an `is_agent` revision and a non-null creator, and assigns every `NULL`-visibility session in batches: `project`, with the owner from the first turn's M2 attribution (CONTRACT.md section 7 rule), else the stream creator, else the first turn creator; channel sessions get no owner. There is no post-rollout script.

- Old pods on the new schema write sessions with `visibility NULL` and agents without a row. New pods list those sessions as project-visible and assign them at first direct access (D9).
- Old pods do not enforce visibility on reads (see Rollout).

## Rollout

M3 ships in one release (CONTRACT.md section 7): enforcement, admission, private writes, the owner default for an omitted visibility, the `/m` sharing UI, the disclosure, and the audit events. `/w` creates project-visible chats and agents until it is retired; its edits are an explicit exception to the `web/AGENTS.md` rule for `web/oss`. Accepted risk: rolling back to pre-M3 code, or an old pod during the rolling deploy, makes private items visible to their project.

## Risks

A missed read path leaks a private item; task 1.2 inventories the paths, and the parity and admission tests cover them. Latency is a hard requirement: warm decisions read Redis only (D9a), steady heartbeats of the admitted run add no Postgres read and no access decision, and a checked beat that names an agent adds one indexed read (D7). Traces (until M9) and unexpired storage credentials stay readable, and the UI and docs say so.

## Out of scope / follow-ups

- Skills, prompts and evaluators keep project visibility in M3. A private agent can use project-visible skills that other members can edit; those members still cannot see the agent or its sessions. Follow-up: skill visibility (private skills come with the M6 personal project, or a per-item setting if needed earlier).

## Decided (former open questions)

Pre-M2 API-key items go to the key creator in the backfill. Grantees of a departed owner's private session lose access. Only sessions that reference an agent can be shared. A running turn finishes after its sender loses access. Human-schedule sessions are private to that human; subscriptions and child runs give no owner. Ownerless sessions keep today's rename, archive and delete rule.
