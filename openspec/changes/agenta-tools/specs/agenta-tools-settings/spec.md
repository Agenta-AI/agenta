# Agenta tools settings delta

## Purpose

Let an author choose, per agent version, which Agenta tools are on and whether each one asks first, and give every agent that choice.

## ADDED Requirements

### Requirement: The settings are one entry in the agent's tools
The agent's `tools` list SHALL accept an entry of `type` `agenta_tools` with a `policy.permissions` object holding `default` and a `tools` map from tool name to value. The allowed values SHALL be `allow`, `ask` and `off`. The entry SHALL NOT accept a top-level `permission`. The entry SHALL be saved with the version like any other tool entry. An unknown tool name SHALL be ignored with a warning.

#### Scenario: Deployed version
- **WHEN** version 4 sets `create_schedule` to `ask` and production still runs version 3
- **THEN** production runs SHALL NOT offer `create_schedule` until version 4 is deployed.

#### Scenario: Unknown name
- **WHEN** the entry names a tool that is not an Agenta tool
- **THEN** the run SHALL start normally, ignore that name, and log a warning.

#### Scenario: Deny is refused
- **WHEN** the entry sets a tool to `deny`
- **THEN** the configuration SHALL be refused as invalid, and the error SHALL name the allowed values.

#### Scenario: Off differs from an author's deny
- **WHEN** `rename_agent` is `off` in the entry
- **THEN** the model SHALL NOT see `rename_agent`, whereas an author's platform entry for `rename_agent` with permission `deny` SHALL leave the tool visible and refuse each call.

### Requirement: New and existing agents get the entry
The default agent template and the built-in agent templates SHALL include the default `agenta_tools` entry. When the playground, in `/w` or `/m`, loads a revision whose `tools` have no `agenta_tools` entry, it SHALL add the default entry to the loaded configuration, in the one place revisions are loaded. The added entry SHALL be part of the loaded baseline and SHALL NOT mark the draft unsaved. It SHALL be saved with the next save of that agent. The playground SHALL NOT create a version on open. Outside the playground, Agenta SHALL read only the saved configuration and SHALL NOT fall back to the defaults.

#### Scenario: Existing agent opened
- **WHEN** an author opens an agent saved before this change
- **THEN** the loaded configuration SHALL contain the default `agenta_tools` entry, the draft SHALL NOT show an unsaved change, and no version SHALL be created.

#### Scenario: Next save
- **WHEN** the author then changes the instructions and the playground saves
- **THEN** the saved version SHALL contain the default `agenta_tools` entry.

#### Scenario: Existing agent not saved
- **WHEN** an agent saved before this change runs in Slack and nobody has saved it from the playground since
- **THEN** the run SHALL offer no Agenta tool.

### Requirement: The tool settings show an Agenta tools section beside the build kit
The agent's tool settings, in `/w` and in `/m`, SHALL show an Agenta tools section beside the Build kit section. The section SHALL render the `agenta_tools` entry with the same permission component as a gateway connection: a per-tool choice of Allow, Ask or Deactivate, grouped into write tools and read-only tools, under a kit-level choice. Deactivate SHALL write `off`. Its copy SHALL say that these tools are available wherever the agent runs: the playground, the API, Slack, Telegram, WhatsApp and automations. The Build kit copy SHALL say that its tools are available only in the playground and not in Slack, Telegram, WhatsApp, automations or the API. An Agenta tools row whose tool is also in the build kit SHALL say that the Build kit setting applies in the playground. The kit-level Deactivate SHALL set every tool to `off` and keep the entry.

#### Scenario: Author opens the tool settings
- **WHEN** an author opens the Advanced drawer of an agent with the default entry
- **THEN** the Agenta tools section SHALL show "Get the link to this chat" and "Rename this chat" set to Allow and every other row set to Deactivate.

#### Scenario: Allow reads
- **WHEN** the author picks Allow reads for the Agenta tools section
- **THEN** every read-only row SHALL read Allow and every write row SHALL read Ask.

#### Scenario: Turning a tool on
- **WHEN** an author sets "Add a schedule" to Ask
- **THEN** the draft SHALL show unsaved changes, and after commit the saved entry SHALL contain `create_schedule: "ask"`.

#### Scenario: Everything off
- **WHEN** an author picks Deactivate for the whole Agenta tools section and the playground saves
- **THEN** the saved entry SHALL set every Agenta tool to `off`, and no run outside the playground SHALL offer an Agenta tool.
