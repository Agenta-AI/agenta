# Status

Source of truth for where this work stands. Update this file as things change.

## Current state

**Implemented.** The recommended design is built across backend and frontend, and the two
acceptance tests pass against the local EE dev stack. The decisions below were accepted as
recommended.

## What is done

- Codebase research complete. See [research.md](research.md).
- Design, phased plan, and decisions written. See [plan.md](plan.md) and
  [decisions.md](decisions.md).
- Backend built:
  - `remove_contact(email)` Loops helper in `api/oss/src/utils/emailing.py`.
  - `SubscriptionsService.cancel_subscription(organization_id)` in
    `api/ee/src/core/subscriptions/service.py`.
  - `count_organization_members(organization_id)` in `api/ee/src/services/db_manager_ee.py`.
  - `PlatformAdminAccountsService.delete_own_account(user_id)` plus
    `_delete_supertokens_user` in `api/oss/src/core/accounts/service.py`, with the
    `AccountHasMembersError` / `AccountAuthDeletionError` exceptions in
    `api/oss/src/core/accounts/errors.py`.
  - `DELETE /profile` endpoint (EE-gated) in `api/oss/src/routers/user_profile.py`.
- Frontend built:
  - `deleteAccount()` in `web/oss/src/services/profile/index.ts`.
  - `Account/DeleteAccount.tsx` settings section with the type-your-email confirm modal.
  - New EE-only "Account" tab wired into the settings page and `SettingsSidebar`.
- Tests: `api/ee/tests/pytest/acceptance/accounts/test_account_deletion.py`. Two cases
  (happy-path delete, shared-org block) pass against the local EE stack.

## Verified behavior

Order of operations in `delete_own_account`: capture email and owned orgs, block if any
owned org has other members, cancel Stripe per owned org (best effort), delete the
SuperTokens login, run the existing DB cascade (memberships + user + owned orgs), then
remove the Loops contact (best effort). The route is EE-only and returns 404 on OSS.

## Auth hardening (review follow-up)

`DELETE /profile` requires an interactive SuperTokens session. The handler rejects the
request (403) when there is no session, or when it authenticated via an API key
(`request.state.credentials` starts with `ApiKey `). This matters because
`request.state.user_id` can be populated by a project API key, and account deletion is
irreversible: without this guard a leaked or embedded integration key could delete the
key owner's account and organizations. The acceptance suite covers it with
`test_delete_account_rejects_api_key` (API key, 403, account survives); the happy-path and
shared-org tests sign in for real and use the session bearer token.

## Needs sign-off

All accepted as recommended and built:

1. Scope EE only, hide on OSS. Done.
2. Block account deletion when an owned org has other members. Done.
3. Immediate hard delete, no grace period. Done.
4. Delete SuperTokens before the DB cascade, treat it as required. Done.
5. Synchronous deletion for v1. Done.
6. Fold Stripe cancel into the existing org-delete endpoint too. Not done. Left as a
   follow-up; `DELETE /organizations/{id}` still skips the Stripe cancel.

## Next steps / follow-ups

1. Fold `cancel_subscription` into the existing `DELETE /organizations/{id}`
   handler so org deletion also stops billing (decision 6).
2. Consider re-auth (recent login) before the destructive action, as hardening.
3. If account volume grows, move the DB cascade to a TaskIQ job and return 202.
4. Migrate `deleteAccount()` to the Fern client once the OpenAPI spec is regenerated with
   the new `DELETE /profile` route.

## Open questions

- The Loops delete endpoint is implemented as `POST /api/v1/contacts/delete` with
  `{"email": ...}`. Confirm against the Loops API docs; it is best-effort either way.
- PostHog person-deletion remains out of scope. Decide whether it is worth a best-effort
  follow-up.
- The acceptance happy-path uses an admin-created account, which has no SuperTokens login,
  so the SuperTokens delete step runs as a no-op there. A real-signup deletion test would
  exercise the auth deletion fully.

## Decision log

- Accepted EE-only scope, block-on-shared-org, hard delete, SuperTokens before DB, sync
  for v1. Implemented and verified with passing acceptance tests against the local EE
  stack.
