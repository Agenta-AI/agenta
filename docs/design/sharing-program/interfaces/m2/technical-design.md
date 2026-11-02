# M2 `run-principal`: technical design

Read `interfaces.md` first. It holds the types, signatures, error codes and lifetimes. Paths are relative to `api/`. Round 3 (2026-10-22) applies the Codex review of the M1 and M2 plans. Implementation shape: one PR with ordered commits; a signature change lands with all of its callers; no temporary fallback.

## 1. File-by-file plan

### Access core

| File | State | Change |
| --- | --- | --- |
| `oss/src/core/access/dtos.py` | MODIFIED (M1) | Principal, authority, context, sender, approval, envelope, `RequestCredentialKind`, `ResourceRef`, `PrincipalRecord`, `RequestAccess`; two `DecisionReason` values |
| `oss/src/core/access/types.py` | MODIFIED (M1) | Exceptions of interfaces 2.2, derived from `AccessError` |
| `oss/src/core/access/principals.py` | NEW | Pure helpers: claim and jsonb (de)serializers, `child_envelope`, `resumed_envelope`, `stored_work_envelope` |
| `oss/src/core/access/context.py` | NEW | `RequestAccess` ContextVar get, set, reset |
| `oss/src/core/access/interfaces.py` | MODIFIED (M1) | `PrincipalsDAOInterface` |
| `oss/src/core/access/service.py` | MODIFIED (M1) | `principals` dependency; `decide`, `check_eligibility`, `check_request`, `check_human` (was `check_capability`), `require`, `invalidate_principal`; `_capability` becomes pure |
| `oss/src/core/access/permissions/service.py` | MODIFIED | `check_action_access` becomes the strict wrapper (interfaces 3.3); its cache is deleted |
| `oss/src/dbs/postgres/access/__init__.py`, `dao.py`, `mappings.py` | NEW | `PrincipalsDAO` (three reads, cached) and the three `map_*_dbe_to_principal_record` functions |
| `oss/src/core/memberships/service.py`, `core/memberships/dtos.py` | MODIFIED (M1) | `resolve` reads and writes the `resolve_membership` cache, for a membership and for its absence (`CachedMembership`, NEW in `dtos.py`); `is_member` calls `resolve` (interfaces 3.2). In `invalidate_access_caches`, delete the `check_action_access` line (the namespace is gone); keep `verify_bearer_token` and `resolve_membership` |
| `entrypoints/access.py` | MODIFIED (M1) | `bootstrap_access()` builds `PrincipalsDAO` and passes it to `AccessService` |

### Middleware, exchanges and mints

| File | State | Change |
| --- | --- | --- |
| `oss/src/middlewares/auth.py` | MODIFIED | `principal`, `authority`, `credential_kind`, `run_envelope` on the three paths; cached Bearer and ApiKey states gain `principal` (and `api_key_id`), and a state without them is a miss; `sign_secret_token(envelope=...)` required; claim parsing with 401 `missing_principal` and `invalid_token`; `request_run_envelope`; `set_request_access` in `auth_middleware` |
| `oss/src/apis/fastapi/access/router.py` | MODIFIED | `check_permissions`: delete the `check_permissions` cache; decide before the mint; mint only after allowance |
| `oss/src/apis/fastapi/gateways/credentials_router.py` | MODIFIED | `check_eligibility` before the mint; envelope in the mint |
| `oss/src/apis/fastapi/gateways/mcps/router.py` | MODIFIED | Envelope in `issue_agenta_credential` |
| `oss/src/core/workflows/service.py` | MODIFIED | `envelope` on `_prepare_invoke`, `invoke_workflow`, `invoke_workflow_detached`; `resolve_request_target`; delete `inspect_workflow`; `triggers_dao` and the pause in `archive_workflow` |

### Sessions

| File | State | Change |
| --- | --- | --- |
| `oss/src/dbs/postgres/sessions/turns/dbas.py`, `mappings.py`, `dao.py` | MODIFIED | Attribution columns; append writes them; complete writes them as one group only when `principal_kind IS NULL` |
| `oss/src/core/sessions/turns/dtos.py`, `service.py` | MODIFIED | Read fields; `SessionTurnCreate.envelope` |
| `oss/src/dbs/postgres/sessions/{inputs,commands,interactions}/*` | MODIFIED | `run_envelope` column, mapping, create and read |
| `oss/src/core/sessions/inputs/service.py` | MODIFIED | `admit(envelope)`, `claim_for_execution(envelope)` |
| `oss/src/core/sessions/commands/service.py` | MODIFIED | `_promote_next_input` copies the envelope; `respond_interaction(s)(approved_by)`; `_deliver` catches `MissingEnvelope` and `AccessDenied` before its generic `except` and settles terminally through NEW `_settle_refused_continuation` (one transaction: command `obsolete`/`failed`; execution error stored, then `settle(terminal_outcome="failed")`, so the refused input is no longer the active successor) |
| `oss/src/core/sessions/interactions/service.py` | MODIFIED | `create_interaction(envelope)` |
| `oss/src/core/sessions/streams/service.py`, `core/sessions/types.py` | MODIFIED | `heartbeat(envelope)`; `SessionCreationRequiresRunCredential` |
| `oss/src/core/sessions/starts/service.py`, `core/agent_templates/loader.py`, `apis/fastapi/agent_templates/router.py` | MODIFIED | Thread `request_run_envelope(request)` into `start_once` |
| `oss/src/apis/fastapi/sessions/router.py`, `models.py` | MODIFIED | Envelope and `approved_by` on the routes of interfaces 4.2; live stream recheck uses the captured `RequestAccess`; map `SessionCreationRequiresRunCredential` to 403 and `MissingEnvelope` to 409; read-only attribution in the turn model |
| `oss/src/tasks/asyncio/sessions/interactions_dispatcher.py` | MODIFIED | `respond_many(envelope)`; `respond` rebuilds from the row; `dispatch_fn(envelope)` |

### Channels, child runs, triggers, evaluations

| File | State | Change |
| --- | --- | --- |
| `oss/src/tasks/asyncio/channels/inbox.py` | MODIFIED | `_installation_envelope` at `_invoke_via_workflows_service`, `_queue_behind_running_turn`, `_dispatch_command`, `_answer_interaction` (which builds `RunApproval(principal=installation, user_id=link user, external_key)`); `require(RUN_SESSIONS)` before invoking |
| `oss/src/core/channels/queue.py` | MODIFIED | `admit(envelope)` |
| `oss/src/core/channels/service.py` | MODIFIED | `invalidate_principal` for each affected binding on archive, unarchive, deactivate, agent delete and agent edit |
| `oss/src/apis/fastapi/gateways/mcps/router.py` (`connect_callback`) | MODIFIED | Exempt from the auth middleware: `check_human(attempt.user_id, attempt.project_id, <today's permission>)` replaces `check_action_access` |
| `entrypoints/channel_adapters.py` | MODIFIED | `decide(authority=None, principal=api_key(key.id), action=RUN_CHANNELS, project_id=key.project_id)` replaces `check_action_access(created_by_id)` |
| `oss/src/apis/fastapi/tools/router.py`, `oss/src/core/tools/platform_handlers.py` | MODIFIED | Child envelope, `require(RUN_WORKFLOWS)`, `invoke_workflow(envelope=child)`; `handle_test_run(envelope)` |
| `oss/src/dbs/postgres/triggers/dbas.py`, `dbes.py`, `mappings.py`, `dao.py` | MODIFIED | Three columns per table, two indexes, `pause_trigger`, `pause_triggers_for_artifact`, `refuse_delivery`; `TriggerDeliveryData.error_details` |
| `oss/src/core/triggers/interfaces.py`, `dtos.py`, `service.py` | MODIFIED | `principal`, `artifact_id`; create stores the principal; edit recomputes `artifact_id` only |
| `oss/src/apis/fastapi/triggers/router.py` | MODIFIED | Pass `request.state.principal`; `/subscriptions/test` passes the request envelope |
| `oss/src/tasks/asyncio/triggers/dispatcher.py` | MODIFIED | Flow F6: resolve target, decide, then claim; `access_service` and `workflows_service` dependencies |
| `oss/src/dbs/postgres/evaluations/dbas.py`, `mappings.py`, `dao.py` | MODIFIED | Two columns; `set_run_principal` |
| `oss/src/core/evaluations/types.py`, `interfaces.py`, `service.py` | MODIFIED | `EvaluationRun.principal`; the start and rerun rules of interfaces 3.7; `refresh_runs` rechecks each live run and closes it on deny |
| `oss/src/core/evaluations/tasks/processor.py`, `runtime/adapters.py` | MODIFIED | Envelope from the run row; `require` before work; envelope into the runner adapters |
| `oss/src/apis/fastapi/evaluations/router.py` | MODIFIED | Create, start and process routes pass `request.state.principal` |
| `entrypoints/routers.py`, `entrypoints/worker_queues.py` | MODIFIED | Dispatcher dependencies; `workflows_service.triggers_dao`; `dispatch_fn` and `DirectControlDelivery` lambdas pass `command.run_envelope` or raise `MissingEnvelope` |
| `oss/src/services/api_key_service.py`, `oss/src/core/accounts/service.py` (`delete_api_key`, `delete_user`), `oss/src/services/user_service.py` (`delete_user`) | MODIFIED | Principal invalidation after commit; user deletion reads the user's keys, bindings and projects before the delete |
| `oss/databases/postgres/migrations/core_oss/versions/oss000000046_add_run_principal_columns.py` | NEW | Interfaces 1.1 and 1.2 (schema expansion) |
| `oss/databases/postgres/migrations/core_oss/versions/oss000000047_backfill_run_principal.py` | NEW | Interfaces 1.2 (backfill) |

## 2. Execution boundaries

One table for every path that starts or continues a run. "Check" is the decision that runs before the work; "mint" is where the run credential is signed.

| Path | Authority source | Check | Mint | Failure |
| --- | --- | --- | --- | --- |
| Browser direct run (services) | Bearer request | exchange `check_request` | exchange | `Deny` response |
| API-proxied run | request (`request_run_envelope`) | route permission (wrapper) | `_prepare_invoke` | 403 |
| Runner refresh | the Secret's claims (copied) | exchange `check_request` | exchange | `Deny`; the run stops at its next refresh |
| Gateway credential | the presented credential | `check_eligibility` | `credentials_router` | 403 `access_denied` |
| Queued send (F5) | `session_inputs.run_envelope` → command | `require(RUN_SESSIONS)` at delivery | `_prepare_invoke` | command failed (`missing_envelope` or `access_denied`) |
| Template start | request | `require(RUN_SESSIONS)` | `_prepare_invoke` | 403 |
| Channel turn (F8) | binding and linked user, at consumption | `require(RUN_SESSIONS)` | `_prepare_invoke` | channel reply `access_denied` |
| Schedule, subscription (F6) | trigger principal columns | `decide(RUN_WORKFLOWS, resource=agent)` before the claim | `_prepare_invoke` | pause and failed delivery |
| Evaluation (F9) | `evaluation_runs` principal columns | `require(EDIT_EVALUATION_RUNS)` | `_prepare_invoke` | run failed or closed |
| Approval resume (F7) | `session_interactions.run_envelope` | `require(RUN_SESSIONS)` at delivery | `_prepare_invoke` | command failed; 409 at respond when no envelope |
| Child run (F10) | parent request envelope | `require(RUN_WORKFLOWS)` | `_prepare_invoke` | tool result `access_denied` |
| Heartbeat-first create (F11) | run credential only | route permission | none | 403 `session_requires_run_credential` |

M3 adds the resource check on the session and the resolved agent at first-heartbeat admission and at queued dispatch and resume. M2 already passes `resource=agent` where it knows the target (F6).

## 3. Key flows

### F1. Bearer request

1. `verify_bearer_token` resolves the user and project as today, then sets `principal = human(user_id)`, `authority`, `credential_kind = bearer_session`.
2. It mints `credentials` with the `web` envelope and caches the state, which now includes `principal`.
3. `auth_middleware` calls `set_request_access`.
4. A handler calls `check_action_access(user_id, project, P)`. The wrapper calls `check_request` with `authority=None`, so `decide` runs: `fetch_principal` (cached), `memberships.resolve` (cached per user and project), `_capability`. On warm caches the decision reads Redis only.

### F2. ApiKey request

1. `verify_apikey_token` reads its cache. A state without `api_key_id` or `principal` is a miss; the miss path calls `use_api_key` and stores both.
2. `principal = api_key(id)`, `credential_kind = api_key`, `user_id = created_by_id`.
3. `decide`: `fetch_principal(api_key)` (a deleted key is `principal_inactive`, because its entry is invalidated on delete even while the token-keyed state is cached); membership of `created_by_id`; capability.

### F3. Run credential

1. `verify_secret_token` decodes as today. `envelope_from_claims`: `None` gives 401 `missing_principal`; `InvalidRunClaims` gives `invalid_token`.
2. `principal`, `authority`, `run_envelope` from the envelope; `credential_kind = run_credential`; `user_id` from the claim.
3. `decide` gets the authority, so another project is `restricted_by_authority`. For an installation, the role user is `linked_user_id` or the binding creator (today's role).

### F4. Credential exchange (`GET /access/permissions/check`)

1. Missing `action` or `resource_type`: `Deny`.
2. `_check_scope_access`: deny gives `Deny`.
3. `decision = await access_service.check_request(access=get_request_access(), action=Permission(action), project_id=get_auth_scope().project_id)`. Deny gives `Deny` and a denial log (section 5).
4. `_check_resource_access` as today.
5. Only now: `grants = _run_credential_grants(...)`, `sign_secret_token(envelope=request_run_envelope(request), grants=...)`, return `Allow`.

No result is cached. A deleted key, a removed member or a lost role is refused at the next refresh, because key deletion and membership mutations clear their cache entries.

### F5. Queued web or API send

1. `admit_session_input` stores `request_run_envelope(request)` in the admission transaction.
2. `_promote_next_input` copies the envelope (or `None`) onto the `continue_input` command.
3. Delivery: `None` raises `MissingEnvelope`; else `require(envelope, RUN_SESSIONS)` (raises `AccessDenied`); `_deliver` catches both before its generic `except` and settles terminally (`missing_envelope` or `access_denied`; not retried); else `invoke_workflow_detached(envelope with run_id=target_turn_id)`.

### F6. Schedule or subscription tick (`TriggersDispatcher._run`)

1. Existing pre-gates (`is_active`, dedup).
2. `entity.principal is None`: `refuse_delivery(reason="missing_principal")` (failed delivery and pause in one transaction, dedup kept), return. No reconstruction from `created_by_id`. The existing `write_subscription_delivery_if_live` cannot be used: it requires `is_active=true` and refuses schedules.
3. Build the request (inputs, references, selector) as today, before the claim.
4. `target = await workflows_service.resolve_request_target(project_id, request)`. This resolves environment references to the current revision on every tick, once; `_prepare_invoke` does not resolve it again. A resolution failure writes the existing `400` failed delivery. A target whose artifact is archived: `refuse_delivery(reason="agent_deleted")`.
5. `envelope = stored_work_envelope(principal, org, project, origin=SCHEDULE|SUBSCRIPTION, origin_id=str(entity.id), created_by_id=entity.created_by_id)`.
6. `decision = await access.decide(authority, principal, RUN_WORKFLOWS, resource=ResourceRef(agent, str(target.artifact_id)))`. Deny: `refuse_delivery(reason="access_denied")` with `error_details.code = "access_denied"`. Return without a claim, so no session is created and nothing is invoked.
7. `claim_trigger_delivery` (unchanged in M2; M3 adds the policy).
8. `dispatch_fn(..., request, envelope)`. The request carries the resolved revision, so the invoke runs the target that was checked.

`artifact_id` stays `NULL` for environment-bound triggers. It is never used as an authorization target. `refresh_schedules` auto-pauses on `end_time` as today.

### F7. Approval resume

1. The runner creates the interaction with its run credential; `run_envelope = request.state.run_envelope` is stored.
2. A human, a key or a channel user answers. Route: `RunApproval(principal=request.state.principal, user_id=request.state.user_id)`. Inbox: `RunApproval(principal=installation(binding), user_id=link user, external_key)`.
3. `respond_interactions` stores `resumed_envelope(asked, run_id=continuation_execution_id, approved_by)` on the `continue_interaction` command in the existing transaction. `asked is None`: the interaction is cancelled in its own committed transaction first, then the route returns 409 `missing_envelope` (raising inside the respond transaction would roll the cancellation back).
4. Delivery: `require(envelope, RUN_SESSIONS)`. Deny settles failed with `access_denied` through the continuation failure path. Then `dispatch_fn(envelope)`. The resumed turn keeps the original principal, sender and origin, and stores `approved_by`.

### F8. Channel turn

1. `dispatch_event` resolves as today; `_invoking_user_id` gives `link_user_id`.
2. `envelope = _installation_envelope(..., linked_user_id=link_user_id, run_id=turn_id)`.
3. `require(envelope, RUN_SESSIONS)`. Deny posts the existing failure reply with `access_denied`. An archived binding is `principal_inactive`.
4. `invoke_workflow_detached(user_id=link_user_id or agent.created_by_id, envelope)`. A busy thread calls `session_queue.admit(envelope)` and F5 applies.

### F9. Evaluations

1. Create, start and process (rerun) routes set the principal to the caller (interfaces 3.7). Edit and maintenance routes keep it.
2. Worker: fetch the run; `principal is None` fails the run with `missing_principal`; else `stored_work_envelope(origin=EVALUATION, origin_id=run_id)`, `require(EDIT_EVALUATION_RUNS)` (deny: `_fail_evaluation_run` with `access_denied`), `_BoundRunner(envelope)`, `invoke_workflow(envelope)`.
3. Live tick (`refresh_runs`): the same per run; deny calls `_close_live_run`.

### F10. Child run

1. `call_tool` checks `RUN_TOOLS` through the wrapper, as today.
2. `child = child_envelope(parent=request_run_envelope(request))`. `parent_run_id` is `None` for a web-direct parent, which has no run id.
3. `require(child, RUN_WORKFLOWS)`. Deny: `AgentError(code="access_denied")`.
4. `invoke_workflow(envelope=child)`; for `test_run`, `_prepare_invoke(envelope=child)`.

### F11. Heartbeat-first session creation

`heartbeat(envelope=request.state.run_envelope)`. `prior_stream is None and envelope is None` raises `SessionCreationRequiresRunCredential` (403). The runner always sends a run credential (`services/runner/src/sessions/alive.ts`). M2 does not store the envelope on the stream; M3 derives the initial policy from it.

### F12. Agent archive

`archive_workflow` archives the artifact, then `pause_triggers_for_artifact(reason="agent_deleted")` runs in its own transaction and is logged. Unarchive does not resume triggers. A paused subscription keeps its provider trigger; the `is_active` pre-gate drops its events.

## 4. Migration

There is no data script. Everything is in the two revisions `oss000000046` (schema expansion, commits first) and `oss000000047` (backfill with `lock_timeout`, batches and changed-value predicates) of interfaces 1.2. Measure the backfill time on a copy of each region's database before the deploy.

1. **Counts.** Before the deploy, run the read-only queries from the revision's docstring on a production copy for each region and record them in the release notes: triggers with a null `created_by_id` (to be paused), triggers that stay environment-bound, and queued work to be cancelled (`session_inputs` pending, `session_commands` open of kinds `continue_*`, `session_interactions` pending). No separate deploy.
2. **Idempotency.** Every `UPDATE` is guarded by `IS NULL`; indexes use `IF NOT EXISTS` and the validity check.
3. **Order.** The Helm hook migrates, then the pods roll. Interfaces 1.3 gives the mixed-version behavior.
4. **Rollback.** Application only. Columns stay. Queued work written by M2 runs under the old code with today's identity.
5. **Gate.** `uv run api/scripts/migration_gate.py <file>` for both revisions. Expected to pass with no label. The gate does not prove lock safety; the copy measurement does.

## 5. Audit and observability

M2 uses the existing structured logger (`oss/src/utils/logging.py`, `get_module_logger`), which the log pipeline ingests. The API has no metrics path, so there is no denial counter.

| Event | Where | Fields |
| --- | --- | --- |
| `[access] denied` (info) | `AccessService.decide`, every deny | `principal_kind`, `principal_id`, `role_user_id`, `credential_kind` (from `RequestAccess` when present), `organization_id`, `project_id`, `action`, `resource_kind`, `resource_id`, `reason`, `run_id`, `origin`, `origin_id` |
| `[access] request access missing` / `mismatch` (error) | wrapper | `user_uid`, `project_id`, `action`, caller module |
| `[triggers] paused` (info) | dispatcher, `pause_triggers_for_artifact` | `trigger_kind`, `trigger_id`, `project_id`, `principal_kind`, `principal_id`, `reason` |
| `[sessions] work cancelled` (info) | command settlement, respond routes | `command_id` or `interaction_id`, `session_id`, `project_id`, `code` |
| Approval | the resumed turn row | `approved_by` = approving principal kind and id, acting user, external key |
| Turn attribution | `session_turns` columns | principal, sender, origin, parent run |

Never log or store: token values, `credentials` headers, raw claims, raw `run_envelope` JSON in logs, provider secrets. Log ids and kinds only. Allows are not logged.

## 6. Docs and config

| Item | Change |
| --- | --- |
| `docs/design/sharing-program/interfaces/m2/` | These two files, updated to the merged code; link them from CONTRACT section 3 |
| `api/AGENTS.md` | Add a short section "Access layer invariants": every run has an explicit `RunEnvelope`; no implicit human fallback (`check_action_access` needs request access; checks about another human use `AccessService.check_human`); `decide` runs before any cached allow and nothing caches a decision; durable work stores its envelope or principal and rechecks with `require` before it runs; mint a run credential only after the decision allows; new agent-visible failures use `AgentError`; logs carry ids and kinds, never credential values |
| `api/oss/src/utils/env.py` | No new variable. The lifetimes in interfaces 7 use existing ones |
| `hosting/docker-compose/*/env.*.example`, `hosting/kubernetes/*/values*.yaml`, Helm charts, Railway | No change |
| Fern client | Regenerate from an EE spec: read-only fields on turn, trigger and evaluation responses |
| User and self-host docs | Release note: queued messages and parked approvals at deploy time are cancelled; schedules without a creator are paused; deleting an agent pauses its schedules; a schedule stops when its owner loses access |

## 7. Test plan

Unit tests (`api/oss/tests/pytest/unit/`, fakes for the DAOs):

| File | Tests |
| --- | --- |
| `access/test_run_principal_dtos.py` (NEW) | `test_claims_round_trip`; `test_unknown_kind_origin_or_key_is_refused`; `test_missing_principal_returns_none`; `test_child_and_resumed_envelope` |
| `access/test_decide.py` (NEW) | `test_deleted_api_key_is_principal_inactive`; `test_run_credential_for_other_project_is_restricted`; `test_key_of_other_project_is_not_member`; `test_human_in_two_organizations_uses_requested_project`; `test_role_requirement_under_key_uses_creator`; `test_first_denial_wins`; `test_installation_linked_user_role_is_used`; `test_installation_unlinked_uses_binding_creator`; `test_archived_binding_is_principal_inactive`; `test_any_agent_restriction_is_refused_in_m2`; `test_expired_api_key_is_principal_inactive_on_a_warm_cache`; `test_key_whose_creator_left_is_not_member`; `test_membership_removed_denies_on_next_call` (fake resolver changes between two calls; no decision is cached); `test_role_change_applies_on_next_call`; `test_missing_project_raises`; `test_deny_logs_ids_without_credentials` |
| `memberships/test_membership_cache.py` (NEW, fake Redis) | `test_membership_removal_is_seen_by_the_next_decision_with_a_warm_membership_cache` (warm `resolve_membership` with one `decide`, call `remove_member`, the next `decide` denies `not_member` and the DAO is read again); `test_resolve_hit_skips_the_dao`; `test_absence_is_cached_as_a_tagged_entry` (a non-member `resolve` stores `CachedMembership(membership=None)` and returns `None`); `test_repeated_denied_requests_hit_redis_not_postgres` (a non-member calls `decide` three times; all deny `not_member`; the DAO is read once, and the second and third calls read only the fake Redis); `test_adding_a_member_clears_the_absent_entry` (cached absence, then `set_member_role` adds the user, the next `decide` allows); `test_invalidate_access_caches_has_no_check_action_access_line` |
| `access/test_check_action_access_wrapper.py` (NEW, replaces M1's cache-key test) | `test_wrapper_under_run_credential_passes_authority`; `test_wrapper_bearer_passes_no_authority`; `test_wrapper_without_request_access_raises`; `test_wrapper_with_other_user_raises`; `test_check_human_is_explicit` |
| `access/test_grant_exchange.py` (extend) | `test_exchange_copies_envelope_and_never_upgrades`; `test_exchange_denies_deleted_key_with_warm_caches`; `test_exchange_mints_only_after_allow` (sign not called on deny) |
| `middlewares/test_auth_run_principal.py` (NEW) | `test_bearer_sets_human_state`; `test_api_key_sets_principal_and_creator_user_id`; `test_secret_sets_claim_principal`; `test_secret_without_principal_is_401_missing_principal`; `test_secret_with_bad_claims_is_invalid_token`; `test_cached_state_without_principal_is_a_miss`; `test_request_access_reset_after_request` |
| `gateways/test_gateway_credentials_envelope.py` (NEW) | `test_gateway_and_mcp_mints_copy_envelope`; `test_gateway_credentials_refuse_deleted_key` |
| `workflows/test_prepare_invoke_envelope.py` (NEW) | `test_prepare_invoke_writes_claims_and_run_id`; `test_prepare_invoke_under_key_carries_api_key` |
| `tools/test_workflow_tool_call.py`, `tools/test_platform_handlers.py` (extend) | `test_child_run_inherits_parent_and_names_parent_run`; `test_child_run_denied_returns_access_denied`; `test_test_run_mints_child_envelope` |
| `sessions/test_turn_attribution.py` (NEW) | `test_two_people_in_one_session`; `test_body_cannot_set_sender`; `test_unlinked_slack_user_turn`; `test_resumed_turn_keeps_sender_records_approver`; `test_historical_turn_reads_null` |
| `sessions/test_inputs_run_envelope.py` (NEW) | `test_queued_api_send_keeps_api_key`; `test_principal_lost_access_while_queued`; `test_command_without_envelope_is_cancelled` |
| `sessions/test_interactions_resume_envelope.py` (NEW) | `test_api_key_run_approved_by_human_records_approver_kind`; `test_original_principal_removed`; `test_approval_without_envelope_is_409_and_cancelled` |
| `sessions/test_heartbeat_run_credential.py` (NEW) | `test_headless_invoke_creates_its_session`; `test_create_without_run_credential_is_refused` |
| `sessions/test_live_stream_recheck.py` (NEW) | `test_recheck_uses_captured_access_and_stops_after_removal` |
| `channels/test_channels_inbox_principal.py` (NEW) | `test_linked_slack_user`; `test_unlinked_uses_binding_creator_role`; `test_channel_answer_records_installation_approver` |
| `test_channel_adapters_entrypoint.py` (extend) | `test_agenta_key_channel_uses_api_key_principal` |
| `triggers/test_triggers_principal.py` (NEW) | `test_create_by_human_stores_principal_and_artifact`; `test_scheduled_run_as_api_key`; `test_edit_keeps_principal_recomputes_artifact` |
| `triggers/test_triggers_dispatcher.py` (extend) | `test_creator_removed_pauses_and_explains`; `test_subscription_key_deleted_pauses_no_run`; `test_deny_happens_before_claim`; `test_null_principal_pauses_without_reconstruction`; `test_environment_target_resolved_before_check` (environment moves to another agent between two ticks; the second check uses the new artifact); `test_archived_target_pauses` |
| `evaluations/test_run_principal.py` (NEW) | `test_evaluation_started_by_api_key`; `test_start_and_process_set_caller`; `test_edit_and_refresh_keep_principal`; `test_null_principal_run_fails`; `test_live_run_closed_when_principal_lost` |

Round 3 adds (names in the plan): `test_cached_models_survive_the_real_serializer`, `test_api_key_with_missing_creator_user_is_inactive`, `test_api_key_whose_creator_is_missing_fails_as_today`, `test_agenta_channel_refuses_key_with_missing_creator`, `test_mcp_connect_callback_checks_the_attempt_user_without_request_access`, `test_api_key_append_then_human_complete_keeps_key_attribution`, `test_refusal_is_not_a_transport_retry`, `test_refused_input_is_not_an_active_successor_and_the_next_input_proceeds`, `test_refuse_delivery_keeps_event_dedup`, `test_project_wide_invalidation_is_one_scan_not_per_member`, `test_exchange_passes_the_auth_scope_project`, and the access-decision statement counts (`count_statements_by_phase`, OSS and EE with the real entitlements adapter).

Integration tests against Postgres (`api/oss/tests/pytest/integration/`, `require_core_uri`):

| File | Tests |
| --- | --- |
| `access/test_principals_dao_postgres.py` (NEW) | `test_fetch_each_kind_active_and_inactive` (expired, deleted and null-creator keys; archived binding; inactive connection) |
| `sessions/test_turns_dao.py` (extend) | `test_attribution_columns_round_trip` |
| `sessions/test_run_envelope_columns_postgres.py` (NEW) | `test_input_command_interaction_envelope_round_trip` |
| `migrations/test_run_principal_backfill_postgres.py` (NEW) | `test_schedule_bound_by_variant`; `test_backfill_by_id_slug_and_revision`; `test_environment_reference_wins_over_an_application_reference`; `test_foreign_project_id_is_not_matched`; `test_creator_not_in_users_is_backfilled_as_today`; `test_null_creator_paused` (null `flags` and `meta`); `test_backfill_is_idempotent` (imports `oss000000047` by path and runs `_backfill(connection)`) |

Acceptance (real stack, `run.sh --oss --dev` and `--ee --dev`): `acceptance/sessions/test_run_principal_acceptance.py` (NEW): human, key and Slack-mock runs keep the principal through `_prepare_invoke`, refresh, gateway and MCP credentials, with warm caches; key deletion, membership removal and role change are refused at the next refresh with warm middleware, principal and membership caches; Alice and Bob alternate and a resume records `approved_by`. `acceptance/triggers/test_triggers_schedules.py` and `test_triggers_subscriptions.py` (extend): a key-created schedule stores `api_key`; a deleted key and an archived agent pause it. Manual QA on the local stack: web, schedule, approval, key and Slack mock turns, including `/w` playground and evaluations; check `session_turns`, `trigger_*` and `evaluation_runs` rows; start a queued input and a parked approval on the old image, deploy, and confirm `missing_envelope` and a clear UI state.

Runner and SDK: no change; run the existing `services/runner` `pnpm test` and `sdks/python` unit tests as a skew check.

## 8. Risks

- **A missed mint or consumer** gives a 401 `missing_principal` or a `missing_envelope`. `sign_secret_token(envelope=)` and `invoke_workflow(_detached)(envelope=)` are required keywords, so a missed call site fails in tests.
- **A missed wrapper caller** that passes a user id other than the request's raises `RequestAccessMismatch` (500). Before the PR, grep `check_action_access(` for `user_uid=` values not taken from `request.state.user_id`; the known ones are in interfaces 3.3.
- **Cached DTO shape.** `_serialize` drops `None` fields. A cached model with a required `Optional` field misses on every read, which silently removes the cache. Every cached access model gives its `Optional` fields a `None` default, and a test round-trips them through the real serializer.
- **API keys whose creator is not a user.** Today they fail on every request (500 in the ApiKey middleware) and the Agenta channel refuses them. M2 keeps both: the middleware path is unchanged up to the failing line, and `fetch_principal` returns them inactive. Schedules and evaluation runs whose creator was deleted keep that id as principal; `decide` denies them `principal_inactive` and the trigger is paused, where today the run is denied at its first checked call.
- **Large organizations.** An organization can have tens of thousands of members. Project-wide invalidation is one pattern call per namespace per project; per-user invalidation is a direct delete by key; loops over users page by 500.
- **Latency.** A warm decision reads two Redis entries (`fetch_principal`, `resolve_membership`) instead of one (`check_action_access`); a cold one also reads Postgres. A warm denial costs the same as a warm allow, because the membership cache stores absence too. Measure p99 on the QA stack against the previous release, for allowed and for denied requests.
- **Invalidation race (known limit).** A read that starts before a mutation commits can write the old membership, or the old absence, after the invalidation. That stale entry lives at most `AGENTA_CACHE_TTL` (300 s). Today's `check_action_access` cache has the same race. M2 does not fix it: no lock, version counter or second invalidation. So revocation takes effect at the next decision when no read races the mutation, and within `AGENTA_CACHE_TTL` in two cases: Redis invalidation fails, or a concurrent read refills the old entry. M1 interfaces section 6 and CONTRACT section 6 (item 6 below) state the same bound.
- **Rollout window.** Runs and queued items started on old pods fail once; triggers created on old pods during the rollout are paused. Deploy at low traffic; the release note says so.
- **ApiKey state cache.** It cannot be invalidated. A deleted key still authenticates for up to 300 s on routes that check no permission; every route that checks a permission, the exchange and the gateway credential route deny it.
- **Behavior change.** Channel turns, resumes and queued sends recheck `RUN_SESSIONS` before invoking. A user who already lacked it now fails earlier, with a clear reason.

## 9. Contract changes needed

None. CONTRACT v3 already holds every change listed in round 2.

## 10. Decisions recorded (former gaps)

| Topic | Rule (least-work default) |
| --- | --- |
| `run_id` | Optional; `None` for web-direct, direct-API and batch runs. Children of web-direct runs have no `parent_run_id`. |
| `linked_user_id` | Part of `RunAuthority`; installation only. Durable work rebuilds it from the row's `created_by_id`, which holds today's acting user. |
| Recheck action per work type | `RUN_SESSIONS` for session work (sends, resumes, channel turns, template starts); `RUN_WORKFLOWS` for triggers and child runs; `EDIT_EVALUATION_RUNS` for evaluations, because annotators lack `RUN_WORKFLOWS`. |
| Rows written by old pods during rollout | No reconstruction. Triggers pause, evaluation runs fail, queued work is cancelled (interfaces 1.3). |
| Environment-bound triggers | Stay active; target resolved each tick before the check (F6). |
| Evaluation principal | Explicit create, start and rerun only (interfaces 3.7). |
| Approval attribution | `RunApproval` with the approving principal. |
| Cancelled inputs | Shown through the failed `continue_input` command; no new column. |
| Exchange labels | The exchange still drops `gateway_run_id`, `gateway_tools` and `gateway_run_labels`, as today. Out of scope. |
| `inspect_workflow` | Deleted (no caller). |
| Implementation shape | One PR with ordered commits; signature changes land with all callers; no temporary `human(user_id)` fallback. |
| Agent restrictions | Unsupported in M2: `decide` denies any non-null `restrictions.agent`. |
| Revisions | `oss000000046` schema expansion, `oss000000047` backfill, same release. |
| Turn completion | Attribution is filled as one group only when `principal_kind IS NULL`; no per-column `COALESCE`. |
| Refused trigger delivery | `refuse_delivery` (record and pause in one transaction); `error` stays a string, `error_details` holds the `AgentError`. |
| `create_runs` | Gains `principal` like `create_run`. |
| Agents are archived, not deleted | Archive pauses triggers; unarchive does not resume them. |
