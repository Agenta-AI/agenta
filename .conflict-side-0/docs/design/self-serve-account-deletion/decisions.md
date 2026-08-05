# Design decisions

Each decision lists the options, a recommendation, and why. These need a quick sign-off
before implementation. The recommendations all lean toward the simplest version that is
still safe.

## Scope: who gets the button {#scope}

**Decision:** Ship to EE only (cloud and self-hosted EE). Hide it on OSS.

Why: In EE each user owns their own organization, so deletion is clean. OSS runs a single
shared organization that the bootstrap path depends on. Deleting it breaks signup for
everyone, and the code already refuses to delete it
(`AdminValidationError("The OSS singleton organization cannot be deleted.")`). The demand
is from cloud users anyway. Gate the endpoint and the UI on `is_ee()`.

Trade-off: a self-hosted OSS user cannot self-delete. That is acceptable. They control the
instance and can drop the row directly. Revisit only if asked.

## Owned org with other members {#shared-orgs}

**Decision:** Block deletion when the user solely owns an organization that has other
members. Show a clear message telling them to remove the other members first (member
removal already exists in workspace settings), or contact support.

Options considered:

- Block and instruct (recommended). Safe, simple, and rare in practice. Protects a team
  from losing its data because one member deletes their account.
- Auto-transfer ownership to another member. Rejected for v1. There is no user-facing
  transfer flow, so we would build one, and picking the new owner is its own UX problem.
- Delete the org anyway. Rejected. It silently destroys other people's data.

The check: for each org the user owns, count members. If any owned org has more than one
member, block with the list of those orgs. Solo orgs (the normal case) pass straight
through.

## Hard delete vs soft delete {#hard-delete}

**Decision:** Immediate hard delete. No grace period in v1.

Why: it is what users ask for ("remove my account"), it matches every existing deletion
path in the code, and a soft-delete model would need new columns, new filters everywhere,
and a purge job. If we later want a 30-day recovery window we can add it as a follow-up.

## Order of operations and failure handling {#ordering}

**Decision:** Run external cleanup and the DB delete in this order, and treat SuperTokens
deletion as a required step:

1. Resolve the user. Capture their email, the ids of orgs they own, and the Stripe
   subscription ids. Do this before anything is deleted, because the DB delete destroys
   these values.
2. Run the shared-org guard. Abort early if it trips.
3. Cancel each owned org's Stripe subscription. Best effort. Log failures and keep going.
   A failed cancel must not strand the user in a half-deleted state.
4. Delete the SuperTokens user with `remove_all_linked_accounts=True`. Required. If this
   fails, abort and surface an error. Do not delete the DB user yet.
5. Hard-delete the DB user and owned orgs via the existing cascade
   (`admin_delete_user_with_cascade` plus `admin_delete_user_memberships`).
6. Remove the Loops contact by email. Best effort.
7. Frontend signs the user out and redirects.

Why SuperTokens before the DB delete: `_create_account` is idempotent. If we delete the DB
user but leave the SuperTokens login alive, the next login recreates a fresh account and
org. Deleting SuperTokens first means the worst failure case is a DB user with no login
(a harmless orphan an admin can clean), instead of a resurrected account.

## Sync vs background job {#sync}

**Decision:** Do it synchronously in the request for v1.

Why: a typical cloud account is small and the existing cascade runs in one transaction.
Keep it simple. If we see timeouts on large accounts, move the DB cascade to a TaskIQ job
(the webhooks and evaluations workers show the pattern) and have the endpoint return 202.
Note this as a known scaling follow-up, not a v1 requirement.

## Confirmation strength {#confirmation}

**Decision:** Require the user to type their email address to enable the delete button,
copying the delete-org modal pattern in `ListOfOrgs.tsx`. Show a red, irreversible
warning that lists what will be deleted.

Future hardening (not v1): require a recent login (re-authentication) before allowing the
action. Worth doing eventually for a destructive irreversible action, but the typed
confirm is enough to ship.

## Consolidate with existing org deletion {#consolidate}

**Decision:** Extract a single "purge organization" routine that cancels Stripe and then
cascade-deletes, and have both account deletion and the existing
`DELETE /organizations/{id}` use it.

Why: the existing org-delete endpoint has the same gap (it never cancels Stripe), so we
are fixing a real bug while we are here, and we avoid two copies of the cleanup logic.
Keep the change small and focused. If it grows, split it into its own task and have
account deletion ship first against the current org-delete behavior.

## PostHog {#posthog}

**Decision:** Out of scope for v1, best-effort later. PostHog deletion is not required for
the feature to work and is not what users are asking for. If we want analytics to honor
deletion too, add a best-effort person-delete call as a small follow-up.
