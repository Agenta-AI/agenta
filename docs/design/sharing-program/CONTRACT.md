# Sharing program: normative contract

Status: proposed, not implemented. Version 3 (2026-10-22), after three Codex reviews.

This file is the single source for the names, rules and ownership boundaries that the OpenSpec changes share. A change specifies only its own additions and points here for everything else. When a change and this file disagree, this file wins, and the change must be fixed.

Changes: M1 `project-membership-resolver`, M2 `run-principal`, M3 `agent-session-sharing`, M4 `remove-workspaces-org-storage`, M5 `organization-credentials`, M6 `personal-project-and-doors`, M9 `session-trace-privacy`, M7 `personal-credentials-bindings`, M8 `agent-use-grants` (deferred design note only).

## 1. Tenancy

- The organization is the tenant boundary. Nothing crosses it.
- A project holds membership, execution and resources. A project can be a team, an app, an environment or a client. Do not call a project "a team" in code.
- Workspaces leave the data model (M4) and permission decisions (M1). The classic `/w` app keeps its API shape: where a workspace id is expected, the API answers with the organization id, until `/w` is retired.
- A personal project (M6) has exactly one owner, who must also be a current organization member. Nobody else can be a member.

## 2. Membership (owned by M1)

- One resolver answers: is this user a member of this project, and with which role. Every caller uses it: Bearer authentication, project listing, capability checks, and membership mutations.
- OSS policy: every organization member is a member of every non-personal project, with their organization role. This is a deliberate OSS access change, not a behavior-preserving refactor. The M1 change reports the expansion and the role collapse.
- EE policy: membership comes from `project_members` rows.
- OSS to EE conversion materializes the effective OSS membership as rows, including correcting stale existing rows. EE to OSS expands access, and the runbook says so.
- Before cutover, M1 counts EE organizations with more than one workspace and EE users whose access changes because the workspace gate goes away. The owner accepted the wider access for these cases (2026-10-22): the report lists them and does not block. Only duplicate membership rows block, because the unique index needs them gone.
- Mutations: `MembershipsDAOInterface.set_member_role`, `remove_member`, project creation with seeding in one DAO operation (one transaction), and `transfer_ownership`, which seeds the new organization owner into every project in the same transaction (from M6: every non-personal project; a personal project keeps its single owner). No other mutation methods.

## 3. Principal and run provenance (owned by M2)

```text
PrincipalRef(kind, id)
  kind: human | api_key | installation          # M6 adds service_account and retires api_key, installation
  installation.id = one agent binding in one channel connection

RunAuthority(principal, organization_id, project_id, restrictions, linked_user_id: UUID | None)
  # linked_user_id: for an installation turn, the linked Slack user whose role is used (else the binding creator's role)
  restrictions: RunRestrictions(agent: AgentRef | None)   # M2 never sets it; decide refuses any non-null value, so a later writer cannot fail open on M2 pods
  # M6 adds: source: AuthSourceRef(api_key | installation, id)  (liveness only, never grants)
  #          restrictions.doors                                 (door delegation limits)

RunContext(run_id: str | None, parent_run_id: str | None, origin, origin_id: str | None)
  origin: web | api | installation | schedule | subscription | evaluation | child
  # run_id is None for web, direct-API and batch runs, which have no run id in their credential
  origin_id: the key id (api), the binding id (installation), the schedule or subscription id; none for child (use parent_run_id)
```

- A schedule's target agent column does not cascade on delete. Deleting the agent pauses the schedule.

- Schedules, subscriptions and child runs are origins, not principals. A child run inherits its parent's principal and restrictions.
- A turn stores: `sender` (the human who sent it, or the external channel sender as attribution only), the principal, and the RunContext. A session stores ownership and access only. It has no acting principal.
- On approval resume, the turn keeps its original sender and authority. The approver is recorded separately as `approved_by = RunApproval(principal, user_id, external_key)`, which names the approving principal kind.
- Every token mint and every execution boundary takes the trusted RunAuthority: `_prepare_invoke`, `inspect_workflow`, evaluation dispatch, gateway and MCP credentials, child invocation, queued inputs and commands, approval resume, schedule and subscription dispatch. New work never falls back to `human(user_id)`. M2 ships in one deploy (owner decision, 2026-10-22): schedules, subscriptions and evaluation runs get their principal from a backfill in a second revision of the same release (schema expansion first, then the batched backfill); queued inputs, commands and parked approvals without stored authority are cancelled with a clear error; run tokens minted before the deploy are refused, and the run is retried. The migration backfill is the only place that builds `human(created_by_id)`, and only for rows that exist at migration time. After the deploy, a trigger without a principal is paused (`missing_principal`) and an evaluation run without one fails.
- The request carries `request.state.principal`, `request.state.authority` and `request.state.credential_kind` (`RequestCredentialKind`: `bearer_session | api_key | run_credential`) next to `user_id`. `check_action_access` keeps its signature and reads the principal from the request. Handlers that use `user_id` do not change. `check_action_access` uses the request's principal only. With no request access, or with a `user_uid` that is not the request's acting user, it fails. A check about another human calls `AccessService.check_human` explicitly.

## 4. Installation execution (M2, used by M3)

Owner decision (2026-10-22): keep today's Slack and Telegram behavior in this program. Restricting installations is a later, additive change.

- M2 records the data: a channel turn's principal is the installation (`installation` kind, id = the binding), and the linked user, if any, is recorded as the sender.
- M2 keeps today's authority for channel turns: the linked user's own role when the Slack user is linked, else the binding creator's role. No installation restrictions are enforced.
- This is not a one-way door. Because the principal and the sender are stored on every turn, a later change can add restrictions (an operation list, bound-agent-only, no child agents) or move linked users to delegated credentials without a data migration.
- Known risk, unchanged from today: a channel user acts with the binding creator's capabilities when not linked.

## 5. Schedules and subscriptions (M2)

- A schedule stores its executing principal and its target agent (a column).
- Edits keep today's behavior in M2 (owner decision, 2026-10-22): anyone with the edit capability may change a schedule, and it keeps its executing principal. M7 adds the edit rule in section 6, because personal credentials make it matter.
- Subscriptions run through the same dispatcher and get the same current-access recheck before each run. No separate identity system.

- An environment-bound trigger resolves its current target at each dispatch, before the access check and the claim, and the invoke runs the resolved revision. The access check in section 7 authorizes that resolved revision. `artifact_id` is stored only for direct references and is never an authorization target.
- Evaluation runs: the principal is set at create, at an explicit start, and at an explicit rerun; edits and maintenance routes keep it.

## 6. Access decision (M2)

```text
AccessService.decide(*, authority: RunAuthority | None, principal: PrincipalRef,
                     action: Permission | RoleRequirement,
                     project_id: UUID | None = None, resource: ResourceRef | None = None) -> Decision
```

- Order, fixed: (1) membership eligibility, (2) authority restrictions, (3) capability (EE no-RBAC and organization-owner shortcuts apply only here), (4) resource policy (M3 and later).
- From M3, `AccessService` requires a resource policy, and every composition root passes it. Startup fails without it.
- Denial reasons, fixed: `principal_inactive` (a deleted key, a disconnected binding, a removed user), `not_member`, `restricted_by_authority`, `missing_capability`, `resource_denied`.
- The tenant scope comes from the requested project, never from a human identity record.
- Organization-scoped decisions are NOT in M2. M5 adds them with their own policy that EE no-RBAC shortcuts cannot bypass.
- Caching: no cache stores a decision. `decide` runs on every call. Membership is cached per (user, project), including its absence, and invalidated by every M1 membership mutation, so decisions stay fast and fresh; the principal record is cached for `AGENTA_CACHE_TTL` and invalidated on key deletion, binding and connection changes, and user deletion. The exchange mints a run credential only after `decide` allows. Credential exchanges that perform no permission check still check principal eligibility (steps 1 and 2). Revocation takes effect at the next decision. A change can take up to `AGENTA_CACHE_TTL` (300 s) in three known cases: Redis invalidation fails; a read that started before the mutation committed refills the old entry after the invalidation; and the ApiKey middleware state on routes that check no permission. Run tokens live 15 minutes, gateway and mount credentials 12 hours, and live streams recheck every 60 seconds.
- Durable executable work (schedules, subscriptions, evaluation runs) gets one edit rule in M7, not before: only the executing principal may change what it executes. Others with the capability may pause, stop, archive or delete it. A rerun or a copy is new work whose principal is the person who starts it.
- Organization-scoped decisions (M5) accept only a browser-session human. Every API key, including M6 personal keys, and every run credential is refused.
- List scopes derive owner and grant eligibility from the principal, never from a creator id. List and direct reads must agree for every principal kind.

## 7. Resource ownership (M3)

- One rule, applied in this order:
  1. A web or API run turn with a human sender: the sender owns what the turn creates. Channel turns (origin `installation`) never give an owner, even with a linked sender.
  2. A browser-session request by a human: that human owns what it creates.
  3. A schedule run whose principal is a human: that human owns what it creates.
  4. Anything else (any API key, including M6 personal keys, an installation, any subscription, a child run, an evaluation run): the resource is project-visible and has no owner.
- This applies to direct requests and to runs, including agents created by tool calls.
- Every point where a run starts or resumes (a heartbeat without verified continuity, queued dispatch, approval resume, trigger dispatch, channel turn, child invocation) checks the existing session and the execution target of the current turn through `decide`. The target is the revision that the turn runs, resolved at that point; a session's stored references and a trigger's stored `artifact_id` are never authorization targets. A reference that resolves to nothing is denied. A run with no agent reference checks only the session. Every heartbeat is authorized before it writes or answers; only a running steady beat of the admitted run (same turn id as the row, same principal as the Redis admission record of that turn) skips the check, with no Postgres read and no access decision. When the admission record cannot be read, the beat gets the full check.
- Agent and session policy reads are cached per item for `AGENTA_CACHE_TTL` and invalidated after every sharing write, so a warm decision reads no Postgres row. Like the membership cache, a read that races a write can refill the old entry for at most `AGENTA_CACHE_TTL`.
- The backfill touches only legacy rows: agents that exist when the migration runs, and sessions whose `visibility` is null (written by pre-M3 code). A null owner is never a migration marker.
- An ownerless agent has no `agent_access` row, at creation and in the backfill. `agent_access.owner_user_id` is never null.
- Channel sessions are project-visible and ownerless. Channel policy takes precedence over the general rule.
- Every session insertion path receives a server-derived initial access policy, including trigger claims (`claim_trigger_delivery`) and heartbeat-first creation.
- An agent and its private access row are committed in one transaction. If no access row exists, the agent is project-visible.
- Rollout (owner decision, 2026-10-22): one release. Enforcement and private writes ship together. Accepted risk: rolling the app back to pre-M3 code makes private items visible to their project.

## 8. Credentials (M5, M7)

- One owner DTO in core: `SecretOwner(kind: organization | project | user, id)`. Storage keeps the existing typed columns (`organization_id`, `project_id`, later `user_id`) with a check constraint.
- Two kinds of reference, never mixed:
  - A named reference (slug) resolves by inheritance: project, then organization. This is M5.
  - An exact binding names one credential id and never substitutes another. This is M7.
- Existing slug references keep their M5 named meaning after M7. M7 does not reclassify them as exact.
- Agent connection binding (M7): `caller_account | project_default | specific`. `specific` never names a user-owned credential.
- Shared-session rule (M7): a session shared with others never releases a user-owned credential. The check and a sticky "used a personal credential" mark on the session are done under one session-row lock, before any personal credential is used. A session with that mark cannot be shared later.
- Organization credential values never reach a user-controlled sandbox. Paths that deliver plaintext refuse inherited organization credentials.
- Organization subscription logins are not supported. User-owned subscription logins are M7.

## 9. Storage (M4)

- Each mount row stores its prefix (after the deployment namespace). Existing mounts keep `mounts/<project_id>/<mount_id>/`. No copy. The layout of new mounts depends on the rollout stage below.
- Storage credentials cover exactly the stored prefix.
- M4a stores the prefix and makes all code read it; new mounts keep the project layout. The M4b mount step, one release later, writes `mounts/<org_id>/<mount_id>/` for new mounts and drops the fill trigger.

## 10. Moves and doors (M6)

- A move is narrow and explicit. Move set: the workflow artifact, its variants and revisions (insert target parents, move revisions, remove source parents), and the agent's mounts. Folder is cleared. Schedules: the old schedule stays paused in the source; a new paused schedule is created in the target when its principal is a target member.
- Refused when: an active run exists, a slug clashes, a reference resolves in the source, or a mount in the move set uses an old path.
- Doors run on the server. The sandbox never gets a credential for another project. Only web runs by a human in their own personal project get doors. Doors are: find agents, read files, run an agent (an execution door).
- Door rule: the parent's delegation limits AND the principal's current access in the target AND the target resource policy.
- Activation gate: the run-an-agent door stays off until M9 enforcement runs everywhere, because before M9 target trace readers could read the child result. The find-agents and read-files doors do not wait.
- Later, not planned here: a read-sessions operation for agent-to-agent communication, so a run acting as a user can read other sessions that user can read. It reuses `decide` with a session resource, the same check M3 adds. Across projects it becomes one more door. The reader's session then holds a copy of that content, so the R4 sharing rule applies to it.
- A move refuses an agent that is deployed to an environment. It never deletes a deployment.

## 11. Trace privacy (M9)

- One read-scope boundary for all user-triggered trace reads, including saved queries. Unrestricted scope only for named maintenance operations.
- A deleted private session leaves a privacy tombstone until its traces expire.
- Query strategy is chosen after measuring; the change specifies the semantics only.

## 12. Migrations and rollout

- Default (owner decision, 2026-10-22): one release per milestone and the least operational work. Pre-PMF, no paying users. Split a rollout only when a step cannot work otherwise, and say why. Cancelling or failing a few in-flight items once is acceptable; a destructive migration that needs the `migration:destructive-approved` label is acceptable.

- Shared schema changes go once in `core_oss`. Only EE-only changes (meters) go in `core_ee`.
- Every change follows the Migration gate in `api/AGENTS.md` and states its mixed-version behavior (old pods on new schema, new pods on old data) for each durable work type.

## 13. Out of scope everywhere unless a change says otherwise

Generic ACLs, policy languages, a principals table, a runs table, API key scopes, service-account administration before M6, team-to-team moves, write doors, and use grants (M8 stays a deferred note).

## 14. Dependencies and parallel work

Two kinds of dependency. An implementation dependency means the code of one piece calls interfaces of another. A release dependency means one piece must be live in production before another can ship and work. Anything without an arrow can run in parallel.

### Pieces

| Piece | What |
| --- | --- |
| M1 | Membership resolver, project route permissions, demo removal |
| M2 | Principal, run authority, access decision, turn attribution |
| M3 | Private agents and sessions, sharing |
| M4a | Stored mount prefix, read everywhere; project layout kept |
| M4b | Workspaces out of the data model, meter re-key (EE); the M4b mount step: organization-keyed paths for new mounts, drop the fill trigger |
| M5 | Organization credentials |
| M6a | Service accounts, personal and service API keys |
| M6b | Personal projects and the personal agent, new agents start personal |
| M6c | Sharing by move |
| M6d | Doors (find agents, read files, run an agent) |
| M9a | Cost and token usage stored on each turn |
| M9b | Trace reads filtered by session access |
| M7 | Personal credentials and bindings, durable-work edit rule |
| M8 | Use grants (deferred, not planned) |

### Implementation dependencies (who can start when)

| Piece | Needs the code of | Can start in parallel with |
| --- | --- | --- |
| M1 | nothing | M4a, M9a, M5 |
| M2 | M1 (resolver, AccessService) | M3 schema and DAO, M4a, M5, M9a |
| M3 | M1, M2 (decide, RequestAccess, turn sender) | its migration, DAO and web UI can be built against the interfaces while M2 is in progress |
| M4a | nothing | everything |
| M4b | M1 (no permission reads workspaces) | M3, M5 |
| M5 | M2 for `credential_kind` only | M3, M4 |
| M6a | M2 | M6b |
| M6b | M1, M3 | M6a |
| M6c | M3, M4b mount step, M6b (it calls `is_organization_keyed`) | M6d |
| M6d | M2, M6b | M6c |
| M9a | nothing | everything |
| M9b | M3 | M6 |
| M7 | M5, M6a, M3 (session personal-use mark) | M9b |

### Release dependencies (what must be live first)

| Piece | Must be live before it ships |
| --- | --- |
| M1 | nothing (preflight report fixed first: no duplicate rows) |
| M2 | M1, or ships in the same release |
| M3 | M1 and M2 |
| M4a | nothing |
| M4b | M1 (the M4b mount step needs nothing but M4a live) |
| M5 | M2, or the same release |
| M6a | M2 |
| M6b | M3 and M5 (a personal project needs inherited keys to be usable) |
| M6c | the M4b mount step and M6b |
| M6d | M6a (doors refuse keys and installations only once those are service accounts) and M6b; the run-an-agent door also needs M9b |
| M9a | nothing |
| M9b | M3 |
| M7 | M5, M6a and M9b |

### Parallel tracks

- Track 1 (critical path): M1, then M2, then M3, then M6b, then M6c and M6d, then M7.
- Track 2 (start now, independent): M4a and M9a.
- Track 3 (after M2's types exist): M5.
- Track 4 (after M1 is live): M4b.
- Track 5 (after M3 is live): M9b, which unlocks the run-an-agent door and M7.
