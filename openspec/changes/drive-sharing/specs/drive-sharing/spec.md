## ADDED Requirements

### Requirement: An agent configuration states all its drives

The agent configuration at `parameters.agent` SHALL hold a list `drives` whose entries each have a `kind` of `"agent"` (the agent's own drive, at most one entry, no `slug`) or `"project"` (with a required `slug`, each slug at most once), and, on project entries only, an `access` of `"read-write"` (default) or `"read"` (the agent's own drive is always read-write), with at most 8 entries; an empty list SHALL mean that the agent has no durable drive.

#### Scenario: The agent's own drive is an entry

- **WHEN** a revision holds `"drives": [{ "kind": "agent" }]`
- **THEN** a run of that agent mounts the agent's own drive at `agent-files/` with read-write access

#### Scenario: A read-only project drive

- **WHEN** a revision holds `{ "kind": "project", "slug": "price-lists", "access": "read" }`
- **THEN** the run request of that agent lists the project drive `price-lists` with the access `"read"`

#### Scenario: The editor and the vault recognize the field

- **WHEN** the playground validates an agent template with `drives` and `has_session_drive`, or the vault middleware of the agent service receives a run of such an agent
- **THEN** the editor schema accepts both fields
- **AND** the vault middleware treats the run as an agent run

### Requirement: An agent configuration states whether it has a session drive

The agent configuration SHALL hold a boolean `has_session_drive` beside `drives`; a configuration without it SHALL be read as `true`.

#### Scenario: Session drive on

- **WHEN** a configuration holds `"has_session_drive": true` and a run carries a session id
- **THEN** the runner mounts the session drive as the working folder, as today

#### Scenario: Session drive off

- **WHEN** a configuration holds `"has_session_drive": false` and runs on `local` or `daytona`
- **THEN** the run works in a throwaway working folder that lasts only as long as its sandbox

#### Scenario: Session drive off on in-process

- **WHEN** a configuration holds `"has_session_drive": false` and runs on `inprocess`
- **THEN** the runner refuses the run with the error code `session_drive_required`, whose message says the `inprocess` backend needs the session drive

#### Scenario: The agent's own commit cannot change it

- **WHEN** an agent uses its own commit tool to change `parameters.agent.has_session_drive`
- **THEN** the commit is refused as a change to a path the platform owns

### Requirement: Current agents are migrated to the explicit list

The platform SHALL read an agent configuration that lacks `drives` and `has_session_drive` as `"drives": [{ "kind": "agent" }]` and `"has_session_drive": true`, and a later release SHALL write exactly these values into every stored agent revision that lacks them.

#### Scenario: An existing agent after release 1

- **WHEN** an agent whose latest revision was saved before release 1 runs on any backend
- **THEN** the runner mounts its session drive and its own drive, as today

#### Scenario: A new agent after release 1

- **WHEN** a person creates an agent from the default template after release 1
- **THEN** its first revision holds `"has_session_drive": true` and `"drives": [{ "kind": "agent" }]`

#### Scenario: Stored revisions after release 2

- **WHEN** the release 2 migration has run
- **THEN** every stored agent revision holds `has_session_drive` and `drives`
- **AND** revisions that already held them are unchanged
- **AND** running the migration a second time changes nothing

### Requirement: A save that breaks the drive rules is refused

Every commit of an agent revision SHALL be refused with HTTP 422 when the drive list breaks the entry rules (code `invalid_drive_entry`), when `has_session_drive` is not a boolean (code `invalid_session_drive`), or when a `"project"` entry names a slug that has no active project drive in the same project (code `drive_not_found`), with the error envelope `{code, message, retryable, next_step, details}`.

#### Scenario: Drive created first, then attached

- **WHEN** a caller with `EDIT_MOUNTS` creates the project drive `price-lists` with `POST /mounts/` and then saves an agent that names it
- **THEN** both calls succeed

#### Scenario: Drive missing

- **WHEN** a caller saves an agent whose list names the slug `price-list` and no such drive exists in the project
- **THEN** the save answers HTTP 422 with the code `drive_not_found`, `retryable` false, a `next_step` that says to create the drive first, and the path of the entry in `details.field`
- **AND** no revision is stored

#### Scenario: Entry rules

- **WHEN** a caller saves a list with a project entry without a slug, an agent entry with a slug or an access, two agent entries, one slug twice, or 9 entries
- **THEN** the save answers HTTP 422 with the code `invalid_drive_entry` and the broken rule in `details`

#### Scenario: Session drive not a boolean

- **WHEN** a caller saves an agent whose `has_session_drive` is `"yes"`
- **THEN** the save answers HTTP 422 with the code `invalid_session_drive` and `details.field` `parameters.agent.has_session_drive`
- **AND** no revision is stored

#### Scenario: The same rules at run time

- **WHEN** a run request reaches the agent service with a list that breaks the entry rules
- **THEN** the agent service refuses it with the same rule text that the save check uses

### Requirement: The API signs a project drive by slug

The API SHALL provide `POST /mounts/projects/sign` with the query parameters `slug` and `access`, which requires `USE_MOUNTS`, signs short-lived credentials for the active project drive with that slug in the caller's project, and never creates a drive.

#### Scenario: A reserved slug is refused

- **WHEN** a caller signs a slug that starts with `__ag__`, such as the slug of another agent's own drive or of a session drive
- **THEN** the API refuses the request and signs nothing

#### Scenario: A drive of another project is not reachable

- **WHEN** a caller in project A signs the slug of a drive that exists only in project B
- **THEN** the API answers not found

#### Scenario: A missing or archived drive

- **WHEN** a caller signs the slug of an archived project drive, or of none
- **THEN** the API answers not found and creates nothing

### Requirement: A read drive is read-only in storage and in the mount

For the access `"read"` the API SHALL sign credentials whose session policy allows only reads and listings of the drive's prefix, and the runner SHALL mount the drive read-only, on every backend.

#### Scenario: A write to a read drive fails

- **WHEN** an agent with `{ "kind": "project", "slug": "price-lists", "access": "read" }` writes a file under `drives/price-lists/`, with a file tool or with a shell command
- **THEN** the write fails at once with a read-only file system error
- **AND** the store holds no change

#### Scenario: The credentials alone cannot write

- **WHEN** a process uses the credentials signed for a read drive to put or delete an object under its prefix
- **THEN** the store refuses the request

### Requirement: A run mounts only the drives that its configuration names

The runner SHALL sign and mount only the drives that the run request lists, the agent service SHALL build that list only from the revision it runs, and the run credential SHALL stay out of the harness environment.

#### Scenario: One drive shared by two agents

- **WHEN** the configurations of two agents of one project both name `{ "kind": "project", "slug": "price-lists", "access": "read" }`
- **THEN** runs of both agents mount `drives/price-lists/` read-only
- **AND** runs of other agents of the project do not mount it

#### Scenario: An agent without the entry gets no credentials

- **WHEN** an agent's list does not name the project drive `team-notes`
- **THEN** a run of that agent on `daytona` or `inprocess` mounts no `drives/team-notes/` and holds no credentials for it

#### Scenario: Session and agent drives stay private

- **WHEN** any caller signs a project slug
- **THEN** the sign route resolves only project drives, never a session drive or an agent drive

#### Scenario: The agent's own commit cannot add a drive

- **WHEN** an agent uses its own commit tool to add or change `drives` in its configuration
- **THEN** the commit is refused as a change to a path the platform owns

### Requirement: The runner mounts the listed drives on every backend, at the same time

On the `local`, `daytona` and `inprocess` backends the runner SHALL send all credential requests of a run at the same time, mount every listed drive in one parallel group, place the agent drive at `agent-files/` and each project drive at `drives/<slug>/`, and include the list and `has_session_drive` in the environment fingerprint.

#### Scenario: Local

- **WHEN** a run on `local` lists the agent drive and two project drives
- **THEN** the runner host mounts all three before the harness starts, at the same time as the session drive

#### Scenario: Daytona

- **WHEN** a run on `daytona` lists the agent drive and two project drives
- **THEN** the sandbox mounts all three while the runner sets the sandbox up, in one group with the session drive

#### Scenario: In-process

- **WHEN** a run on `inprocess` lists the agent drive and two project drives
- **THEN** the command sandbox mounts all of them at the first tool call of each sandbox boot, at the same time

#### Scenario: All credential requests go out together

- **WHEN** a run has a session drive, its own drive and two project drives
- **THEN** the runner sends the four credential requests before it receives the first answer

#### Scenario: A changed drive list starts a new environment

- **WHEN** a parked sandbox served a revision with drives `[agent, a]` and the next turn runs a revision with `[agent, a, b]`
- **THEN** the runner does not reuse the parked sandbox

### Requirement: The runner follows an empty list and an older request

The runner SHALL mount no agent or project drive for an empty list and tell the model that none is attached, and SHALL keep today's rule for a run request that carries no `drives` field.

#### Scenario: Empty list

- **WHEN** a run's list is empty
- **THEN** the runner signs no agent or project drive, creates no `agent-files` link and sets no `AGENTA_AGENT_MOUNT_DIR`
- **AND** the prompt says that no agent or project drive is attached, and how long the working folder lasts

#### Scenario: Older agent service

- **WHEN** a run request carries no `drives` field
- **THEN** the runner mounts the session drive when the run has a session id and the agent drive when it has an artifact id, as today

### Requirement: A drive that cannot be signed or mounted is reported

When the credentials of an agent drive or a project drive cannot be signed, the runner SHALL continue the run without that drive and tell the model it is not available; when a signed drive fails to mount, each backend SHALL keep its behavior of today for a failed agent drive; and the runner SHALL log `mount degraded` with the kind (`agent_mount` or `project_mount`) and the slug.

#### Scenario: Old API

- **WHEN** a new runner signs a project drive against an API that has no project drive sign route
- **THEN** the run continues with the other drives
- **AND** the model is told that `drives/<slug>/` is not available

#### Scenario: A drive archived after the save

- **WHEN** a configuration names a project drive that was archived after the save
- **THEN** the sign answers not found, the run continues without the drive, and the model is told that `drives/<slug>/` is not available

#### Scenario: In-process mount failure

- **WHEN** a signed project drive cannot be mounted in the command sandbox
- **THEN** file commands are refused with a sentence that names the drive, as today for a failed agent drive, and chat keeps working

### Requirement: Concurrent writes follow last write wins

The platform SHALL promise for shared drives only that a write replaces a file whole, that the last upload of a file wins, that no locks or merges exist, and that a run sees another run's change once the writer's upload has completed and the reader's cache has refreshed, and the prompt SHALL tell each agent these rules.

#### Scenario: Two agents write one file

- **WHEN** two agents that share a read-write drive write `INDEX.md` in the same minute
- **THEN** the file holds the content of the write that reached the store last

#### Scenario: The prompt explains the rules

- **WHEN** a run mounts `drives/team-notes/` read-write
- **THEN** its prompt says the folder is shared, that the last write to a file wins, to prefer new files over edits of shared files, and not to delete folders it did not create

### Requirement: The session files pane shows project drives

The session files pane SHALL show the files of each project drive of the session under `drives/<slug>/`, and a link in chat to a path under `drives/<slug>/` SHALL open that file.

#### Scenario: A person reads the price list from a session

- **WHEN** a person opens a session of an agent whose list names `price-lists`
- **THEN** the files pane lists the files of the drive under `drives/price-lists/`
- **AND** a chat link `[prices](drives/price-lists/2026.md)` opens that file
