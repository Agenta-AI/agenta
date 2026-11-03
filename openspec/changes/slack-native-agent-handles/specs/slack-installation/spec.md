# Slack installation delta

## MODIFIED Requirements

### Requirement: Slack scope configuration
The hosted authorization request and customer-owned app manifest SHALL share the complete scope set required for messaging, native user-group addressing, and customized replies. That set SHALL include `usergroups:read`, `usergroups:write`, and `chat:write.customize`. Agenta SHALL verify granted permissions before activating a deployment.

#### Scenario: Generate setup configuration
- **WHEN** Agenta generates the Slack manifest or hosted authorization URL
- **THEN** both SHALL request the final required scope set without an intermediate old-scope installation mode.

#### Scenario: Token lacks required permissions
- **WHEN** setup receives a token without required permissions
- **THEN** Agenta SHALL block deployment and explain how to complete authorization rather than enable a backward-compatible mode.

## ADDED Requirements

### Requirement: Native deployment eligibility
Native deployment SHALL require a workspace-level installation, supported Slack plan, required granted scopes, and permission to manage user groups with the installation's bot token. Agenta SHALL expose specific blockers without replacing credentials with a user token or changing workspace permissions automatically.

#### Scenario: Workspace restricts group management
- **WHEN** Slack refuses group creation because of workspace permissions
- **THEN** deployment SHALL show the permission blocker and remain non-active without creating a second installation.

#### Scenario: Free workspace or organization installation
- **WHEN** the workspace lacks user groups or the connection uses an organization-level installation
- **THEN** native deployment SHALL be unavailable and setup SHALL explain the unsupported configuration without promising an alternative mode.

### Requirement: Installation identity verification
Agenta SHALL bind an installation only to the project and Slack identity authorized by its setup flow. An authorization callback for a different workspace or app SHALL NOT silently overwrite a selected connection.

#### Scenario: Correct installation
- **WHEN** an authenticated setup flow completes with the expected Slack identity and required permissions
- **THEN** Agenta SHALL bind that installation to the authorized project.

#### Scenario: Wrong workspace is authorized
- **WHEN** a callback identifies a different Slack workspace or app from the connection being configured
- **THEN** Agenta SHALL refuse to overwrite that connection.
