# Agenta tools settings delta

## Purpose

Let an author choose, per agent version, which Agenta tools are on and whether each one asks first.

## ADDED Requirements

### Requirement: The settings are saved in the agent's configuration
The agent configuration SHALL accept an optional `agenta_tools` block that maps a tool name to `allow`, `ask` or `off`. The block SHALL be saved with the version like any other setting. A tool missing from the block, or a missing block, SHALL use the tool's default. An unknown tool name SHALL be ignored. `off` SHALL mean the tool is not added to the run.

#### Scenario: Agent saved before this change
- **WHEN** an agent with no `agenta_tools` block runs
- **THEN** it SHALL get the default for every Agenta tool.

#### Scenario: Deployed version
- **WHEN** version 4 turns `create_schedule` on and production still runs version 3
- **THEN** production runs SHALL NOT offer `create_schedule` until version 4 is deployed.

#### Scenario: Unknown name
- **WHEN** the block names a tool that is not an Agenta tool
- **THEN** the run SHALL start normally and ignore that name.

#### Scenario: Off differs from deny
- **WHEN** `rename_agent` is `off` in `agenta_tools`
- **THEN** the model SHALL NOT see `rename_agent`, whereas an author's `tools` entry for `rename_agent` with permission `deny` SHALL leave the tool visible and refuse each call.

### Requirement: The tool settings show an Agenta tools section beside the build kit
The agent's tool settings, in `/w` and in `/m`, SHALL show an Agenta tools section beside the Build kit section. The Agenta tools section SHALL list every Agenta tool with a per-tool choice of Allow, Ask or Deactivate, grouped into write tools and read-only tools, under a kit-level choice of Allow all, Allow reads, Ask all or Deactivate that reads Custom when the rows differ. Its copy SHALL say that these tools are available wherever the agent runs: the playground, the API, Slack, Telegram, WhatsApp and automations. The Build kit copy SHALL say that its tools are available only in the playground and not in Slack, Telegram, WhatsApp, automations or the API. An Agenta tools row whose tool is also in the build kit SHALL say that the Build kit setting applies in the playground.

#### Scenario: Author opens the tool settings
- **WHEN** an author opens the Advanced drawer of an agent that has no Agenta tools settings
- **THEN** the Agenta tools section SHALL show "Get the link to this chat" and "Rename this chat" set to Allow and every other row set to Deactivate.

#### Scenario: Allow reads
- **WHEN** the author picks Allow reads for the Agenta tools section
- **THEN** every read-only row SHALL read Allow and every write row SHALL read Ask.

### Requirement: Agenta tools choices edit the draft
Changing a choice in the Agenta tools section SHALL edit the draft configuration and mark it unsaved. A commit SHALL save it. Playground runs of the draft SHALL use the unsaved choice. The UI SHALL write a tool to the block only when its choice differs from the default. Build kit choices SHALL keep being saved in the browser.

#### Scenario: Turning a tool on
- **WHEN** an author sets "Add a schedule" to Ask in the Agenta tools section
- **THEN** the draft SHALL show unsaved changes, and after commit the saved configuration SHALL contain `agenta_tools.create_schedule: "ask"`.

#### Scenario: Run before commit
- **WHEN** an author turns `create_schedule` on and runs the draft in the playground without committing
- **THEN** the playground run SHALL offer `create_schedule`, and Slack runs of the deployed version SHALL NOT.

#### Scenario: Back to the default
- **WHEN** an author sets a tool back to its default choice
- **THEN** the saved block SHALL NOT contain that tool.
