# Slack agent addresses delta

## Purpose

Give each deployed agent a native Slack address while keeping group ownership, retry behavior, and removal safe within a shared installation.

## ADDED Requirements

### Requirement: Managed address ownership
A native deployment SHALL own at most one managed user-group address per agent and Slack team. Each external group ID SHALL map to only one agent in its installation and team. Agenta SHALL record the immutable ID, handle, ownership, and lifecycle state. Address APIs SHALL enforce project and connection ownership on reads and writes.

#### Scenario: Create an address
- **WHEN** an authorized editor deploys an eligible agent with an available handle
- **THEN** Agenta SHALL create a user group, verify it by reading it back, and activate its mapping only after that verification succeeds.

#### Scenario: Cross-project mutation
- **WHEN** an editor from another project submits the address, connection, or agent ID
- **THEN** Agenta SHALL refuse access without modifying the group or revealing its profile.

### Requirement: Collision and ownership protection
Agenta SHALL NOT adopt, rename, disable, or change membership of an unrelated Slack user group. A conflicting name or handle SHALL leave the deployment non-active and request another value. Matching a handle alone SHALL NOT prove ownership.

#### Scenario: Handle is already taken
- **WHEN** Slack reports that the requested handle or group name conflicts
- **THEN** Agenta SHALL show the collision without modifying the existing object.

#### Scenario: Owner changes handle
- **WHEN** an authorized editor renames a verified managed group
- **THEN** Agenta SHALL retain its immutable routing ID and verify the updated handle before reporting success.

### Requirement: Recoverable provisioning
Agenta SHALL expose pending, active, failed, pending-disable, and disabled states. Duplicate requests SHALL reuse one operation. A timed-out create with an unknown outcome SHALL NOT be blindly repeated or claim an existing group by name. Only positive evidence of the operation's group ID and ownership SHALL permit automatic recovery; otherwise the deployment SHALL remain blocked for operator review. Rate-limited operations SHALL respect Slack's retry guidance.

#### Scenario: Response is lost after creation
- **WHEN** Slack may have created a group but Agenta has no verified receipt
- **THEN** Agenta SHALL report an unresolved outcome and SHALL NOT create another group automatically.

#### Scenario: Rate limit
- **WHEN** Slack returns a rate limit and a retry delay
- **THEN** Agenta SHALL retain the operation state and defer its retry for at least that delay.

#### Scenario: Verification fails after a successful create receipt
- **WHEN** Agenta has the created group ID but cannot read it back
- **THEN** it SHALL retain that ID for verification retry without exposing the address as active or issuing another create.

### Requirement: Safe user-group membership
Agenta SHALL create agent groups without adding humans, guests, or bots as members and without assigning default channels. Native deployment SHALL remain disabled for rollout unless a live workspace test proves that this produces usable native mentions without human notifications. Agenta SHALL NOT attempt to clear an existing group's membership through an empty membership update. Detected human membership SHALL suspend that address and warn the operator without editing those members.

#### Scenario: New managed group
- **WHEN** Agenta provisions an agent address
- **THEN** it SHALL create no human subscriptions or default channel memberships.

#### Scenario: Human members are added outside Agenta
- **WHEN** reconciliation detects human membership in a managed agent group
- **THEN** Agenta SHALL suspend native routing for it and warn that Slack mentions can notify those members until the operator resolves the drift.

### Requirement: Safe removal and drift handling
Removing a deployment SHALL stop routing locally before attempting to disable its managed group. Agenta SHALL retain ownership and disabled-address records so old mentions cannot fall back to another agent. Failed disablement SHALL remain visible and retryable. Reconciliation SHALL suspend addresses whose group is missing or externally disabled and refresh renamed handles by ID. It SHALL NOT automatically recreate or re-enable externally disabled groups.

#### Scenario: Slack disable call fails
- **WHEN** an agent is removed but Slack cannot disable its group
- **THEN** Agenta SHALL keep local routing disabled, show pending cleanup, and preserve other deployments.

#### Scenario: Group is disabled externally
- **WHEN** a managed group's disabled state is observed
- **THEN** Agenta SHALL suspend its native address until an editor explicitly requests recovery.

#### Scenario: Same handle is reused by an unrelated group
- **WHEN** a removed agent's handle later belongs to another Slack group ID
- **THEN** Agenta SHALL NOT route the new group to the removed agent or claim it automatically.
