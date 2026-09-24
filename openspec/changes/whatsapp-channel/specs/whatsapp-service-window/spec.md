# WhatsApp service window

## Purpose

Keep every outbound message inside Meta's 24-hour customer service window and consent rules, and make any reply that cannot be sent visible to the operator.

## ADDED Requirements

### Requirement: Window tracking
Agenta SHALL record, per WhatsApp conversation, the time of the customer's last inbound message. A conversation's window SHALL be open for 24 hours after that time.

#### Scenario: Customer writes again
- **WHEN** a customer sends a message 30 hours after the previous one
- **THEN** the window SHALL reopen for 24 hours from the new message

### Requirement: Hold replies after the window closes
Before sending a free-form message, Agenta SHALL check the window. If the window has closed, Agenta SHALL NOT send the message. It SHALL mark the delivery held with the reason `window_closed` and show the state and reason in the channel's outbound events. Showing it in the session view is a follow-up. A provider error that reports the window closed SHALL be handled the same way.

#### Scenario: Turn finishes after the window
- **WHEN** a turn started 23 hours 50 minutes after the customer's message and finishes 20 minutes later
- **THEN** Agenta SHALL hold the answer with the reason `window_closed`

#### Scenario: Provider reports window closed
- **WHEN** Meta rejects a message with the re-engagement error
- **THEN** Agenta SHALL mark the delivery held with `window_closed` and SHALL NOT retry it as free-form

### Requirement: Optional re-open template
An editor MAY select one approved template on the connection to re-open closed conversations. When a reply is held and a template is configured, Agenta SHALL send the template once, for the first reply held since the customer last wrote. When the customer writes again, with or without a template, Agenta SHALL deliver the held replies, oldest first, before it answers the new message. Without a configured template, Agenta SHALL send nothing until the customer writes.

#### Scenario: Template configured
- **WHEN** a reply is held and the connection has an approved re-open template
- **THEN** Agenta SHALL send the template and, after the customer replies, SHALL send the held answer

#### Scenario: No template configured
- **WHEN** a reply is held and no template is configured
- **THEN** the customer SHALL receive nothing and the channel's outbound events SHALL show the held reply

### Requirement: Inbound-only messaging
In this change, Agenta SHALL send WhatsApp messages only in reply to a conversation the customer started. Apart from the re-open template, Agenta SHALL NOT start a WhatsApp conversation.

#### Scenario: Agent tries to message a new number
- **WHEN** an agent or tool asks to send to a WhatsApp number that never wrote to the business
- **THEN** Agenta SHALL refuse the send

### Requirement: Opt-out
When a customer sends STOP or UNSUBSCRIBE, Agenta SHALL mark the conversation opted out, send one confirmation, and stop answering. STOP and START SHALL apply in the order the customer sent them: a redelivered older one SHALL change nothing. Later messages SHALL be stored but SHALL NOT start turns or trigger templates until the customer sends START.

#### Scenario: Customer opts out
- **WHEN** a customer sends STOP
- **THEN** Agenta SHALL confirm once and SHALL NOT answer their next message

#### Scenario: Customer opts back in
- **WHEN** an opted-out customer sends START
- **THEN** Agenta SHALL clear the opt-out and answer later messages again
