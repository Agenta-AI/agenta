## ADDED Requirements

### Requirement: Platform-provided builder agent

The platform SHALL provide the builder agent as one entry in the static workflow catalog with a reserved `__ag__*` slug, and every project SHALL resolve it without a database row.

#### Scenario: A project has the builder agent with no setup

- **WHEN** a person opens a project that never used the builder agent
- **THEN** the builder agent is available, and no row for it exists in the project

#### Scenario: A project cannot change the builder agent

- **WHEN** a person tries to commit a revision to the builder agent's slug in a project
- **THEN** the API refuses the commit, and the platform definition stays unchanged

### Requirement: The builder agent acts as the person

Each run of the builder agent SHALL carry the person who chats with it as its principal, with that person's project role and private items.

#### Scenario: Two people see different private agents

- **WHEN** person A and person B each ask the builder agent to list agents in the same project
- **THEN** each list holds the shared agents of the project and only that person's own private agents

#### Scenario: A viewer cannot change agents through the builder agent

- **WHEN** a person whose role cannot edit workflows asks the builder agent to change an agent
- **THEN** the edit tool returns a permission error, and the agent does not change

#### Scenario: Conversations are private by default

- **WHEN** person A has a conversation with the builder agent and does not share it
- **THEN** person B does not see that conversation

#### Scenario: A person shares a conversation

- **WHEN** person A shares a conversation with the builder agent with the project, as with any agent's session
- **THEN** person B can see that conversation

### Requirement: Approval defaults for the builder agent's tools

The builder agent's catalog entry SHALL set the approval permission of each tool, with `ask` for tools that create or change agents and `allow` for tools that only read.

#### Scenario: An edit asks first

- **WHEN** the builder agent calls `edit_agent_config`
- **THEN** the person sees an approval request before the change is saved

#### Scenario: A read does not ask

- **WHEN** the builder agent calls `list_agents` or `read_agent_config`
- **THEN** the tool runs without an approval request

### Requirement: Shared learning drive per project

The builder agent's configuration SHALL list one shared drive with a fixed slug, and the builder agent SHALL save preferences and lessons there as its learning skill describes.

#### Scenario: Team members share what the builder agent learned

- **WHEN** person A corrects the builder agent and it saves the lesson to its drive
- **THEN** a later run for person B in the same project can read that lesson

#### Scenario: The drive is created on first use

- **WHEN** a person runs the builder agent for the first time in a project
- **THEN** the platform creates the shared learning drive with the fixed slug before the run starts, and the builder agent has no home drive

#### Scenario: Projects do not share learning

- **WHEN** the builder agent saves a lesson in project X
- **THEN** a run in project Y does not see it

### Requirement: Release path

A new version of the builder agent's instructions, skills or tool list SHALL reach an instance only through the API release that carries it.

#### Scenario: Self-hosted upgrade

- **WHEN** a self-hosted instance upgrades to a release with a new builder agent version
- **THEN** every project on that instance uses the new version on its next run, with no migration
