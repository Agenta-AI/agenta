## ADDED Requirements

### Requirement: Inbound events can carry host context

A processed inbound event SHALL accept an optional `context` object. When present, `compose_input` SHALL add one text part after the sender attribution part and before the message content. The part SHALL label the values as provided by the host and not verified. Events without context SHALL produce the same input as today.

#### Scenario: Message with context

- **WHEN** an inbound event carries `context` `{"page": "/invoices"}`
- **THEN** the turn's input contains the attribution part, then a part that lists the context as host-provided and unverified, then the message content

#### Scenario: Message without context

- **WHEN** an inbound event carries no `context`
- **THEN** the turn's input is the same as before this change

#### Scenario: Any channel may set context

- **WHEN** an adapter other than `embed` fills `processed.context`
- **THEN** `compose_input` renders it the same way

### Requirement: Generated parts are marked

`compose_input` SHALL mark the attribution part and the context part with `"generated": "channel"`. Chat views SHALL hide marked parts inside a person's own message.

#### Scenario: Visitor sees only their own words

- **WHEN** a visitor opens a past conversation in the widget
- **THEN** each of their messages shows only what they typed or attached

#### Scenario: The model still sees the parts

- **WHEN** a turn runs
- **THEN** the attribution and context parts are part of the model's input
