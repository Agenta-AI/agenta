## ADDED Requirements

### Requirement: Include-event option on subscriptions

A trigger subscription SHALL carry `data.include_event`, a boolean that defaults to true. A stored subscription without the key SHALL read as true.

#### Scenario: Old subscription reads as on

- **WHEN** a subscription row was saved before this change and its `data` has no `include_event` key
- **THEN** the API returns it with `data.include_event` equal to `true`

#### Scenario: The user turns it off

- **WHEN** a client edits a subscription with `data.include_event` set to `false`
- **THEN** the stored row keeps `false` and later reads return `false`

#### Scenario: No migration

- **WHEN** the change is deployed
- **THEN** no database migration runs, because `data` is a JSON column

### Requirement: Event included in the agent's message

When `include_event` is true and the event has attributes, the dispatcher SHALL add the event text to the resolved inputs of a subscription before it sends them. The event text is a blank line, a header that names `event.event_type`, and the JSON of `event.attributes` in a fenced block, with no size cap.

#### Scenario: Chat mapping with a string instruction

- **WHEN** the resolved inputs are `{"messages":[{"role":"user","content":"Review this pull request"}]}`
- **THEN** the sent content is `"Review this pull request"` followed by the event text, as one string

#### Scenario: Chat mapping with text parts

- **WHEN** the last user message has a list of text parts
- **THEN** one more text part with the event text is appended to that list

#### Scenario: Last message is not a user message

- **WHEN** the resolved `messages` list ends with a message whose role is not `user`
- **THEN** a new user message with the event text is appended

#### Scenario: Empty mapping

- **WHEN** the mapping is `{}`
- **THEN** the inputs become one user message whose content is the event text without the leading blank line

#### Scenario: Other mapping shapes stay unchanged

- **WHEN** the resolved inputs have no `messages` list and are not empty, for example `{"number": 42}` or the whole context from a `"$"` mapping
- **THEN** the inputs are sent unchanged

#### Scenario: Option off

- **WHEN** `include_event` is false
- **THEN** no event text is added

#### Scenario: Event without attributes

- **WHEN** the event's `attributes` is absent or null
- **THEN** no event text is added

### Requirement: Message text is always a string

After it resolves the mapping of a subscription, the dispatcher SHALL turn each `content` value of a message in `messages`, and each `text` value of a text part in such a content list, into a string, whether or not `include_event` is on. A string SHALL stay unchanged, `None` SHALL become the empty string, and any other value SHALL become its compact JSON. Schedule inputs SHALL stay as they are today.

#### Scenario: Number field

- **WHEN** a text part's selector resolves to the integer `42`
- **THEN** the sent part is `{"type":"text","text":"42"}`

#### Scenario: Object field

- **WHEN** a selector resolves to an object
- **THEN** the sent text is the compact JSON of that object

#### Scenario: Absent field

- **WHEN** a selector resolves to nothing
- **THEN** the sent text is the empty string and the run does not fail

#### Scenario: Boolean field

- **WHEN** a selector resolves to `true`
- **THEN** the sent text is `true`, the same text the frontend preview shows

### Requirement: Delivery records the event

Each subscription delivery that the dispatcher writes with a resolved event SHALL store the normalized event context block (`event_id`, `event_type`, `timestamp`, `created_at`, `attributes`) in `data.event`, not the raw provider body. Schedule deliveries SHALL NOT set it.

#### Scenario: Successful run

- **WHEN** an event runs the agent
- **THEN** the delivery's `data.event.attributes` equals the provider payload and `data.inputs` equals the inputs sent, event text included

#### Scenario: Schedule tick

- **WHEN** a schedule fires
- **THEN** its delivery has no `data.event`

### Requirement: Test captures match real runs

A test-mode capture SHALL build its inputs with the same coercion and event text as a real run, and SHALL record `data.event`.

#### Scenario: Test capture with the option on

- **WHEN** a subscription with `flags.is_test` true and `include_event` true receives an event
- **THEN** the test delivery's `data.inputs` holds the event text and `data.event` holds the event

### Requirement: Builder agent guidance

The agent-facing reference on trigger inputs SHALL state that the event is included in the message by default and SHALL NOT recommend a sibling `event` input key.

#### Scenario: Reference text

- **WHEN** a builder agent reads the trigger inputs reference
- **THEN** it reads that `include_event` defaults to on and that the agent reads only `messages`
