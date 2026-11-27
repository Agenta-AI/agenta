## ADDED Requirements

### Requirement: The agent is always sent

Every message sent from the builder panel SHALL carry the agent part `agent: {id, name}`, the id and the name of the agent of the screen. It SHALL stay outside the removable `page` part. The builder SHALL NOT need to ask which agent the user means.

#### Scenario: Message with the chip
- **WHEN** the user sends "Make the replies shorter" from the builder panel on a session of "Support triage"
- **THEN** the message carries `agent` with the agent id and the name "Support triage"

#### Scenario: Message with the chip removed
- **WHEN** the user removed the chip and sends a message
- **THEN** the message still carries the agent id and name, and no `page` part

### Requirement: Configuration page part

While the chip shows on the Configuration content or the Configuration page, the message SHALL also carry `page: {kind: "configuration", tab, item?}`. `tab` is the open tab. `item` is the open configuration item as `{list, key, name}`, absent when no item is open.

#### Scenario: On Configuration with an open skill
- **WHEN** the Configuration content shows the skill "ticket-triage"
- **THEN** `page` holds `kind: "configuration"`, `tab: "agent"` and `item: {list: "skills", key: "ticket-triage", name: "ticket-triage"}`

#### Scenario: On Configuration with no open item
- **WHEN** the Configuration page shows the Automations tab and no item is open
- **THEN** `page` holds `kind: "configuration"`, `tab: "automations"` and no `item`

#### Scenario: Item with no server id
- **WHEN** the open item is an agent-only skill with no server id
- **THEN** `item.key` holds its key, the same key as the operation target of the builder tools

### Requirement: Session part
While the chip shows on a session, the message SHALL also carry `page: {kind: "session", session: {id, name}, revision: {id, version}}`, the session the user sees and the version it runs on. `version` SHALL be a string. While the session name loads, the message SHALL carry the session id with no name.

#### Scenario: On a session
- **WHEN** the user sends from the panel on the session "Charged twice for March" of "Support triage", which runs on v4
- **THEN** `page` holds `kind: "session"`, the session id and name, and `revision` with the v4 id and `version: "4"`

#### Scenario: Name still loading
- **WHEN** the user sends before the session name has loaded
- **THEN** `page.session` holds the id and no name, and the chip shows the agent name only

#### Scenario: New session with no turn yet
- **WHEN** the user sends from the panel on a new session that has no id yet
- **THEN** the message carries no `page` part

### Requirement: Sessions and Analytics parts
While the chip shows on the Sessions page or the Analytics page of an agent, the message SHALL also carry `page: {kind: "sessions" | "analytics", filters}`, where `filters` holds the names and values of the active filters of that page.

#### Scenario: Sessions page with a filter
- **WHEN** the user sends from the Sessions page of "Support triage" with Status set to Running
- **THEN** `page` holds `kind: "sessions"` and `filters` with the status filter and its value

#### Scenario: Analytics with a period
- **WHEN** the user sends from Analytics of "Support triage" with the period "Last 7 days"
- **THEN** `page` holds `kind: "analytics"` and `filters` with the period

#### Scenario: No filter set
- **WHEN** no filter is active
- **THEN** `filters` is an empty list

### Requirement: Read at send time, snapshotted when queued

The send function SHALL read the page context when the person presses Send and SHALL copy it into the queued message. A retry or an approval resume of that message SHALL send the same snapshot, also after the person navigated away. After a reload, an approval resume SHALL rely on the context line that the stored text of the original message holds.

#### Scenario: Navigation between messages
- **WHEN** the user sends one message on Configuration with the skill "ticket-triage" open, then opens a session of the same agent and sends a second message
- **THEN** the second message carries no `page` part, because the context is read at send time

#### Scenario: Retry after navigation
- **WHEN** a message sent on Configuration with "ticket-triage" open waits in the queue, the user opens a session, and the message is retried
- **THEN** the retried message carries the snapshot with "ticket-triage"

#### Scenario: Approval resume
- **WHEN** a turn pauses for a change card, the user navigates, and then approves
- **THEN** the resumed request carries the page context of the original message

#### Scenario: Approval resume after a reload
- **WHEN** a turn pauses for a change card sent with "ticket-triage" open, the user reloads the page, and then approves
- **THEN** the resumed run reads the history, whose stored text of the original message holds the context line with the configuration part

### Requirement: Ids, not content

The page context SHALL hold ids, keys and short names. It SHALL NOT hold the text of a conversation, a configuration, a file, an open form or a secret. The builder SHALL read what it needs with its own tools, and every tool SHALL check the rights of the person who chats.

#### Scenario: Open form with edits
- **WHEN** the Instructions view has typed text that is not applied yet and the user asks the builder about it
- **THEN** the message carries the `configuration` part with the item, not the typed text

#### Scenario: An agent the user cannot read
- **WHEN** the page context names an agent that the person may not read
- **THEN** the builder tools refuse with `access_denied`, and the builder says that it cannot read it

### Requirement: Context on every message

The page context SHALL be sent with every message of a builder panel chat, not only with the first one. The browser SHALL put it as one context line before the person's words in the text the model reads, and SHALL set `metadata.display_content` to the person's words only, with the existing `executionText` path. No API, SDK, runner or record change SHALL be needed.

#### Scenario: Third message of a chat
- **WHEN** the user sends the third message in a chat
- **THEN** the text the model reads starts with the context line of that moment, and `metadata.display_content` holds only the typed words

#### Scenario: The message text
- **WHEN** the chat shows the sent message
- **THEN** the message bubble shows only the words the user typed, read from `display_content`

#### Scenario: Message with the chip removed
- **WHEN** the user removed the chip and sends a message
- **THEN** the context line names only the agent

### Requirement: The context line has one fixed format
The context line SHALL have one fixed, versioned format that the browser writes and reads back: a fixed prefix, then the agent id and name and the page part with its ids, keys and short names. The browser SHALL parse it from a stored message to rebuild the chip. A text with no valid line SHALL be treated as a message with no context.

#### Scenario: Round trip
- **WHEN** the browser writes the line for "Support triage" with the skill "ticket-triage" open and parses it back
- **THEN** it gets the same agent, tab and item

#### Scenario: Person types text that looks like the prefix
- **WHEN** the typed words start with the same characters as the prefix
- **THEN** the chip comes only from the line the browser wrote, because the browser compares the stored text with `display_content` and reads only the part before the typed words

#### Scenario: Unknown version
- **WHEN** a stored line has a format version the browser does not know
- **THEN** the message shows no chip and no error

### Requirement: The chip shows what is sent

The context chip SHALL show exactly what the message would carry: the agent name, then a separator " · " and the session name on a session, the open item on Configuration, or the page name on the Sessions page and Analytics. A remove button with the label "Remove the context" SHALL remove the chip. After a removal, the composer SHALL offer "Add this page as context", which brings the chip back.

#### Scenario: Chip on a session
- **WHEN** the builder panel is open on the session "Charged twice for March" of "Support triage"
- **THEN** the chip shows "Support triage · Charged twice for March" with the hover title "The builder sees this"

#### Scenario: Chip on the Sessions page and Analytics
- **WHEN** the builder panel is open on the Sessions page or Analytics of "Support triage"
- **THEN** the chip shows the agent name, " · " and the page name, and the hover lists the active filters

#### Scenario: Chip on Configuration
- **WHEN** the Configuration content shows the skill "ticket-triage" of "Support triage"
- **THEN** the chip shows "Support triage · ticket-triage"

#### Scenario: Remove the chip
- **WHEN** the user clicks "Remove the context"
- **THEN** the chip goes away, "Add this page as context" shows in its place, and the next message carries only the agent part

#### Scenario: Add it back
- **WHEN** the user clicks "Add this page as context"
- **THEN** the chip shows the page of this moment again

#### Scenario: Removal and navigation
- **WHEN** the user removed the chip and then opens another screen of the same agent
- **THEN** the chip shows again for the new page

#### Scenario: Long names
- **WHEN** the item name is longer than the chip
- **THEN** the chip cuts the text with an ellipsis and shows the full text on hover

### Requirement: A sent message keeps its chip
A sent message SHALL show the chip it was sent with, also after a reload, rebuilt in the browser from the context line in the stored message text. A message sent with the chip removed (a line with the agent only) SHALL show no chip. A message with no context line SHALL show no chip and no error.

#### Scenario: Live message
- **WHEN** the user sends a message on Configuration with "ticket-triage" open
- **THEN** the sent message shows the chip "Support triage · ticket-triage"

#### Scenario: After a reload
- **WHEN** the user reloads the page and opens the same builder chat
- **THEN** the sent message shows the chip "Support triage · ticket-triage" again

#### Scenario: Message sent with the chip removed
- **WHEN** the user sent a message with the chip removed
- **THEN** that message shows no chip

#### Scenario: Message with no context line
- **WHEN** a user message of the chat has no context line in its stored text
- **THEN** that message shows no chip and no error

### Requirement: The chip reads the page itself

The context chip and the send function SHALL read the page context from one atom that the page writes. No code SHALL pass the page context or the page session id down into the builder panel as a prop. On a same-agent switch, only the chip SHALL render again.

#### Scenario: Same-agent switch
- **WHEN** the user opens the skill "ticket-triage" on Configuration of the same agent
- **THEN** the chip shows the new item, and the builder chat and its composer do not render again

### Requirement: The builder reads what the page names
The builder SHALL read the saved version of the agent, the session or the traces that the page context names, with its own tools and the rights of the person. When a tool refuses, the builder SHALL say what it cannot read instead of guessing.

#### Scenario: Ask about a session
- **WHEN** the user asks "Why did Login fails on Safari get only medium urgency?" with the chip on that session
- **THEN** the builder reads that session with its read-session tool and answers from its turns

#### Scenario: Ask on Analytics
- **WHEN** the user asks why runs failed this week with the chip on Analytics and the period "Last 7 days"
- **THEN** the builder reads the traces of the agent with that filter

#### Scenario: No right to read traces
- **WHEN** the person's role cannot read traces
- **THEN** the traces tool refuses, and the builder says that it cannot read traces for this person
