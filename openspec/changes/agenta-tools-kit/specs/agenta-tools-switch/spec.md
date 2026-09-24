# Agenta tools switch delta

## Purpose

Let an author turn the Agenta tools off, all at once or one at a time, and save that choice on the agent so it applies to production runs.

## ADDED Requirements

### Requirement: The switch is saved in the agent configuration
The agent configuration SHALL accept an optional `agenta_tools` block with `enabled` (a boolean) and `disabled_tools` (a list of tool names). The block SHALL be committed with the revision like any other setting. When the block is missing, `enabled` SHALL mean true and `disabled_tools` SHALL mean empty. When `enabled` is false, Agenta SHALL add no Agenta tool. A tool named in `disabled_tools` SHALL NOT be added. An unknown name in `disabled_tools` SHALL be ignored. The switch SHALL NOT remove an entry the author wrote in `tools`.

#### Scenario: Existing agent without the block
- **WHEN** an agent saved before this change runs in Slack
- **THEN** every Agenta tool allowed for that run SHALL be offered.

#### Scenario: Kit off
- **WHEN** the saved configuration has `agenta_tools.enabled` set to false
- **THEN** no Agenta tool SHALL be offered in any run of that revision.

#### Scenario: One tool off
- **WHEN** `disabled_tools` contains `create_subscription`
- **THEN** every run SHALL offer the other Agenta tools and SHALL NOT offer `create_subscription`.

#### Scenario: Deployed revision
- **WHEN** revision 4 turns `create_schedule` off and production still runs revision 3
- **THEN** production runs SHALL still offer `create_schedule` until revision 4 is deployed.

#### Scenario: Unknown name
- **WHEN** `disabled_tools` contains a name that is not in the kit
- **THEN** the run SHALL start normally and ignore that name.

### Requirement: The tools themselves are never committed
Agenta SHALL NOT write any Agenta tool into a saved configuration. The static workflow that lists the kit SHALL NOT be embeddable, and a commit that embeds it SHALL be refused.

#### Scenario: Commit after a playground run
- **WHEN** an author runs the agent in the playground and then commits
- **THEN** the committed `tools` list SHALL contain only the author's own entries.

#### Scenario: Embedding the kit
- **WHEN** a commit embeds `__ag__agenta_tools`
- **THEN** the commit SHALL be refused as a non-embeddable reference.

### Requirement: The playground shows and edits the switch
The agent configuration drawer, in the classic playground and in `/m`, SHALL show an Agenta tools block next to the build kit. The block SHALL list every Agenta tool as a read-only row with its name, a short description, its default permission, and a switch, under one master switch. Changing a switch SHALL edit the draft configuration and mark it unsaved. A row whose tool the author also listed in `tools` SHALL say so and SHALL NOT show a switch. Channel tool rows SHALL say that they are active only when the agent is connected to Slack or Telegram. The build kit block SHALL NOT list the moved tools.

#### Scenario: Turning a tool off
- **WHEN** an author switches off `create_subscription` in the Agenta tools block
- **THEN** the draft SHALL show unsaved changes, and after commit the saved configuration SHALL contain `agenta_tools.disabled_tools: ["create_subscription"]`.

#### Scenario: Playground run before commit
- **WHEN** an author switches a tool off and runs the draft without committing
- **THEN** the playground run SHALL NOT offer that tool, and production runs SHALL still offer it.

#### Scenario: Author already listed the tool
- **WHEN** the author's `tools` list contains `create_schedule`
- **THEN** the `create_schedule` row SHALL show "Set in your tools" and no switch.

#### Scenario: Agent without a bot
- **WHEN** the agent is not connected to any bot
- **THEN** the four channel rows SHALL show that they become active when a bot is connected.
