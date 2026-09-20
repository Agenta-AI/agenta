# Template first message

## Purpose

Deliver the remaining setup work to the created agent in an ordinary first message, without a separate installation lifecycle.

## ADDED Requirements

### Requirement: Setup context in the message

The first message SHALL include the template setup instructions, unresolved connection needs, retained user choices, and automation recipes still to configure. Package content MUST be labeled as template-supplied text and MUST NOT become platform system instructions.

#### Scenario: Setup supplied

- **WHEN** a package has SETUP.md, optional notes, and an automation recipe
- **THEN** one normal first message carries those instructions and pending actions without requiring an installation-read tool.

#### Scenario: No setup supplied

- **WHEN** setup instructions and recipes are absent
- **THEN** the existing first-message behavior remains valid without fabricated requirements.

### Requirement: Use existing self-configuration

The agent SHALL continue setup with the existing configuration, discovery, connection, file, verification, and automation tools. This change MUST NOT introduce template-specific setup tools.

#### Scenario: Continue setup

- **WHEN** the agent needs a user fact, connection, or schedule after the first message
- **THEN** the existing tools handle it with their existing authorization and approval behavior.

### Requirement: Loading ends at handoff

The loader SHALL finish its responsibility when the first message is durably accepted. It MUST NOT track conversational setup status or gate ordinary runs on a template readiness state.

#### Scenario: Unfinished optional work

- **WHEN** the first message is accepted but the agent has not yet configured an optional automation
- **THEN** loading is complete and the remaining work belongs to the ordinary conversation.

### Requirement: No automatic trigger activation

Loading a template MUST NOT activate schedules or subscriptions. Subsequent activation SHALL use existing agent tools and approval controls.

#### Scenario: Automation recipe

- **WHEN** a package includes a weekday schedule
- **THEN** the first message carries the recipe but no active trigger is created by the loader.

#### Scenario: User declines

- **WHEN** the user declines the proposed schedule during conversation
- **THEN** the agent leaves it inactive and does not treat that choice as a loading failure.

### Requirement: One first message

The session service SHALL atomically deduplicate the first message by session-scoped key and stable payload fingerprint. Replays SHALL return the original input or result; changed content under the same key MUST conflict.

#### Scenario: Idle session replay

- **WHEN** an idle first-message request is retried after timeout or browser refresh
- **THEN** exactly one input is accepted and the original input/result is returned.

#### Scenario: Two tabs

- **WHEN** two tabs submit the same first message concurrently
- **THEN** one transcript message is appended and the other request returns its identity.

#### Scenario: Changed message

- **WHEN** the same delivery key is submitted with different setup text
- **THEN** the service rejects the conflicting payload instead of appending another message.

### Requirement: No secret disclosure

The first message and resource provenance MUST contain no credential values.

#### Scenario: Authenticated MCP

- **WHEN** an endpoint has an API key or OAuth token
- **THEN** the first message identifies the connection need or public reference but does not contain the credential value.
