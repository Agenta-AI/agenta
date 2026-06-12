# Plan

The design and a phased build. Read [decisions.md](decisions.md) first; this plan assumes
those recommendations are accepted. Read [research.md](research.md) for the exact existing
functions each step reuses.

## The design in one picture

```text
Settings (EE only)
  └─ Danger zone: "Delete account"
       └─ Modal: type your email to confirm ──► DELETE /profile   (session auth)
                                                      │
                                                      ▼
                               SelfServeAccountsService.delete_own_account(user_id)
                                                      │
   1. load user, capture email + owned org ids + subscription ids
   2. guard: any owned org with other members?  ── yes ──► 409, list the orgs, stop
   3. for each owned org: cancel Stripe subscription          (EE, best effort)
   4. delete SuperTokens user (remove_all_linked_accounts)    (required)
   5. cascade-delete memberships + user + owned orgs          (reuse admin cascade)
   6. remove Loops contact by email                           (EE, best effort)
                                                      │
                                                      ▼
                          Frontend: sign out, clear caches, redirect to /auth
```

## Backend

### New endpoint

Add a session-authenticated route to the existing profile router.

- Route: `DELETE /profile`.
- File: `api/oss/src/routers/user_profile.py`.
- Auth: read `request.state.user_id` from the auth middleware. No id is taken from the
  client. The user can only delete themselves.
- Gate: `is_ee()`. On OSS, return 404 or 405 so the route does not exist for singleton
  installs.
- Require an interactive session rather than only a resolved `user_id`, so API keys cannot
  delete the owning account.
- Convert domain exceptions to HTTP at the boundary, preserving structured details for the
  shared-org 409 response.

### New service method

Add the orchestration to the accounts core service.

- File: `api/oss/src/core/accounts/service.py`.
- Method: `delete_own_account(*, user_id: str) -> AccountDeletionResponse`.
- Steps follow [decisions.md ordering](decisions.md#ordering):
  1. Parse and load the user. Capture `email`, the owned-org ids, and per-org Stripe
     subscription ids before deleting anything.
  2. Shared-org guard. For each owned org, count members. If any owned org has more than
     one member, raise a new domain exception (for example `AccountHasSharedOrgsError`)
     carrying the list of org names. The router maps it to 409.
  3. Cancel Stripe per owned org (EE only, best effort). See the billing factor-out below.
  4. Delete the SuperTokens user (required). Use `UserDB.uid`; call
     `delete_user(user_id=uid, remove_all_linked_accounts=True)` from
     `supertokens_python.asyncio`. On failure, raise a domain exception and stop. The DB
     user is still intact, so the operation is safely retryable.
  5. Reuse the existing cascade. Call `_ee_delete_user_memberships(uid)` then
     `_db_delete_user_with_cascade(uid)`. This is the same code
     `PlatformAdminAccountsService.delete_user` already runs.
  6. Remove the Loops contact (EE only, best effort). Call the new
     `emailing.remove_contact(email)`.
- Return a typed DTO listing what was deleted. The existing `AdminDeletedEntities` shape
  is a fine model; define an account-deletion DTO in
  `api/oss/src/core/accounts/dtos.py` if the admin shape does not fit.

Keep EE-only steps (Stripe, Loops) behind `is_ee()` so OSS stays clean. They already live
this way in the accounts service.

### Loops delete helper

- File: `api/oss/src/utils/emailing.py`.
- Add `remove_contact(email: str)` mirroring `add_contact`: no-op when `env.loops`
  disabled, POST to `https://app.loops.so/api/v1/contacts/delete` with `{"email": email}`,
  same retry and backoff. Confirm the endpoint against the Loops API docs.

### Stripe cancel factor-out

- Pull the Stripe cancel out of the billing router so the account-deletion service can
  call it per org without going through HTTP. A thin function on the subscriptions service
  in `api/ee/src/core/subscriptions/service.py` that takes an org id, reads the
  subscription, and calls `stripe.Subscription.cancel(subscription_id)` if one exists.
- Make it best effort from the deletion path: catch and log, never block the account
  delete. The org row is about to be deleted regardless.
- Optional but recommended ([decisions.md](decisions.md#consolidate)): have the existing
  `DELETE /organizations/{id}` handler call this too, so org deletion finally cancels
  Stripe.

### Domain exceptions

Add to the accounts core (`api/oss/src/core/accounts/` exceptions or `dtos.py`), following
the typed-exception rule in `api/AGENTS.md`:

- `AccountHasSharedOrgsError(org_names)` → 409.
- `AccountAuthDeletionError` (SuperTokens delete failed) → 502 or 500.
- Reuse `AdminUserNotFoundError` for a missing user.

## Frontend

### Where the button lives

Add an account-level "Danger zone" with a "Delete account" action. The simplest placement
that matches the user's "in settings" request is a new section in the existing settings
page, shown only in EE.

- Settings page: `web/oss/src/pages/w/[workspace_id]/p/[project_id]/settings/index.tsx`.
- New section component under `web/oss/src/components/pages/settings/`, for example
  `Account/DeleteAccount.tsx`.

### The modal

Copy the typed-confirm modal from
`web/oss/src/components/Sidebar/components/ListOfOrgs.tsx`:

- Red, irreversible warning. List what gets deleted: the account, the organizations they
  own, and all data in them.
- An input that must match the user's email (from `useProfileData`) before the delete
  button enables.
- Disable the button and show a loading state while the request runs.

### The mutation and sign-out

- Add `deleteAccount()` to the profile service
  (`web/oss/src/services/profile/`) calling `DELETE /profile`.
- Use `useMutation`. On success: reset caches (`resetOrganizationData`,
  `resetProjectData`, profile reset), sign out of the SuperTokens session, and redirect to
  the auth page. On error, surface the message. The 409 shared-org case should show the
  returned org list so the user knows what to fix.

## Phases

Ship in slices so each is reviewable on its own.

1. **Backend core.** `remove_contact` helper, Stripe cancel factor-out, the service
   method with all guards and ordering, the domain exceptions. Unit and acceptance tests
   for the service. No endpoint yet.
2. **Backend endpoint.** Wire `DELETE /profile`, EE-gated, with exception mapping.
   Acceptance test that hits the route for a solo account and for the shared-org block.
3. **Frontend.** The settings section, the typed-confirm modal, the mutation, and the
   sign-out flow.
4. **Consolidation (optional, can follow).** Point the existing
   `DELETE /organizations/{id}` at the shared Stripe-cancel routine.

## Testing

Follow `docs/designs/testing/README.md` and the running-tests notes. At minimum:

- Service test: solo account deletes cleanly and calls Stripe cancel, SuperTokens delete,
  and Loops delete (mock the externals). Assert the DB cascade ran.
- Service test: an owned org with a second member blocks with the shared-org error and
  deletes nothing.
- Service test: SuperTokens delete failure aborts before the DB delete and leaves the user
  intact.
- Endpoint test: the route is EE-gated and only deletes the caller's own account.

## Risks and watch-outs

- **Resurrection bug.** If SuperTokens delete is skipped or ordered after the DB delete,
  the next login recreates the account. The ordering in
  [decisions.md](decisions.md#ordering) exists to prevent this. Guard it with a test.
- **Owner FK is RESTRICT.** The DB will refuse to delete a user who still owns an org.
  The cascade helper deletes owned orgs first, so this is handled, but any new path must
  delete orgs before the user.
- **Best-effort externals can drift.** A failed Stripe cancel means we stop billing in our
  DB but Stripe might keep an active subscription. Log these clearly so we can reconcile.
  Consider an alert on repeated failures.
- **Line numbers in research.md drift.** Confirm the current location of each reused
  function before editing.
