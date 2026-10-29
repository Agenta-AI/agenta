# Slack agent routing

## Purpose

Describe how the reviewed stack selects an agent from Slack input. This baseline records PR #6737 at `658d6f5edae34d861d141a38604ef7a12a7b69c8`. Selection and permission to start a turn are separate checks. See [source evidence](../../evidence.md).

## Requirements

### Requirement: Explicit agent addressing
The Slack adapter SHALL recognize the Agenta `~slug` syntax as explicit agent addressing. It SHALL mark messages with that syntax or Slack `app_mention` events as addressed. It SHALL NOT interpret a Slack user-group mention as an agent address.

#### Scenario: Legacy slug
- **WHEN** a human message contains `~triage`
- **THEN** the adapter SHALL mark it as addressed and core SHALL resolve `triage` within the receiving connection when explicit addressing is reached.

#### Scenario: Native group mention alone
- **WHEN** a message contains only a Slack user-group mention as its addressing syntax
- **THEN** the adapter SHALL NOT mark it addressed on the strength of that mention or select an agent by the group's ID.

### Requirement: Agent selection precedence
Core SHALL first resolve a matching pending-choice answer, then an existing active conversation, then explicit slug addressing, then the space default grant, then the connection default. An explicit slug SHALL bypass the existing-conversation lookup. An unknown explicit slug SHALL NOT fall back to a default.

#### Scenario: Reply continues a specialist conversation
- **WHEN** a message has no explicit slug, matches no pending choice, and belongs to an active specialist conversation
- **THEN** core SHALL select that specialist rather than the connection default.

#### Scenario: Slug switches the conversation agent
- **WHEN** a message names `~research`, matches no pending choice, and an active conversation belongs to another agent
- **THEN** core SHALL bypass that conversation's agent and resolve `research` in the connection.

#### Scenario: Unknown explicit slug
- **WHEN** explicit addressing is reached and the named slug does not exist
- **THEN** core SHALL return no agent rather than silently choose a default.

#### Scenario: Pending choice answer
- **WHEN** a message resolves a pending choice in the conversation
- **THEN** core SHALL select the agent holding that choice before the ordinary conversation or default lookup.

### Requirement: Human input and bot echo filtering
The Slack adapter SHALL ignore bot-authored messages, message edits, message deletions, and unsupported system subtypes before creating normalized user input.

#### Scenario: Progress message is edited
- **WHEN** Slack delivers `message_changed` for the app's progress message
- **THEN** the adapter SHALL discard it rather than start another turn.
