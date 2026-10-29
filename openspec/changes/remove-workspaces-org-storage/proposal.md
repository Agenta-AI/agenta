# Remove workspaces and key new mount storage by organization (M4)

## Why

- Mount files live under `mounts/<project_id>/<mount_id>/`, and the key is computed from the mount's current project. When M6 moves an agent to another project by updating rows, the agent's files would disappear.
- Every organization has one hidden "Default" workspace. It still owns projects through a cascading foreign key, it is a claim in every run credential, and it is part of the EE meter identity. M1 removes it from permission decisions. M4 removes it from the data model.

## What Changes

M4a (one release, no dependency):

- Each mount row stores its storage prefix, and all code reads it. New mounts keep the project layout, so previous-release pods agree on every path during the rollout. Old mounts keep their path. No file is copied. See CONTRACT.md section 9.
- No API response exposes the stored prefix.

The M4b mount step (the release after M4a):

- New mounts use the organization layout. The compatibility fill trigger is dropped.
- Core provides one per-mount predicate that tells whether a mount uses the organization layout. M6 uses it to refuse moves.

M4b workspace removal:

- The `workspaces` and `workspace_members` tables and `projects.workspace_id` go away, in three releases (accept, switch, contract).
- The classic `/w` app keeps its API shape (CONTRACT.md section 1), including the workspace role scope that its members page reads.
- The legacy member routes act through M1's `set_member_role` and `remove_member`.
- Workspace create and rename return HTTP 410. No classic screen calls them.
- EE meters lose the workspace dimension. A re-key keeps every count.
- Each organization keeps exactly one default project.

## Non-goals

- Moving agents or files between projects (M6).
- Retiring `/w` or removing workspace-shaped API fields. That happens with `/w`.
- Per-project role editing in EE. The legacy role route keeps its organization-wide effect.
