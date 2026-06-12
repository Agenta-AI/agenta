# Research

What the codebase already has. Every path and line number below was checked against the
tree on branch `feat/unified-eval-loops`. Line numbers drift, so treat them as a starting
point and confirm before editing.

## Summary: most of the deletion already exists

Account deletion is mostly a wiring job, not a from-scratch build. We already have admin
cascade deletion, a self-serve org deletion endpoint, a SuperTokens delete call, a Stripe
cancel routine, and a Loops client. What is missing is one authenticated endpoint that
calls them in the right order with the right guards, plus the Settings UI.

## 1. Data model and what a user owns

Core models live in `api/oss/src/models/db_models.py`:

- `UserDB` (users). Key fields: `id` (UUID PK), `uid` (the SuperTokens user id, unique),
  `email` (unique).
- `OrganizationDB` (organizations). `owner_id` and `created_by_id` are FKs to users with
  `ON DELETE RESTRICT`. So a user cannot be deleted while they still own an organization.
  The org must be deleted or reassigned first.
- `WorkspaceDB`, `ProjectDB`. Both cascade from organization (`ON DELETE CASCADE`).
- Everything under a project (apps, variants, environments, testsets, evaluators,
  evaluations, api keys, invitations, folders) cascades from `project_id`.

EE membership models live in `api/ee/src/models/db_models.py`:
`OrganizationMemberDB`, `WorkspaceMemberDB`, `ProjectMemberDB`. All cascade from both the
user and their scope.

The deletion shape for one user:

```
user
├── organizations they own        (RESTRICT — must delete these explicitly)
│   ├── workspaces                 (CASCADE)
│   ├── projects + all data        (CASCADE)
│   ├── organization_members       (CASCADE, EE)
│   └── subscription + meters      (CASCADE, EE)
├── memberships in other orgs      (CASCADE — just drop the membership rows)
└── SuperTokens recipe user(s)     (separate system, deleted via SuperTokens API)
```

## 2. EE signup creates one org per user

In EE/cloud, a new signup gets a fresh organization, workspace, and project, and is the
sole owner. See `api/ee/src/services/commoners.py` (`create_organization_for_signup`) and
`api/ee/src/services/db_manager_ee.py` (`create_organization`, which inserts the
`OrganizationMemberDB` row with role `owner`). A signup subscription is provisioned at
`api/ee/src/core/subscriptions/service.py` (`provision_subscription`).

So in cloud the typical user owns exactly one org and is its only member. An org gets more
members only through invitations. This is why "delete my account" maps cleanly to "delete
me and the orgs I own" for almost everyone.

## 3. Existing cascade deletion (admin path)

`api/oss/src/core/accounts/service.py`, `PlatformAdminAccountsService.delete_user` (around
line 1644):

```python
async def delete_user(self, *, user_id: str) -> AdminDeleteResponse:
    uid = _parse_uuid(user_id, "user_id")
    user = await _db_get_user_by_id(uid)
    if not user:
        raise AdminUserNotFoundError(user_id)
    if is_ee():
        await _ee_delete_user_memberships(uid)      # drop membership rows first
    deleted_org_ids = await _db_delete_user_with_cascade(uid)
    ...
```

It calls:

- `_ee_delete_user_memberships` = `admin_delete_user_memberships` (EE).
- `_db_delete_user_with_cascade` = `admin_delete_user_with_cascade` in
  `api/oss/src/services/db_manager.py` (around line 2025). This finds every org the user
  owns and runs `admin_delete_accounts_batch`, which deletes projects, then workspaces,
  then organizations, then the user, in one transaction.

This admin path does NOT touch SuperTokens, Stripe, or Loops. That is the gap.

## 4. Existing self-serve org deletion (closest sibling)

The frontend already deletes organizations. `deleteOrganization` in
`web/oss/src/services/organization/api/index.ts` calls `DELETE /organizations/{id}`. The
trigger is the org switcher menu in
`web/oss/src/components/Sidebar/components/ListOfOrgs.tsx`, which opens a modal that makes
the user type the organization name to confirm.

The backend handler is `delete_organization` in
`api/ee/src/routers/organization_router.py` (around line 429):

- Checks the caller is the org owner (`check_user_org_access(..., check_owner=True)`).
- Blocks deleting your last org (`count_organizations_by_owner(...) <= 1` returns 400).
- Calls `db_manager_ee.delete_organization(id)`, a hard delete that relies on DB cascade.

It does NOT cancel Stripe, delete from SuperTokens, or remove from Loops. Same gap as the
admin path. The "last org" guard does not apply to account deletion, since deleting your
account is exactly the case where the last org should go too.

## 5. SuperTokens: how to delete a login

SuperTokens is configured in `api/oss/src/core/auth/supertokens/config.py`
(`init_supertokens`). It is always on when auth is enabled, in both OSS and EE.

The link between a SuperTokens user and our user is `UserDB.uid`. On signup,
`_create_account` in `api/oss/src/core/auth/supertokens/overrides.py` stores the
SuperTokens recipe user id into `users.uid`.

We already call SuperTokens delete in two places:

- `api/oss/src/core/accounts/service.py`, `delete_user_identity` (around line 1666):
  `from supertokens_python.asyncio import delete_user as _st_delete_user` then
  `await _st_delete_user(user_id=identity_id, remove_all_linked_accounts=False)`.
- `api/oss/src/services/db_manager.py` line 17 imports
  `delete_user as delete_user_from_supertokens`, used around line 1013 after looking the
  user up by email with `list_users_by_account_info`.

Critical detail: `_create_account` is idempotent. If we delete our DB user but leave the
SuperTokens login alive, the next time that person logs in the override recreates a fresh
account and org. So SuperTokens deletion must happen, and it must happen before (or with)
the DB delete. For full removal use `remove_all_linked_accounts=True` so linked logins
(email plus Google, for example) all go.

## 6. Stripe: how to cancel a subscription

A subscription is 1:1 with an organization. The model stores `customer_id` and
`subscription_id` (`api/ee/src/dbs/postgres/subscriptions/dbas.py`).

The cancel routine is in `api/ee/src/apis/fastapi/billing/router.py`,
`cancel_subscription` (around line 862):

- `stripe.Subscription.cancel(subscription.subscription_id)` (around line 907).
- `process_event(Event.SUBSCRIPTION_CANCELLED)` in
  `api/ee/src/core/subscriptions/service.py` (around line 335), which resets the local
  subscription to free and clears `customer_id` and `subscription_id`.

We want the Stripe cancel call, not the local "reset to free" bookkeeping, since the org
row is about to be hard-deleted. The cancel logic should be factored into a small service
function we can call per owned org during account deletion.

## 7. Loops: how to remove a contact

Config: `LoopsConfig` in `api/oss/src/utils/env.py` (around line 782). Enabled when
`LOOPS_API_KEY` is set. Gated by `is_ee()` at the call site.

Add contact today: `add_contact(email)` in `api/oss/src/utils/emailing.py` (around line
95). It POSTs to `https://app.loops.so/api/v1/contacts/create` with `{"email": email}`,
with retry and backoff. Called on signup from `api/ee/src/services/commoners.py`.

There is no delete yet. We add a `delete_contact(email)` that mirrors `add_contact`. The
Loops delete endpoint is `POST https://app.loops.so/api/v1/contacts/delete` with body
`{"email": email}`. Confirm the exact endpoint against the Loops API docs at
implementation time.

## 8. Other integrations to check

- PostHog (`api/oss/src/utils/env.py`, analytics middleware). Tracks users by email as
  distinct id. Not required for v1 functionally. If we want GDPR-clean analytics we can
  fire a person-delete to PostHog, but treat it as optional and best-effort. See
  [decisions.md](decisions.md#posthog).
- SendGrid. Only sends transactional email, holds no contact list to clean. No action.
- Crisp. Frontend chat widget, no per-user backend record in our code. No action.

## 9. Backend conventions that apply

From `api/AGENTS.md`:

- New domain code goes under `api/oss/src/apis/fastapi/<domain>/`,
  `api/oss/src/core/<domain>/`. The accounts domain already exists at
  `api/oss/src/apis/fastapi/accounts/` and `api/oss/src/core/accounts/`.
- Router handlers stay thin, use `@intercept_exceptions()`, and convert domain exceptions
  to HTTP at the boundary. Services raise typed domain exceptions, never `HTTPException`.
- Services return typed Pydantic DTOs. The accounts domain already has
  `AdminDeleteResponse` and friends in `api/oss/src/core/accounts/dtos.py`.
- The authenticated user is on `request.state.user_id` (set by the auth middleware,
  `api/oss/src/middlewares/auth.py`).
- EE-only behavior is guarded with `is_ee()` (`api/oss/src/utils/common.py`). EE routers
  are mounted via `ee.extend_main(app)` in `api/entrypoints/routers.py`.

## 10. Frontend conventions that apply

- Settings is a tabbed page at
  `web/oss/src/pages/w/[workspace_id]/p/[project_id]/settings/index.tsx`, with section
  components under `web/oss/src/components/pages/settings/`. There is no account-level
  settings page yet; settings are workspace/project scoped.
- The confirm-by-typing modal pattern to copy is in `ListOfOrgs.tsx` (the delete-org
  modal). The simpler `AlertPopup` helper
  (`web/oss/src/components/AlertPopup/AlertPopup.tsx`) is the fallback for low-risk
  confirms; account deletion warrants the stronger typed confirm.
- Mutations use TanStack Query `useMutation`. The current user comes from `useProfileData`
  (`web/oss/src/state/profile`). Org/project caches reset via `resetOrganizationData` and
  `resetProjectData` (`web/oss/src/state/org`, `web/oss/src/state/project`).
- Sign-out uses the SuperTokens session. After deletion the UI signs out and redirects to
  the auth page.
