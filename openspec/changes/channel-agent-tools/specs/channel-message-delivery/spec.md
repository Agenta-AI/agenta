# Channel message delivery delta

## Purpose

Let an authorized agent send durable Slack and Telegram messages outside an originating thread while preserving destination policy, identity, and delivery evidence.

## ADDED Requirements

### Requirement: Proactive delivery without an inbound thread
`send_channel_message` SHALL accept an opaque authorized destination, text content, and an optional destination thread reference. Agenta SHALL create a durable delivery intent before it calls the provider. The send SHALL NOT require an inbound event, an existing `ChannelThread`, or a channel-linked source session.

#### Scenario: Send from Agenta chat to Slack
- **WHEN** a connected agent sends approved text to an authorized Slack channel from an Agenta chat session
- **THEN** Agenta SHALL create a delivery intent and post it through that connection without fabricating an inbound thread.

#### Scenario: Send to an existing destination thread
- **WHEN** the agent supplies a valid opaque thread reference for an authorized destination
- **THEN** Agenta SHALL post in that thread without accepting a raw provider timestamp or message ID from the model.

### Requirement: Durable status and receipts
An accepted delivery SHALL return a stable delivery ID and a state. Agenta SHALL retain the requested content, authorized destination reference, attempt history, sanitized provider failures, and external receipt. The observable states SHALL distinguish queued, sending, sent, failed, blocked, and cancelled outcomes. Agenta SHALL NOT report sent before the provider acknowledges the message.

#### Scenario: Provider accepts the message
- **WHEN** Slack or Telegram acknowledges the post
- **THEN** Agenta SHALL mark the delivery sent and retain the provider receipt needed for later inspection or update.

#### Scenario: Provider rejects the message
- **WHEN** the provider returns a terminal permission or destination error
- **THEN** Agenta SHALL mark the delivery failed or blocked, preserve a sanitized reason, and SHALL NOT claim success.

### Requirement: Stable invocation idempotency
The runner SHALL attach a server-generated tool invocation identity that remains stable across retries of one tool dispatch and is hidden from model input. The Channels service SHALL create at most one delivery intent for the same project, running agent, operation, and invocation identity. A retry SHALL return the existing delivery state. Agenta SHALL document provider-specific duplicate risk when the provider accepted a post but its receipt was lost.

#### Scenario: HTTP response is lost after intent creation
- **WHEN** the runner retries the same send call after losing the first Agenta response
- **THEN** the Channels service SHALL return the existing delivery rather than enqueue another one.

#### Scenario: Slack receipt is lost after posting
- **WHEN** Slack may have accepted a message but Agenta did not retain its receipt
- **THEN** Agenta SHALL expose an unknown delivery outcome and SHALL NOT claim exactly-once delivery.

### Requirement: Authorization is checked again before delivery
Agenta SHALL re-check the project, running channel-agent deployment, connection state, destination state, and required Channels action immediately before an external post. Revocation after enqueue and before provider delivery SHALL block the post.

#### Scenario: Grant is revoked while queued
- **WHEN** an editor removes proactive-send permission before the worker claims the delivery
- **THEN** Agenta SHALL mark it blocked without calling Slack or Telegram.

#### Scenario: Connection credential is revoked
- **WHEN** the provider credential becomes invalid before posting
- **THEN** Agenta SHALL stop delivery, retain the sanitized failure, and SHALL NOT try another project's or another connection's credential.

### Requirement: Trusted sender identity
The server SHALL derive the provider sender profile from the authorized channel-agent deployment. Prompts and tool arguments SHALL NOT override the sender name, avatar, bot token, or installation. Where Slack customized identity is enabled, proactive messages SHALL follow the same trusted deployment profile rules as channel replies.

#### Scenario: Prompt requests another identity
- **WHEN** model output includes a name or avatar field that is not in the send tool schema
- **THEN** Agenta SHALL reject or ignore that field and use only the trusted deployment profile.

### Requirement: Private direct-message continuity
A first proactive direct message SHALL create or select a private channel session for the running agent and recipient. It SHALL NOT move, expose, or reuse a shared source session. A later reply from that recipient SHALL route to the private channel session, subject to current grants and agent state.

#### Scenario: Channel conversation starts a Slack direct message
- **WHEN** an agent in a shared channel sends an authorized direct message to a recipient
- **THEN** the outbound text SHALL be delivered through a separate private channel session without copying the shared session history.

#### Scenario: Recipient replies
- **WHEN** the recipient replies in the resulting direct conversation
- **THEN** Agenta SHALL continue the private channel session rather than attach the reply to the source channel session.

### Requirement: Direct-message recipients require explicit authority
A direct-message send SHALL use an existing or explicitly authorized recipient destination. The model SHALL NOT supply an arbitrary Slack user ID, Telegram chat ID, email address, or username to create authority. Slack initiation SHALL require the installation scope and API operation needed to open or use the direct conversation.

#### Scenario: Arbitrary Slack user ID
- **WHEN** a model attempts to send to a raw Slack user ID that has no authorized destination
- **THEN** Agenta SHALL reject the call before invoking Slack.

#### Scenario: Recipient belongs to another project installation
- **WHEN** a destination token resolves only under another project or installation
- **THEN** Agenta SHALL refuse the send without revealing that recipient's identity.
