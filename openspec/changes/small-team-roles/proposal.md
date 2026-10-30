# Small team roles

## Why

A private chat is hidden in the app, but its traces are not. Every default role has `VIEW_SPANS`, and on Hobby and Pro the access check lets every member pass every project permission, whatever role is stored. So a role shown on those plans has no effect on project actions, any Pro member can change roles or edit billing, and anyone can read the prompts and answers of a private chat in its traces.

The session trace privacy design (M9b) filtered each trace read by chat access. That design is replaced. Who may read traces becomes a role decision, which is simpler and easier to explain.

## What Changes

- **A new `member` role.** A member uses the product and cannot read trace content, analytics, evaluations, or manage people.
- **Roles are enforced on every plan.** The shortcut that lets every member pass on plans without RBAC is removed.
- **Hobby, Pro and OSS offer simple roles.** Invites and role changes offer Admin and Member. Owner changes only through the existing transfer, and no invite can name `owner`. Business and Enterprise keep the longer list.
- **Existing Hobby and Pro members become admins** in a one-time migration, so their work continues. On every EE plan, the same migration changes an `owner` row on anyone who is not the organization owner to `admin`. OSS has no migration, because its roles already apply.
- **The app shows and changes roles.** The Members tab gets a role column and a change control. Screens hide what a member cannot read.
- **PR #7881 shrinks** to per-turn usage and what its write-back needs. The deny list, read scope, tombstone cleanup, "Partial" note and flag are removed.

## Non-goals

- Per-project membership on Business, more Business roles, custom roles on Enterprise.
- An option to turn tracing off or to record only costs.
- Hiding private chat traces from owners and admins.
- Changing the sharing dialog notice about trace readers.
- Filtering copies of span content already stored in evaluation results, annotations or testsets.
