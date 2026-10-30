# Agent needs setup

## Purpose

Find every reference in an agent that names an item that is missing where the agent runs, show it in one way, block a run only for model items, and let a person fix it in one place.

## ADDED Requirements

### Requirement: One server check returns requirements
The system SHALL provide one server check that reads every reference of an agent revision or draft and returns a list of requirements. Each requirement SHALL name the item, its kind (`model_key`, `subscription`, `model`, `mcp_server`, `mcp_sign_in`, `secret`, `app_connection`), a reason, every configuration path that uses the item, whether it blocks a run, and what the caller can do. The check SHALL NOT change the configuration and SHALL NOT replace a missing item with another item, by name or by default. References that name the same item SHALL give one requirement.

#### Scenario: Two tools name one deleted connection
- **WHEN** an agent has two GitHub tools that name the connection `github-x1`, and that connection was deleted
- **THEN** the check SHALL return one `app_connection` requirement with reason `not_found` and both paths

#### Scenario: Ready agent
- **WHEN** every item that the agent names exists, is active and is signed in where the agent runs
- **THEN** the check SHALL return `status` `ready` and an empty list

#### Scenario: Unnamed key keeps the project default
- **WHEN** an agent names no model key, and the project has a key for its provider
- **THEN** the check SHALL return no `model_key` requirement

### Requirement: Query route
The system SHALL expose the check as `POST /workflows/revisions/requirements/query`, for a saved revision or an unsaved draft, to a caller with view permission on the agent. The response SHALL NOT contain a secret value. When the caller cannot see a referenced item, the requirement SHALL label it "Another person's account" and SHALL NOT return its slug.

#### Scenario: Viewer queries an agent
- **WHEN** a project member with view permission queries an agent whose MCP server was deleted
- **THEN** the route SHALL return the `mcp_server` requirement with `can_edit_agent` false

### Requirement: The check adds no wait
`/m` SHALL call the query route when it opens an agent, in parallel with its other requests. The run-time check SHALL add no sequential round trip to a run: the model key, secret and connected-app checks SHALL use the resolve calls the handler makes today, and the MCP server check SHALL be sent concurrently with them.

#### Scenario: Opening an agent
- **WHEN** a person opens an agent in `/m`
- **THEN** the requirements request SHALL start together with the page's other requests and SHALL NOT delay the first render

### Requirement: Only model items block a run
A model item is the model, its model key, or its subscription login. When a model item needs setup, the run SHALL fail before the sandbox starts with 422, `failure_code` `agent_needs_setup`, the message "The model needs setup before this agent can run.", and the requirements. When only other items need setup, the run SHALL start without those items and SHALL add no new message. Each requirement SHALL keep today's error code as `detail.code`.

#### Scenario: Deleted model key
- **WHEN** a person sends a message to an agent whose named model key was deleted
- **THEN** the run SHALL fail with `agent_needs_setup` before a sandbox starts, and the requirement SHALL carry `detail.code` `endpoint_not_found`

#### Scenario: Deleted custom secret
- **WHEN** a person sends a message to an agent whose custom secret was deleted, and its model items are ready
- **THEN** the run SHALL start without that secret binding, and no new chat message SHALL appear

#### Scenario: Old-style connected-app tool
- **WHEN** an agent has an old-style connected-app tool whose connection was deleted, and its model items are ready
- **THEN** the run SHALL start without that tool, and the editor SHALL tag the tool "Needs setup"

### Requirement: Saving is never blocked
Saving an agent SHALL always succeed when its shape and the caller's permissions are valid. No check of referenced items SHALL run at save time.

#### Scenario: Save with a missing model key
- **WHEN** an editor saves an agent whose named model key does not exist
- **THEN** the revision SHALL be saved, and the tag SHALL stay on the model key card

### Requirement: Needs setup in the editor and the chat
Every item card that names an item with a requirement SHALL show the tag "Needs setup" and the reason on a second line. The agent list SHALL show no tag. Only a model item SHALL show a banner, in the config pane and above the composer, and only a model item SHALL disable Send. Other items SHALL get no banner, no card, no blocker and no new chat notice.

#### Scenario: Model no longer available
- **WHEN** an agent's model left the catalog
- **THEN** the model row SHALL show "Needs setup" and "No longer available", the banner SHALL say "The model needs setup before this agent can run.", and Send SHALL be disabled

#### Scenario: Picking a model clears the state
- **WHEN** the person opens the model picker from the banner, which lists only models that the chosen key offers, and picks one
- **THEN** the tag and the banner SHALL clear and Send SHALL be enabled

#### Scenario: MCP sign-in expired
- **WHEN** an agent's MCP server needs a new sign-in and its model items are ready
- **THEN** the MCP server card SHALL show "Needs setup", no banner SHALL show, and Send SHALL stay enabled

### Requirement: One fix for every use of an item
The fix sheet SHALL let a person pick a compatible existing item, connect a new one, sign in again, or remove a non-model item from the agent. A pick or a removal SHALL write every path of the requirement and save one new revision. When exactly one compatible item exists, the sheet SHALL select it, and the person SHALL still confirm it. A sign-in SHALL NOT change the agent and SHALL NOT need edit permission on the agent.

#### Scenario: Replace a deleted connection
- **WHEN** an editor picks `github-release` for a requirement with four GitHub tool paths
- **THEN** all four paths SHALL name `github-release` in one new revision

#### Scenario: Remove is not offered for the model
- **WHEN** the fix sheet opens for a `model_key` requirement
- **THEN** the sheet SHALL NOT offer "Remove from agent"

### Requirement: Automations skip only for model items
When a schedule or trigger fires while a model item of its target revision needs setup, the dispatcher SHALL record a delivery with state `skipped` and reason `agent_needs_setup`, SHALL NOT retry it, and SHALL keep the schedule on. When only other items need setup, the fire SHALL run without them. Turning on a schedule, trigger or channel SHALL be refused with `agent_needs_setup` only while a model item needs setup, checked as the principal the automation runs as.

#### Scenario: Schedule fires with a deleted model key
- **WHEN** a schedule fires and its agent's model key was deleted
- **THEN** one `skipped` delivery SHALL be recorded, no run SHALL start, no retry SHALL follow, and the schedule SHALL stay on

#### Scenario: Schedule fires with a deleted MCP server
- **WHEN** a schedule fires and only its agent's MCP server was deleted
- **THEN** the run SHALL start without that server

### Requirement: Channels keep today's reply
A channel turn whose model item needs setup SHALL fail with today's reply. A channel turn whose other items need setup SHALL answer without them and SHALL send no extra message.

#### Scenario: Slack turn with a missing model key
- **WHEN** a person mentions an installed agent in Slack and its model key was deleted
- **THEN** the bot SHALL send today's reply "The agent run could not be started. Check the agent's configuration in Agenta."

### Requirement: Templates keep their own setup step
Unset template slots SHALL NOT produce requirements. After an agent is created from a template, every bound slot SHALL be a normal reference that this check covers.

#### Scenario: Optional slot skipped
- **WHEN** a person creates an agent from a template and skips an optional slot
- **THEN** the agent SHALL show no "Needs setup" tag for that slot
