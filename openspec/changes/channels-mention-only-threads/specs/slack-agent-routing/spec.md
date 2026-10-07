# Slack agent routing delta

## Purpose

Separate agent selection from turn admission: a held thread picks the agent for an addressed message, and no longer admits an unaddressed one.

## MODIFIED Requirements

### Requirement: Agent selection precedence
Core SHALL first resolve a matching pending-choice answer, then an existing active conversation, then explicit slug addressing, then the space default grant, then the connection default. An explicit slug SHALL bypass the existing-conversation lookup. An unknown explicit slug SHALL NOT fall back to a default. Selecting an agent SHALL NOT by itself start a turn: the message must also pass the turn trigger rules.

#### Scenario: Reply continues a specialist conversation
- **WHEN** a reply mentions the bot, has no explicit slug, matches no pending choice, and belongs to an active specialist conversation
- **THEN** core SHALL select that specialist rather than the connection default.

#### Scenario: Unaddressed reply in a specialist conversation
- **WHEN** a message in a channel thread has no mention, no slug, no command, matches no pending choice, and belongs to an active specialist conversation
- **THEN** core SHALL store the message and SHALL NOT start a turn.

#### Scenario: Slug switches the conversation agent
- **WHEN** a message names `~research`, matches no pending choice, and an active conversation belongs to another agent
- **THEN** core SHALL bypass that conversation's agent and resolve `research` in the connection.

#### Scenario: Unknown explicit slug
- **WHEN** explicit addressing is reached and the named slug does not exist
- **THEN** core SHALL return no agent rather than silently choose a default.

#### Scenario: Pending choice answer
- **WHEN** a message resolves a pending choice in the conversation
- **THEN** core SHALL select the agent holding that choice before the ordinary conversation or default lookup.
