# Design: run principal (M2)

Shared rules: CONTRACT.md sections 3 to 6; only M2's additions are here. Full signatures, file plan, flows and tests: `docs/design/sharing-program/interfaces/m2/`. Paths are relative to `api/`.

## Decisions

### D1. Principal records and the tenant scope

`PrincipalsDAO.fetch_principal` (`dbs/postgres/access/dao.py`) returns:

| Kind | Id | Bound project | Active when | `acting_user_id` |
| --- | --- | --- | --- | --- |
| `human` | `users.id` | none | user exists | the user |
| `api_key` | `api_keys.id` | key project | has a creator, the creator has a `users` row, not expired (`expires_at`, checked by `decide` on every call) | key creator |
| `installation` | `channel_agents.id` | binding project | binding and its connection active | binding creator |

A human record has no organization: the tenant comes from the requested project. `request.state.user_id` holds `acting_user_id`, so `created_by_id` writers do not change.

### D2. decide

Signature and order: CONTRACT.md section 6. `project_id` defaults to `authority.project_id`; with neither, `decide` raises.

1. **Eligibility.** `principal_inactive` when there is no active record. `not_member` when the key or binding is in another project, or when the role user (the human, the key creator, or the installation's role user of D3) does not resolve as an M1 member. Membership is read through the per (user, project) membership cache (D4).
2. **Authority restrictions** (`restricted_by_authority`), when `authority` is given: same principal, same project, and `restrictions.agent` is `None`. M2 supports no agent restriction and never sets it; any non-null value is refused, so a later writer cannot fail open on M2 pods, including at boundaries that pass no resource.
3. **Capability** (`missing_capability`): M1's catalog step for the role user, computed from the membership of step 1.
4. Resource policy: M3.

`check_eligibility` runs steps 1 and 2 only. It guards credential exchanges that check no permission (`POST /gateways/credentials`).

### D3. Installation authority

M2 keeps today's channel authority (CONTRACT.md section 4). The role user of a channel turn is `RunAuthority.linked_user_id` when the Slack user is linked, else the binding creator. Nothing enforces installation restrictions in M2.

### D4. Wrapper and caches

The middleware sets one context variable, `RequestAccess` (`core/access/context.py`). `check_action_access` keeps its signature and calls `AccessService.check_request` with it. With no request access, or with a `user_uid` that is not the request's acting user, it raises. A check about another human calls `AccessService.check_human` explicitly. Run paths call `decide` or `require` with the run authority. A streaming handler captures `RequestAccess` at entry and passes it on each recheck.

No cache stores a decision. `decide` runs on every call. M2 deletes the `check_action_access` cache and the exchange's `check_permissions` cache. Membership is cached per (user, project): `MembershipsService.resolve` reads through the `resolve_membership` namespace (`AGENTA_CACHE_TTL`, Redis through `oss/src/utils/caching.py`). The entry has the fixed key `membership`, so a per-(user, project) invalidation is a direct delete, and a project-wide one is one pattern call per project, never one call per member. It caches absence too, as the tagged entry `CachedMembership(membership=None)`, with the same key and invalidation, so repeated denied requests read Redis and not Postgres, as today's `check_action_access` cache does, and M1's `invalidate_access_caches` clears it after every M1 membership mutation. The principal record is cached (`fetch_principal`, `AGENTA_CACHE_TTL`) and invalidated on key deletion (user and admin paths), binding archive, edit or delete, connection archive, deactivation, edits that change `is_active`, reinstall, and user deletion (with the user's keys, bindings and memberships). Every `Optional` field of a cached model has a `None` default, because the cache serializer drops `None` fields. The credential exchanges pass the authenticated project explicitly to `check_request` and `check_eligibility`. The MCP OAuth `connect_callback`, which runs without the auth middleware, calls `check_human` for the stored attempt's user. Cached Bearer and ApiKey middleware states gain `principal`; a state without it is a miss, so old-pod states are never used.

### D5. Token claims and mints

New Secret claims, validated like `grants`: `principal {kind, id}`, `restrictions {agent}`, `authority {organization_id, project_id, linked_user_id}`, `run {run_id, parent_run_id, origin, origin_id}`, `sender {user_id | external_key}`, `approved_by {principal, user_id, external_key}` (resume only). Unknown kinds, origins or keys answer 401 `invalid_token`; a Secret without `principal` answers 401 `missing_principal`.

- Bearer middleware: `human`, origin `web`.
- Credential exchange (`GET /access/permissions/check`): `decide` first, then the resource check, then the mint. Nothing is minted on deny. Bearer gives `human`, ApiKey `api_key`, Secret copies all claims. It never upgrades.
- `_prepare_invoke`, `invoke_workflow(_detached)`: required `envelope`. `inspect_workflow` has no caller and is deleted.
- Gateway and builtin MCP credentials: copy all claims; the gateway credential route checks eligibility first.

`RunContext.run_id` is the runner's `turn_id` (`meta.run_id`), or `None` for web-direct, direct-API and batch runs.

### D6. Durable work and where authority comes from

Each consumer rebuilds the envelope and calls `require` before it runs. The recheck action is `RUN_SESSIONS` for session work, `RUN_WORKFLOWS` for triggers and child runs, and `EDIT_EVALUATION_RUNS` for evaluations (annotators lack `RUN_WORKFLOWS`).

| Work | Authority source |
| --- | --- |
| Web and API send (`session_inputs` → `session_commands`) | `run_envelope` written from the request |
| Template first message | the request |
| Channel turn and command | the binding and the linked user, at consumption |
| Schedule and subscription tick | trigger principal columns (D7) |
| Evaluation dispatch and live tick | `evaluation_runs` principal columns (D7) |
| Child run (tools router, `platform_handlers.py`) | the parent request envelope, `origin = child` |
| Approval resume | `session_interactions.run_envelope` (D8) |

No consumer builds `human(created_by_id)`. The migration backfill is the only place that does, and only for rows that exist at migration time.

Heartbeat-first session creation receives the run credential's envelope (for M3's initial policy). Without a run credential it creates no session.

`entrypoints/channel_adapters.py` checks the Agenta-key channel with `decide(principal=api_key(key.id))`.

### D7. Schedules, subscriptions and evaluation runs

Schedules and subscriptions store `principal_kind`, `principal_id` and, for direct references, `artifact_id`. Create stores `request.state.principal`. Edits keep today's behavior: anyone with `EDIT_TRIGGERS` may edit, and the trigger keeps its principal. The dispatcher builds the request, resolves the current target (environment references included) with `resolve_request_target`, calls `decide(RUN_WORKFLOWS, resource=agent)`, and only then claims the delivery. The invoke runs the resolved revision. On deny it calls `refuse_delivery`, which records the failed delivery (event dedup kept) and pauses the trigger in one transaction, with no session; `error` stays a string and `error_details` holds the `AgentError`. A trigger without a principal is refused the same way with `missing_principal`. `artifact_id` does not cascade; archiving the agent pauses its triggers (`agent_deleted`).

Evaluation runs store the principal at create. It changes only on an explicit new start or rerun: `POST /evaluations/runs/`, `POST /simple/evaluations/`, `POST /simple/evaluations/{id}/start`, `POST /simple/evaluations/{id}/process`. Edits (including the restart inside `PATCH /simple/evaluations/{id}`), populate, probe, prune, refresh, stop, close, open and the live tick keep the stored principal. A run without a principal fails with `missing_principal`.

The edit rule (only the executing principal changes what runs) ships in M7 (CONTRACT.md section 6).

### D8. Approval resume

The resumed run keeps the original authority, origin and sender, with a new `run_id` and `approved_by = RunApproval(principal, user_id, external_key)`: the approving principal kind and id, its acting user, and the channel key for a channel answer. The existing interaction route authorizes the answerer.

### D9. Errors

New failures that an agent or a client sees use the `AgentError` envelope (`core/tools/dtos.py`): `{code, message, retryable, next_step?, details?}`. Codes: `missing_principal`, `missing_envelope`, `access_denied` (`details.reason` is the decision reason), `session_requires_run_credential`. A refused queued command or resume is a terminal settlement in one transaction (command `obsolete`/`failed`; the execution stores the error and is settled with `terminal_outcome` `failed`), never a transport retry, so the next queued input proceeds. A parked approval without an envelope is cancelled in a committed transaction before the 409. Existing 403 bodies of permission-checked routes do not change.

### D10. Audit

Every deny in `decide` writes one structured log line with principal kind and id, role user, credential kind, organization, project, action, resource, reason and run correlation (`run_id`, `origin`, `origin_id`). Trigger pauses and cancelled work are logged with ids and reason. Logs never carry token values, raw claims, raw envelopes or secrets.

## Data structures

DTOs in `core/access/dtos.py`, exceptions in `core/access/types.py`, pure helpers in `core/access/principals.py`. CONTRACT.md section 3 types plus `AgentRef`, `RunSender`, `RunApproval`, `RunEnvelope`, `RequestCredentialKind`, `ResourceRef`, `PrincipalRecord`, `RequestAccess`. All are frozen Pydantic models with `extra="forbid"`, so an older pod refuses an unknown key and fails closed. M6 adds `RunAuthority.source` and `RunRestrictions.doors`.

| Table | New columns (all nullable) |
| --- | --- |
| `session_turns` | `principal_kind`, `principal_id`, `sender_user_id`, `sender_external_key`, `origin`, `origin_id`, `parent_run_id`, `approved_by` (jsonb) |
| `session_inputs`, `session_commands`, `session_interactions` | `run_envelope` jsonb |
| `trigger_schedules`, `trigger_subscriptions` | `principal_kind`, `principal_id`, `artifact_id` |
| `evaluation_runs` | `principal_kind`, `principal_id` |

## Lifetimes

Run token 15 minutes (refresh runs `decide`). Gateway and mount credentials 12 hours (`AGENTA_GATEWAYS_CREDENTIALS_TTL_SECONDS`, `AGENTA_MOUNTS_CREDENTIALS_TTL_SECONDS`). Live stream recheck 60 seconds (`AGENTA_SESSIONS_LIVE_AUTH_RECHECK_SECONDS`). Membership, principal and middleware caches 300 seconds (`AGENTA_CACHE_TTL`); the bound applies when Redis invalidation fails, when a read that started before a mutation committed refills the old entry after the invalidation (a known limit, as in today's cache), and to the ApiKey middleware state on routes that check no permission. Tokens are bearer credentials until they expire; M2 does not make them single-use.

## Migration and deploy

One deploy with two `core_oss` revisions and no separate preflight deploy: `oss000000046` adds the columns and indexes under a short `lock_timeout` and commits; `oss000000047` backfills in batches with `lock_timeout`, `statement_timeout` and changed-value predicates. Together they add the columns, backfill existing schedules, subscriptions and evaluation runs with `human(created_by_id)`, pauses triggers that still have no principal, and fills `artifact_id` for direct references.

| Work type | Without stored authority after the deploy |
| --- | --- |
| Schedules, subscriptions | paused (`missing_principal`) with a refused delivery |
| Evaluation runs | failed (`missing_principal`); an explicit start sets the principal |
| Queued inputs and commands | cancelled with `missing_envelope` |
| Parked approvals | cancelled with `missing_envelope`; the agent must ask again |
| Secret tokens | 401 `missing_principal`; the run fails once and the user retries |

Old pods ignore the new columns, so an application rollback restores today's behavior.

## Docs and config

The design docs in `docs/design/sharing-program/interfaces/m2/`; an "Access layer invariants" section in `api/AGENTS.md`; Fern client regeneration (read-only fields on turn, trigger and evaluation responses). No new environment variable, and no change in `hosting/` or Helm values.

## Production finding: API keys whose creator is not a user

In managed deployments some API keys have a `created_by_id` with no `users` row (the users were deleted; `api_keys.created_by_id` has no foreign key). Today every request with such a key fails with 500 in the ApiKey middleware (it reads the email of a missing user), uncached, and the Agenta channel adapter refuses the key. M2 keeps both outcomes: the middleware path is unchanged up to that line, and `fetch_principal` returns such a key as inactive. The backfill copies `created_by_id` as it is; a schedule whose creator was deleted is denied `principal_inactive` and paused at its next run, where today the run is denied at its first checked call.
