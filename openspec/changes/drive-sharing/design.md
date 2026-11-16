# Design: drive sharing

All file and line references point to `origin/main` at commit `8d6f0dff68` (13 November 2026). "Measured" means I read it in that code. "Proposed" means a choice of this design. 

## Words used in this design

- **Drive**: a folder of files that the platform keeps in an object store. In the API and the runner a drive is a **mount**: a row of the `mounts` table plus a key prefix in the store. The configuration and the user-facing text say "drive"; the API and the runner code say "mount" (see "Names per layer" in Decision 2).
- **The `drives` list**: the list in an agent configuration. Its entries are the agent's own drive and project drives, never the session drive.
- **Root** (`DriveRoot` in the `inprocess` code): one folder that the command sandbox mounts. A session drive, an agent drive and a project drive are each one root.
- **Mount**: the act of making a drive appear as a normal folder, so that normal file tools (`cat`, `rg`, an editor) work on it. The code also calls the row a "mount".
- **Sandbox**: the machine or container where the agent's shell commands run.
- **Runner**: the Node.js service in `services/runner` that runs one agent turn. For a Python developer: it plays the role that a worker process plays in a job queue. The Python agent service decides what to run, and the runner runs it.
- **Backend** (the code says "sandbox provider"): where the sandbox is. The code knows three: `local`, `daytona` and `inprocess` (`services/runner/src/config/runner-config.ts:20`).
- **Harness**: the coding agent program that the runner drives, for example Pi or Claude Code.
- **FUSE** (Filesystem in Userspace): a Linux feature that lets a normal program serve a folder. Every file read or write in the folder becomes a call into that program.
- **geesefs**: the FUSE program that the runner uses. It serves an object store prefix as a folder.
- **STS** (Security Token Service): the object store service that issues temporary credentials. The API asks it for a key pair that works only for one prefix and only for a limited time.
- **Revision**: one saved version of an agent configuration.

## Product decisions this design builds on

- Each agent configuration holds one list `drives`, with every durable drive the agent mounts. The agent's own drive is an entry of that list.
- Each configuration also states whether the agent has a session drive.
- Current agents are migrated so that their configuration states exactly what they have today: a session drive and their own drive.
- A drive can be attached read-only in the first version, enforced by the storage credentials and by the mount.
- A configuration that names a drive that does not exist is refused at save. A drive is created first, then attached.
- An agent cannot add a drive to its own configuration.
- Project drives show in the session files pane like the agent's own drive. Other UI is out of scope.

## Short answers

1. **How does it look in the configuration?** Every agent states all its drives in one list, `drives`, The agent's own drive is an entry, `{ "kind": "agent" }`, and a project drive is an entry with its slug, `{ "kind": "project", "slug": "price-lists", "access": "read" }`. The configuration also states whether the agent has a session drive, with `has_session_drive`. See Decisions 1 to 3.
2. **Do we need to migrate our current agents?** Yes. After the migration every agent configuration holds `drives` with exactly its own drive and states that it has a session drive. The plan has two releases: the first ships the field with a default for a configuration that lacks it, and the second rewrites every stored agent revision. See "Migration". (Proposed)
3. **How does the flow in the runner look, local versus Daytona versus in-process?** On `local` the runner host mounts the drives before the harness starts. On `daytona` the sandbox mounts them while the runner sets the sandbox up. On `inprocess` the command sandbox mounts them at the first tool call. After the change the runner mounts the agent's own drive because the list names it, not by a special rule, and an agent with an empty list gets no durable drive. See the figures under "Context" and Decision 6. (Measured today, Proposed after)
4. **Does it run in parallel, or does it get slow?** The mounts already run at the same time on all three backends; only the credential requests run one after the other today. The change signs and mounts every drive at the same time. One mount in a sandbox takes about 0.6 s (Measured on `inprocess`), so one to three extra drives should add well under one second to a cold start (estimate). See Decision 9.

## Context

### The drive model in the API (Measured)

- **Table.** A drive is a row of `mounts` (`api/oss/src/dbs/postgres/mounts/dbes.py:13-50`). The primary key is `(project_id, id)`. A unique constraint holds `(project_id, slug)` (`dbes.py:23-27`). The row has `session_id`, `agent_id`, `purpose` and `storage_prefix` (`api/oss/src/dbs/postgres/mounts/dbas.py:29-51`). The row is deleted with its project (`dbes.py:17-21`).
- **Where the files are.** The key prefix is `mounts/<organization_id>/<mount_id>` for drives created by version 0.125.0 or later (`api/oss/src/core/mounts/types.py:12-39`).
- **Three scopes.** `MountScope` holds `session_id` and `agent_id`; neither set means a project drive (`api/oss/src/core/mounts/dtos.py:56-61`).
  - A **session drive** is the working folder of one session. The service creates it on demand with a reserved slug (`api/oss/src/core/mounts/service.py:515-547`).
  - An **agent drive** is one durable drive per agent artifact, with the reserved slug `__ag__agent__<artifact_id>__<name>` and the name `default` (`service.py:128-148`, `service.py:576-601`).
  - A **project drive** is any row with no session and no agent. `POST /mounts/` creates one (`api/oss/src/apis/fastapi/mounts/router.py:196-204`, `router.py:404-431`). A caller may not use the reserved prefix `__ag__` (`service.py:151-154`, `service.py:486-487`).
- **What a project drive is used for today.** Nothing in the product. The only caller of `create_mount` is the route itself (`router.py:424`). No web code lists mounts (`queryMounts` appears only in the generated client). The runner signs only the session drive and the agent drive (`services/runner/src/engines/sandbox_agent/mount.ts:83`, `services/runner/src/engines/sandbox_agent/agent-mount.ts:57`).
- **Routes.** `POST /mounts/`, `POST /mounts/query`, `POST /mounts/agents/sign`, `POST /mounts/agents/query`, `GET` and `PUT /mounts/{id}`, `POST /mounts/{id}/sign`, archive and unarchive, and the file routes under `/mounts/{id}/files` (`router.py:196-373`). The session drive is signed at `POST /sessions/mounts/sign` (`api/oss/src/apis/fastapi/sessions/router.py:2519-2558`).
- **Access rules.** Every route first checks a project permission: `VIEW_MOUNTS`, `EDIT_MOUNTS` or `USE_MOUNTS` (`router.py:375-382`). The editor role holds all three; the viewer role holds `VIEW_MOUNTS` only (`api/oss/src/core/access/permissions/types.py:226`, `types.py:253-254`). Then `allow_mount` checks the scope: a session drive follows its session, an agent drive follows its agent, and a **project drive is allowed to every project member with the permission** (`api/oss/src/apis/fastapi/sharing/utils.py:468-499`).
- **Credentials.** The API asks the store's STS for a key pair limited by an inline policy to one prefix (`api/oss/src/core/store/storage.py:292-346`, `storage.py:348-384`). The policy always allows read, write and delete (`storage.py:316-326`). SeaweedFS gets `AssumeRoleWithWebIdentity`; a remote S3 store gets `GetFederationToken` (`storage.py:386-470`). The lifetime is `AGENTA_MOUNTS_CREDENTIALS_TTL_SECONDS`, 43,200 s (12 hours) by default, so that it covers the runner's 11-hour run limit (`api/oss/src/utils/env.py:1862-1874`). The docstring of `sign_mount_credentials` still says the credentials "expire in minutes" (`service.py:1108-1114`); the setting is the truth.
- **Writes through the API.** A write can carry `If-Match` (only over a known version) or `If-None-Match: *` (only create) (`service.py:1778-1806`). Writes through a mount carry no such condition.
- **History.** On the bundled SeaweedFS store the API turns on bucket versioning and keeps old versions for 30 days (`storage.py:203-247`, `env.py:1793-1801`). On a remote S3 bucket the API never turns versioning on (`storage.py:211-213`). No route or screen lists or restores old versions.

### The agent configuration today (Measured)

- The configuration is `parameters.agent` of a workflow revision. It holds `instructions`, `llm`, `tools`, `mcps`, `skills`, and the nested `harness`, `runner` and `sandbox` sections (`sdks/python/agenta/sdk/utils/types.py:1522-1567`).
- **No field names a drive.** `AgentTemplate` has no drive or mount field (`sdks/python/agenta/sdk/agents/dtos.py:812-858`).
- The three nested sections accept only fixed keys, and an unknown key fails the run with HTTP 400 (`dtos.py:1563-1572`). The flat definition keys stay open: `from_params` reads the known keys and ignores the rest (`dtos.py:906-944`).
- The editor schema `AgentTemplateSchema` forbids unknown keys (`types.py:1270-1284`). Only the template compiler validates against it (`api/oss/src/core/agent_templates/compiler.py:144-150`).
- The vault middleware recognizes an agent run only when every key of `parameters.agent` is a known template key (`sdks/python/agenta/sdk/middlewares/running/vault.py:604-657`). A new top-level key therefore needs a change there, or an agent run is not recognized as one.
- The agent's own commit tool may write `parameters.agent` but not `harness.kind`, `harness.permissions`, `runner.permissions`, `sandbox.kind`, `sandbox.permissions` or `sandbox.credentials` (`api/oss/src/core/workflows/change_set.py:569-581`).

### How a run learns which drives to mount today (Measured)

- The runner derives both drives from the run request. The session drive comes from `sessionId`, the agent drive from `runContext.workflow.artifact.id` (`services/runner/src/engines/sandbox_agent/environment-setup.ts:87-128`).
- The runner calls the API with the run's credential, the `authorization` header of the run (`services/runner/src/engines/sandbox_agent/runtime-policy.ts:32-38`). The credential never enters the harness environment (`services/runner/src/environment/runtime-lifecycle.ts:181`). So the model inside the sandbox cannot sign a drive by itself.
- The agent artifact id is part of the fingerprint that decides whether a parked sandbox can serve the next turn (`services/runner/src/engines/sandbox_agent/session-identity.ts:285-295`).

### The runner flow per backend today (Measured)

The three backends differ in one fact: who runs geesefs (`runner-config.ts:28-49`).

| Backend | Who mounts | When | Where the session folder is |
|---|---|---|---|
| `local` | the runner host | before the harness starts | `/var/lib/agenta/<prefix>` |
| `daytona` | the Daytona sandbox | while the runner sets the sandbox up | `/home/sandbox/agenta/<prefix>` |
| `inprocess` | the command sandbox (a Daytona sandbox for shell commands) | at the first tool call of each sandbox boot | `/home/sandbox/agenta/<prefix>` |

The roots come from `services/runner/src/engines/sandbox_agent/run-plan.ts:439-457` and `environment-setup.ts:132-146`. The agent drive sits beside the session folder at `<session folder>-agent`, and a symbolic link `agent-files` in the session folder points to it (`agent-mount.ts:21-39`, `agent-mount.ts:237-260`).

:::figure local-today
:::

On `local`:

1. The runner asks the API for credentials of the session folder (`environment-setup.ts:87-101`, `mount.ts:76-141`). Then, after that answer, it asks for credentials of the agent drive, with a 10-second limit (`environment-setup.ts:111-122`, `agent-mount.ts:46-68`). The two requests run one after the other.
2. The runner host starts one geesefs process per drive, both at the same time (`services/runner/src/engines/sandbox_agent/environment.ts:760-782`). geesefs runs as a child process; the credentials ride its environment, never its command line (`mount.ts:273-281`, `mount.ts:431-485`).
3. The runner waits until each folder answers, polling every 50 to 100 ms for up to 15 s (`mount.ts:327-347`, `mount.ts:458-464`). The code says geesefs "mounts within ~1s normally" (`mount.ts:458`).
4. After the agent drive is up, the runner writes a `README.md` if none exists, links `agent-files`, sets `AGENTA_AGENT_MOUNT_DIR` and adds a paragraph to the prompt (`services/runner/src/environment/mount-lifecycle.ts:275-307`, `mount-lifecycle.ts:162-204`).
5. A failed sign does not stop the run. The run goes on with a throwaway folder and the runner logs `mount degraded kind=session_cwd` or `kind=agent_mount` (`environment-setup.ts:102-128`). A failed geesefs mount logs `mount failed ... running on ephemeral cwd` and the run goes on (`mount.ts:545-548`); when the runner cannot confirm the detach of a dead mount, it throws and the run fails (`mount.ts:539-544`, `environment.ts:781`).
6. Each later turn drops geesefs's one-minute cache of the store at the start (`services/runner/src/engines/sandbox_agent/turn-start-refresh.ts:1-24`).
7. A broken mount (`ENOTCONN`, "transport endpoint is not connected") is signed again and mounted again, a limited number of times (`mount-lifecycle.ts:321-420`).
8. At the end the runner unmounts with `fusermount -uz` and deletes the folder only after it confirms the mount is gone (`mount.ts:561-598`, `environment.ts:602-640`).

One limit matters for sharing: on `local`, one mount namespace holds the mounts of every concurrent session on the host (`run-plan.ts:443-445`). A process on that host can reach other sessions' folders by path. The `local` backend therefore does not isolate drives from each other today, for any kind of drive.

:::figure daytona-today
:::

On `daytona`:

1. The runner signs the two drives one after the other, as on `local`.
2. The runner creates or reattaches the sandbox (`environment.ts:907-929`).
3. The sandbox mounts the session folder (with the harness's transcript folder) and the agent drive at the same time (`environment.ts:1115-1290`). Each mount is one shell script in the sandbox: detach, create the folder, start geesefs in the background, and probe until the folder answers, for up to 10 s, inside a 60-second limit for the call (`mount.ts:747-806`, `mount.ts:841-910`).
4. When the store is not public, the sandbox reaches it through a tunnel; with no tunnel the mount is refused (`environment.ts:1098-1153`, `environment.ts:1219-1241`). The model is told only about a refused agent drive (`environment.ts:1230-1240`); a refused session folder is a log line for the operator (`environment.ts:1145-1153`).
5. After the agent drive is up, the sandbox gets the `README.md`, the `agent-files` link (only after the session folder is up) and the prompt paragraph (`environment.ts:1250-1270`).
6. A failed mount returns false, the runner detaches the dead mount, and the run goes on (`mount.ts:877-909`).
7. A parked sandbox keeps its mounts for the next turn (`environment.ts:583-603`). The lease of the sandbox is the earliest credential expiry of its mounts (`session-identity.ts:778-791`), and the runner reuses the sandbox only while that lease covers the run limit plus 60 s (`services/runner/src/lifecycle/session-coordinator.ts:347-349`).

:::figure inprocess-today
:::

On `inprocess` (Pi runs inside the runner process; only shell commands go to a Daytona sandbox):

1. The runner signs the two drives one after the other, as on the other backends.
2. The runner mounts nothing at setup. It records the two folders and their credentials for the command sandbox (`environment.ts:785-800`, `environment.ts:864-888`).
3. At the first tool call of a sandbox boot, the sandbox mounts every folder at the same time (`services/runner/src/engines/inprocess/sandbox/sandbox-drive.ts:237-288`). The code measured "about 0.6 s of calls" per mount (`sandbox-drive.ts:271`). The first tool call of a conversation takes about 2.7 s with a new sandbox and its mounts (`openspec/changes/spike-pi-inprocess-runner/findings.md:13`).
4. If any folder cannot be mounted, the tool call fails with a sentence and chat keeps working (`sandbox-drive.ts:58-67`, `sandbox-drive.ts:264-279`).
5. Every command first checks that each folder is still mounted, and refuses to run when one is not (`sandbox-drive.ts:178-193`).
6. When the mount credentials expire within 10 minutes and fresher ones exist, the runner replaces the sandbox (`sandbox-drive.ts:69-78`, `sandbox-drive.ts:242-253`), because `fusermount -u` does not work inside a Daytona sandbox (`sandbox-drive.ts:13-17`).
7. The runner writes its own files (Pi's conversation file, the skill snapshot) through the object store API, not through a mount (`services/runner/src/engines/inprocess/workspace/drive-objects.ts:1-5`).

### Read-only today (Measured)

- The STS policy has no read-only form; it always grants `PutObject` and `DeleteObject` (`storage.py:316-326`).
- The runner passes no read-only flag to geesefs (`mount.ts:247-271`).
- The API has a read level only for the scope tokens of HTML apps in the browser (`api/oss/src/apis/fastapi/mounts/models.py:133`, `router.py:665-705`). Mount credentials carry no access level (`dtos.py:147-163`).
- The sandbox permission has a field `filesystem: "readonly"`, but the runner does not enforce it on any backend (`services/runner/src/protocol.ts:355-372`).
- So no read-only mount exists today.

### Two writers on one drive today (Measured)

- Two sessions of one agent already share its agent drive. The `README.md` that the runner writes says: "Concurrent runs share this folder, so the last writer wins for each file." (`agent-mount.ts:28`).
- geesefs keeps what it saw of the store for one minute. The runner drops that cache at the start of each turn, but not during a turn (`turn-start-refresh.ts:4-23`).
- A close of a file starts its upload but does not wait for it; a writer that needs its data in the store at once must call `fsync` (`mount.ts:241-246`).
- Not verified in this repo (general behavior of object stores and geesefs): a write replaces the whole object, so two agents that append to one file lose one append; a folder rename is a copy and a delete per file, not one atomic step; file locks do not reach across two mounts.

### The web app today (Measured)

- The session files pane shows two origins: the session folder and the agent drive, folded in under `agent-files/` (`web/packages/agenta-entities/src/drive/useSessionDrive.ts:28-65`).
- The agent overview shows the newest files of the agent drive (`web/mobile/src/features/agents/AgentDriveCard.tsx`).
- The platform prompt tells the agent to link only files in its working folder or in `agent-files/`, because the person cannot open any other path (`sdks/python/agenta/sdk/agents/platform_instructions.py:170-175`).
- No screen lists or opens a project drive.


### Where agent configurations are stored, and how their shape changed before (Measured)

- An agent configuration is the `data` of a row in `workflow_revisions` (`api/oss/src/dbs/postgres/workflows/dbes.py:85`), a `JSON` column (`api/oss/src/dbs/postgres/shared/dbas.py:201-207`). A revision is immutable after its commit; each save adds a revision with a random slug and the next version number of its variant (`api/oss/src/core/workflows/service.py:3400`, `api/oss/src/dbs/postgres/git/dao.py:2159-2168`). An agent revision carries `flags.is_agent` (`service.py:3323`).
- Every writer of a revision (the commit route, an agent's own commit tool, simple create and edit) passes through `commit_workflow_revision`, which refuses two narrow shapes of agent configuration (unreadable instructions, a malformed organization connection) before it stores them (`service.py:3393-3398`, `service.py:308-370`). Those checks sit in `_build_revision_commit`, which is documented as pure and free of input and output (`service.py:3343-3348`); a check that reads the database goes in the async body of `commit_workflow_revision`. The harness kind check (`service.py:280-306`) runs only on the commit route (`service.py:3053`). The commit route answers such a refusal with HTTP 422, "the configuration in it is not" committable (`api/oss/src/apis/fastapi/workflows/router.py:2047-2050`).
- The repo has four precedents for a change of stored shape:
  - **Rewrite stored revisions in place.** `oss000000010` backfilled `flags` on every row of `workflow_revisions`, and kept a side table of what it added so that a downgrade can undo it (`api/oss/databases/postgres/migrations/core_oss/versions/oss000000010_backfill_workflow_revision_flags.py:1-60`). `oss000000041` rewrote the `data` JSON of MCP endpoint rows in place (`oss000000041_move_mcp_credential_header_to_binding.py:1-70`).
  - **Tolerate the old shape at read time.** A legacy `gateway` tool entry, which "no migration ever rewrote", is coerced or dropped when the configuration is parsed (`sdks/python/agenta/sdk/agents/dtos.py:865-870`).
  - **Refuse the old shape at read time.** A pre-migration flat template fails with a named 400 (`dtos.py:1556-1561`, `dtos.py:1575-1604`).
  - **Break and recreate.** The MCP configuration redesign declared old revisions invalid, with no migration (`docs/design/agent-workflows/projects/mcp-configuration-redesign/migration.md:1-19`).
- I found no migration that rewrote `parameters.agent` inside stored revisions.
- A database migration runs before any new pod starts, and the old code runs against the migrated data for the whole rollout (`api/AGENTS.md`, section "Migration gate"). The repo's rule for a change that old code cannot read is "expand and contract": add the new shape in one release, and remove the old one in a later release (same section).

### Agents with no drive today (Measured)

- An agent drive row exists only after the agent's first run: the sign route creates it on first use (`api/oss/src/core/mounts/service.py:576-601`, `api/oss/src/apis/fastapi/mounts/router.py:473-499`). An agent that never ran has no drive row.
- A run with no agent artifact id gets no agent drive, and a run with no session id gets a throwaway working folder (`services/runner/src/engines/sandbox_agent/environment-setup.ts:87-146`). The runner already handles both cases.
- The platform instructions describe `agent-files/` to every agent without a condition (`sdks/python/agenta/sdk/agents/platform_instructions.py:156-175`). Only a failed or refused mount changes the text, through the runner's "not available this turn" paragraph (`services/runner/src/engines/sandbox_agent/agent-mount-guidance.ts:84-93`).

## Goals / Non-Goals

Goals:

- Every agent configuration states all its drives: its own drive, the project drives it uses, and whether it has a session drive.
- Each project drive entry is read-write or read-only.
- Every backend mounts the drives that the configuration names, and only those, at the same time.
- A run mounts only drives of its own project. Session drives stay private as they are.
- Current agents are migrated so that their configuration states exactly what they have today, and they run exactly as today.
- Several agents of one project can share one drive, and an agent that does not list it gets no access to it.

Non-goals (deliberately not built):

- Any web screen to create, attach or browse drives beyond the session files pane.
- A history of each file, a restore screen, or a difference view.
- Links between files, or an index that the platform keeps.
- A platform-defined "save" operation or file format for shared drives.
- Locks, merges or conflict detection for writes through a mount.
- Drives that belong to an organization or that span projects.
- Mounting another agent's own drive.
- A quota per drive, search inside files, or access rules per folder inside a drive.

## Decisions

### Decision 1: Every agent lists its drives in its configuration (decided)

Each agent configuration holds one list, `drives`, with every drive the agent mounts. The alternatives were every project drive on every agent by default, and a table of attachments outside the configuration. The list keeps every resource of an agent in its configuration, beside `tools`, `mcps` and `skills`.

An agent that does not list a drive does not get it. Who may change an agent's list is decided by who may commit its configuration (Decision 5).

### Decision 2: The shape of a drive entry, classified by role

```json
"drives": [
  { "kind": "agent" },
  { "kind": "project", "slug": "price-lists", "access": "read" }
]
```

| Field | What it is | Who sets it | When it changes | Role |
|---|---|---|---|---|
| `drives` | every durable drive this agent mounts | the platform at creation; a person, or an agent that edits other agents' configurations | per revision | definition of the agent's resources, beside `tools`, `mcps` and `skills` |
| `drives[].kind` | which kind of drive: `"agent"` (the agent's own drive) or `"project"` (a drive of the project) | same | per revision | a reference: it says how the drive is found |
| `drives[].slug` | the name of a project drive; required for `"project"`, absent for `"agent"` | same | per revision | a reference |
| `drives[].access` | `"read-write"` (default) or `"read"` | same | per revision | policy: what the run may do with the drive |

Choices inside the shape (Proposed):

- **`kind`, not `scope`.** The value says which kind of drive the entry is, as `harness.kind` and `sandbox.kind` do in the same configuration. The repo's naming conventions record `scope` on `llm.connection` as a shipped exception not to copy into new references, and the mounts API already uses "scope" for an access grant (the app scope token). The values `agent` and `project` are the owner kinds of `MountScope` (`api/oss/src/core/mounts/dtos.py:56-61`).
- **The agent's own drive is `{ "kind": "agent" }`, resolved at run time from the agent's artifact id**, as the runner finds it today (`environment-setup.ts:111-122`). The entry names no id. Three reasons: an agent that never ran has no drive row yet (`service.py:576-601`), so an id could not be written for it; a copied agent gets its own new drive, as today, because the copy has a new artifact id; and the agent drive keeps its privacy rule, which follows the agent (`sharing/utils.py:493-498`).
- **Other ways to name the own drive, rejected:**

| Option | Trade-off |
|---|---|
| **A. `{ "kind": "agent" }`, found by artifact id at run time** | Works for agents that never ran; a copy gets a new drive; privacy unchanged. The entry does not say which row it is. |
| B. The drive's id, `{ "id": "<mount id>" }` | Exact. An agent that never ran has no id to write, and a copied agent would share the original's drive. |
| C. Turn each agent drive into a project drive with a readable slug | One kind of drive for all. A project drive is open to every project member (`sharing/utils.py:478-499`), so a private agent's files would become visible to the whole project. |

- **One agent entry at most** in version 1. The API already supports several named agent drives (`service.py:576-601` takes a `name`), so a `name` field can come later without a break.
- **The values of `access`** are the ones the mounts API already uses for app scope tokens, `"read"` and `"read-write"` (`api/oss/src/apis/fastapi/mounts/models.py:133`). That model names the field `level`; the shipped name is not copied, because `access` says what it is. The sandbox setting `sandbox.permissions.filesystem` (`"on"`, `"readonly"`, `"off"`) is a different, unenforced setting with its own values; the two are not merged.
- **One slug at most once.** Two entries for one slug would mount two times on one path. The rules refuse it.
- **Paths are fixed.** The agent's own drive stays at `agent-files/`, as today; a project drive appears at `drives/<slug>/`. No `path` field in version 1.
- **At most 8 entries.**
- **One owner for the entry rules.** One SDK function, `validate_agent_drives`, holds the rules: `kind` values, `slug` required for `project` and absent for `agent`, at most one `agent` entry, each slug once, `access` values, at most 8 entries. `AgentTemplate` parsing calls it (a named HTTP 400 at run time, as for other configuration errors, `dtos.py:945-954`), and the commit check calls it (HTTP 422, Decision 4). The commit already follows this pattern for instructions: `_reject_unreadable_agent_instructions` calls the SDK's `validate_agent_instructions` (`api/oss/src/core/workflows/service.py:307-330`).
- **An empty list is allowed.** The agent then has no durable drive at all (Decision 6, "An empty list").

Complete examples (Proposed):

An agent as it is today, after the migration:

```json
{
  "instructions": { "agents_md": "You draft quotes." },
  "llm": { "provider": "openai", "model": "gpt-5.5" },
  "has_session_drive": true,
  "drives": [ { "kind": "agent" } ],
  "harness": { "kind": "pi_core" },
  "sandbox": { "kind": "daytona" }
}
```

Two agents that both read one price list drive:

```json
// agent A
{ "has_session_drive": true,
  "drives": [ { "kind": "agent" },
              { "kind": "project", "slug": "price-lists", "access": "read" } ] }
// agent B
{ "has_session_drive": true,
  "drives": [ { "kind": "agent" },
              { "kind": "project", "slug": "price-lists", "access": "read" } ] }
```

An agent with no durable drive at all:

```json
{ "has_session_drive": false, "drives": [] }
```

Three agents that share a working folder, and a fourth that must not see it:

```json
// three agents that share "team-notes"
{ "has_session_drive": true,
  "drives": [ { "kind": "agent" },
              { "kind": "project", "slug": "team-notes" } ] }
// the fourth agent: no "team-notes" entry
{ "has_session_drive": true, "drives": [ { "kind": "agent" } ] }
```

Names per layer. The configuration, its wire mirror, the user-facing folders and the save errors say "drive". The stored row, the sign routes, the sign functions and the mount paths say "mount". In the runner, `drives` on the request holds only configured entries (`AgentDrive`); the resolved list holds `RunDrive` items; the `inprocess` facts field that holds `DriveRoot` objects is renamed `roots`, so `drives` never means two sets in one module.

| Layer | Session drive | Agent drive (today) | Project drive (new) |
|---|---|---|---|
| Table and DTO | `mounts` row, `MountScope(session_id=...)` | `mounts` row, `MountScope(agent_id=...)` | `mounts` row, `MountScope()` |
| API service | `get_or_create_session_mount` | `fetch_agent_mount` | `fetch_project_mount(slug)` |
| API route | `POST /sessions/mounts/sign` | `POST /mounts/agents/sign` (`sign_agent_mount_credentials`) | `POST /mounts/projects/sign` (`sign_project_mount_credentials`) |
| API errors at save | none | none | `drive_not_found`, `invalid_drive_entry` |
| Configuration | `has_session_drive` | `{ "kind": "agent" }` | `{ "kind": "project", "slug": ..., "access": ... }` |
| Run request (wire) | `hasSessionDrive` | `drives: [{ kind: "agent" }]` | `drives: [{ kind: "project", slug, access }]` |
| Types | none | `AgentDrive` (one configuration entry, in the SDK and in `protocol.ts`); `RunDrive` (one item of the runner's resolved list) | same types |
| Runner file and functions | `mount.ts`, `signSessionMountCredentials` | `agent-mount.ts`, `signAgentMountCredentials`, `agentMountPath(cwd)` = `<cwd>-agent` | `project-mount.ts`, `signProjectMountCredentials`, `projectMountPath(cwd, slug)` = `<cwd>-project-<slug>` |
| Runner log kind and timing stage | `kind=session_cwd`, stage `mounts` / `local_mounts` | `kind=agent_mount`, stage `agent_mount` | `kind=project_mount`, stage `project_mounts` |
| Folder in the session | the working folder itself | `agent-files/` | `drives/<slug>/` |
| Web | `FileOrigin` `"session"` | `FileOrigin` `"agent"` | `FileOrigin` `"project"` |

The run request carries the configuration's entries as `drives`, with `access` filled in on project entries (`"read-write"` when absent), and the session setting as `hasSessionDrive` (the wire is camelCase, as `sandboxPermission` and `runContext` are). Both fields are optional on the wire: a request without `drives` comes from an older agent service (Decision 12). The agent entry carries no id; the runner finds the agent drive from `runContext.workflow.artifact.id`, as today. The folder names `agent-files` and `drives` are set by the runner (`AGENT_FILES_LINK_NAME` and a new `PROJECT_DRIVES_DIR_NAME`); the web fold, the platform instructions and the prompt guidance follow it.

### Decision 3: How the configuration states the session drive (decided in the design review: S1, `has_session_drive`)

Two shapes were possible: a setting beside the list, or an entry of the list with kind session.

**Status: decided in the design review loop: shape S1, a boolean `has_session_drive` beside `drives`.** The reasoning, by the `design-interfaces` questions:

1. *What is the field?* Whether the working folder of a session is kept in the store between turns. It is not a folder the agent attaches; it is where the run works. Its absence changes the working directory, not the list of folders under it.
2. *Who sets it, and when?* The same owner as `drives` (the platform at creation, a person or an agent that edits configurations), per revision. Same owner and lifecycle, so it sits next to `drives` at the top level of the agent configuration, not inside `harness`, `runner` or `sandbox`.
3. *What role?* Configuration of the run's workspace. The entries of `drives` are references to resources (which drive, with which access). A child must answer the same question as its parent; a session entry answers a different question ("does my working folder persist") and would sit in a list that answers "which drives does this agent attach".
4. *Invalid combinations.* With S2, `{ "kind": "session", "slug": "x" }`, `{ "kind": "session", "access": "read" }` and two session entries are all expressible and each needs its own refusal rule. With S1 a boolean cannot express any of them.
5. *Will it grow?* No second option is in sight. A plain boolean is enough; it does not get an `{ "enabled": ... }` wrapper before a second option exists.
6. *Name.* `has_session_drive`. It keeps the noun of `drives` and of the product's words ("session drive"), and the `has_` prefix makes it read as a switch, not as a drive object next to a list of drive objects. An earlier proposal was `have_session_drives`; the singular is right, because a run has at most one session drive. The first name, `session_drive`, changed in the design review: a reviewer showed that a reader who knows `drives` holds objects guesses that `session_drive` holds one too.

The cost of S1 is that a reader looks at two keys to see all storage of an agent. The two keys sit next to each other, so the cost is small.

A configuration without `has_session_drive` reads as `true` (today's behavior).

What a session drive is today: the working folder of one session, kept in the store and mounted as the working directory of every run of that session (`service.py:515-547`, `environment-setup.ts:87-146`). Today every agent run with a session id has one.

| | Shape S1: a setting beside the list | Shape S2: an entry in the list |
|---|---|---|
| Example | `"has_session_drive": true`  | `{ "kind": "session" }` in `drives` |
| What the field is | whether the working folder of a session persists | one more drive of the agent, with no slug |
| Who sets it, when | same people, per revision | same |
| Role (design-interfaces) | configuration of the run's workspace: it decides what the working directory is | a resource of the agent, like the other entries |
| For | The session drive is not a folder under the working directory; it IS the working directory. A separate field keeps one meaning per field, and needs no rule such as "at most one session entry, never a slug". | One list answers "where do this agent's files persist". Uses the owner kinds of the API's `MountScope` (session, agent, project) as `kind` values. `access` could later apply to it. |
| Against | Two places describe storage. A reader must look at both. | The entry behaves unlike the others: no slug, no path under `drives/`, at most one, and `"read"` access would make no sense for a working folder. Validation needs special rules. |


Whatever the shape, the behavior is the same (Proposed):

- On: as today. A run with a session id mounts the session drive as its working folder.
- Off, on `local` and `daytona`: the run works in a throwaway working folder, the path the runner already takes for a run with no session id (`environment-setup.ts:129-157`). Files there last until the sandbox is gone.
- Off, on `inprocess`: refused in version 1. The in-process harness host needs the session drive to open the session and to publish skill files (`services/runner/src/engines/inprocess/harness-host.ts:135-139`). The runner fails such a run at once with the error code `session_drive_required`, whose message says the `inprocess` backend needs the session drive. Every agent has the session drive on today, so no current agent is affected. A throwaway workspace for `inprocess` is later work, if someone needs it.
- The harness's own transcript folders (`mount.ts:143-189`) keep the conversation going between turns. They are runner internals and stay as they are in both cases.

### Decision 4: A project drive is created first, and a save that names a missing drive is refused (decided)

Refusing the save keeps every stored configuration runnable, so a tool that edits configurations gets a clear error at once instead of a broken run later.

- **Create.** A project drive is created through the API before any configuration names it. `POST /mounts/` already does it: a body with a slug and no session and no agent creates a project drive (`api/oss/src/apis/fastapi/mounts/router.py:196-204`, `router.py:404-431`). It needs `EDIT_MOUNTS` (`router.py:412`), refuses the reserved prefix `__ag__` (`service.py:486-487`), and answers 409 when the slug is taken (`router.py:122-125`). The API needs no new route to create a drive. A screen to create one is out of scope.
- **Refuse the save.** `commit_workflow_revision`, which every writer passes through (`service.py:3393-3398`), gets one more check. First it calls the SDK's `validate_agent_drives` (Decision 2); a broken rule answers `invalid_drive_entry`. Then each `"project"` entry must name a project drive that exists in the same project and is not archived; a missing one answers `drive_not_found`. A failed check raises a domain error that the router answers with HTTP 422, the status the route uses for every "not committable" configuration (`router.py:2047-2050`), in the agent-facing error envelope that the sibling `InvalidAgentHarnessError.to_detail()` uses (`api/oss/src/core/workflows/types.py:99-119`). Proposed body: `{"code": "drive_not_found", "message": "The drive 'price-lists' does not exist in this project.", "retryable": false, "next_step": "Create the drive with POST /mounts/, then commit again.", "details": {"field": "parameters.agent.drives[1].slug", "value": "price-lists"}}`.
- **Layering.** The mounts service already depends on the workflows service (`api/oss/src/core/mounts/service.py:549-574`), so the workflows service cannot import the mounts service back. The check reads the `mounts` table through a narrow lookup (for example a callable that wraps `MountsService.fetch_project_mount`; there is no second "exists" lookup) that the workflows service receives at construction. The implementation session picks the exact seam.
- **At run time** the sign route never creates a project drive. A drive deleted or archived after the save is skipped by the run, which logs it and tells the model (Decision 6).

### Decision 5: The sign route and the access rules

The agent's own drive keeps its route, `POST /mounts/agents/sign` (`router.py:473-499`). A new route signs a project drive (Proposed): `POST /mounts/projects/sign?slug=<slug>&access=<read|read-write>`, operation id `sign_project_mount_credentials`, beside `POST /mounts/agents/sign` (`sign_agent_mount_credentials`). The route segment names the owner kind, as `agents` does.

1. Checks the project permission `USE_MOUNTS`, as both sign routes do today (`router.py:482`, `router.py:637`).
2. Refuses a reserved slug (`service.py:151-154`), so the route can never reach a session drive or an agent drive.
3. Looks the slug up in the project of the request only. The `mounts` key is `(project_id, id)` (`dbes.py:22`), so another project's drive cannot match.
4. Finds a row with no session and no agent; an absent or archived row answers 404. It creates nothing.
5. Signs credentials for the drive's prefix: read and write for `"read-write"`, read only for `"read"` (Decision 7).

`access` applies only to project entries in version 1. The agent's own drive is always read-write, as today, so `POST /mounts/agents/sign` does not change. A read-only agent drive would also be unsafe during a rollout: an older runner or an older API would mount it writable (Decision 12).

Who may do what (Proposed):

- **Attach a drive to an agent**: anyone who may commit a revision of that agent. Attaching is an edit of the configuration.
- **Mount a drive in a run**: the run's principal needs `USE_MOUNTS` in the project, as for the agent drive today.
- **Isolation**: the runner signs only the drives that the run request lists, and the service builds that list from the revision it runs. The run credential stays out of the sandbox (`runtime-lifecycle.ts:181`), so a model cannot sign another drive. Each STS credential covers one prefix (`storage.py:292-346`), so the credentials that geesefs holds in the sandbox reach only the drives this run mounts.
- **Session drives stay private as they are.** The new route cannot sign them, and `allow_mount` keeps its rules (`sharing/utils.py:468-499`).
- **People in the web app**: a project drive keeps today's rule; every project member with `VIEW_MOUNTS` can read it and with `EDIT_MOUNTS` can change it (`sharing/utils.py:478-499`).

The sign route does not load the revision to check that it names the slug. The principal who runs the agent may already sign any project drive through `POST /mounts/{id}/sign` (`router.py:632-661`), so the check would add a database read per sign and no protection against that principal. The check that matters, "the model gets only the drives its configuration names", lives in the runner and in the per-prefix credentials.

The `local` backend keeps its known limit: one mount namespace for all sessions on the host (`run-plan.ts:443-445`). The guarantee above holds on `daytona` and `inprocess`, where each conversation has its own sandbox.

### Decision 6: The runner flow after the change

:::figure flow-after
:::

The runner mounts exactly what the list names. It resolves the drives of a run once, into one list, and every consumer reads that list: the backend handoff, the turn-start cache refresh, the `ENOTCONN` remount, the credential expiry and the teardown. Today two places rebuild their own lists of session and agent drive (`services/runner/src/engines/inprocess/harness-host.ts:148`, `services/runner/src/engines/sandbox_agent/turn-start-refresh.ts:92-101`); both read the resolved list after the change. Only the agent drive's own setup (its `README.md`, the `.tools` restore) stays specific to it. The agent's own drive is mounted because the list holds `{ "kind": "agent" }`, not because the run has an artifact id. For every backend (Proposed):

1. The service reads `drives` and `has_session_drive` from the revision and puts both on the run request, next to `runContext`. 
2. The runner sends every credential request at the same time: the session drive (when on), the agent drive (when listed) and one per project drive. Today the first two run one after the other (`environment-setup.ts:87-122`).
3. The agent drive mounts where it does today, at `<session folder>-agent`, linked as `agent-files` (`agent-mount.ts:21-39`). Each project drive mounts at `<session folder>-project-<slug>`, a sibling path, and a link `drives/<slug>` in the session folder points to it. Every link is renewed on every turn, because geesefs turns links into empty files across remounts (`agent-mount.ts:237-241`).
4. All mounts of the run start at the same time, in the same group as today's mounts.
5. A drive whose credentials cannot be signed is skipped. A signed drive whose mount fails follows each backend's rule of today for a failed agent drive (`local` and `daytona` go on without it; `inprocess` refuses file commands until the next boot). The run goes on, the runner logs `mount degraded kind=<agent_mount|project_mount>`, and the prompt says that drive is not available this turn, as it does today for a refused agent drive (`agent-mount-guidance.ts:84-93`).
6. The prompt lists each drive with its path and access, and says how shared writes behave (Decision 8).
7. The drive list and `has_session_drive` join the fingerprint, so a changed list starts a new sandbox instead of reusing one with old mounts (`session-identity.ts:285-295`).
8. The credential lease of the environment becomes the earliest expiry over all its mounts (`session-identity.ts:778-791`).
9. A run request with no `drives` field (an older agent service) gets today's behavior: session drive when the run has a session id, and the agent drive when it has an artifact id. The runner keeps this one rule for version skew only.

Per backend:

- **`local`**: the runner host mounts each listed drive before the harness starts (`mount-lifecycle.ts:206-319`). The `ENOTCONN` remount covers every drive. Teardown unmounts them and deletes the mount points only after it confirms the unmount.
- **`daytona`**: the sandbox mounts each listed drive in the same group as the session drive (`environment.ts:1281-1284`). A parked sandbox keeps them.
- **`inprocess`**: each listed drive that was signed becomes one root (`DriveRoot`) of the command sandbox (`environment.ts:885-888`). Today any root that fails to mount fails every file command with a sentence, and chat keeps working (`sandbox-drive.ts:277-279`). That rule stays: a partial mount would let commands write into a plain folder left where a drive should be. A drive that could not be signed is not a root, so it does not block commands; the prompt says it is not available.

:::figure backends-after
:::

**An empty list** (Proposed). The runner signs and mounts no durable drive. It creates no `agent-files` link, sets no `AGENTA_AGENT_MOUNT_DIR`, and skips the restore of `agent-files/.tools/` (for example `environment.ts:1288-1300`). The prompt tells the model that no agent or project drive is attached, and separately how long its working folder lasts: for the session when the session drive is on, and only until the sandbox is removed when it is off. The platform instructions, which today describe `agent-files/` to every agent (`platform_instructions.py:156-175`), get one variant for an agent without an agent drive.

### Decision 7: Read-only drives now, enforced by the credentials and the mount (decided)

| Option | How | Trade-off |
|---|---|---|
| **A. Read-only credentials and a read-only mount** | The STS policy allows only `GetObject`, `GetObjectAttributes` and the scoped `ListBucket`; geesefs mounts with `-o ro` | A write fails at once with "read-only file system", and even a process that reads the credentials out of geesefs cannot write. One more policy form and one more flag. |
| B. A read-only mount only | geesefs `-o ro`, read-write credentials | The credentials sit in the geesefs process in the sandbox (`sandbox-drive.ts:10-12`; `mount.ts:9-12` says a same-user process can read them on `local`). A model with a shell could write with them. |
| C. A rule in the prompt only | The prompt says "do not write" | Nothing stops a write. |
| D. Not now | Ship read-write only | Smaller first step. Agents that only read would hold write access. |

**Chosen: A.** The credentials are the boundary; the mount flag gives the agent a clear error instead of a write that geesefs accepts and the store later refuses. Both parts are small. Per backend the enforcement is the same. The three backends build their geesefs arguments from one builder (`mount.ts:247-271`) and each adds its own flags (`local` adds `-f`, `mount.ts:428`; `daytona` runs it in the background, `mount.ts:852`; `inprocess` adds `--enable-perms` and `--read-retry-attempts`, `sandbox-drive.ts:108`), so `-o ro` goes in the shared builder: on the runner host for `local`, in the sandbox for `daytona` and `inprocess`.

Two points need a check during the build (not verified): that geesefs accepts `-o ro`, and that SeaweedFS honors a session policy without `PutObject` (its prefix scoping is already tested by the API's acceptance tests).

### Decision 8: Two writers at once, and what agents are told

What version 1 promises (Proposed). It starts simple and adds rules only when a problem shows.

- Each file is one object. A write replaces the whole file. When two runs write one file, the last upload wins. No locks and no merges.
- A run sees another run's change after the writer's upload has completed and the reader's cache has refreshed. Closing a file starts its upload but does not wait for it (`mount.ts:241-246`); the reader's cache refreshes at the start of each turn, best effort (`turn-start-refresh.ts:4-23`, `turn-start-refresh.ts:107`), and otherwise within one minute. No stronger promise, so no new coordination.
- On the bundled store, an overwritten or deleted file can be recovered from the store's versions for 30 days, by an operator, not in the product (`storage.py:203-247`).

The prompt paragraph for each shared drive says (Proposed): "`drives/<slug>/` is shared with other agents of this project, and they can write it at the same time. A write replaces the whole file, and the last write wins. Prefer adding new files to editing shared ones. Never delete a folder you did not create." For a read-only drive: "`drives/<slug>/` is read-only for you."



### Decision 9: Keeping it fast

- **Sign at the same time** (Proposed). Today the runner waits for the session sign before it sends the agent sign. After the change all signs go out together. The added time of more drives is then about one sign, not one per drive.
- **Mount at the same time** (Measured today, kept). All three backends already mount their folders at the same time (`environment.ts:776-779`, `environment.ts:1281-1284`, `sandbox-drive.ts:271-272`). Shared drives join the same group.
- **Lazy mount stays where it is.** `inprocess` already mounts at the first tool call. On `local` the harness environment is fixed before the harness starts (`environment.ts:801-804`). `daytona` already uploads a new system prompt after the agent mount (`mount-lifecycle.ts:171-193`), but a lazy mount would still add a mount step inside the turn. Not in version 1.
- **A limit of 8 drives per agent** (Proposed). Each drive is one sign and one geesefs process.


Expected added cold-start time (estimate, not measured): one mount in a sandbox takes about 0.6 s (Measured on `inprocess`, `sandbox-drive.ts:271`), and on `local` the code expects about 1 s (`mount.ts:458`). Because the extra mounts run beside the session mount, one to three extra drives should add between 0.1 s and 0.5 s of wall time, from more parallel work in one sandbox. Signing in parallel removes one round trip that runs one after the other today. The runner already logs the stages `local_mounts`, `mounts` and `agent_mount` (`environment.ts:780`, `environment.ts:1206`, `environment.ts:1277`); a `project_mounts` stage lets the release measure the real number.

### Decision 10: The agent's own commit tool cannot change `drives` (decided)

Add `["parameters", "agent", "drives"]`, and `has_session_drive`, to the refused paths of `AGENT_COMMIT_SCOPE` (`change_set.py:569-581`), next to the sandbox permissions. An agent cannot give itself a drive that a person or the platform did not give it.

### Decision 11: The session files pane shows project drives (decided)

The session files pane folds each project drive of the session in under `drives/<slug>/`, as it folds the agent drive under `agent-files/` today (`useSessionDrive.ts:28-65`), and a chat link to a path under `drives/<slug>/` opens the file. The pane learns the project drives from the `drives` list of the agent's configuration, which it already loads for the session, and resolves each slug to its mount with `POST /mounts/query` and a new optional `slugs` filter on `MountQuery` (today the query filters only by session and agent, `api/oss/src/dbs/postgres/mounts/dao.py:338-346`). A slug with no active mount is not shown. The platform prompt allows such links (`platform_instructions.py:170-175`). No other web work is in scope.

### Decision 12: Version skew between the API, the agent service and the runner

The runner and the agent service do not always run the same version. Each pair below must work (Proposed):

| New part | Old part | What happens |
|---|---|---|
| runner | API | The new project sign route answers 404. The runner skips the project drive, logs it, and tells the model. Fails closed. |
| API | runner | The old runner ignores `drives`. It mounts the session drive and the agent drive by its old rule and never mounts a project drive. Fails closed for project drives; an agent whose list omits its own drive still gets it, as today, until the runner is updated. |
| agent service | runner | Same as the row above: the old runner ignores the new wire fields. A test pins that the run request parse accepts unknown fields. |
| runner | agent service | No `drives` on the request. The runner applies today's rule (Decision 6, step 9). |
| stored configuration with `drives` | old agent service | The old SDK does not read `drives` (`dtos.py:906-944`), but the vault middleware stops recognizing the run as an agent run, because it accepts only known top-level keys (`sdks/python/agenta/sdk/middlewares/running/vault.py:604-657`), so the run gets the old vault path. (Separately, the API's template compiler validates catalog templates against the editor schema, `compiler.py:144-150`; it ships with the API and learns the keys in the same release.) |

Because `access: "read"` exists only on project entries, and only a new runner against a new API mounts a project drive, no version pair mounts a read drive writable.

Rollout order for release 1: the API first, then the runner, then the agent service. No configuration with the new keys is saved before the agent service runs release 1; the save check and the editor schema ship with the API, and the default template that writes the keys ships with the agent service, so the order holds when each part deploys in this order. The backfill of stored revisions (release 2) must not run before every agent service knows the keys. A database migration runs before the new pods start (`api/AGENTS.md`, "Migration gate"), so the backfill cannot ship in the same release as the code that reads it.

## Risks / Trade-offs

- **A recursive delete in a shared drive hits every agent that shares it.** One run's recursive delete already removed whole drives once on `local`, through a shared mount root (`run-plan.ts:443-445` names the data loss). Read-only access is the defense for agents that only read. Store versions are the recovery on the bundled store; a remote bucket has them only if its operator turned versioning on (`storage.py:211-213`).
- **`local` does not isolate drives between sessions** (`run-plan.ts:443-445`). The rule "an agent that does not list a drive cannot reach it" holds on `daytona` and `inprocess`. On `local` it holds for what the agent is told and for its configured paths, not against a process that walks the host's mount root.
- **Last write wins can lose an edit** when two agents edit one file in the same minute. The prompt rule (new files over shared edits) makes it rare.
- **The backfill rewrites history.** Old revisions change their stored content, not their meaning: each gets exactly the drives it already had. A revision that a deployed environment points to is rewritten too, which is the point.
- **A deleted or archived drive breaks no saved configuration.** The save check runs at commit; later the run skips the drive and says so.

## Migration

Target state: every stored agent revision holds `has_session_drive` set to on, and `"drives": [{ "kind": "agent" }]`. Both describe exactly what the agent has today.

Options (Proposed):

| Option | How | Trade-off |
|---|---|---|
| A. Rewrite stored revisions in place | An alembic data migration in `core_oss` adds the two keys to `data.parameters.agent` of every agent revision that lacks them, idempotent, with a no-op downgrade | Every stored configuration, including old ones that environments point to, states its drives. Old code must already know the keys (Decision 12), so it needs a release before it. Changes the stored content of old revisions. |
| B. Commit one new revision per agent | The platform commits a new revision with the two keys to each agent's variants | Keeps old revisions untouched. Adds one revision per variant, moves every head, can collide with the playground's auto-commit (`base_revision_id` conflicts), and leaves environments that point to old revisions without the keys. |
| C. A default at read time only | A configuration without `drives` is read as `[{ "kind": "agent" }]` with the session drive on | No data change and no rollout risk. Stored configurations never state their drives, but he asked that they do. |

**Recommended: C, then A, in two releases** (Proposed). It is the repo's "expand and contract" rule (`api/AGENTS.md`, "Migration gate"):

1. **Release 1, expand.** Ship the field everywhere (API save check, SDK, vault keys, editor schema, runner, files pane). The SDK reads a configuration without `drives` as `[{ "kind": "agent" }]` with the session drive on, which is today's behavior. The default template for new agents (`sdks/python/agenta/sdk/utils/types.py:1522-1567`) and the playground editor write both keys on every save, so new and edited agents state them at once.
2. **Release 2, contract.** An alembic data migration rewrites every stored agent revision that lacks the keys, in place, as in option A. It only adds missing keys and keeps any value a revision already states, so a second run changes nothing. Its downgrade does nothing: a database is never rolled back on a failed deploy (`api/AGENTS.md`, "Migration gate"), and release 1 code reads the added keys, so no rollback needs them removed. No side table. After it, every agent configuration states its drives. The read-time default stays only for configurations that callers of the API send without the keys, so a client that never heard of drives gets today's behavior.

Agents with no drive row today (agents that never ran) need nothing special: `{ "kind": "agent" }` names no row, and the first run creates the drive as today (`service.py:576-601`).

No table changes: a project drive is a `mounts` row with no session and no agent, which the table already allows (`dbas.py:29-51`).

## Tests

Each suite below runs with the commands in the root `AGENTS.md` (`py-run-tests` in `api` and `sdks/python`) and in `services/runner/AGENTS.md` (`pnpm test`).

- API unit tests (`api/oss/tests/pytest/unit/mounts/`, `api/oss/tests/pytest/unit/` for workflows): the read-only policy holds no write or delete action; the project sign route refuses reserved slugs, another project's drive, missing and archived drives, and never creates one; the commit refuses a missing drive with 422 and the code `drive_not_found`, more than 8 entries, a project entry without a slug, and two agent entries; the agent's own commit refuses `drives` and `has_session_drive`.
- API acceptance tests (`api/oss/tests/pytest/acceptance/mounts/`): read-only credentials can read and list but cannot put or delete on the test store.
- Migration test (release 2): the backfill adds the keys to agent revisions only, leaves revisions that have them unchanged, and a second run changes nothing.
- SDK unit tests: `AgentTemplate` parses `drives` and `has_session_drive`, with the read-time default for a configuration without them; the wire golden fixtures and `test_wire_contract.py`; the vault middleware recognizes a template with the new keys; `AgentTemplateSchema` accepts them; the default template writes them.
- Runner unit tests: all signs start before the first answer arrives; a list without the agent entry mounts no agent drive and creates no `agent-files` link; an empty list gives the "no agent or project drive" prompt; `has_session_drive` off gives a throwaway folder on `local` and `daytona` and a named refusal on `inprocess`; a request without `drives` keeps today's behavior; geesefs gets `-o ro` for a read drive; each backend mounts each listed drive; `inprocess` keeps working when a non-session root fails; the fingerprint changes with the list; `tests/unit/wire-contract.test.ts`; an unknown wire field is ignored by an older parse.
- Runner integration test: `services/runner/tests/integration/inprocess/sandbox-drive.test.ts` with three roots, one failing.
- Web unit tests: the third origin in `useSessionDrive.ts`.
- Live check on the development stack, once per backend: two agents share a drive and see each other's files after the upload and a cache refresh; a write to a read drive fails; an agent without a project entry has no `drives/` folder; an agent with an empty list has no `agent-files/`; the cold-start time with two project drives against none.

## Size

About 1,400 lines of code and 1,200 lines of tests (estimate): API 330 (sign route, save check, read-only policy, backfill), SDK 200, runner 600, web 250. One engineer needs six to eight working days; three parallel lanes (API with SDK, runner, web) need three to four days, plus the second release for the backfill.

## What I could not verify

- The real time of one sign call and of a mount on `daytona` or `local`: the code logs them, but I did not read production logs.
- Whether geesefs accepts `-o ro`, and whether SeaweedFS honors a session policy without write actions.
- Whether the runner ignores an unknown field on the run request at run time.
- How geesefs behaves when two mounts write one file within its upload window, beyond "the last upload wins".
- Whether the Daytona API runs several commands in one sandbox at the same speed as one.
- How many stored agent revisions the backfill touches, and how long it runs on the largest database. The migration test and a count on a copy of the data answer it before release 2.
- Whether the playground editor drops keys it does not know when it saves a configuration; if it does, release 1 must teach it both keys before any agent states them.
