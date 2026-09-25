# Agenta tools delta

## Purpose

Give every run of an agent the Agenta tools its author turned on, wherever the run starts, without writing them into the agent's saved tools.

## ADDED Requirements

### Requirement: The Agenta tools and their defaults
The Agenta tools SHALL be `get_current_session`, `rename_session`, `rename_agent`, `create_schedule`, `create_subscription`, `remove_schedule`, `remove_subscription`, `list_schedules`, `list_subscriptions`, `list_deliveries`, `test_subscription`, `discover_triggers`, `commit_revision`, `read_config`, `check_skill_updates` and `apply_skill_update`. The default setting SHALL be `allow` for `get_current_session` and `rename_session`, and `off` for every other Agenta tool.

#### Scenario: New agent in Slack
- **WHEN** an agent with no Agenta tools settings runs in a Slack thread
- **THEN** the run SHALL offer `get_current_session` and `rename_session`, and SHALL NOT offer `rename_agent`, `commit_revision`, `read_config` or any automation tool.

#### Scenario: Author turns on a tool
- **WHEN** the author sets `create_schedule` to `ask` and commits
- **THEN** every run of that version SHALL offer `create_schedule`, and each call SHALL ask for approval.

### Requirement: Every run gets the Agenta tools that are on
Agenta SHALL add each Agenta tool whose setting is `allow` or `ask`, with that permission, to every agent run that passes through the agent service: the playground in `/w` and `/m`, the API, a Slack, Telegram or WhatsApp message, an automation, and an approval resume. Agenta SHALL NOT add a tool whose setting is `off`. Agenta SHALL NOT write the added tools into the saved configuration. Agenta SHALL add `get_current_session` and `rename_session` only when the run has a session ID. When the agent service has no Agenta API address, Agenta SHALL add no Agenta tool and the run SHALL start normally.

#### Scenario: Session link in Slack
- **WHEN** someone in a Slack thread asks the agent "send me a link to this conversation" and the author changed no Agenta tools setting
- **THEN** the agent SHALL call `get_current_session` and reply with the session's link.

#### Scenario: Automation
- **WHEN** a schedule fires for an agent whose author turned on `list_schedules`
- **THEN** the run SHALL offer `list_schedules`.

#### Scenario: Tool turned off
- **WHEN** the author set `rename_session` to `off`
- **THEN** no Slack, Telegram, WhatsApp, automation or API run of that version SHALL offer `rename_session`.

#### Scenario: Saved tools untouched
- **WHEN** a run adds Agenta tools and the author then commits
- **THEN** the committed `tools` list SHALL contain only the author's own entries.

#### Scenario: Standalone SDK
- **WHEN** the agent handler runs with no Agenta API address
- **THEN** it SHALL add no Agenta tool and the run SHALL start normally.

### Requirement: A tool is never added twice
When a run already has an entry for an Agenta tool, from the author's own `tools` list or from the playground build kit, Agenta SHALL keep that entry exactly as it is, including its permission, and SHALL NOT add another. A run SHALL NOT fail because a tool is on in more than one place.

#### Scenario: Author's own entry
- **WHEN** the author listed `create_schedule` with permission `deny` and set it to `allow` in the Agenta tools
- **THEN** the run SHALL contain exactly one `create_schedule`, with permission `deny`.

#### Scenario: Build kit in the playground
- **WHEN** a playground run has `commit_revision` from the build kit with `allow`, and the Agenta tools set it to `ask`
- **THEN** the run SHALL contain exactly one `commit_revision`, with permission `allow`.

#### Scenario: Session tool in both sections
- **WHEN** a playground run has `get_current_session` from the build kit and the Agenta tools also have it on
- **THEN** the run SHALL contain exactly one `get_current_session`, with the build kit's permission, and SHALL start normally.

### Requirement: The build kit stays playground-only
The build kit SHALL keep all its tools, including `get_current_session` and `rename_session`, its defaults and its browser-saved choices. It SHALL reach only playground runs and a loaded template's first run. In a playground run, the build kit's choice SHALL apply to a tool that is in both the build kit and the Agenta tools. Outside the playground, only the Agenta tools settings SHALL apply.

#### Scenario: Build kit contents
- **WHEN** the playground fetches the build kit
- **THEN** the list SHALL include every tool it includes today, among them `commit_revision`, `read_config`, `get_current_session` and `rename_session`.

#### Scenario: Agenta tool off, build kit on
- **WHEN** `rename_session` is `off` in the Agenta tools and on in the build kit
- **THEN** a playground run SHALL offer `rename_session`, and a Slack run SHALL NOT.

#### Scenario: Slack run
- **WHEN** an agent runs in a Slack thread
- **THEN** the run SHALL NOT offer a build kit tool unless it is also an Agenta tool that is on, or the author listed it.
