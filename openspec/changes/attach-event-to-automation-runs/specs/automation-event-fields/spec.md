## ADDED Requirements

### Requirement: Field tags for event automations

For an event automation, the Instruction field SHALL show a wrapping row of small field tags inside the instruction box, under the text, built from the catalog payload schema of the automation's event. A tag SHALL show the field's label only; the schema's `description` SHALL show in a tooltip on hover and on keyboard focus. Schedules SHALL keep today's composer.

#### Scenario: Flat schema

- **WHEN** the event is the GitHub pull request event, whose schema has `action`, `createdAt`, `createdBy`, `description`, `number`, `title` and `url`
- **THEN** seven tags show, in schema order, each with its humanized name, and hovering a tag shows the schema's `description`

#### Scenario: Nested object

- **WHEN** a property is an object with its own `properties`, such as Linear's `data`
- **THEN** one tag shows per child property, its label starting with the object's name, and deeper objects show as one tag each

#### Scenario: No schema

- **WHEN** the catalog returns no payload schema, or the query fails
- **THEN** no tags show and the instruction box, the checkbox and the preview still work

### Requirement: Tag labels come from the key

A tag label SHALL be the property key split at camelCase and underscores, in sentence case, with known acronyms in capitals, through `humanizeActionKey`. A child label SHALL join the parent and child words. No hand-written label map SHALL exist.

#### Scenario: camelCase key

- **WHEN** the key is `createdBy`
- **THEN** the label is "Created by"

#### Scenario: Acronym

- **WHEN** the key is `url`
- **THEN** the label is "URL"

### Requirement: Pills

A click or a tap on a tag SHALL insert a pill for that field at the cursor. The pill SHALL show the tag label. The mapping SHALL store the field as the selector `$.event.attributes.<key>`. A pill SHALL be removable like one character.

#### Scenario: Insert

- **WHEN** the user types "Review " and clicks the "Title" tag
- **THEN** the box shows "Review " and a "Title" pill, and the stored content is `[{"type":"text","text":"Review "},{"type":"text","text":"$.event.attributes.title"}]`

#### Scenario: One pill alone

- **WHEN** the instruction is only a "Labels" pill
- **THEN** the stored content is `[{"type":"text","text":"$.event.attributes.labels"}]`, a text part and not a bare selector, so an array value reaches the agent as JSON text

#### Scenario: Used tag

- **WHEN** the instruction already has a "Title" pill
- **THEN** the "Title" tag shows a check

#### Scenario: Remove

- **WHEN** the user deletes the pill with Backspace
- **THEN** the selector leaves the stored content and the tag loses its check

#### Scenario: Key with special characters

- **WHEN** a key has a character other than letters, digits and underscores
- **THEN** the selector uses bracket form, `$.event.attributes["<key>"]`

### Requirement: Other mapping keys are kept

Reading and writing the instruction SHALL change only the message key of the mapping and SHALL keep every other key.

#### Scenario: Agent-made mapping

- **WHEN** a stored mapping is `{"messages":[{"role":"user","content":"Triage it"}],"event":"$.event.attributes"}` and the user edits the text
- **THEN** the saved mapping still has the `event` key

#### Scenario: Pill typed before the agent's input shape resolves

- **WHEN** the user types text and inserts a pill before the agent revision resolves, and the agent then resolves as a chat agent
- **THEN** the text and the pill move into `messages`, the old key is removed, and other keys are kept

### Requirement: Include-event checkbox

The Instruction field SHALL show a checkbox labeled "Also attach the full event, so the agent can use any detail" for event automations. It SHALL read `data.include_event`, treat an absent value as checked, and save its value with the rest of the draft.

#### Scenario: Existing automation

- **WHEN** an automation saved before this change opens
- **THEN** the checkbox is checked

#### Scenario: New automation

- **WHEN** the user creates an event automation and does not touch the checkbox
- **THEN** the create request body has `data.include_event` equal to `true`

#### Scenario: Unsaved change

- **WHEN** the user unchecks it on the detail screen
- **THEN** the save bar shows, and Discard checks it again

### Requirement: What the agent gets preview

The Instruction field SHALL show a "What the agent gets" preview of the message. Pills SHALL show values from `data.event` of the newest delivery that has one, with the same text rule as the dispatcher (a string unchanged, an absent or null value empty, any other value as compact JSON), else their labels. When the checkbox is on and a delivery has `data.event`, the preview SHALL show the event text with its JSON. The preview SHALL show the same text Run now sends.

#### Scenario: With a delivery

- **WHEN** the newest delivery with `data.event` has `attributes.title` equal to "Fix the login page"
- **THEN** the "Title" pill reads "Fix the login page" in the preview

#### Scenario: Without a delivery

- **WHEN** no delivery has `data.event`
- **THEN** the pills show their labels in square brackets and the preview has no event text, because Run now sends none

#### Scenario: Quoted key

- **WHEN** a pill's selector is `$.event.attributes["a.b"]` and the delivery's attributes have the key `a.b`
- **THEN** the preview shows the value of `a.b`

### Requirement: Run now uses the same message

Run now SHALL send the text the preview shows, built by the same function: pills filled from the newest delivery with `data.event`, each pill as its label in square brackets when there is none, and the event text added when the checkbox is saved as on and an event exists.

#### Scenario: Run now with a delivery

- **WHEN** the user presses Run now and a delivery with `data.event` exists
- **THEN** the new chat's first message has the filled values and, when the option is on, the event text in the dispatcher's format

#### Scenario: Run now with pills and no delivery

- **WHEN** the deliveries call succeeds and no delivery has `data.event`
- **THEN** the first message has "[Title]" where the "Title" pill is

#### Scenario: Deliveries call fails

- **WHEN** the user presses Run now and the deliveries call fails
- **THEN** no run starts, the error goes to the log, and the button stays enabled

#### Scenario: Mapping the composer cannot show

- **WHEN** the stored mapping has several messages, a non-user message or a non-text part
- **THEN** the preview shows only the existing warning line and Run now sends the same text it sends today
