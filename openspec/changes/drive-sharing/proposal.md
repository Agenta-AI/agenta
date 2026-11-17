# Drive sharing: one kind of drive

## Why

A **drive** is a folder of files that the platform keeps in an object store (a storage service that keeps each file as one object under a key, such as Amazon S3 or SeaweedFS). A **mount** makes a drive appear as a normal folder in the place where an agent's commands run.

Today an agent run gets two drives by fixed rules: the folder of its session (its working folder) and the agent's own drive, found by the agent's id and shown at `agent-files/`. No configuration names them. No run can mount a drive that several agents share, and an agent cannot run without its own drive.

Teams need more than that. A support agent should read a knowledge folder and keep nothing between customers. A crew of agents should write one common folder. A person's private agent should keep private files. The four open pull requests of this change (#8315, #8316, #8317, #8319) first added a second kind of drive, the "project drive", beside the agent's own drive. Product decisions replaced that two-kind model before any of them merged: there is one kind of drive, and the agent's own drive is an ordinary drive.

## What Changes

- **One kind of drive.** A drive belongs to the project, has a slug (a readable unique name in the project), and has its own visibility (who may open it). In this change "access" means only read or read-write. The agent's own drive is an ordinary drive.
- **The configuration lists drives** as `{ "slug": "...", "access": "read-write" | "read" }` entries in `parameters.agent.drives`. An optional pointer `home_drive` names the one attached drive that holds the agent's saved tools (`.tools/`), app files (`.apps/`), template files and README. `has_session_drive` stays a boolean beside them.
- **Folder structure.** Every attached drive appears in the working folder at `drives/<slug>/`. `agent-files/` is a link to the home drive, for old and new agents. An agent with no home drive has no `agent-files/`. The platform writes `drives/README.md` at every start, from the configuration.
- **Visibility rule.** A drive is shared (every project member whose role allows the action) or private (only its owner), the two states agents have. A shared agent can attach only shared drives. A personal agent can attach shared drives and its owner's private drives. The home drive of a personal agent must be a private drive of its owner, so no other member can plant tools that run in the owner's runs; one function checks it at save, at the change to private, and each time a run signs its home drive (`is_home=true`), using the agent that the API writes into the run credential. When a personal agent becomes shared, the same action makes shared the private drives it lists that the acting owner owns, and the response lists them; a private drive of another owner refuses the action. One entry, the sharing service's `evaluate`, owns the rule; every route, tool and loader that reads, writes or signs a drive calls it, and the save check stops configurations that cannot work.
- **Drive creation.** Every new agent gets one drive of its own by default: created by the API with the agent's first revision, named after the agent, with the agent's visibility, listed in the configuration and set as home. A template or a person can remove it. A template writes its files only into a drive created in the same action.
- **Save refusals.** A save is refused with HTTP 422 when an entry breaks the rules (`invalid_drive_entry`), when `home_drive` is wrong (`invalid_home_drive`), when a slug names no drive the saver can see (`drive_not_found`), when a shared agent lists a private drive (`drive_not_shared`), or when a personal agent's home drive is not its owner's private drive (`home_drive_not_allowed`). The agent's own commit tool cannot change `drives`, `home_drive` or `has_session_drive`.
- **One sign route** for every drive: `POST /mounts/sign?slug=&access=` (it replaces `POST /mounts/projects/sign` of the open pull request), with read-only credentials for `access=read`. `POST /mounts/agents/sign` stays for runners older than this change: it finds the agent's drive by the agent's id and signs it only for an agent with no stored revision that has a `drives` key and only when the home rule passes, so an older runner can lose a drive, never gain one. After release 2 it always refuses, and it is deleted in the release after.
- **Runner.** One code path for all drives on all three sandbox kinds (`local`, `daytona`, `inprocess`): mount beside the working folder at `<working folder>-drive-<slug>`, link at `drives/<slug>`, link `agent-files` to the home drive, never replace a real folder or a file with content, prune leftover links, repair links at every turn. A read drive is mounted read-only.
- **No new revision without drives.** A commit through the new API fills `drives`, `home_drive` and `has_session_drive` when they are missing, and the API applies the same fill when it reads an older revision. The fill lists the agent's own drive only when the visibility rules allow it, and writes no drive otherwise.
- **Two releases.** Release 1 ships in the order agent service, runner, API, web. It ships the model and reads a configuration without the keys as today's behavior. Release 2 gives every existing agent drive a readable slug and a visibility row, rewrites stored references to the old slugs, creates a drive for agents that never ran, and writes `drives`, `home_drive` and `has_session_drive` into every stored agent revision. Nothing changes for existing agents.
- **Web.** The session files pane shows each attached drive under `drives/<slug>/` and the home drive once, under `agent-files/`. The agent page card lists the agent's drives from its configuration. Other screens are out of scope.

## Capabilities

### New Capabilities

- `drive-sharing`: one kind of drive with its own visibility; agent configurations that list their drives and name a home drive; the runner flow that mounts them on every sandbox kind; the migration of existing agents; the files pane.

### Modified Capabilities

- None as a separate spec. The sharing rules of agents and sessions (`agent-session-sharing`) keep their behavior. A drive gets its own rule, built the same way.

## Impact

- **API** (#8315): a new table `mount_visibility` and a unique index on the agent id of a drive (release 1 schema migration); the drive visibility rule (one check) in `api/oss/src/core/sharing/` and `api/oss/src/apis/fastapi/sharing/utils.py`; the sign routes and the `slugs` filter in `api/oss/src/apis/fastapi/mounts/router.py` and `api/oss/src/core/mounts/service.py`; drive creation in `api/oss/src/core/workflows/service.py` (`commit_workflow_revision`); the save check and the visibility change; the template loader and the apps tools (`list_starters`, `create_app`) apply the same check; `POST /mounts/` refuses a caller-supplied `agent_id`.
- **SDK and agent service** (#8315): `sdks/python/agenta/sdk/agents/dtos.py` (entry shape, `home_drive`, the rules), the wire mirror and golden fixtures, `utils/types.py` (editor schema, default template), the vault keys, `platform_instructions.py`.
- **Runner** (#8316): `services/runner/src/protocol.ts` and the files under `engines/sandbox_agent/` and `engines/inprocess/sandbox/` that sign, mount and link drives; one module for all drives replaces the agent and project drive modules.
- **Web** (#8319): the session files pane fold, the tool-path mapping, chat links and the agent page card.
- **Migration** (#8317, release 2): one alembic data migration in `core_oss`.
- **Docs** (#8315): the pages that describe agent drives and project drives.
