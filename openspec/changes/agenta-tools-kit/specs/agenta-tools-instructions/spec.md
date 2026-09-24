# Agenta tools instructions delta

## Purpose

Make the platform instructions describe exactly the Agenta tools a run has, in every run that has them.

## ADDED Requirements

### Requirement: Automation guidance follows the automation tools
The platform instructions SHALL include the automation guidance (what schedules and subscriptions are, and how to set up an automation) when the run offers `create_schedule` or `create_subscription`, whether or not the run offers `commit_revision`. They SHALL NOT include it when the run offers neither tool. The configuration guidance SHALL still follow `commit_revision`.

#### Scenario: Slack run with automation tools
- **WHEN** a Slack run offers `create_schedule` and not `commit_revision`
- **THEN** the instructions SHALL contain the automation guidance and SHALL NOT contain the configuration guidance.

#### Scenario: Automation run
- **WHEN** an automation run offers no create tool
- **THEN** the instructions SHALL NOT contain the automation guidance.

### Requirement: The agent is told where scheduled results go
The automation guidance SHALL say that a scheduled or subscribed run starts a new Agenta session and does not answer in the chat thread that set it up. When the run also offers `send_channel_message`, it SHALL tell the agent to write the destination into the scheduled task so that the scheduled run posts there. Otherwise it SHALL tell the agent to say where the results will appear.

#### Scenario: Reminder from Slack
- **WHEN** someone in Slack asks the agent to "remind the team every Monday" and the run offers both `create_schedule` and `send_channel_message`
- **THEN** the instructions SHALL tell the agent to include the team channel's destination in the scheduled task.

#### Scenario: No channel tools
- **WHEN** the run offers `create_schedule` and no channel tool
- **THEN** the instructions SHALL tell the agent to tell the person where the results will appear.

### Requirement: Channel guidance follows the channel tools
The platform instructions SHALL include a short channel section when the run offers `send_channel_message`. It SHALL tell the agent to find destinations with `list_channel_destinations` and never to invent one.

#### Scenario: Connected agent
- **WHEN** a run offers `send_channel_message`
- **THEN** the instructions SHALL contain the channel section.

#### Scenario: Unconnected agent
- **WHEN** a run offers no channel tool
- **THEN** the instructions SHALL NOT contain the channel section.
