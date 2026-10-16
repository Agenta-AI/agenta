## ADDED Requirements

### Requirement: Slack audience without account linking
Agenta read access to a Slack session SHALL follow its original workflow artifact audience, without Slack user linking or membership copying.

#### Scenario: Project agent Slack history
- **WHEN** a project member can use the project-visible associated agent
- **THEN** the member SHALL read its Slack sessions in Agenta, including direct-message sessions, under the disclosed audience rule.

#### Scenario: Rebinding
- **WHEN** a binding changes to a different agent
- **THEN** new sessions SHALL use the new artifact and existing sessions SHALL retain their immutable artifact parent.

#### Scenario: Deleted binding
- **WHEN** a channel agent binding is deleted
- **THEN** historical access SHALL resolve the stored artifact rather than requiring the deleted binding.

#### Scenario: Private parent
- **WHEN** the original artifact becomes private
- **THEN** Agenta readers SHALL follow its private audience and the external installation SHALL pause.

### Requirement: Bounded channel execution
The channel service SHALL derive execution authority from the verified installation and allowed space. It SHALL preserve the external sender identity and SHALL NOT grant general creator authority.

#### Scenario: Allowed Slack event
- **WHEN** a verified sender in an allowed space invokes the configured agent
- **THEN** the service SHALL use the configured agent-owned account without requiring a linked Agenta identity.

#### Scenario: Administrative request
- **WHEN** an external sender requests a tool beyond installation authority
- **THEN** the service SHALL deny the operation even if a technical creator ID is present.

#### Scenario: Unlinked approval
- **WHEN** a Slack response is offered for an action requiring an Agenta approval role
- **THEN** the service SHALL NOT treat that sender as the creator or as an authenticated Agenta approver.

#### Scenario: Disconnect
- **WHEN** a connection is disabled
- **THEN** new external requests SHALL stop and the historical artifact association SHALL remain intact.
