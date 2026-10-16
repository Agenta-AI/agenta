## ADDED Requirements

### Requirement: Stable agent policy
The system SHALL store agent visibility separately from ownership at the stable workflow artifact and SHALL require active project membership and the applicable project capability.

#### Scenario: Private agent
- **WHEN** Bob requests Alice's private agent without ownership
- **THEN** the service SHALL deny access through lists, artifact, variant, revision, template, clone, skill, and file paths.

#### Scenario: Project agent
- **WHEN** an active member has the required project capability and the agent is project-visible
- **THEN** the service SHALL allow the corresponding use or edit operation.

#### Scenario: Policy row protection
- **WHEN** a private artifact is edited through a generic workflow update
- **THEN** the update SHALL NOT remove or bypass its agent access policy.

### Requirement: Change visibility in both directions
The system SHALL support changing project visibility to private and private visibility to project without moving the artifact, versions, or files.

#### Scenario: Make private
- **WHEN** an authorized sharing manager confirms an active private owner
- **THEN** the service SHALL update owner and visibility atomically, pause external installations, and deny future use by other members.

#### Scenario: Old web conversation
- **WHEN** Bob retains session read access after Alice makes its agent private
- **THEN** Bob SHALL still read that web history but SHALL NOT invoke the private agent.

#### Scenario: Make shared again
- **WHEN** the owner makes the agent project-visible
- **THEN** authorized project members SHALL regain agent access and paused external installations SHALL remain paused until explicitly enabled.

#### Scenario: Transfer without credentials
- **WHEN** an authorized user transfers agent management
- **THEN** the operation SHALL NOT transfer credentials and SHALL validate the configured connection authority.

### Requirement: Private default for new agent UI
New agent UI creation SHALL explicitly request private access with the authenticated owner while legacy creation clients retain documented project defaults.

#### Scenario: New UI agent
- **WHEN** Alice creates an agent in the updated UI
- **THEN** the agent SHALL be private to Alice subject to active membership and capabilities.

#### Scenario: Legacy SDK
- **WHEN** an existing client omits access policy
- **THEN** creation SHALL preserve its previous project-visible behavior and SHALL NOT silently privatize a prompt or evaluator.
