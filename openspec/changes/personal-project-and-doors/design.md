# Design: personal project, service accounts, agent moves and doors

## Context

M6 builds on M1, M2, M3 and M4. Shared names and rules: CONTRACT.md sections 1, 3, 6, 7 and 10. Code research: `research-personal-project-and-doors.md`.

## Additions to the contract types

```python
class PrincipalKind(str, Enum):            # after D1
    HUMAN = "human"; SERVICE_ACCOUNT = "service_account"

class AuthSourceRef(BaseModel):            # which key or binding authenticated the principal
    kind: Literal["api_key", "installation"]
    id: UUID                               # api_keys.id | channel_agents.id

RunAuthority.source: AuthSourceRef | None  # None for a Bearer session
RunRestrictions.doors: frozenset[DoorKind] # default empty
DoorKind = find_agents | run_agent | read_files
```

The principal says who acts; the source says how it authenticated. The source never grants access. Before a stored authority is used, the server checks that the source is still live. This keeps the M2 deleted-key recheck after keys stop being principals.

| Run | `origin` | `origin_id` | `parent_run_id` |
| --- | --- | --- | --- |
| API key request | `api` | key id | none |
| Installation turn | `installation` | binding id | none |
| Door child run | `child` | none | parent run id |

## D1. Service identity

- A service account is its own table, not a `users` row, so it stays out of member lists and the EE seat gauge.
- `request.state.user_id` holds the service account id for a service principal, so handlers do not change and `created_by_id` holds actor ids. Code reads the kind from `request.state.principal`.
- Personal key: principal `(human, user_id)`, source the key. It acts within the user's current membership and role in the key's project. It has no sender, so the resources it creates are ownerless (CONTRACT section 7). Every organization-scoped decision refuses it, as it refuses every API key (CONTRACT section 6). Service key: principal `(service_account, id)`, source the key. `created_by_id` is audit only.
- Installation turn: principal the connection's service account, source the binding, M2 installation restrictions. The external sender is attribution.
- Service accounts, service keys and installations exist only in team projects.
- Resolver rule: a service account is a member of its own project only, with its stored role, if not deleted. No shortcut applies.

**Data (core_oss).** `service_accounts`: PK `(project_id, id)`, `id` globally unique, `slug` unique per project, `name`, `description`, `role` (role catalog slug, EE custom roles allowed), lifecycle columns with soft delete. `api_keys`: `principal_kind` (server default `human`), `principal_id`. `channel_connections`: `service_account_id` with FK `(project_id, service_account_id)`. `trigger_schedules`, `trigger_subscriptions`, `evaluation_runs`: `source_kind`, `source_id` (source liveness after keys stop being principals).

**Interfaces.** `ServiceAccountsDAOInterface` (`create`, `fetch`, `query`, `edit`, `delete`; delete also revokes the keys). M1 `MembershipsDAOInterface` gains `fetch_service_account_role(project_id, service_account_id) -> str | None`. Routes in `apis/fastapi/service_accounts/` under `MANAGE_SERVICE_ACCOUNTS` (owner and admin by default). Legacy key routes create personal keys only.

**Principal mappings.** The data migration and release B readers apply the same mappings to every stored M2 reference:

| Stored M2 reference | New principal | New source |
| --- | --- | --- |
| `(api_key, K)`, K not hidden | service account for `(K.project_id, K.created_by_id)` | `(api_key, K)` |
| `(api_key, K)`, K hidden | `(human, K.created_by_id)` | `(api_key, K)` |
| `(installation, B)` | installation service account of B's connection | `(installation, B)` |

Accounts: one per `(project, creator)` with a non-hidden key, with the creator's effective role at migration time; one "Channel installations" account per project with installations, with the lowest role that can run agents. A key whose creator has no effective access is revoked and reported; it keeps its mapping, so its schedules, subscriptions, evaluation runs and queued work fail the source check and pause. Rewritten records: `trigger_schedules`, `trigger_subscriptions`, `evaluation_runs`, the `run_envelope` of queued inputs, queued commands and parked interactions, and `session_turns` principal columns. Turns with `origin = api` and no `origin_id` get the key id.

## D2. Personal projects

- `projects.kind` (`team` or `personal`, server default `team`), `projects.owner_user_id` (FK `users.id` ON DELETE SET NULL), partial unique index on `(organization_id, owner_user_id) WHERE kind = 'personal' AND deleted_at IS NULL`, created concurrently.
- Resolver rule: a principal is a member of a personal project only if it is `human`, is the owner, and is a current member of the organization. Role `owner`. It runs before both shortcuts and does not read `project_members`. When the owner leaves, the rule denies everyone: the project locks with no extra state, and the M2 dispatch recheck pauses its schedules.
- `PersonalProjectsService.ensure(organization_id, user_id)`: insert with `ON CONFLICT DO NOTHING`, then read. Before M4 finishes, `workspace_id` is the organization's workspace.
- Every `/m` create-agent path (blank, template, duplicate) creates the agent in the creator's personal project. The API keeps creation in any project the caller may edit.
- M3 shares a session only with members of its project. So a personal-project session, including a door result, cannot be shared with another user.

## D3. Agent moves

Source P is the caller's personal project; target T is a team project of the same organization. The request names the visibility in T and a choice for each connection reference.

**Order, one transaction.** The foreign keys are immediate and composite on `(project_id, ...)`; revisions reference both their artifact and their variant.

1. Lock the source artifact. Rerun every refusal check.
2. Insert the target artifact row (same id, `folder_id` null) and the target variant rows (same ids).
3. Update every revision to `project_id = T`.
4. Update the M3 `agent_access` row and the agent mounts to T. Prefixes and files do not change.
5. Commit one new revision in T with the chosen connection references, if any changed.
6. Delete the source variants, then the source artifact.
7. Schedules (below), the `agents.moved` event, and a cache clear for P and T after commit.

**Schedules.** A delivery references its schedule by `(project_id, schedule_id)`, so a schedule cannot change project. Every schedule on the agent stays in P, paused, with its deliveries; its `artifact_id` no longer resolves in P. For each schedule whose principal is a human member of T and has no source, the move creates a new paused schedule in T with the same principal, input and cadence.

**Refusals.** Slug clash in T (artifact, variant, revision, moved mount). A running session of the agent (stream alive, with the same stale sweep as the session stream) or a pending approval. A moved mount on the old prefix. A reference in the latest revision to a skill or workflow in P. A connection reference without a choice. A session attachment on a moved mount (it would break its foreign key). A deployment of the agent to an environment in P; a move never deletes a deployment. A wrong target or missing access.

`AgentMovesService.preflight` (refusals, connection references, disclosure) and `.move`, on `AgentMovesDAOInterface` (`lock_and_collect`, `find_refusals`, `apply`). Routes `POST /workflows/moves/preflight` and `POST /workflows/moves/`, human Bearer only.

## D4. Doors

**Eligibility.** At run start, a run gets all three doors only if the principal is `human`, the source is none, the origin is `web`, and the project is that human's personal project. Every other run gets none, including child runs.

**Check per call, all three must allow:** (1) the door kind is in `restrictions.doors` and the target is a team project in the authority's organization; (2) `AccessService.decide(authority=None, principal=..., action, project_id=T, resource)` with membership read without the permission cache; (3) the M3 resource policy.

| Door | Action in T | Resource policy |
| --- | --- | --- |
| find agents | `VIEW_WORKFLOWS` | M3 agent list scope; without a project id, every member team project, with a limit |
| run an agent | `RUN_WORKFLOWS` | M3 agent use |
| read files | `VIEW_WORKFLOWS` or `VIEW_SESSIONS` by mount parent | M3 read on the mount's agent or session; server-side reads with a size limit, never a storage credential |

**Child run.** Authority: parent principal, project T, parent restrictions with no doors, no source. The child's trace, files, usage and meters are in T; its session in T is private to the principal. The result returns to the parent tool call and is stored only in the personal session. A child that pauses for approval returns a pending result; there is no approval relay.

**Events.** One `doors.crossed` event per call, allowed or refused, with the refusing part (`delegation`, `access`, `resource`).

`DoorsService` (no DAO): `check`, `find_agents`, `run_agent`, `list_files`, `read_file`, each taking the parent `RunAuthority` and `RunContext`. Routes `POST /doors/agents/query`, `/doors/agents/invoke`, `/doors/files/query`, `/doors/files/read` accept only run credentials. SDK ops `find_agents`, `run_agent`, `read_files` are offered only when the run's limits contain them.

## Migration and mixed-version behavior

All schema goes once in `core_oss`.

**D1, three releases.**

1. Release A: add the table and nullable columns. Pods read both the M2 kinds and the new shape, and still write the M2 kinds, so M2 pods never meet the new shape.
2. Release B: the data migration creates the accounts, fills the key and connection columns, and rewrites stored references. Pods write the new shape. A rollback to A is safe because A reads it. Work queued by an M2 pod during the rollout carries an M2 kind; B maps it on read.
3. Release C: after a check finds no stored M2 kind, and after the longest credential TTL has passed since release B so no Secret token signed with an M2 kind is valid, remove the two kinds and make the columns required.

The migration report runs in preview mode on a production copy first.

**D2.** A pod without the D2 resolver rule would let the shortcuts into a personal project. No personal project is created until every pod runs D2 and the rollback floor is past D2; the personal-space flag enforces this.

**D3, D4.** No schema except event types. Doors stay off until D1 release C is in production. The run-an-agent door also waits for M9 enforcement on every pod, since before M9 target trace readers can read the child result (CONTRACT section 10). The other two doors do not wait.

## Risks

A door run spends money and sends messages in T as the user, within the user's access, one level deep.

## Open questions

1. Key conversion roles in an EE organization without RBAC. Recommendation: the creator's stored role, not full access; revoke keys of creators without access; review the report first.
2. `created_by_id` holds service-account ids (one-way door). Recommendation: accept; the UI resolves names from the principal.
3. No installations in personal projects, so a personal agent cannot have a Slack installation. Recommendation: accept for M6.
4. Schedules in the personal project cannot open doors. Recommendation: keep narrow for M6.
5. `/m` cannot create an agent directly in a team project. Recommendation: personal first; sharing is a move.
