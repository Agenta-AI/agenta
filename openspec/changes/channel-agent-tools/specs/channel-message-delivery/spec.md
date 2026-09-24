# Channel message delivery delta

## Purpose

Let a connected agent post outside the conversation that woke it, with a durable record and a truthful outcome.

## ADDED Requirements

### Requirement: Send outside the current conversation
`send_channel_message` SHALL accept a destination ID, the message text, and an optional thread ID. It SHALL post through the bot that owns the destination. It SHALL NOT need an inbound event, an existing channel thread, or a channel-linked session. It SHALL NOT invent an inbound message or thread.

#### Scenario: Post from Agenta chat to a Slack channel
- **WHEN** a connected agent sends text to a Slack channel destination from an Agenta chat session
- **THEN** Agenta SHALL post it to that channel and return the outcome.

#### Scenario: Post in a thread
- **WHEN** the agent passes a thread ID returned by an earlier send, read, or search for the same destination
- **THEN** Agenta SHALL post as a reply in that thread.

#### Scenario: Thread from another destination
- **WHEN** the thread ID belongs to a different destination
- **THEN** Agenta SHALL refuse the send without calling the provider.

### Requirement: Durable delivery record with a truthful state
Agenta SHALL write a delivery record before it calls the provider. The call SHALL return a delivery ID and one of three states: `sent` when the provider acknowledged the post, `failed` when the provider refused it or the call never reached the provider, and `unknown` when the post may have reached the chat but Agenta has no receipt. Agenta SHALL NOT report `sent` without a provider acknowledgement. It SHALL NOT retry an `unknown` post. A `sent` result SHALL include a message ID, and a thread ID when the platform threads.

#### Scenario: Provider accepts
- **WHEN** Slack acknowledges the post
- **THEN** the record SHALL hold the receipt and the tool SHALL return `sent` with a message ID and thread ID.

#### Scenario: Provider refuses
- **WHEN** Telegram answers that the bot was removed from the chat
- **THEN** the tool SHALL return `failed` with a sanitized reason and SHALL NOT claim success.

#### Scenario: Timeout after sending
- **WHEN** the request to Slack times out after it was sent
- **THEN** the tool SHALL return `unknown`, and Agenta SHALL NOT post the text again.

### Requirement: A retried call does not post twice
The runner SHALL pass a hidden tool call ID that stays the same when one tool call is retried. Agenta SHALL keep at most one delivery record per project, session, and tool call ID. A retry SHALL return the existing record's state instead of posting again.

#### Scenario: Runner retries after a lost response
- **WHEN** the runner retries the same send after losing Agenta's response
- **THEN** Agenta SHALL return the first attempt's state and SHALL NOT post a second message.

### Requirement: Checks run again right before posting
Immediately before calling the provider, Agenta SHALL confirm the connection is active, the destination still resolves for the running agent, and the bot's posting settings still allow the send. A failed check SHALL refuse the send without a provider call.

#### Scenario: Setting changed during the call
- **WHEN** an admin turns off direct messages while a send to a person is being processed
- **THEN** Agenta SHALL refuse the send if the check runs after the change, and SHALL NOT call the provider.

#### Scenario: Credential revoked
- **WHEN** the provider rejects the bot's credential
- **THEN** Agenta SHALL return `failed`, switch the connection off as replies already do, and SHALL NOT try another connection.

### Requirement: The sender identity comes from the bot
The provider identity of a sent message SHALL come from the connection, the same as for replies. Tool input SHALL NOT be able to set a sender name, avatar, token, or installation.

#### Scenario: Model tries to set a name
- **WHEN** the send arguments include a `username` field
- **THEN** Agenta SHALL reject the call because the field is not in the schema.

### Requirement: A proactive direct message uses its own private session
Pending decision: Mahmoud has not yet decided whether direct messages to people are in version one. If they are left out, this requirement is removed and the send tool SHALL accept channel destinations only. If they stay, a send to a person SHALL post in the person's private conversation with the bot. On Slack, Agenta SHALL open that conversation if it does not exist. On Telegram, it exists because the person wrote first. Agenta SHALL use the agent's active thread in that private conversation, or create one with a new session. It SHALL NOT move, copy, or link the source session. The private session's next turn SHALL see the text the agent sent.

#### Scenario: Channel conversation leads to a direct message
- **WHEN** an agent working in a shared Slack channel sends a direct message to a person
- **THEN** only the sent text SHALL reach the person, and the shared channel's history SHALL NOT enter the private session.

#### Scenario: Recipient replies in the thread
- **WHEN** the person replies to the agent's direct message in Slack
- **THEN** the reply SHALL continue the private session and SHALL NOT reach the source session.

#### Scenario: Private session knows what was sent
- **WHEN** the person's reply starts a turn in the private session
- **THEN** the turn input SHALL include the message the agent sent earlier.

#### Scenario: Telegram user who never wrote
- **WHEN** the agent holds no person destination for a Telegram user because the user never messaged the bot
- **THEN** the agent SHALL have no way to message that user.

### Requirement: No scheduling in this change
`send_channel_message` SHALL post immediately. It SHALL NOT accept a delivery time. Timed or recurring posts SHALL come from an automation that runs the agent, and the agent SHALL use the same send tool.

#### Scenario: Automation posts a weekly report
- **WHEN** an automation runs the agent every Monday and the agent calls the send tool
- **THEN** Agenta SHALL treat it as an ordinary immediate send.
