# Design: small team roles

## Context

Facts about today, read from the code:

- `AccessService._capability` returns allowed when `RbacEnforcementInterface.is_enforced` is false. EE reads `Flag.RBAC`, which is false for Hobby and Pro. OSS always enforces.
- Roles are stored on every plan. The invite path does not read the plan, and the default is `viewer`.
- Trace reads and analytics reads check `VIEW_SPANS`. All built-in roles have it.
- `GET /invocations/{trace_id}` and `GET /annotations/{trace_id}` return the root span's `ag.data` for any trace id, under `VIEW_INVOCATIONS` and `VIEW_ANNOTATIONS`.
- Evaluation workers load traces and pass inputs and outputs to the evaluator. Metrics can store span values.
- OTLP ingest requires `EDIT_SPANS`, and the runner sends spans with the acting user's credential.
- Chat transcripts live in `records`, under `VIEW_SESSIONS` and chat access. They do not read `spans`.
- A few organization paths read the stored role on every plan: `decide_organization` (organization credentials, the provider test, the organization project list and "Needs setup"), `verify_user_org_admin` (domains and SSO) and the new-member notice email. Personal accounts, account choices, personal MCP sign-in and channel bindings read no role.
- The /m Members tab shows no role and has no role change control. The API routes for changing roles exist. The tab's payload reads `organization_members.role`, and the access check reads `project_members.role`. `set_member_role` writes both, so they agree.

## Decision 1: one new role, defined by removal

`member` has the `developer` permissions minus:

- `VIEW_SPANS` (also the permission for analytics)
- `VIEW_INVOCATIONS`, `EDIT_INVOCATIONS`, `VIEW_ANNOTATIONS`, `EDIT_ANNOTATIONS`
- every `*_EVALUATION_*` permission

Why: the first item alone leaves trace content readable through the routes above, and an evaluation can copy trace content into its output.

`member` keeps `EDIT_SPANS`, because its runs must send spans, and `VIEW_BILLING`, because credit balances are read under it.

`member` also gains `CREATE_WORKSPACE` and `EDIT_WORKSPACE`, which `developer` does not have, so it creates and renames projects. Why: a later change gives each person a personal project, and a member must be able to set one up. `DELETE_WORKSPACE` stays with the owner. Making a project the default needs the admin role, because organization writes authorize on the default project; `EDIT_WORKSPACE` alone no longer allows it, and /m hides "Set as default" from a member. The domain and SSO routes also check `EDIT_WORKSPACE`, but they require the admin role first, so a member still cannot change them.

`member` exists in all three scopes, with an empty permission list at organization scope, as `admin` and `viewer` have. It joins `RequiredRole` and the reserved slugs in `role_overrides.py`, so an `AGENTA_ACCESS_ROLES` override cannot remove or rebind it. Its description names the exclusion: "Can use and build, but cannot read traces, analytics or evaluations."

The roles are a set, not a ladder. `member` holds `EDIT_WORKFLOWS`, which `annotator` and `viewer` lack, and lacks `VIEW_SPANS`, which `viewer` holds.

`member` was the old lowest slug. Migration `a1b2c3d4e5f7` renamed it to `viewer`, and its downgrade renames every `viewer` back to `member`. Under the new catalog that downgrade would promote viewers, so its role rewrite becomes a no-op.

No analytics permission is added. Admins and owners read analytics, as they read traces, so one permission serves both. Business can split them later if a customer asks.

## Decision 2: enforce everywhere, offer by plan

Remove the shortcut from `_capability` and from the role check that shares it. A new helper answers which roles a plan offers:

| Edition or plan | Offered in invites and role changes |
|---|---|
| OSS, Hobby, Pro | admin, member |
| Business, Agenta AI, self-hosted Enterprise | every catalog role except `owner` |

On EE, `Flag.RBAC` keeps its name and now means "offers every role". One offered-roles helper in `core/access` is the only reader of `Flag.RBAC` for offering, and `Flag.RBAC` gets a comment that says this meaning. It also still controls selected-project credentials, which today read it through `RbacEnforcementInterface.is_enforced` (`EntitlementProjectLimits`). When the shortcut goes, that caller reads `Flag.RBAC` through the offered-roles helper or its own check, so removing `is_enforced` does not change it. OSS offers the short list, so the helper cannot reuse `is_enforced`, which answers true on OSS. `GET /access/roles` and `GET /workspaces/roles/` return the offered roles for the caller's organization, which makes the first route request-aware. Their docstrings say "offered roles". "Catalog" stays the name of the full set. The invite and assign routes refuse any other role, so the API and the screen agree. The role route already refuses `owner` (`_set_member_role`). The invite path does not: `resolve_workspace_invite_role` accepts any catalog role. The offered-roles check closes that, on every edition and plan. The floor role is the role a person gets when an invite names no role, and the role a demotion writes. It is `member` on OSS, Hobby and Pro, and `viewer`, as today, on plans with `Flag.RBAC`. The `organization_members.role` column keeps its server default `viewer`, because every writer passes the role. `DELETE /workspaces/{id}/roles/` demotes to the floor role. Its shipped name, `unassign_role_from_user`, stays, although the route writes a role. `DecisionReason.RBAC_NOT_ENTITLED` is deleted. The catalog keeps all roles, so stored rows and higher plans keep working.

An EE organization with no subscription, or with a plan the helper does not know, is offered every role except `owner`, and its floor role is `viewer`.

Invitations follow the same rule through their whole life:

- Resending an invitation runs the same offered-role check as creating one, before any invitation is created or any email is sent. The API answers 400 for a role the plan does not offer, `owner` included, and 503 when the plan cannot be read. Resend never moves the seat gauge.
- Accepting an unused invitation that is stored as `owner` grants `admin`. Only the transfer route grants `owner`.
- Accepting an invitation with any other stored role grants that role as stored. An old OSS invitation for `viewer` still grants `viewer`.

Alternative rejected: keep the shortcut and check only `member` on Hobby and Pro, with no migration. It is smaller, but a stored "viewer" could then do everything, and the app would show roles that are not real.

## Decision 3: migrate data once, on EE only

One EE data migration does two things. A migration cannot read entitlements, so it names the plans.

1. On `cloud_v0_hobby` and `cloud_v0_pro`, it sets `role = 'admin'` on `organization_members`, `project_members` and unused `project_invitations` where the role is not `owner`, `admin` or `member`, or is null. Nothing is lost, because those stored values have no effect on project actions on those plans today.
2. On every EE plan, it sets `role = 'admin'` on `organization_members` and `project_members` rows whose role is `owner` and whose user is not `organizations.owner_id`, and on unused `project_invitations` whose role is `owner`. Today an invite can name `owner`. Such a row passes every project check, and the role route cannot change it. It is a mistake, and the app has no way to fix it.

Effects on the people in step 1:

- They keep every project action, including traces, analytics and evaluations.
- They lose `DELETE_WORKSPACE`, so only the owner deletes a project. Editing, transferring and deleting the organization were already owner-only on every plan, because those routes check the owner id first (`_check_org_owner`). `ADD_USER_TO_ORGANIZATION` is checked nowhere. They keep billing, because admin gains `EDIT_BILLING` (Decision 6).
- They gain `decide_organization` actions, such as managing organization credentials, and they start to get the new-member notice email.

A person in step 2 loses `DELETE_WORKSPACE` and keeps every admin permission.

Alternative rejected: map stored roles to admin at read time. It keeps old values, but every role reader must know the mapping forever.

OSS has no migration. Its roles already limit people, so moving a viewer to admin would add real power. Old rows keep working and keep their names, `owner` rows included.

A plan downgrade from Business needs no code: a stored `viewer` stays a real, enforced viewer, and an admin can change it. No Business customer exists today.

## Decision 4: the app hides what a Member cannot read

The app gates on `useProjectPermission(projectId, "view_spans")` (`web/mobile/src/features/context/useProjectPermission.ts`), which returns false while loading and on error:

- Settings: the Analytics tab, its URL, and the "Open trace" control in the Analytics drawer.
- The Observability page. It is hidden from navigation, but a person can open it by URL.
- Every "View trace" control.
- Chat: the answerless-turn trace read (`TurnRow`) and the activity line read (`ActivityTimeline`). The activity line takes its duration from the turn's start and end. The footer timestamp and metrics stop reading the trace in reduced PR #7881 (Decision 5, "chat footer").

The hook lives in the app. /m passes the gate as a prop into the `@agenta/*` components that read traces, such as `@agenta/chat` and `@agenta/observability`.

Without this gate, a 403 reads as "trace not found", and the drawer stays on its skeleton.

Removing the shortcut also exposes actions that /m shows to everyone today, because the app leaves the decision to the API. The same hook gates them:

- Invite: `add_new_user_to_workspace`. Create project: `create_workspace`. Rename project: `edit_workspace`. Owners, admins and members have both, so a member can set up a project of their own. Delete project: `delete_workspace`, which only the owner has.
- Billing portal, plan change, credit usage and the chat "Buy credits" button: `edit_billing`.
- Remove a person: an admin or owner check, because that route requires the admin role.

The permission names `create_workspace`, `edit_workspace` and `delete_workspace` mean project. The gates reuse them; no project-named copies are added.
- Access & Security: the organization owner only, as the API already requires.

## Decision 5: reduce PR #7881

| Part of PR #7881 | Result |
|---|---|
| Usage columns, runner usage, write-back, chat footer | Keep |
| Runner and SDK stamps, ingest linking, `totals.linked` | Remove. The write-back matches turns by `trace_id`, so a non-chat trace updates no row. The cost is one indexed no-op update per recompute of a priced non-chat trace |
| Tracing fill migration `oss000000008` | Remove |
| `SpanReadScope`, `TraceAccessService`, required `scope`, deny list, partial index | Remove |
| Tombstone cleanup in retention | Remove |
| `access.restricted` and the "Partial" note | Remove |
| `AGENTA_API_TRACING_SESSION_FILTER_ENABLED` | Remove |
| Migration `oss000000055_add_session_turn_usage` | Renumber to the next free number (`oss000000061` on main today), revising the head (`oss000000060`), because main already has `oss000000055`. Keep the usage columns and `ix_session_turns_project_id_trace_id`. Drop `ix_session_streams_project_id_private_owner` |
| One-line change to `14-share-agents-and-chats.mdx` | Revert, because the sharing notice does not change |

The tombstone table and its write already shipped in M3. Removing them is a separate cleanup.

## Decision 6: owner and admin manage billing

Admin gains `EDIT_BILLING`. Comparable products let admins manage billing, and owner-only billing would strand a team whose payer is not the owner. The owner alone deletes the organization and transfers ownership.

## Decision 7: keep both usage writers for now

The runner value fills a turn when the write-back cannot: a turn with no trace id, a trace without exactly one root, a trace shared by several turns, or a trace export that failed or was skipped. Live QA proved the trace value only on Pi. If QA shows source `trace` on every harness, a later change can delete the runner path and `usage_source`.

## Accepted limits

- **People migrated to admin keep full trace access** until an owner or admin changes them to Member.
- **Owners and admins read traces of private chats.** Private means private from Members.
- **A Member can overwrite or delete a trace if they know its ids.** `EDIT_SPANS` covers ingest, edit and delete, and ingest updates an existing span. A Member sees ids only for chats they can open. Annotators and above can do this today, and so can everyone on Hobby and Pro. Guarding the edit and delete routes would not close ingest.
- **A failed turn shows less to a Member.** A provider failure that exists only on the trace shows as "No response". Showing the real text would need a sanitized copy on the turn, because the raw text can hold account ids.
- **Trace summaries cached in a browser** stay readable on that device after a demotion, until they expire.
- **Membership is cached for up to five minutes.** Just after the rollout, a new pod can read a cached old role, so an active person on Pro can get a 403 on an edit during that window.
- **Invitations written during the rollout** by old pods keep their old role. That person becomes an enforced viewer, and an admin can change the role.
- **An agent running as a Member** gets a 403 from the `query_spans` and `annotate_trace` operations. Neither is in the default build kit.
- **`test_run` reads its child run's trace without `VIEW_SPANS`.** The handler reads spans as the service and returns a digest. A Member sees only the digest of a run they started.
- **An evaluation run whose principal becomes a Member stops.** Runs execute as their stored principal and recheck `EDIT_EVALUATION_RUNS`.
- **Rollback while `member` rows exist.** Old pods do not know `member`. On Hobby and Pro, the old shortcut lets a member pass every permission. On other plans and on OSS, a member has no permissions until an admin changes the role. There is no translation and no rollback block.
- **A stray `owner` row on OSS keeps full power.** OSS has no migration. The invite path stops writing new ones.

## Rollout

1. Ship reduced PR #7881.
2. The owner runs a read-only production count of organizations per `subscriptions.plan`, to confirm that no other plan values exist. The build does not run it, because a production read needs the owner's approval. The migration names only `cloud_v0_hobby` and `cloud_v0_pro`, so rows on any other plan value keep their role.
3. Ship the roles API, the migration and the app gates in one PR. The API change without the app gates shows 403 errors to Members.
4. Run the data migration, then roll out API pods. Old pods keep the shortcut, so the migrated data is safe with old and new code.
5. Roll back by redeploying old pods. The shortcut returns, and migrated roles stay valid. Members created after the rollout keep the `member` role, so the rollback limit above applies to them.

There is no feature flag. The migration number is assigned at merge. On main today, it is `ee0000000008` in `core_ee`, revising `ee0000000007`.
