# Agenta tools kit delta

## Purpose

Give every run of an agent a fixed set of platform tools, the Agenta tools, without writing them into the agent's saved configuration.

## ADDED Requirements

### Requirement: The Agenta tools are added to every run of an agent
Agenta SHALL add the Agenta tools to the tool list of every agent run that passes through the agent service, whatever started it: the playground, `/m`, the API, a Slack or Telegram message, an automation, an approval resume, or a loaded template. The kit SHALL hold `rename_session`, `discover_triggers`, `create_schedule`, `create_subscription`, `list_schedules`, `list_subscriptions`, `list_deliveries`, `test_subscription`, `remove_schedule`, `remove_subscription`, and the four channel tools. Agenta SHALL NOT change the saved configuration or create a revision to add them. When the agent service has no Agenta API address, it SHALL add nothing and the run SHALL continue.

#### Scenario: Slack turn
- **WHEN** someone in a Slack thread asks a connected agent to "remind the team every Monday" and the agent's configuration lists no automation tool
- **THEN** the run SHALL offer `create_schedule` and the other automation tools to the model.

#### Scenario: API call
- **WHEN** a developer invokes a saved agent through the API with a session ID
- **THEN** the run SHALL offer `rename_session` and the automation tools.

#### Scenario: Saved configuration is untouched
- **WHEN** a run adds the Agenta tools
- **THEN** the agent's saved revision SHALL be unchanged and its `tools` list SHALL NOT contain the added tools.

#### Scenario: Standalone SDK without Agenta
- **WHEN** the agent handler runs with no Agenta API address configured
- **THEN** it SHALL add no Agenta tool and the run SHALL start normally.

### Requirement: The build kit keeps only authoring tools
The playground build kit SHALL NOT contain any Agenta tool. It SHALL keep `commit_revision`, `read_config`, `test_run`, `rename_agent`, `search_skills`, `check_skill_updates`, `apply_skill_update`, `discover_tools`, `create_app`, `list_starters`, `request_connection`, `request_input`, and `request_secret`, and it SHALL remain playground-only.

#### Scenario: Build kit contents
- **WHEN** the playground fetches the build kit
- **THEN** the list SHALL NOT include `rename_session`, `create_schedule`, or any other Agenta tool.

#### Scenario: Request cards in Slack
- **WHEN** an agent runs in a Slack thread
- **THEN** the run SHALL NOT offer `request_connection`, `request_input`, or `request_secret`.

### Requirement: A tool is never added twice
Agenta SHALL add an Agenta tool only when the run's tool list has no platform entry for the same operation. An entry the author wrote SHALL be kept exactly as written, including its permission. A run SHALL NOT fail because the kit and the author both name a tool.

#### Scenario: Author listed the tool
- **WHEN** the author listed `create_schedule` with permission `deny` and the kit is on
- **THEN** the run SHALL contain exactly one `create_schedule`, with permission `deny`.

#### Scenario: Old playground overlay
- **WHEN** a browser with an old cached build kit sends `rename_session` in its overlay
- **THEN** the run SHALL contain exactly one `rename_session` and SHALL start normally.

### Requirement: Default permissions apply only when nobody chose one
Each Agenta tool SHALL have a default permission: `allow` for `rename_session`, `test_subscription`, `send_channel_message`, and the read-only tools, and `ask` for `create_schedule`, `create_subscription`, `remove_schedule`, and `remove_subscription`. The default SHALL apply only when the author set no permission on the tool and the agent-wide permission mode is `allow_reads`. The author's per-tool permission SHALL win over the default. An agent-wide `ask` or `deny` mode SHALL win over the default. The operator kill switch SHALL still stop any tool.

#### Scenario: Default ask in Slack
- **WHEN** a connected agent calls `create_schedule` in a Slack thread under the default mode and the author set no permission
- **THEN** Slack SHALL show an approval card, and the schedule SHALL be created only after someone approves.

#### Scenario: Agent-wide ask
- **WHEN** the agent-wide mode is `ask` and the agent calls `rename_session`
- **THEN** the call SHALL wait for approval.

#### Scenario: Author allows
- **WHEN** the author listed `create_schedule` with permission `allow`
- **THEN** the call SHALL run without approval.

### Requirement: Some runs get fewer tools
In a test run started by `test_run` and in an evaluation run, Agenta SHALL add only the read-only Agenta tools. In an automation run, Agenta SHALL NOT add `create_schedule`, `create_subscription`, `remove_schedule`, or `remove_subscription`. Agenta SHALL NOT add `rename_session` to a run that has no session ID, and SHALL NOT add `create_schedule` or `create_subscription` to a run that has no variant ID. These rules SHALL NOT remove an entry the author wrote.

#### Scenario: Evaluation
- **WHEN** an evaluation runs a connected agent over a test set
- **THEN** no run SHALL be offered `send_channel_message`, `create_schedule`, or any other Agenta write tool that the author did not list.

#### Scenario: Automation creating automations
- **WHEN** a weekly schedule fires and the agent is asked in the task to set up another schedule
- **THEN** the run SHALL NOT offer `create_schedule`.

#### Scenario: Automation posting
- **WHEN** a schedule fires for a connected agent
- **THEN** the run SHALL offer `send_channel_message`.

#### Scenario: No session
- **WHEN** an API call runs an agent without a session ID
- **THEN** the run SHALL NOT offer `rename_session`.

### Requirement: Channel tools need an active bot
The four channel tools SHALL be added only when the agent is bound to an active, verified bot. Agenta SHALL check this only when at least one channel tool is switched on. When the check fails or times out, Agenta SHALL add no channel tool, SHALL log the failure, and SHALL still add the other Agenta tools. The bot's own settings SHALL still refuse calls they forbid.

#### Scenario: Not connected
- **WHEN** an agent with no bot runs in the playground
- **THEN** the run SHALL offer the automation tools and SHALL NOT offer any channel tool.

#### Scenario: Bot forbids posting
- **WHEN** the author left `send_channel_message` on and the bot's "Can post outside the conversation" setting is off
- **THEN** the tool SHALL be offered, and every send SHALL be refused with a clear reason.

#### Scenario: Availability check times out
- **WHEN** the check for an active bot times out
- **THEN** the run SHALL start with the automation tools and without the channel tools.
