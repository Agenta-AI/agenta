# Proposal: one project membership resolver, without workspaces

## Why

Project membership is decided in several places: the permission check goes through workspace membership, Bearer authentication and the project list read `project_members` directly, and a sync re-adds and overwrites rows. M3, M4 and M6 need one answer to "is this user a member of this project, and with which role". Also, today any member, even a viewer, can create, rename or delete a project.

## What Changes

- One resolver and one set of membership writers (CONTRACT.md section 2) for every membership read and write. No permission decision reads workspace membership. `check_action_access` keeps its signature.
- **OSS access change (deliberate):** every organization member becomes a member of every team project with their organization role. A member removed from a project regains it. Per-project role differences collapse to the organization role.
- **EE access changes (reported, accepted by the owner on 2026-10-22):** none blocks the release:
  1. A user with organization and project rows but no workspace row is denied today, allowed after.
  2. Project creation, invitations and role changes act on the whole organization, not one workspace.
  3. OSS to EE conversion corrects stale project rows to the effective OSS role.
- The sync is removed. A new project, also the default project of a new workspace, gets rows for current organization members once.
- **Owner access is repaired:** the migration gives every organization owner an organization row and a row in every project. An ownership transfer seeds the new owner into every project in the same transaction.
- **Project routes check a permission (owner request, 2026-10-22):** create needs `create_workspace`, update needs `edit_workspace`, delete needs `delete_workspace`.
- **Demo feature removed (owner decision, 2026-10-22):** `AGENTA_DEMOS` (`AGENTA_EXTRAS_DEMOS`) is deleted, and the migration deletes the `project_members` rows with `is_demo = true`. The column stays unused until M4.
- **One release.** The preflight script runs from the release checkout. Only duplicate membership rows block, and the script removes them, keeping the oldest row.

## Capabilities

### New Capabilities

- `project-membership`: the resolver and its readers.
- `project-capability-checks`: membership to capability decision, and the project route permissions.
- `membership-mutations`: the membership writers and the legacy endpoints.
- `membership-data-migration`: report, repairs, cutover gate, edition switches.

### Modified Capabilities

None.

## Non-goals

- Personal projects (M6). New member endpoints, per-project role editing, removing workspaces (M4).
- Principals other than users, run authority and `AccessService.decide` (M2).
- A resolver-backed project member list (M3).
- Role catalog changes or custom-role administration.
