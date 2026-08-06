# Context

## The problem

Users ask us to delete their accounts. They write to us on chat and we delete the account
by hand using admin tooling. This does not scale, it is slow for the user, and it puts a
manual data-deletion task on the team. We want users to do it themselves from Settings.

There is also a compliance angle. Account deletion is part of how we honor data deletion
requests, so a clean self-serve path is the right long-term answer.

## What the user wants

A button in Settings that deletes their account. When they use it, we must remove their
data from every system that holds it:

- Our application database (the user, and the organizations they own, plus everything
  under those organizations).
- SuperTokens, our auth provider, so the login itself is gone and cannot be reused.
- Stripe, so we stop billing them and cancel their subscription.
- Loops, our email tool, so they stop receiving email from us.

## Guiding principle

Favor simplicity over completeness. The common case is one person who owns one
organization and wants out. We optimize for that. We protect the rare team case with a
guard rather than a complex transfer flow. We reuse the deletion code we already have
instead of writing a parallel path.

## Goals

- A logged-in user can delete their own account from Settings.
- Deletion removes the user from the database, SuperTokens, Stripe, and Loops.
- The action is hard to trigger by accident. It needs an explicit typed confirmation.
- The deletion reuses the existing cascade deletion logic, not a new one.
- After deletion the user is signed out and cannot log back into a half-deleted account.

## Non-goals (for v1)

- OSS singleton deletion. Self-hosted OSS runs one shared organization. Deleting it
  breaks the instance, so OSS does not get this button. See
  [decisions.md](decisions.md#scope).
- Ownership transfer UI. If a user owns an organization that has other members, we block
  the deletion and tell them to remove the members first. We do not build a transfer flow.
- Soft delete or a grace period. v1 is an immediate hard delete, matching what users ask
  for and matching the existing deletion code.
- Self-service deletion of a single organization. That already exists. This work is about
  deleting the whole account.
- Exporting the user's data before deletion.

## Who is affected

Cloud users (EE license) and self-hosted EE users. In EE, each signup gets its own
organization and is the sole owner of it, so "delete my account" maps cleanly to "delete
me and my organizations." OSS is out of scope for v1.
