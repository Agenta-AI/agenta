## ADDED Requirements

### Requirement: Agent config capability groups three tools

The platform SHALL expose Agent config as one capability that provides `read_agent_config`, `create_agent` and `edit_agent_config`. It SHALL show one capability toggle in the build kit and in the Agenta tools section, and each of the three tools SHALL keep its own permission control.

#### Scenario: Toggle turns on all three tools

- **WHEN** a person turns Agent config on
- **THEN** the agent is offered `read_agent_config`, `create_agent` and `edit_agent_config`

#### Scenario: Toggle off removes all three tools

- **WHEN** a person turns Agent config off
- **THEN** the model is offered none of the three tools, and `read_config` and `commit_revision` are unaffected

#### Scenario: Per-tool permission

- **WHEN** a person sets `edit_agent_config` to ask and leaves the other two on allow
- **THEN** only calls to `edit_agent_config` show an approval card

### Requirement: Default availability and permission

Both capabilities SHALL be on by default in the build kit with every tool set to allow. New agents SHALL get the four tools in their `agenta_tools` entry, set to allow. Saved `agenta_tools` entries SHALL NOT be rewritten.

#### Scenario: Playground default

- **WHEN** a person opens any agent's playground after this ships
- **THEN** the build kit shows List agents and Agent config turned on, with each tool set to allow

#### Scenario: New agent default

- **WHEN** a person creates a new agent
- **THEN** its `agenta_tools` entry lists the four tools set to allow, beside the existing defaults

#### Scenario: Existing agent unchanged

- **WHEN** an agent saved before this change already has an `agenta_tools` entry and runs outside the playground
- **THEN** it has the new tools only if someone turned the capabilities on in its Agenta tools section

### Requirement: Read another agent's configuration

`read_agent_config` SHALL return the latest saved configuration of the named agent, or one part of it by path, with its `base_revision_id`, using the same response shape and size limits as `read_config`.

#### Scenario: Read by id or slug

- **WHEN** an agent calls `read_agent_config` with another agent's id or slug
- **THEN** it receives that agent's latest saved configuration and its `base_revision_id`

#### Scenario: Read one part

- **WHEN** the call includes `path: ["parameters","agent","llm"]`
- **THEN** it receives only that part, and a value over the size limit is refused with a list of children to read instead

#### Scenario: Unknown or invalid target

- **WHEN** the id or slug does not name a non-archived agent in the caller's project, or names a static platform workflow
- **THEN** the call fails with a clear error and no data from any other workflow

#### Scenario: Self as target

- **WHEN** an agent names itself
- **THEN** the call is refused with a next step that points to `read_config`

### Requirement: Create an agent

`create_agent` SHALL create a new agent in the caller's project from the same catalog template the "New agent" action uses, with the given name and optional description, then apply optional ordered operations in the same call. It SHALL return the new agent's id, slug and `base_revision_id`.

#### Scenario: Create with a name only

- **WHEN** an agent calls `create_agent` with `name: "Invoice helper"`
- **THEN** a new agent named "Invoice helper" exists with the same default configuration as one created through "New agent", and the tool returns its id, slug and `base_revision_id`

#### Scenario: Create with operations

- **WHEN** the call includes operations that set the instructions and add a skill
- **THEN** the first saved revision already contains those changes

#### Scenario: Invalid operations

- **WHEN** an operation fails validation or targets a path outside the agent commit scope
- **THEN** no agent is created and the error names the failing operation

#### Scenario: Unknown field

- **WHEN** the call sends a field other than `name`, `description` and `operations`, for example `instructions`
- **THEN** it is refused with `invalid_arguments`, and the next step shows the `operations` form

#### Scenario: Created agent appears in the list

- **WHEN** `list_agents` runs after a successful `create_agent`
- **THEN** the new agent is in the result

### Requirement: Edit another agent's configuration

`edit_agent_config` SHALL commit ordered operations to the named agent's latest saved revision, under the same commit scope, platform-tool check and stale-revision check as `commit_revision`. It SHALL NOT deploy the new revision.

#### Scenario: Successful edit

- **WHEN** an agent reads another agent, then calls `edit_agent_config` with that `base_revision_id` and an operation that edits the instructions
- **THEN** the target gets a new revision with the change, and its deployed environments are unchanged

#### Scenario: Stale base revision

- **WHEN** the target's head moved after the read
- **THEN** the edit is refused with a conflict error that tells the agent to read again

#### Scenario: Scope still applies

- **WHEN** an operation targets the target's sandbox credentials or harness permissions
- **THEN** the edit is refused, exactly as the same operation would be for a self-edit

#### Scenario: Tools and integrations are editable

- **WHEN** an operation adds a gateway integration or turns on Agent config for the target
- **THEN** the edit is committed without extra approval when the tool is set to allow

#### Scenario: Whole configuration refused

- **WHEN** the call sends a full configuration instead of operations
- **THEN** it is refused with the same `full_data_not_committable` error as self-edit

#### Scenario: Operations inside delta

- **WHEN** the call sends `delta.operations` or `workflow_revision.delta.operations`, the `commit_revision` shape
- **THEN** it is refused with `invalid_arguments`, and the next step says to send `operations` at the top level

#### Scenario: A result the runtime cannot run

- **WHEN** the operations leave a configuration the runtime would refuse, for example a skill without `body`
- **THEN** nothing is saved, and the refusal names the field, for example `skills[0].body is required`

#### Scenario: Self as target

- **WHEN** an agent names itself
- **THEN** the call is refused with a next step that points to `commit_revision`

### Requirement: Attribution in the commit message

Every revision written by `create_agent` or `edit_agent_config` SHALL have a commit message that ends with the editing agent's name, the editing agent's id and the session id. These values SHALL come from run context, never from model input.

#### Scenario: Edit message

- **WHEN** the agent "Support Triage" edits another agent's instructions in session S
- **THEN** the target's new revision message is the derived description of the change followed by `(by agent "Support Triage" <id>, session S)`

#### Scenario: Create message

- **WHEN** "Support Triage" creates an agent in session S
- **THEN** the new agent's first revision message starts with `Created by agent "Support Triage" <id>, session S`

#### Scenario: Model cannot forge attribution

- **WHEN** the model's arguments include a message, agent name or session id
- **THEN** those values are ignored or refused, and the suffix still shows the bound values

### Requirement: Change previews name the target agent

The chat SHALL show each `create_agent` and `edit_agent_config` call with the target agent's name and the same change preview that `commit_revision` shows.

#### Scenario: Preview in the editing conversation

- **WHEN** an agent calls `edit_agent_config` on "Invoice helper"
- **THEN** the call shows "Invoice helper" and a preview of the operations, whether or not an approval card is needed
