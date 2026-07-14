# Context: agent mounts

## Why this work exists

Agent workflows already have durable storage at the session level. Every session gets a
mount: a row in the mounts table that names an S3 prefix, signed with short-lived
prefix-scoped credentials and mounted as the session's working directory via geesefs
(FUSE over S3: the prefix appears as a normal local folder). JP's session-continuity PR
(#5197) extended the same mechanism to per-session harness transcript directories.

Nothing equivalent exists at the agent level. Two consequences:

1. **An agent has no folder of its own.** Skills it accumulates, scratch memory, artifacts
   it should keep across conversations: there is no place for them. Each session starts
   from its own prefix and dies with it.
2. **A request without a session id gets a throwaway temp folder.** The runner only signs
   session mounts, so a sessionless run falls back to an ephemeral temp directory and its
   files evaporate. Once an agent mount exists, a sessionless run still has an agent, so
   it has a mount to use (provided that run type carries the workflow identity on the
   wire; verifying this per run type is part of the plan).

This project adds the agent mount: one durable folder per agent, derived from the workflow
artifact id, requiring no configuration and no schema change.

## The decision (made 2026-07-11, Mahmoud + JP)

Build agent mounts the way session mounts are built: **identity by reserved slug, not by
schema.**

The mounts table enforces one generic constraint, `unique(project_id, slug)`. Session
mounts are unique per session because their slug is minted deterministically from the
session id (`__ag__<uuid5(session_id)>__<name>`) and upserted. The agent mount uses the
identical trick with the workflow **artifact id** in place of the session id, and leaves
the `session_id` column NULL. The runner upserts it at mount time, exactly as it already
does for session mounts. Anyone who needs the mount (runner, frontend inspector)
re-derives the slug from the artifact id; nobody configures anything.

The mount point inside the sandbox follows a hardcoded derivation rule (a per-run sibling
of the working directory; see the plan's D3). Nothing about it is user-configurable.
Anything configurable would need a home in the agent template config, and we are
deliberately not adding one.

### Why the artifact id and not the revision id

The artifact is the agent's stable identity; revisions are config versions. A mount derived
from the revision id would orphan the agent's files on every config change.

### Alternatives considered

| Option | What it adds | Why not now |
|---|---|---|
| Schema-level uniqueness (new `artifact_id` column + unique index) | Reverse lookup (mount to owner), indexed per-agent listing, FK integrity and cascade delete | None of these serve the feature: the runner and the frontend always start FROM the agent (forward lookup), which the derived slug already gives. Costs a migration and commits the schema before the model has settled. Can be added later by backfilling from re-derived slugs. |
| Informational `artifact_id` column, slug still enforces uniqueness (what sessions do with `session_id`) | Same lookups as above, no uniqueness machinery | Discussed and dropped 2026-07-11: the limitations it fixes are not a problem for the planned use. Revisit if per-agent storage reporting or cleanup jobs materialize. |
| Mount declared in the agent template config | Re-pointable and shareable mounts | No use case: an agent's mount never needs to be visible to another agent. Config is for access to SHARED mounts (project mounts), a future kind, not for the agent's own identity. |

### Accepted limitations

All queries that start from the mount side are given up, deliberately:

- No reverse lookup from a mount row to its owning agent (the uuid5 slug is one-way).
- No indexed "all agent mounts with owners" listing or per-agent storage aggregation
  (slug prefix scans at best).
- No FK integrity: deleting an agent orphans its mount row and S3 prefix; cleanup is a
  future job.

The frontend files view is NOT limited: showing an agent's files starts from the artifact
id the UI already holds, derives the mount, and lists files the same way the session
inspector does today.

## Goals

1. Every agent has exactly one derived mount per key (key `"default"` to start), created
   lazily by upsert on first use.
2. The runner mounts it into the sandbox at a predictable derived path on every run of
   that agent, local and Daytona, alongside the session cwd mount.
3. The frontend can show the agent's files by artifact id, reusing the session inspector's
   mount file browser.
4. Zero configuration, zero schema change, zero new uniqueness machinery.

## Non-goals

- Project mounts and shared-mount access control in the agent template (future kind; this
  design must not block it).
- Making mount signing failures loud instead of silently falling back to ephemeral
  (tracked in the runner-selfhosting-explainer workspace notes; separate change).
- Cleanup/GC of orphaned mounts after agent deletion.
- Configurable mount points.

## Source conversations

- Mahmoud + agent session 2026-07-10/11: the mount taxonomy notes in
  `docs/design/agent-workflows/projects/runner-selfhosting-explainer/mounts-design-notes.md`.
- JP voice note 2026-07-11: the chosen mechanism (reserved slug with artifact id, no
  session_id, runner upserts at mount time, hardcoded mount point, inspector reads via the
  non-session mounts path), and the open questions it settles.
