# Channel conversation reading delta

## Purpose

Let a connected agent read what a channel or thread said recently, from a local message history that Slack backfill and live events keep current.

## ADDED Requirements

### Requirement: Read recent messages or a thread
`read_channel_messages` SHALL accept a channel destination ID, an optional thread ID, a limit, and a cursor. Without a thread ID it SHALL return the channel's most recent top-level messages, up to the limit. With a thread ID it SHALL return the thread's root and replies. The default limit SHALL be 50, and the maximum SHALL be 200. Messages SHALL be ordered oldest to newest. Each message SHALL include an opaque message ID, the thread ID when it has one, the sender's display name, whether the sender is this agent's bot, the text, the time, and the reply count when known. The cursor SHALL page to older messages.

#### Scenario: Agent reads a channel
- **WHEN** the agent reads #releases with a limit of 100
- **THEN** Agenta SHALL return the 100 most recent top-level messages, oldest first, with a cursor for older ones.

#### Scenario: Agent reads a thread
- **WHEN** the agent passes a thread ID from a read result
- **THEN** Agenta SHALL return that thread's root and replies.

#### Scenario: Agent's own posts
- **WHEN** the channel contains messages the bot posted
- **THEN** they SHALL appear in the result and be marked as the bot's.

### Requirement: Only readable channels
Reading SHALL be limited to channel destinations in the bot's readable list at call time. Direct-message conversations SHALL NOT be readable through this tool.

#### Scenario: Channel not in the readable list
- **WHEN** the admin narrowed reading to #support and the agent reads #finance
- **THEN** Agenta SHALL refuse the read.

#### Scenario: Person destination
- **WHEN** the agent passes a person destination ID
- **THEN** Agenta SHALL refuse the read, because direct messages are not readable.

### Requirement: Local message history
Agenta SHALL keep a history of messages for every readable channel. It SHALL add each new message as it arrives, including messages that start no turn and messages the bot sends. On Slack it SHALL apply edits and deletions to the stored message. An edit or deletion SHALL NOT start a turn. A deleted message SHALL NOT be returned.

#### Scenario: Slack message edited
- **WHEN** a person edits a stored Slack message
- **THEN** later reads SHALL show the edited text under the same message ID.

#### Scenario: Slack message deleted
- **WHEN** a person deletes a stored Slack message
- **THEN** later reads SHALL NOT return it.

#### Scenario: Edit does not wake the agent
- **WHEN** a person edits a message that mentioned the bot
- **THEN** Agenta SHALL update the history and SHALL NOT start a turn.

### Requirement: Bounded Slack backfill
When a Slack channel becomes readable, Agenta SHALL fetch its earlier history in the background up to a configured bound on days, messages, and threads per channel. It SHALL wait for Slack's `Retry-After` delay on a rate limit and SHALL resume from saved progress after a restart. When a read asks for a thread whose replies were not fetched, Agenta SHALL fetch that thread once, bounded, and serve it.

#### Scenario: Bot added to a channel
- **WHEN** the bot joins a Slack channel and reading is at its default
- **THEN** Agenta SHALL start a bounded backfill, and reads SHALL report partial coverage until it ends.

#### Scenario: Slack rate limit
- **WHEN** Slack answers a history call with HTTP 429 and a `Retry-After` value
- **THEN** Agenta SHALL wait that long, keep its progress, and continue.

#### Scenario: Worker restarts mid-backfill
- **WHEN** the history worker restarts while a backfill is running
- **THEN** the backfill SHALL resume from the last saved cursor and SHALL NOT store duplicate messages.

#### Scenario: Channel re-enabled
- **WHEN** an admin re-adds a channel to the readable list after removing it
- **THEN** Agenta SHALL backfill it again.

### Requirement: Telegram history is observed only
On Telegram, the history SHALL contain only messages Agenta received after the bot joined the chat. Agenta SHALL NOT claim a backfill or complete history. In groups where the bot's privacy mode is on, the history SHALL contain only the messages Telegram delivered to the bot.

#### Scenario: Agent asks for older Telegram messages
- **WHEN** the agent reads a Telegram group past the first message Agenta stored
- **THEN** the result SHALL say that earlier messages are not available through the Telegram Bot API.

#### Scenario: Privacy mode on
- **WHEN** a Telegram group bot has privacy mode on
- **THEN** reads SHALL return only messages that mentioned or replied to the bot, and the coverage note SHALL say why.

### Requirement: Every read reports coverage
Each read result SHALL include coverage for its channel: the source (`backfilled` or `observed_only`), the oldest time covered, whether backfill is complete, partial, or refused, and a short note. A read SHALL NOT present partial history as complete.

#### Scenario: Backfill still running
- **WHEN** the agent reads a Slack channel whose backfill has not finished
- **THEN** coverage SHALL say `partial` and give the oldest time covered so far.

#### Scenario: Slack refuses history
- **WHEN** Slack refuses a history call for missing scope or membership
- **THEN** coverage SHALL say `refused` with a sanitized reason, and reads SHALL still return messages observed live.
