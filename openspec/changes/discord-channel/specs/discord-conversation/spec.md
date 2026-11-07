# Discord conversation

## Purpose

Define when the agent answers on Discord, where its replies go, how replies are shaped, and which Discord ids identify events and conversations.

## ADDED Requirements

### Requirement: Direct messages
Every message in a direct message with the bot SHALL start a turn. All messages in one direct message SHALL continue the same thread until the thread is closed or restarted.

#### Scenario: Two messages in a DM
- **WHEN** a person sends the bot a question and later a follow-up in the same DM
- **THEN** both SHALL run in the same agent session

#### Scenario: DM locator
- **WHEN** a DM message is parsed
- **THEN** its locator SHALL carry `guild_id` `""`, the DM `channel_id`, `thread_id` `""`, `source_channel_id` equal to the DM channel, and the `message_id`

### Requirement: Mentions in server channels open a thread
In a server channel, a message SHALL start a turn only when it mentions the bot, uses the agent sigil, or is a command. The reply SHALL go into a new public thread started from that message.

#### Scenario: Mention in a channel
- **WHEN** a person mentions the bot in a server text channel
- **THEN** Agenta SHALL start one turn and SHALL post the answer in a thread started from that message with `POST /channels/{channel.id}/messages/{message.id}/threads`

#### Scenario: Message without a mention
- **WHEN** a person posts in a server channel without a mention, a sigil or a command
- **THEN** Agenta SHALL store the message and SHALL NOT start a turn

#### Scenario: Mention locator points at the new thread
- **WHEN** a mention in channel C with message id M is parsed
- **THEN** its locator SHALL carry `channel_id` C, `thread_id` M (Discord gives the new thread the id of its source message) and `source_channel_id` C, and the reply SHALL post into M

#### Scenario: One space per text channel
- **WHEN** two people mention the bot in channel C with messages M1 and M2
- **THEN** both events SHALL resolve to the one space for C, so a grant on C covers both, and to two thread keys, M1 and M2

### Requirement: Thread follow-ups
A message in a thread the bot started SHALL follow the shared mention-only rule: it SHALL start a turn only when it is addressed, and it SHALL continue the same agent session as the mention that opened the thread.

#### Scenario: Follow-up with a mention
- **WHEN** a person mentions the bot again in the thread the bot started for their first mention
- **THEN** Agenta SHALL run the turn in the same session as the first turn, with the messages posted since the last turn as context

#### Scenario: Message inside the bot's thread
- **WHEN** a message is posted in thread T, which the bot started from message T in channel C
- **THEN** its locator SHALL carry `channel_id` C (read from the thread's channel object), `thread_id` T and `source_channel_id` T, so it keys to the same space and thread as the opening mention

#### Scenario: Follow-up without a mention
- **WHEN** a person posts without a mention, a sigil, a command or a choice answer in the bot's thread
- **THEN** Agenta SHALL store the message and SHALL NOT start a turn

### Requirement: Event ids
A message event SHALL use the Discord message id as `external_id`. A button click SHALL use `discord_interaction_id` as `external_id`. In both cases `processed.message_ref` SHALL be the id of the message, so a click points at the message that holds the button.

#### Scenario: Message redelivered
- **WHEN** the same Discord message reaches the inbox twice
- **THEN** the second insert SHALL be dropped by `uq_channel_inbox_connection_external` and SHALL NOT start a second turn

#### Scenario: Click id
- **WHEN** a person clicks a button on message M
- **THEN** the event SHALL have `external_id` equal to the Discord interaction id and `processed.message_ref` equal to M

### Requirement: Bot echoes are dropped
The adapter SHALL return no event for a message written by the connection's own bot.

#### Scenario: Bot's own answer
- **WHEN** Discord delivers the bot's own reply over the socket
- **THEN** `parse_event` SHALL return `None`

### Requirement: Answers as new messages within 2,000 characters
Agenta SHALL deliver an answer as new Discord messages of at most 2,000 characters each. It SHALL split at paragraph, line or word boundaries and SHALL keep a fenced code block whole when the block fits in one message. It SHALL NOT edit a sent message to stream progress.

#### Scenario: Long answer
- **WHEN** an answer is 4,500 characters of plain text
- **THEN** Agenta SHALL send three messages in order, none longer than 2,000 characters

#### Scenario: Code block near a boundary
- **WHEN** a 600 character code block would cross the 2,000 character boundary
- **THEN** Agenta SHALL start a new message before the code block

#### Scenario: Code block longer than one message
- **WHEN** one code block is longer than 2,000 characters
- **THEN** Agenta SHALL split it into several messages and SHALL close and reopen the fence in each part

### Requirement: Typing indicator and reaction while the agent works
While a turn runs, Agenta SHALL show Discord's typing indicator in the reply channel and SHALL put a reaction on the user's message. It SHALL NOT post a placeholder message.

#### Scenario: Turn starts
- **WHEN** a turn starts for a message
- **THEN** Agenta SHALL call `POST /channels/{channel.id}/typing` and SHALL add a reaction with `PUT /channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me`

#### Scenario: Turn ends
- **WHEN** the turn completes or fails
- **THEN** Agenta SHALL change the reaction to show the result, as Slack's message status does

#### Scenario: Long turn
- **WHEN** a turn runs longer than 30 seconds
- **THEN** Agenta SHALL send the shared working message once, as the native indicator path does today (Open Question 7)

### Requirement: Approval buttons
Agenta SHALL render a tool approval as a message with Approve and Deny buttons whose `custom_id` is the existing choice token. A click SHALL resolve through the same pending-choice path as other channels. A typed label or number SHALL also resolve it.

#### Scenario: Button value
- **WHEN** the agent pauses for approval of interaction U
- **THEN** the buttons SHALL carry `custom_id` `U:approve` and `U:deny`, each within Discord's 100 character limit

#### Scenario: Click acknowledged in time
- **WHEN** a person clicks a button
- **THEN** `parse_event` SHALL send callback type `6` (`DEFERRED_UPDATE_MESSAGE`) to `POST /interactions/{interaction.id}/{interaction.token}/callback` before it returns, within Discord's 3 second limit

#### Scenario: Stale click
- **WHEN** a person clicks a button from a choice that was already answered or replaced
- **THEN** Agenta SHALL ignore the click and SHALL NOT start a turn

#### Scenario: Buttons removed after the answer
- **WHEN** the choice is resolved
- **THEN** Agenta SHALL remove the buttons from that message and SHALL keep its text

### Requirement: Commands in conversation
Discord SHALL support the in-conversation commands with the `!` sigil, `!new`, `!sessions` and `!use`. Agenta SHALL NOT register Discord slash commands in v1.

#### Scenario: New session
- **WHEN** a person sends `!new` in a DM with the bot
- **THEN** Agenta SHALL start a new session for that DM
