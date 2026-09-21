# Channel message scheduling delta

## Purpose

Support exact one-time channel deliveries and recurring generated messages without placing timing or approval logic inside provider adapters.

## ADDED Requirements

### Requirement: Exact one-time message schedule
`schedule_channel_message` SHALL accept an opaque authorized destination, exact text content, an optional destination thread reference, and an RFC 3339 delivery time with an explicit offset. Agenta SHALL store a durable delivery intent and return its stable ID and normalized UTC delivery time. The provider adapter SHALL NOT own or interpret the schedule.

#### Scenario: Schedule an exact message
- **WHEN** an agent receives approval to send fixed text at a future time
- **THEN** Agenta SHALL persist that exact content and enqueue it for delivery at or after the normalized UTC time without invoking the model again.

#### Scenario: Time has no offset
- **WHEN** a scheduling call supplies a local date and time without an offset
- **THEN** Agenta SHALL reject it instead of guessing a timezone.

#### Scenario: Time is already past
- **WHEN** a scheduling call supplies a delivery time outside the accepted clock-skew window
- **THEN** Agenta SHALL reject it and SHALL NOT convert it into an immediate send.

### Requirement: Scheduled-message visibility and cancellation
A running agent with the scheduling tool SHALL be able to list its own pending exact-message schedules and cancel one before delivery starts. The service SHALL scope listing and cancellation to the authenticated project and bound running agent. Cancellation SHALL be idempotent and SHALL NOT claim to recall a message already acknowledged by the provider.

#### Scenario: Cancel a pending message
- **WHEN** the owning agent cancels a scheduled delivery before the worker claims it
- **THEN** Agenta SHALL mark it cancelled and SHALL NOT call the provider.

#### Scenario: Cancel after provider acknowledgement
- **WHEN** cancellation arrives after the message is sent
- **THEN** Agenta SHALL report the sent state and SHALL NOT claim that the external message was removed.

#### Scenario: Another agent attempts cancellation
- **WHEN** an agent supplies a scheduled-message ID owned by another agent or project
- **THEN** Agenta SHALL refuse the request without revealing its content or destination.

### Requirement: Delivery-time authorization
Agenta SHALL re-check the active deployment, connection, destination, installation capability, and proactive-send or direct-message grant when an exact schedule becomes due. Approval to create the schedule SHALL NOT prevent a later revocation from blocking delivery.

#### Scenario: Destination access is revoked before due time
- **WHEN** an editor removes the required destination grant after scheduling but before delivery
- **THEN** Agenta SHALL mark the delivery blocked and SHALL NOT call Slack or Telegram.

#### Scenario: Installation loses a required scope
- **WHEN** the provider credential no longer has the scope needed at delivery time
- **THEN** Agenta SHALL retain a sanitized blocked result and SHALL NOT switch to another installation.

### Requirement: Due delivery is idempotent
The scheduling service and delivery worker SHALL use the stored delivery identity so retries create at most one Channels delivery attempt record for one due intent. Agenta SHALL preserve the provider-specific unknown-outcome rule when a post receipt is lost.

#### Scenario: Scheduler fires twice
- **WHEN** the due event is delivered more than once
- **THEN** Channels SHALL claim one intent and SHALL NOT enqueue two independent messages.

### Requirement: Recurring generated messages use agent schedules
Recurring messages whose content must be generated at run time SHALL use Agenta's existing agent scheduler to start the configured workflow. The scheduled run MAY then call `send_channel_message` under its current tool and Channels permissions. Channel adapters SHALL NOT implement cron parsing or invoke agents.

#### Scenario: Weekly generated report
- **WHEN** an editor approves a weekly agent schedule whose instructions generate a current report
- **THEN** the scheduler SHALL run the agent at each occurrence and the agent SHALL use the ordinary send tool for any resulting channel delivery.

#### Scenario: Scheduled run cannot obtain write approval
- **WHEN** the send tool still requires an interactive approval that no person can answer during the scheduled run
- **THEN** the run SHALL not bypass the tool decision or post the message; configuration SHALL make this limitation visible before activation.

### Requirement: Schedule creation is a write
Creating or cancelling an exact-message schedule and creating a recurring agent schedule SHALL use write permission handling. Read-only destination listing, schedule listing, and message search SHALL NOT authorize those writes.

#### Scenario: Read-only agent attempts to schedule
- **WHEN** an agent can list destinations but its scheduling tool is absent or denied
- **THEN** it SHALL NOT create a future delivery.
