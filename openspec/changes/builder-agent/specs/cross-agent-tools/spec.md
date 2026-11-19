## ADDED Requirements

### Requirement: List and read other agents

The platform SHALL provide the tools `list_agents` and `read_agent_config`, which return only agents that the caller may view in the run's project.

#### Scenario: Private agent of another person

- **WHEN** the builder agent asks `read_agent_config` for a private agent that belongs to another person
- **THEN** the tool answers `agent_not_found`, the same answer as for a missing agent

### Requirement: Create another agent

The platform SHALL provide the tool `create_agent` with a `visibility` parameter (`private` or `project`), and it SHALL create the agent in the run's project owned by the caller with that visibility.

#### Scenario: The builder agent asks and creates a private agent

- **WHEN** the person answers the builder agent's question with "only for me", and the builder agent calls `create_agent` with `visibility: private`
- **THEN** the person owns the new agent, and only the person sees it

#### Scenario: The builder agent creates a shared agent

- **WHEN** the builder agent calls `create_agent` with `visibility: project`
- **THEN** the new agent is visible to the project, and its drive is shared

#### Scenario: No visibility given

- **WHEN** the builder agent calls `create_agent` without `visibility`
- **THEN** the new agent is private to the caller

### Requirement: Edit another agent

The platform SHALL provide the tool `edit_agent_config`, which saves a new revision of the target agent only when the caller holds `EDIT_WORKFLOWS` on that target agent.

#### Scenario: Edit without rights on the target

- **WHEN** the caller may view the target agent but may not edit it
- **THEN** the tool refuses the edit and saves nothing

#### Scenario: Edit does not deploy

- **WHEN** `edit_agent_config` saves a new revision
- **THEN** no environment changes, and the person deploys separately

### Requirement: Tools only for the builder agent

The cross-agent tools SHALL NOT be in the build kit defaults or in the defaults of new agents.

#### Scenario: A new agent has no cross-agent tools

- **WHEN** a person creates a new agent from the default template
- **THEN** its tool list holds none of the four cross-agent tools
