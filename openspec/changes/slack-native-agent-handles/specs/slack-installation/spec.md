# Slack installation delta

## MODIFIED Requirements

### Requirement: Slack scope configuration
The hosted authorization request and customer-owned app manifest SHALL share one scope list. They SHALL retain the existing messaging and read scopes and request `usergroups:read`, `usergroups:write`, and `chat:write.customize` for native agent deployment. Agenta SHALL assess granted scopes rather than assume that existing tokens acquired new permissions.

#### Scenario: Generate setup configuration
- **WHEN** Agenta generates the new Slack manifest or hosted authorization URL
- **THEN** both SHALL request the same scope set, including the three native-deployment scopes.

#### Scenario: Existing token lacks scopes
- **WHEN** an existing installation has not granted the additional scopes
- **THEN** Agenta SHALL retain legacy routing and show reauthorization as a prerequisite for native deployment.

## ADDED Requirements

### Requirement: Native deployment eligibility
Native deployment SHALL require a workspace-level installation, supported Slack plan, required granted scopes, and permission to manage user groups with the installation's bot token. Agenta SHALL expose specific blockers without replacing credentials with a user token or changing workspace permissions automatically. Existing Enterprise Grid installations SHALL retain their legacy behavior.

#### Scenario: Workspace restricts group management
- **WHEN** Slack refuses group creation because of workspace permissions
- **THEN** deployment SHALL show the permission blocker and remain non-active without creating a second installation.

#### Scenario: Free workspace or organization installation
- **WHEN** the workspace lacks user groups or the connection uses an organization-level installation
- **THEN** native deployment SHALL be unavailable and legacy connection behavior SHALL remain available.

### Requirement: Reauthorization preserves ownership
Reauthorizing the same Slack installation SHALL preserve its connection ID, project ownership, agents, grants, and conversations. A callback identifying a different installation SHALL NOT silently replace the existing installation.

#### Scenario: Add missing scopes
- **WHEN** an administrator grants the new scopes for the same installation
- **THEN** Agenta SHALL update the existing installation credentials and capability state without moving or recreating its agents.

#### Scenario: Wrong workspace is authorized
- **WHEN** a reauthorization callback identifies a different Slack workspace or app
- **THEN** Agenta SHALL refuse to apply it to the connection being upgraded.
