## ADDED Requirements

### Requirement: Channel sessions are project-visible and ownerless
A Slack session SHALL be project-visible with no owner, also when the Slack sender is a linked Agenta user. This rule SHALL take precedence over the general ownership rule. Members with `VIEW_SESSIONS` SHALL read Slack sessions in Agenta, including direct messages with the bot. The installation setup screen SHALL state this audience.

#### Scenario: Linked Slack sender
- **WHEN** Alice, a linked Slack user, starts a thread with the installed agent
- **THEN** the session has no owner, Alice is the turn sender only, and members can read the session in Agenta without sending

### Requirement: Only project-visible agents run in Slack
A channel agent SHALL be active only when its agent is project-visible. Making the agent private SHALL make inactive, in the same transaction, every channel agent whose references name the agent by artifact id or slug or by the id of one of its variants or revisions. Making it project-visible again SHALL NOT reactivate them. A channel turn SHALL check the agent at admission.

#### Scenario: Agent made private
- **WHEN** Alice makes an installed agent private
- **THEN** new Slack messages get no agent turn, and the stored history stays

#### Scenario: Install a private agent
- **WHEN** a member activates a channel agent for a private agent
- **THEN** the service rejects the request

### Requirement: Channel activation is serialized with make-private
Activating a channel agent SHALL lock the artifact row, read its current policy without a cache, and write the channel agent in the same transaction. Channel references in the `workflow` and the `application` families SHALL both be resolved; references that name no agent SHALL be refused.

#### Scenario: Activation races with make-private
- **WHEN** a member activates a channel agent while the owner makes the agent private
- **THEN** either the activation is rejected, or it commits first and the make-private transaction deactivates it; no active channel agent for a private agent remains

#### Scenario: Application-family reference
- **WHEN** a channel agent names its agent by `application_revision`
- **THEN** the reference is resolved to the agent and its policy is checked
