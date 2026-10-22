## ADDED Requirements

### Requirement: Agent visibility and owner
Each agent SHALL have a visibility of `private` or `project` and an optional owner. An agent without an access row SHALL be project-visible with no owner. Only the owner SHALL see, use, or edit a private agent, with the project capability for the action.

#### Scenario: Private agent is hidden
- **WHEN** Bob requests Alice's private agent by list, by id, or through its revisions, files, templates, or a reference tool
- **THEN** the service answers as if the agent does not exist

### Requirement: Policy of a new agent
The system SHALL compute a new agent's policy on the server with the rule of CONTRACT.md section 7, for direct requests and for runs, including tool calls. A requested `private` without an owner SHALL NOT be applied and SHALL NOT fail the creation. The response SHALL return the applied policy.

#### Scenario: Human creates an agent
- **WHEN** Alice creates an agent in `/m` with visibility `private`
- **THEN** the agent is private and Alice is its owner

#### Scenario: API key creates an agent
- **WHEN** an API key that Alice created creates an agent with visibility `private`
- **THEN** the creation succeeds, the response shows a project-visible agent with no owner, and no access row exists

#### Scenario: Tool call
- **WHEN** a tool call creates an agent in a turn that Bob sent, and another in a Slack, API-key or child run with no human sender
- **THEN** Bob owns the first agent, and the second is project-visible with no owner

### Requirement: Private agent creation is atomic
A private agent's artifact row and access row SHALL be committed in one transaction, and a failure SHALL return an error. An ownerless agent SHALL have no access row. A revision commit SHALL write no access field, except that the first agent revision committed to an artifact without an access row SHALL add a project-visible row when the ownership rule gives an owner.

#### Scenario: Access row write fails
- **WHEN** the access row insert fails while a private agent is created
- **THEN** no artifact row exists and the request returns `agent_creation_failed`

#### Scenario: Multi-step creation
- **WHEN** Alice creates an artifact and commits its first agent revision in separate requests
- **THEN** the agent is project-visible, Alice is its owner, and she can make it private

#### Scenario: Multi-step creation by an API key
- **WHEN** an API key creates an artifact and commits its first agent revision in separate requests
- **THEN** the agent is project-visible with no owner, and no access row exists

### Requirement: Change agent visibility and owner
The owner SHALL be able to change the visibility and transfer the agent to another active project member, with `EDIT_WORKFLOWS`. A member with `MANAGE_AGENT_OWNERSHIP` SHALL be able to take ownership of a project-visible agent with no active owner. These changes SHALL NOT move files.

#### Scenario: Make private
- **WHEN** Alice makes her project-visible agent private
- **THEN** other members cannot see or run it, and they can still read their existing web sessions of it without sending

#### Scenario: Take ownership
- **WHEN** an admin takes ownership of a project-visible agent whose owner left, and of a private agent whose owner left
- **THEN** the first succeeds with visibility `project`, and the second is denied

### Requirement: Existing agents after migration
The migration SHALL make every agent that exists when it runs project-visible, owned by its recorded creator when one exists. An agent with no recorded creator, prompts, and evaluators SHALL get no access row. The migration SHALL run once and SHALL NOT select agents by a missing access row after new code runs.

#### Scenario: Existing agent
- **WHEN** the migration runs on an agent created by Carol
- **THEN** the agent is project-visible and Carol owns it

#### Scenario: Agent created by an old pod during the deploy
- **WHEN** a pod of the previous release creates an agent during the rolling deploy
- **THEN** the agent is project-visible with no owner, and an admin can take ownership
