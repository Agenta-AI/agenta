# Tasks

Parentheses name the spec requirement. Sections 2, 3 and 4 ship as one PR, because the API change without the app gates shows members 403 errors.

## 1. Reduce PR #7881

- [ ] 1.1 Remove the read scope, deny list, partial index, tombstone cleanup, `access.restricted`, "Partial" note, flag, tracing fill, span stamps, ingest linking and `totals.linked`. Renumber `oss000000055_add_session_turn_usage` to the next free number (`oss000000061` on main today), revising the head, and drop `ix_session_streams_project_id_private_owner` from it. Revert the one-line change to `14-share-agents-and-chats.mdx`. (Design decision 5)
- [ ] 1.2 Re-run unit tests and the turn usage acceptance tests. (Turn usage needs no trace access)
- [x] 1.3 Update the `session-trace-privacy` change and CONTRACT.md to say M9b is replaced: section 11, the change list (`:7`), the door gate (`:135`), the dependency tables (`:194-195`, `:210-213`) and the tracks (`:221`). Note that M7 already shipped without M9b.

## 2. Roles in the API

- [ ] 2.1 Add `member` to the catalog in the workspace and project scopes; add `EDIT_BILLING` to admin. (Member permissions; Billing)
- [ ] 2.2 Remove the shortcut in `AccessService`; keep `Flag.RBAC` for offered roles and selected-project credentials, and move `EntitlementProjectLimits` from `is_enforced` to a `Flag.RBAC` read. (Roles apply on every plan) Delete `RBAC_NOT_ENTITLED`; update `test_rbac_enforcement_ee.py` and the RBAC section of `api/AGENTS.md`.
- [ ] 2.3 Offered-roles helper in `/access/roles`, `/workspaces/roles/`, invite and assign; default `member`; the invite route refuses `owner` on every edition and plan, as the role route already does. (Offered roles; Owner changes by transfer)
- [ ] 2.4 Unit tests per edition and plan, and an acceptance test for each 403 route. (Member permissions)

## 3. Migration

- [ ] 3.1 EE data migration in `core_ee` (`ee0000000008` on main today): Hobby and Pro rows to `admin`, and stray `owner` rows and `owner` invitations to `admin` on every EE plan. Test on Hobby, Pro and Business rows, with a stray `owner` row and the real owner's rows. (Existing Hobby and Pro members become admins; Stray owners become admins)
- [ ] 3.2 Release step for the owner, not run by the build: a read-only production count of organizations per `subscriptions.plan`, to confirm no other plan values exist. A production read needs the owner's approval.

## 4. App

- [ ] 4.1 Role column and change control in Members; invite list from the offered roles. (Members tab shows and changes roles)
- [ ] 4.2 Gate Analytics with its URL and the drawer "Open trace" control, the Observability route also by URL, every "View trace" and the chat trace reads on `view_spans`. Pass the gate into the `@agenta/*` components as a prop. (Screens hide trace and analytics access)
- [ ] 4.2a Gate invite, remove member, create, rename and delete project, billing changes, credit usage and the chat "Buy credits" button; show Access & Security only to the organization owner. (Screens hide actions the role lacks)
- [ ] 4.3 Activity line duration from the turn. (Screens hide trace and analytics access)
- [ ] 4.4 Docs: fix `03-rbac.mdx:12` and `:69`, and `01-organizations.mdx:26`, `:42` and `:55`. (Docs match behavior)

## 5. QA

- [ ] 5.1 Live on Pro, as a real user: owner invites a member; the member chats, runs an automation and uses `test_run`; no 403 appears in the browser; the owner changes a migrated admin to Member; the admin sees no delete project control.
- [ ] 5.1a Record `usage_source` on each harness, as evidence for Design decision 7.
- [ ] 5.2 OSS: an old viewer keeps viewer behavior; a new invite offers Admin and Member.
