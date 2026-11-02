# Slack installation

## Purpose

Describe installation ownership and access checks in the reviewed channels stack. This baseline records PR #6737 at `658d6f5edae34d861d141a38604ef7a12a7b69c8`, not released behavior. See [source evidence](../../evidence.md).

## Requirements

### Requirement: Shared installation ownership
Agenta SHALL represent a Slack installation with a channel connection identified by the app ID and the workspace or enterprise discriminator. It SHALL permit several channel agents in that connection, with distinct connection-scoped slugs and at most one connection default. The installation key SHALL belong to only one Agenta project.

#### Scenario: Multiple backend agents
- **WHEN** two channel agents with distinct slugs reference the same connection
- **THEN** they SHALL share the installation without requiring separate Slack apps.

#### Scenario: Installation already belongs to another project
- **WHEN** another project attempts to store the same Slack installation key
- **THEN** the global connection uniqueness constraint SHALL prevent duplicate ownership.

### Requirement: Slack scope configuration
The hosted authorization request and customer-owned app manifest SHALL share the `SLACK_BOT_SCOPES` list. The baseline list SHALL contain `chat:write` and the channel, group, direct-message, and multi-party history and read scopes. It SHALL NOT request `usergroups:read`, `usergroups:write`, or `chat:write.customize`.

#### Scenario: Generate setup configuration
- **WHEN** Agenta generates a Slack manifest or hosted authorization URL
- **THEN** both SHALL use the shared scope list without agent-specific user-group or sender-customization scopes.

### Requirement: Connection and grant checks
Agenta SHALL verify the Slack request signature before processing the event. Agent resolution SHALL reject inactive, archived, or unverified connections, disallowed senders, inactive spaces, and inactive or archived agents. A matching deny grant SHALL take precedence. An agent with no grants SHALL be unrestricted by grants; an agent with grants but no matching allow SHALL be refused.

#### Scenario: Mention cannot override access
- **WHEN** an event names an agent but the sender is excluded by the connection allow-list or a matching grant denies access
- **THEN** Agenta SHALL refuse to run that agent.

#### Scenario: No grants exist
- **WHEN** a valid agent has no grants and all other checks pass
- **THEN** resolution SHALL permit that agent subject to the effective message policy.

#### Scenario: Invalid signature
- **WHEN** a Slack request fails signature verification
- **THEN** Agenta SHALL reject the request rather than trusting its claimed workspace or sender.
