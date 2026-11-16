# Drive sharing

## Why

A **drive** is a folder of files that the platform keeps in an object store (a storage service that keeps each file as one object under a key, such as Amazon S3 or SeaweedFS). A **mount** makes a drive appear as a normal folder inside the place where an agent's commands run. Today an agent run gets two drives by fixed rules: the folder of its session and the agent's own drive. No configuration states them, and no run can mount a drive that several agents share.

Several agents of one project often need one shared folder: a price list that two agents read, or a notes folder that a team of agents writes. Some of those agents should only read. Others must not see the folder at all.

## What Changes

- Every agent configuration states all its drives in one list, `drives`. The agent's own drive is the entry `{ "kind": "agent" }`; a project drive is `{ "kind": "project", "slug": "<slug>", "access": "read-write" | "read" }`. An empty list means the agent has no durable drive.
- Every agent configuration states whether the agent has a session drive, with a boolean `has_session_drive` beside `drives` (design Decision 3).
- Current agents keep today's behavior. Release 1 reads a configuration without the two keys as `"drives": [{ "kind": "agent" }]` and `"has_session_drive": true`, and new agents state both keys. Release 2 writes the two keys into every stored agent revision that lacks them.
- A project drive is created first through the existing `POST /mounts/` route, then attached. Saving a configuration that names a missing drive is refused with HTTP 422 and the code `drive_not_found`; a list that breaks the entry rules is refused with `invalid_drive_entry`.
- The API gets one new route, `POST /mounts/projects/sign`, that signs credentials for a project drive by slug, with read-only credentials when the access is `"read"`. The agent's own drive stays read-write, so `POST /mounts/agents/sign` does not change. `POST /mounts/query` gets an optional `slugs` filter.
- The runner mounts exactly the drives the configuration names, on all three sandbox backends (`local`, `daytona`, `inprocess`), and sends all credential requests at the same time.
- A read-only drive is enforced by the storage credentials and by a read-only mount.
- The agent's own commit tool cannot change `drives` or `has_session_drive`.
- The session files pane shows each project drive under `drives/<slug>/`, like the agent's own drive under `agent-files/`. Other UI is out of scope.

## Capabilities

### New Capabilities

- `drive-sharing`: agent configurations that state all their drives, project drives that several agents of one project mount at run time with read-write or read access, and the migration of current agents to the explicit list.

### Modified Capabilities

- None as a separate spec. The agent's own drive and the session drive keep their behavior; only the place that decides them moves into the configuration.

## Impact

- API: `api/oss/src/apis/fastapi/mounts/router.py` (one new sign route), `api/oss/src/core/mounts/` (`fetch_project_mount`, the `slugs` filter), `api/oss/src/core/store/storage.py` (a read-only session policy), `api/oss/src/core/workflows/service.py` (the save check), `api/oss/src/core/workflows/change_set.py` (the agent's own commit cannot touch drives), and in release 2 one alembic data migration in `core_oss`.
- SDK and agent service: `sdks/python/agenta/sdk/agents/dtos.py` (`validate_agent_drives`, the two fields), `sdks/python/agenta/sdk/agents/utils/wire.py` and the golden fixtures, `sdks/python/agenta/sdk/utils/types.py` (editor schema and default template), `sdks/python/agenta/sdk/middlewares/running/vault.py` (the agent keys), `sdks/python/agenta/sdk/agents/platform_instructions.py`.
- Runner: `services/runner/src/protocol.ts`, `engines/sandbox_agent/environment-setup.ts`, `environment.ts`, `mount.ts`, a new `project-mount.ts`, `environment/mount-lifecycle.ts`, `engines/inprocess/sandbox/sandbox-drive.ts`, `session-identity.ts`, the prompt guidance.
- Web: `web/packages/agenta-entities/src/drive/useSessionDrive.ts` and the session files pane.
- No table changes.
