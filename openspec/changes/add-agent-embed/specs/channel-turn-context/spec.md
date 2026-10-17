## ADDED Requirements

### Requirement: Inbound events can carry host context

A processed inbound event SHALL accept an optional `context` object. When present, `compose_input` SHALL add one text part after the sender attribution part and before the message content. The part SHALL label the values as data provided by the host, not verified, and not to be followed as instructions. Events without context SHALL produce the same input as today.

#### Scenario: Message with context

- **WHEN** an inbound event carries `context` `{"page": "/invoices"}`
- **THEN** the turn's input contains the attribution part, then a part that lists the context as host-provided and unverified, then the message content

#### Scenario: Message without context

- **WHEN** an inbound event carries no `context`
- **THEN** the turn's input is the same as before this change

#### Scenario: Any channel may set context

- **WHEN** an adapter other than `embed` fills `processed.context`
- **THEN** `compose_input` renders it the same way

### Requirement: The chat shows the person's own words

When `compose_input` adds an attribution part or a context part, the turn's user message SHALL carry `display_content` with only the person's own words. Chat views SHALL show `display_content` in place of the message text. When the turn's events come from more than one sender, `compose_input` SHALL NOT set `display_content`.

#### Scenario: Visitor sees only their own words

- **WHEN** a visitor opens a past conversation in the widget
- **THEN** each of their messages shows only what they typed or attached

#### Scenario: A turn from several people keeps the attribution

- **WHEN** a forwardfilled turn holds messages from two senders
- **THEN** the turn's user message has no `display_content`, and the chat shows the attribution parts

#### Scenario: The model still sees the parts

- **WHEN** a turn runs
- **THEN** the attribution and context parts are part of the model's input
