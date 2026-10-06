## ADDED Requirements

### Requirement: List agents in the project

The `list_agents` tool SHALL return the agents in the caller's project, with each agent's id, slug, name, description, latest revision version and last update time. It SHALL include only workflows flagged `is_agent`, exclude archived agents unless asked, and exclude static platform workflows.

#### Scenario: Agent lists its project's agents

- **WHEN** an agent with the List agents capability calls `list_agents` with no arguments
- **THEN** it receives every non-archived agent in its project, including itself, each with id, slug, name, description, version and updated time

#### Scenario: Results are paginated

- **WHEN** the project has more agents than one page holds
- **THEN** the result includes a cursor, and calling `list_agents` with that cursor returns the next page, with no agent listed twice

#### Scenario: Other projects are invisible

- **WHEN** an agent calls `list_agents`
- **THEN** no agent from another project appears, because the project comes from the run's credential and not from any argument

### Requirement: List agents is its own tool row

The platform SHALL show `list_agents` as one row in the Read-only list of the build kit and of the Agenta tools section, with the same Allow, Ask and Deactivate choice as every other tool there, independent of the config tools.

#### Scenario: Listing without write power

- **WHEN** `list_agents` is on and the three config tools are deactivated
- **THEN** the agent has `list_agents` and has none of `read_agent_config`, `create_agent` or `edit_agent_config`

#### Scenario: Deactivate removes the tool

- **WHEN** `list_agents` is deactivated
- **THEN** the model is not offered `list_agents`
