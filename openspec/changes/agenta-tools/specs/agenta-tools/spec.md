# Agenta tools delta

## Purpose

Give every run of an agent the Agenta tools its saved configuration turns on, wherever the run starts.

## ADDED Requirements

### Requirement: The Agenta tools and their defaults
The Agenta tools SHALL be `get_current_session`, `rename_session`, `rename_agent`, `create_schedule`, `create_subscription`, `remove_schedule`, `remove_subscription`, `list_schedules`, `list_subscriptions`, `list_deliveries`, `test_subscription`, `discover_triggers`, `commit_revision`, `read_config`, `check_skill_updates` and `apply_skill_update`. The default `agenta_tools` entry SHALL set `default` to `off` and SHALL set `get_current_session` and `rename_session` to `allow`.

#### Scenario: New agent in Slack
- **WHEN** an agent created from the default template runs in a Slack thread
- **THEN** the run SHALL offer `get_current_session` and `rename_session`, and SHALL NOT offer `rename_agent`, `commit_revision`, `read_config` or any automation tool.

#### Scenario: Author turns on a tool
- **WHEN** the author sets `create_schedule` to `ask` in the entry and commits
- **THEN** every run of that version SHALL offer `create_schedule`, and each call SHALL ask for approval.

### Requirement: The entry expands into platform tools at resolve time
When the agent's `tools` contain an `agenta_tools` entry, the tool resolver SHALL add one platform tool for each Agenta tool whose value is `allow` or `ask`, with that value as its permission, and SHALL NOT add a tool whose value is `off`. A tool not named in `tools` SHALL take the `default` value. The op catalog SHALL supply each tool's description, endpoint and schema. This SHALL apply to every run of the agent: the playground in `/w` and `/m`, the API, a Slack, Telegram or WhatsApp message, an automation, and an approval resume. The resolver SHALL skip `get_current_session` and `rename_session` when the run has no session ID. When the platform connection has no Agenta API address, the resolver SHALL skip the entry with a warning and the run SHALL start normally. An agent with no `agenta_tools` entry SHALL get no Agenta tools.

#### Scenario: Session link in Slack
- **WHEN** someone in a Slack thread asks "send me a link to this conversation" and the agent's saved entry has the defaults
- **THEN** the agent SHALL call `get_current_session` and reply with the session's link.

#### Scenario: Automation
- **WHEN** a schedule fires for an agent whose entry sets `list_schedules` to `allow`
- **THEN** the run SHALL offer `list_schedules`.

#### Scenario: Tool off
- **WHEN** the entry sets `rename_session` to `off`
- **THEN** no Slack, Telegram, WhatsApp, automation or API run of that version SHALL offer `rename_session`.

#### Scenario: No saved entry
- **WHEN** a version whose saved `tools` have no `agenta_tools` entry runs in Slack
- **THEN** the run SHALL offer no Agenta tool the author did not list separately, and the SDK SHALL NOT fall back to the defaults.

#### Scenario: Standalone SDK
- **WHEN** the agent handler runs with no Agenta API address and the agent has an `agenta_tools` entry
- **THEN** it SHALL add no Agenta tool, log a warning, and start the run normally.

### Requirement: A tool is never added twice
When a run already has a `{"type": "platform"}` entry for an Agenta tool, from the author's own `tools` list or from the playground build kit, the resolver SHALL keep that entry exactly as it is, including its permission, and SHALL NOT add the tool again from the `agenta_tools` entry. A run SHALL NOT fail because a tool is in more than one place.

#### Scenario: Author's own entry
- **WHEN** the author listed `create_schedule` as a platform entry with permission `deny` and the `agenta_tools` entry sets it to `allow`
- **THEN** the run SHALL contain exactly one `create_schedule`, with permission `deny`.

#### Scenario: Build kit in the playground
- **WHEN** a playground run has `commit_revision` from the build kit with `allow`, and the `agenta_tools` entry sets it to `ask`
- **THEN** the run SHALL contain exactly one `commit_revision`, with permission `allow`.

#### Scenario: Build kit deactivates a tool
- **WHEN** the build kit deactivates `create_schedule` and the `agenta_tools` entry sets it to `ask`
- **THEN** a playground run SHALL contain exactly one `create_schedule`, with permission `ask`.

### Requirement: The build kit stays unchanged and playground-only
The build kit SHALL keep all its tools, including `get_current_session` and `rename_session`, its defaults and its browser-saved choices. It SHALL reach only playground runs and a loaded template's first run.

#### Scenario: Build kit contents
- **WHEN** the playground fetches the build kit
- **THEN** the list SHALL include every tool it includes today, among them `commit_revision`, `read_config`, `get_current_session` and `rename_session`.

#### Scenario: Agenta tool off, build kit on
- **WHEN** `rename_session` is `off` in the `agenta_tools` entry and on in the build kit
- **THEN** a playground run SHALL offer `rename_session`, and a Slack run SHALL NOT.
