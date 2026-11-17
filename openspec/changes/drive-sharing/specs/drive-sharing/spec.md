## ADDED Requirements

### Requirement: An agent configuration lists its drives by slug

The agent configuration at `parameters.agent` SHALL hold a list `drives` of at most 8 entries, each `{ "slug": ..., "access": ... }` with a non-empty slug that is one path segment and not `README.md` (any case; `drives/README.md` is the platform's file), each slug at most once, and an `access` of `"read-write"` (default) or `"read"`, and an entry with any other key SHALL be refused.

#### Scenario: A drive entry

- **WHEN** a revision holds `"drives": [{ "slug": "price-lists", "access": "read" }]`
- **THEN** a run of that agent lists the drive `price-lists` with the access `"read"` on its run request

#### Scenario: The two-kind entry is refused

- **WHEN** a caller saves an agent whose list holds `{ "kind": "agent" }`
- **THEN** the save answers HTTP 422 with the code `invalid_drive_entry`

#### Scenario: An empty list

- **WHEN** a revision holds `"drives": []`
- **THEN** a run of that agent mounts no drive and has no `agent-files/` folder

#### Scenario: A configuration without the key

- **WHEN** a revision stored before release 1 has no `drives` key and the agent has no drive row
- **THEN** the agent service sends no `drives` on the run request
- **AND** the runner uses the legacy route, which creates and mounts the agent's drive at `agent-files/`, as today

### Requirement: An agent configuration names an optional home drive

The agent configuration SHALL accept an optional `home_drive` that is `null` or the slug of a `"read-write"` entry of `drives`, and the platform SHALL keep the agent's saved tools, app files, template files and README in that drive and link it at `agent-files/` in the working folder.

#### Scenario: The home drive at agent-files

- **WHEN** a revision holds `"drives": [{ "slug": "quote-agent-files" }]` and `"home_drive": "quote-agent-files"`
- **THEN** the working folder holds `agent-files` and `drives/quote-agent-files`, both pointing to the one mount of that drive

#### Scenario: No home drive

- **WHEN** a revision holds `"home_drive": null` or no `home_drive` key and a non-empty `drives` list
- **THEN** the working folder has no `agent-files/`, the runner restores no saved tools, and the platform text is the variant without a durable agent folder

#### Scenario: Saved tools come from the home drive

- **WHEN** the home drive holds `.tools/bin/jq`
- **THEN** the runner copies it into `.tools/bin/` of the working folder before the first command

#### Scenario: A crew shares one home

- **WHEN** three agents each hold `"drives": [{ "slug": "crew-notes" }]` and `"home_drive": "crew-notes"`
- **THEN** each run links `agent-files` to the mount of `crew-notes`

### Requirement: The platform writes a README of the attached drives

At every start of a run, the runner SHALL write `drives/README.md` in the working folder, listing only the drives mounted in this run with each drive's folder, its access and whether it is the home drive, and the prune of leftover links SHALL never remove it.

#### Scenario: README content

- **WHEN** a run lists `quote-agent-files` (home) and `price-lists` (read)
- **THEN** `drives/README.md` lists `drives/quote-agent-files/` as read and write and as the home drive also at `agent-files/`, and `drives/price-lists/` as read only

#### Scenario: A drive that is not available

- **WHEN** the sign of `price-lists` fails
- **THEN** `drives/README.md` does not list `drives/price-lists/`
- **AND** the environment notes tell the agent that `drives/price-lists/` is not available in this conversation

#### Scenario: Write wording

- **WHEN** a run mounts a read-write drive
- **THEN** the README and the environment notes say "Other agents with access to this drive may also write files here. If two agents write the same file, the last write wins." and do not call the drive shared

### Requirement: A drive is shared or private

A drive SHALL be judged by its `mount_visibility` row, with visibility `project` (open to every project member whose role allows the action) or `private` (open only to its human owner), through the one entry `SharingService.evaluate` for every route, tool and loader that reads, writes or signs a drive, and a row with an agent id and no `mount_visibility` row SHALL follow its agent's rule until release 2.

#### Scenario: Personal agent with its owner's private drive

- **WHEN** the owner runs his personal agent that lists his private drive `private-notes`
- **THEN** the drive is signed and mounted

#### Scenario: A teammate's run cannot get a private drive

- **WHEN** a run whose principal is not the owner signs the private drive `private-notes`
- **THEN** the API answers 404 and signs nothing

#### Scenario: A shared agent becomes personal

- **WHEN** the owner makes a shared agent private
- **THEN** its drives stay shared

#### Scenario: A viewer of a personal agent's conversation

- **WHEN** a person with a grant on a personal agent's conversation opens its files
- **THEN** he sees the session folder and the shared drives of the agent, and no private drive

#### Scenario: A run by an API key

- **WHEN** a run whose principal is an API key signs a private drive
- **THEN** the API answers 404
- **AND** the same run can sign shared drives


#### Scenario: The owner leaves the project

- **WHEN** the owner of a private drive stops being a member of the project
- **THEN** no principal can read, write or sign that drive

#### Scenario: The apps tools apply the check

- **WHEN** a run whose principal may not use the private drive `private-notes` calls `list_starters` or `create_app` for an agent whose home is `private-notes`
- **THEN** the tool reads and writes nothing in `private-notes` and answers as for an agent with no drive

#### Scenario: Every new drive has an explicit row

- **WHEN** the API creates a drive for an ownerless shared agent
- **THEN** the drive has a `mount_visibility` row with visibility `project` and no owner

#### Scenario: A legacy agent drive follows its agent

- **WHEN** a drive row has an agent id and no `mount_visibility` row, and its agent is private
- **THEN** only the agent's owner can read, write or sign it

### Requirement: A channel turn may use only its own agent's private drives

A channel installation SHALL sign a private drive only on its own channel turn, for `USE_MOUNTS`, when the run's agent is private and its owner is both the binding's creator and the drive's owner; the API SHALL take that agent only from the `run_agent_id` claim of the run credential, and a child run, the save check and a credential without the claim SHALL NOT get this exception.

#### Scenario: A channel turn of a personal agent

- **WHEN** the owner's channel binding runs his personal agent, which lists his private home drive, on its own channel turn
- **THEN** the run can sign that home drive

#### Scenario: The same binding on another agent

- **WHEN** a binding created by the owner runs a shared agent on a channel turn, and the sign names the owner's private drive `private-notes`
- **THEN** the API answers 404

#### Scenario: A drive not in the revision

- **WHEN** a channel turn of the owner's personal agent signs a private drive of the owner that the revision of the turn does not list
- **THEN** the API answers 404

#### Scenario: A child run of a channel turn

- **WHEN** a child run of that channel turn signs the owner's private drive
- **THEN** the API answers 404

### Requirement: A personal agent's home drive is a private drive of its owner

The home drive of a private agent SHALL be a private drive owned by the agent's owner, checked by the one function `check_home_drive`; a save that breaks this SHALL be refused with HTTP 422 and the code `home_drive_not_allowed`, and a change of an agent to private SHALL be refused with HTTP 409 and the same code while any variant's latest revision names a home drive that breaks it.

#### Scenario: Shared drive as home of a personal agent

- **WHEN** the owner saves his personal agent with `"home_drive": "crew-notes"` and `crew-notes` is shared
- **THEN** the save answers HTTP 422 with `home_drive_not_allowed`

#### Scenario: Shared drive as a non-home entry

- **WHEN** the owner saves his personal agent with the shared drive `crew-notes` as an entry and his private drive `private-notes` as home
- **THEN** the save succeeds

#### Scenario: Making an agent private with a shared home

- **WHEN** the owner makes a shared agent private while its latest revision names a shared home drive
- **THEN** the request answers HTTP 409 with `home_drive_not_allowed` and the agent stays shared

#### Scenario: A shared agent with a shared home

- **WHEN** a shared agent names the shared drive `crew-notes` as home
- **THEN** the save succeeds, as today members who can write the agent's drive can write its tools

### Requirement: The home drive is checked again when a run signs it

The runner SHALL sign the home drive with `is_home=true`, and the API, taking the agent from the `run_agent_id` claim of the run credential, SHALL refuse that sign with HTTP 403 and `home_drive_not_allowed` when `check_home_drive` fails or the credential has no claim; the legacy agent route SHALL apply the same check, and the runner SHALL then run without a home.

#### Scenario: Another agent shared the home drive

- **WHEN** two personal agents of one owner use the private drive `private-notes` as home, the owner makes the first agent shared, and the second agent runs
- **THEN** the home sign of the second agent is refused with `home_drive_not_allowed`
- **AND** the run has no `agent-files/`, restores no saved tools, and the agent is told its home drive is not available

#### Scenario: A credential without the agent claim

- **WHEN** a sign with `is_home=true` carries a credential with no `run_agent_id` claim
- **THEN** the API refuses the sign with HTTP 403 and `home_drive_not_allowed`

#### Scenario: The agent comes from the credential

- **WHEN** a caller invokes an agent with `meta.run_id` or references that name another agent
- **THEN** the run credential's `run_agent_id` is the agent the API resolved for the invoke

#### Scenario: A child run carries its own agent

- **WHEN** a shared agent starts a child run of a private agent of the same owner whose home is a shared drive
- **THEN** the child run's credential names the private child agent, and its home sign is refused

#### Scenario: The legacy route applies the home rule

- **WHEN** an older runner signs through `POST /mounts/agents/sign` a private agent whose own drive is shared
- **THEN** the route answers 404

#### Scenario: A shared agent's shared home

- **WHEN** a shared agent signs its shared home drive with `is_home=true`
- **THEN** the API signs it

### Requirement: Making a personal agent shared makes its owner's private drives shared

When the owner makes a personal agent shared, the same request SHALL make shared every private drive owned by the acting owner that the latest revision of any variant lists, read through the key fill, SHALL list their slugs in `drives_made_shared`, and SHALL be refused with HTTP 409 and the code `drive_not_owned`, naming the slug, when such a revision lists a private drive of another owner.

#### Scenario: Visibility change with a private drive

- **WHEN** the owner makes his personal agent shared while it lists his private drive `private-notes`
- **THEN** the agent and `private-notes` are both shared after the request
- **AND** the response holds `"drives_made_shared": ["private-notes"]`

#### Scenario: A revision without keys

- **WHEN** the owner makes his personal agent shared while an environment points to a revision without `drives`, and the agent's own drive is private
- **THEN** the own drive is listed in the disclosure and in `drives_made_shared`, and becomes shared

#### Scenario: After a transfer

- **WHEN** an owner transfers a personal agent, which lists the owner's private drive `private-notes`, to another member, and the new owner makes the agent shared
- **THEN** the request is refused with `drive_not_owned` and names `private-notes`
- **AND** `private-notes` stays private

#### Scenario: The new owner's runs after a transfer

- **WHEN** the new owner runs the transferred agent that still lists `private-notes`
- **THEN** the sign of `private-notes` answers 404 and the agent is told that `drives/private-notes/` is not available

### Requirement: A save that cannot work is refused

An agent commit through an HTTP route SHALL be refused with HTTP 422 and the envelope `{code, message, retryable, next_step, details}` when an entry breaks the rules (`invalid_drive_entry`), `home_drive` is wrong (`invalid_home_drive`), `has_session_drive` is not a boolean (`invalid_session_drive`), a slug names no drive the saver may use (`drive_not_found`), or a shared agent lists a private drive (`drive_not_shared`).

#### Scenario: Drive created first, then attached

- **WHEN** a caller creates the drive `price-lists` with `POST /mounts/` and then saves an agent that lists it
- **THEN** both calls succeed

#### Scenario: Missing drive

- **WHEN** a caller saves an agent that lists the slug `price-list` and no such drive exists in the project
- **THEN** the save answers HTTP 422 with `drive_not_found` and `details.field` `parameters.agent.drives[0].slug`
- **AND** no revision is stored

#### Scenario: Another person's private drive

- **WHEN** a caller saves an agent that lists a private drive owned by another member
- **THEN** the save answers HTTP 422 with `drive_not_found`, the same answer as for a missing drive

#### Scenario: Own private drive on a shared agent

- **WHEN** a caller saves a shared agent that lists a private drive he owns
- **THEN** the save answers HTTP 422 with `drive_not_shared`

#### Scenario: Home drive not in the list or read only

- **WHEN** a caller saves `"home_drive": "notes"` and `notes` is not an entry, or is an entry with `"access": "read"`
- **THEN** the save answers HTTP 422 with `invalid_home_drive`

#### Scenario: Handler-mode refusal

- **WHEN** the agent's own commit tool commits a change that the drive rules refuse
- **THEN** the tool result is an error with status `STATUS_CODE_ERROR` whose content carries the same code
- **AND** no revision is stored

#### Scenario: The agent's own commit cannot change its drives

- **WHEN** an agent uses its own commit tool to change `drives`, `home_drive` or `has_session_drive`
- **THEN** the commit is refused as a change to a path the platform owns

### Requirement: An agent configuration states whether it has a session drive

The agent configuration SHALL hold a boolean `has_session_drive` beside `drives`; a configuration without it SHALL be read as `true`, and a run on `inprocess` with `false` SHALL be refused with the error code `session_drive_required`.

#### Scenario: Session drive off

- **WHEN** a configuration holds `"has_session_drive": false` and runs on `local` or `daytona`
- **THEN** the run works in a throwaway working folder

#### Scenario: Session drive off on in-process

- **WHEN** a configuration holds `"has_session_drive": false` and runs on `inprocess`
- **THEN** the runner refuses the run with `session_drive_required`

### Requirement: The API never stores an agent revision without its drives

A commit through the API SHALL fill `has_session_drive`, `drives` and `home_drive` into an agent revision that lacks `drives`, and a read SHALL apply the same fill when the agent has a drive row, through one function `fill_agent_drive_keys`, which lists the own drive as home only when the home rule allows it for the agent's current visibility and otherwise writes `"drives": []` and `"home_drive": null`.

#### Scenario: An older client saves without the keys

- **WHEN** a client commits a revision of an existing agent with no `drives` key, and the agent's drive has the slug `quote-agent-files`
- **THEN** the stored revision holds `"has_session_drive": true`, `"drives": [{ "slug": "quote-agent-files" }]` and `"home_drive": "quote-agent-files"`

#### Scenario: An older revision is read

- **WHEN** the agent service reads an agent revision stored before release 1, and the agent has a drive row
- **THEN** the revision it receives holds `drives` and `home_drive` naming that drive

#### Scenario: An older revision of an agent with no drive is read

- **WHEN** the agent service reads an agent revision stored before release 1, and the agent has no drive row
- **THEN** the revision it receives has no `drives` key, so the run uses the legacy route

#### Scenario: The fill obeys the home rule

- **WHEN** the API reads or saves a revision without `drives` of a private agent whose own drive was made shared
- **THEN** the revision holds `"drives": []` and `"home_drive": null`

#### Scenario: A drive before release 2

- **WHEN** the API reads a revision without `drives` of an agent whose own drive has no `mount_visibility` row
- **THEN** the drive follows its agent, the rule holds, and the revision lists it as home by its current slug

### Requirement: A new agent gets its own drive

When the API stores the first agent revision of an artifact that has no drive created with it, and the revision has no `home_drive` key, the API SHALL create one drive named after the agent, with the agent's visibility and owner and the artifact id in `agent_id`, append it to `drives`, and set it as `home_drive`.

#### Scenario: Agent from the default template

- **WHEN** a person creates an agent named "Quote agent" with slug `quote-agent`
- **THEN** the first revision holds `"drives": [{ "slug": "quote-agent-files" }]` and `"home_drive": "quote-agent-files"`
- **AND** the drive exists before the first conversation

#### Scenario: Private agent gets a private drive

- **WHEN** a person creates a private agent
- **THEN** its new drive is private with the same owner

#### Scenario: The template removes the drive

- **WHEN** the first revision holds `"home_drive": null`
- **THEN** the API creates no drive

#### Scenario: The template names an existing home

- **WHEN** the first revision holds `"home_drive": "crew-notes"` and lists `crew-notes`
- **THEN** the API creates no drive

#### Scenario: Every creation path

- **WHEN** an agent is created through workflow create and commit, simple workflow create, application create, or a template load
- **THEN** each path creates exactly one drive for the agent

#### Scenario: A variant fork creates none

- **WHEN** a person forks a variant of an agent
- **THEN** no drive is created

#### Scenario: A retried commit creates one drive

- **WHEN** the first commit of an agent is sent twice
- **THEN** the agent has one drive

#### Scenario: Template files land in the new drive

- **WHEN** a template without a `home_drive` key declares the seed file `agent-files/SETUP.md`
- **THEN** the file is written at `SETUP.md` in the drive created in the same load

#### Scenario: A template cannot write into an existing drive

- **WHEN** a template's first revision holds `"home_drive": "crew-notes"`, lists the existing drive `crew-notes`, and declares the seed file `.tools/setup.sh`
- **THEN** the loader writes no file into `crew-notes`
- **AND** its answer lists the seed files it skipped

#### Scenario: A caller cannot link a drive to an agent

- **WHEN** a caller sends `POST /mounts/` with an `agent_id`
- **THEN** the API refuses the request and creates no drive

### Requirement: The API signs any drive by slug

`POST /mounts/sign` (operation id `sign_mount_credentials_by_slug`) with the query parameters `slug` and `access` SHALL require `USE_MOUNTS`, apply the drive's visibility rule, sign short-lived credentials for the active drive with that slug and no `session_id` in the caller's project (read-only for `access=read`), answer 404 for a missing, archived, session or denied drive, and never create a drive.

#### Scenario: A drive created with an agent

- **WHEN** a run signs the slug of a drive that the API created with an agent
- **THEN** the API signs it

#### Scenario: An existing agent drive with a reserved slug

- **WHEN** a run of the agent signs the reserved slug `__ag__agent__<id>__default` of its own drive before release 2
- **THEN** the API applies the visibility rule and signs it

#### Scenario: A session drive is never signed by slug

- **WHEN** a caller signs the slug of a session drive
- **THEN** the API answers 404, because the row has a `session_id`

#### Scenario: A reserved slug cannot be created

- **WHEN** a caller creates a drive with `POST /mounts/` and a slug that starts with `__ag__`
- **THEN** the API refuses the request

#### Scenario: A drive of another project

- **WHEN** a caller in project A signs the slug of a drive that exists only in project B
- **THEN** the API answers 404

### Requirement: The legacy agent route never gives more than the configuration

`POST /mounts/agents/sign` SHALL take the agent from the `run_agent_id` claim, which must equal its `artifact_id` parameter, SHALL sign, and create when none exists, the drive found by `agent_id` only for an agent with no stored revision that has a `drives` key and only when `check_home_drive` passes, SHALL answer 404 and create nothing otherwise, and the database SHALL hold at most one drive row per agent id.

#### Scenario: An agent with no explicit configuration

- **WHEN** an older runner signs an agent whose stored revisions have no `drives` key
- **THEN** the route signs the drive found by the agent id, and creates it when none exists

#### Scenario: An agent with an explicit configuration

- **WHEN** an older runner signs an agent that has a stored revision with a `drives` key, whatever that list holds
- **THEN** the route answers 404, signs nothing and creates nothing

#### Scenario: After release 2

- **WHEN** an older runner signs any agent after the release 2 migration
- **THEN** the route answers 404, because every revision has a `drives` key

#### Scenario: No empty second drive

- **WHEN** an older API pod tries to create a drive by the reserved slug for an agent that already has a drive
- **THEN** the database refuses the second row and the run continues without the drive

### Requirement: A read drive is read-only in storage and in the mount

For the access `"read"` the API SHALL sign credentials whose policy allows only reads and listings of the drive's prefix, and the runner SHALL mount the drive read-only on every sandbox kind.

#### Scenario: A write to a read drive fails

- **WHEN** an agent writes a file under `drives/price-lists/` of a read entry, with a file tool or a shell command
- **THEN** the write fails with a read-only file system error
- **AND** the store holds no change

#### Scenario: The credentials alone cannot write

- **WHEN** a process uses the credentials signed for a read drive to put or delete an object
- **THEN** the store refuses the request

### Requirement: The runner mounts and links every drive the same way

On `local`, `daytona` and `inprocess` the runner SHALL sign every listed drive at the same time, mount each at `<working folder>-drive-<slug>`, link it at `drives/<slug>`, link `agent-files` to the home drive, and include `drives` and `homeDrive` in the environment fingerprint.

#### Scenario: Local

- **WHEN** a run on `local` lists two drives
- **THEN** the runner's machine mounts both before the harness starts, at the same time as the session drive

#### Scenario: Daytona

- **WHEN** a run on `daytona` lists two drives
- **THEN** the cloud machine mounts both during setup, in one group with the session drive

#### Scenario: In-process

- **WHEN** a run on `inprocess` lists two drives
- **THEN** the command machine mounts both at the first tool call of each boot, and links `agent-files` to the home drive

#### Scenario: A changed list starts a new environment

- **WHEN** a parked sandbox served a revision with drives `[a]` and the next turn runs a revision with `[a, b]`
- **THEN** the runner does not reuse the parked sandbox

#### Scenario: A drive that cannot be signed

- **WHEN** the sign of one listed drive fails
- **THEN** the run continues with the other drives, the runner logs `mount degraded kind=drive_mount slug=<slug>` (`kind=agent_mount` stays only on the legacy path), and the agent is told the drive is not available

### Requirement: The runner keeps links safe and repairs them every turn

The runner SHALL never replace a real folder or a file with content at `agent-files` or `drives/<slug>`, SHALL replace an empty file or a wrong link, SHALL remove only links that the list no longer holds, and SHALL repair every link at the start of every turn on all three sandbox kinds.

#### Scenario: A real folder at agent-files

- **WHEN** the working folder holds a real folder `agent-files` with files in it
- **THEN** the runner leaves the folder and its files as they are, makes no link, and tells the agent the home drive is not available

#### Scenario: A lost link on daytona

- **WHEN** the `agent-files` link became an empty file between two turns on `daytona`
- **THEN** the runner makes the link again at the start of the next turn

#### Scenario: A drive removed from the list

- **WHEN** a drive was removed from the configuration since the last turn of a session
- **THEN** the runner removes its `drives/<slug>` link and keeps any real folder or file there

### Requirement: Older parts keep working and fail closed

A runner SHALL apply today's rule to a run request without `drives`, an older part MAY lose a drive but SHALL NOT gain write access or cause a drive to be created against the configuration, and an existing agent SHALL find its files at `agent-files/` at every step of the rollout order agent service, runner, API, web.

#### Scenario: Older agent service

- **WHEN** a run request carries no `drives` field
- **THEN** the runner mounts the session drive when the run has a session id, and signs the agent's drive through the legacy route by the agent id, linking it at `agent-files/` when the route signs it

#### Scenario: Older runner with a new configuration

- **WHEN** a runner older than this change receives a request with `drives` and `homeDrive`
- **THEN** it mounts no drive of an agent that has a revision with a `drives` key

#### Scenario: New runner against an older API

- **WHEN** the runner signs a slug and the API has no matching route
- **THEN** the drive is not available and the run continues

### Requirement: The migration gives every existing agent its drive by slug

The release 2 migration SHALL give every agent drive row with a reserved slug a readable unique slug while keeping its `agent_id` and storage prefix, write an explicit `mount_visibility` row for every drive without one, create a drive for every agent without one, add the keys to every agent revision that lacks them, and rewrite every revision reference to a renamed slug, idempotently and without calling app services.

#### Scenario: An existing agent after release 2

- **WHEN** an agent that ran before this change runs after release 2
- **THEN** its revision lists its drive by slug as home, and its files are at `agent-files/` as before

#### Scenario: An agent that never ran

- **WHEN** the migration meets an agent with no drive row
- **THEN** it creates one, with a `mount_visibility` row copied from the agent, and lists it as home

#### Scenario: A private agent's drive stays private

- **WHEN** the migration renames the drive of a private agent
- **THEN** the drive gets a private `mount_visibility` row with the agent's owner

#### Scenario: A reference saved during release 1

- **WHEN** a revision saved during release 1 names the reserved slug of the agent's own drive in `drives` and `home_drive`
- **THEN** the migration replaces both with the drive's new readable slug

#### Scenario: A second run

- **WHEN** the migration runs a second time
- **THEN** nothing changes

#### Scenario: Stored JSON that the jsonb cast refuses

- **WHEN** a revision's stored `data` holds text that the `jsonb` cast refuses
- **THEN** the migration reads and merges it as text and stores the keys

### Requirement: The files pane shows the drives of the session

The session files pane SHALL show the files of each attached drive under `drives/<slug>/`, show the home drive once under `agent-files/`, hide drives the viewer may not use, and open chat links under `drives/<slug>/` and `agent-files/`.

#### Scenario: A person opens a session

- **WHEN** a person opens a session of an agent with home `quote-agent-files` and the drive `price-lists`
- **THEN** the pane lists `agent-files/` with the home drive's files and `drives/price-lists/` with the price list files
- **AND** it does not list `drives/quote-agent-files/`

#### Scenario: A slug that ends in -agent

- **WHEN** a tool path lies under `<session>-drive-support-agent`
- **THEN** the pane maps it to `drives/support-agent/`, not to the old agent mount

#### Scenario: The agent page before the first conversation

- **WHEN** a person opens the page of an agent that never ran
- **THEN** the files card lists the drives of its configuration
