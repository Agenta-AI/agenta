# WhatsApp conversation

## Purpose

Define how an agent converses with one customer on WhatsApp, given that sent messages cannot be edited and conversations are one-to-one.

## ADDED Requirements

### Requirement: One-to-one conversations
Every WhatsApp conversation SHALL be a private space keyed on the business phone number ID and the customer's WhatsApp ID. Every customer message SHALL be a trigger. All messages from one customer SHALL continue the same thread until the thread is closed or restarted.

#### Scenario: Customer sends two messages
- **WHEN** a customer sends a question and later a follow-up
- **THEN** both SHALL run in the same agent session

#### Scenario: Group message
- **WHEN** an event arrives from a group conversation
- **THEN** Agenta SHALL store it and SHALL NOT start a turn

### Requirement: Native turn indicator without placeholder text
When a turn starts, Agenta SHALL mark the triggering message as read and show the WhatsApp typing indicator. It SHALL NOT post a placeholder text message. It SHALL refresh the typing indicator every 20 seconds while the turn runs.

#### Scenario: Short turn
- **WHEN** the agent answers within 30 seconds
- **THEN** the customer SHALL see the message marked read, a typing indicator, and then only the answer

### Requirement: One working message on long turns
If a turn has produced no answer after 30 seconds, Agenta SHALL send one fixed "working on it" message for that turn and SHALL NOT send further progress messages.

#### Scenario: Two-minute turn
- **WHEN** a turn runs for two minutes
- **THEN** the customer SHALL receive exactly one working message followed by the answer

### Requirement: Answers as new messages within limits
Agenta SHALL deliver the final answer as new messages. It SHALL split text longer than 4096 characters at paragraph, line, or word boundaries, and it SHALL space parts to one customer at least 6 seconds apart. Agenta SHALL NOT attempt to edit or delete a sent WhatsApp message.

#### Scenario: Long answer
- **WHEN** the answer is 9,000 characters long
- **THEN** Agenta SHALL send three messages in order, none longer than 4096 characters

#### Scenario: Pair rate limit
- **WHEN** Meta rejects a part with the pair rate limit error
- **THEN** Agenta SHALL retry that part after a delay and SHALL NOT resend parts already accepted

### Requirement: Approvals and choices
Agenta SHALL render a pending choice with up to 3 options as reply buttons, with 4 to 10 options as a list message, and with more than 10 options as numbered text. A tap SHALL resolve through the same pending-choice token as other channels. A typed label or number SHALL also resolve the choice.

#### Scenario: Tool approval
- **WHEN** the agent pauses for approval of a tool call
- **THEN** the customer SHALL receive the redacted request with Approve and Deny reply buttons

#### Scenario: Stale button tap
- **WHEN** the customer taps a button from a choice that was already answered or superseded
- **THEN** Agenta SHALL ignore the tap and SHALL NOT start a turn

#### Scenario: Typed answer
- **WHEN** the customer types "approve" instead of tapping
- **THEN** Agenta SHALL resolve the pending choice as Approve

### Requirement: Images and documents
Agenta SHALL accept inbound images and documents, pass them to the agent as attachments, and send images and documents the agent returns. Files larger than Meta's limit for their type SHALL be replaced by a short text notice. Audio, video, and sticker messages SHALL receive one fixed reply saying which message types the agent can read.

#### Scenario: Customer sends a PDF
- **WHEN** a customer sends a 2 MB PDF invoice with a question
- **THEN** the agent SHALL receive the document and the question in the same turn

#### Scenario: Customer sends a voice note
- **WHEN** a customer sends a voice note
- **THEN** Agenta SHALL reply that it can read text, images, and documents, and SHALL NOT start a turn

### Requirement: Delivery status
Agenta SHALL record Meta's sent, delivered, read, and failed statuses against the outbox receipt for each message. A failed status SHALL mark the delivery failed with Meta's error code.

#### Scenario: Message fails after acceptance
- **WHEN** Meta reports a failed status for an accepted message
- **THEN** the session SHALL show the delivery as failed with the error code
