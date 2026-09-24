# Channel conversation reading delta

## Purpose

Let a connected agent read what a channel or thread said, from the messages Agenta already stores and, on Slack, from live history for anything older.

## ADDED Requirements

### Requirement: Read recent messages or a thread
`read_channel_messages` SHALL accept a channel destination ID, an optional thread ID, a limit, and a cursor. Without a thread ID it SHALL return the channel's most recent messages, up to the limit. With a thread ID it SHALL return the thread's root and replies. The default limit SHALL be 50, and the maximum SHALL be 200. Messages SHALL be ordered oldest to newest by the provider's time, except that the bot's own stored posts sort by the time Agenta recorded them, which is within about a second of the post. Each message SHALL include an opaque message ID, the thread ID when it has one, the sender's display name when known, whether the sender is this agent's bot, the text, and the time. The cursor SHALL be opaque and SHALL page to older messages. Tool input and output SHALL NOT contain raw provider IDs.

#### Scenario: Agent reads a channel
- **WHEN** the agent reads #releases with a limit of 100
- **THEN** Agenta SHALL return up to the 100 most recent messages, oldest first, with a cursor for older ones.

#### Scenario: Agent reads a thread
- **WHEN** the agent passes a thread ID from a read or search result
- **THEN** Agenta SHALL return that thread's root and replies.

#### Scenario: Thread ID from another channel
- **WHEN** the agent passes a thread ID that belongs to a different destination
- **THEN** Agenta SHALL return not found without a provider call.

#### Scenario: Sender name unknown
- **WHEN** Agenta holds only a provider user ID for a sender
- **THEN** the message SHALL omit the name and SHALL NOT show the raw ID.

### Requirement: Stored messages come first
Agenta SHALL serve a read from the messages it already stores for the channel, with no new message table: inbox rows for what people posted, and sent outbox rows for the bot's own posts, merged in provider-time order. Every stored inbox message SHALL carry a provider time, taken from the provider when the adapter has it and from the arrival time otherwise. A bot post stored in both places SHALL appear once, taken from the outbox. Button clicks SHALL NOT appear as messages.

#### Scenario: Both sides of a conversation
- **WHEN** people and the bot have both posted in a channel since the bot joined
- **THEN** a read SHALL return both, in order, with the bot's posts marked as the bot's.

#### Scenario: Bot post edited by a turn
- **WHEN** the bot's reply was posted as a progress message and then edited into the final answer
- **THEN** a read SHALL show the final text.

### Requirement: Live Slack history for older messages
On Slack, when the stored messages do not fill the page, Agenta SHALL fetch older messages live from `conversations.history`, starting before the oldest stored message. It SHALL make at most one live Slack call per read, and SHALL return a cursor while Slack reports more history, even after a short page. A thread read on Slack SHALL read the thread live from its root with `conversations.replies`, paging with Slack's cursor, and SHALL fall back to the thread's stored messages, with a note that they are partial, when Slack rate-limits or refuses the first page. A rate-limited later page SHALL return the same cursor, so a retry resumes where it stopped. Live messages SHALL be returned and SHALL NOT be stored. A live channel page SHALL list only top-level messages, because Slack's channel history shows thread replies only inside their thread, and the result SHALL say so. When Slack answers with a rate limit, the read SHALL return the stored messages and a note that says Slack limits this app's history reads and when to try again, taken from `Retry-After`.

#### Scenario: Thread longer than one page
- **WHEN** the agent reads a Slack thread with more replies than the limit
- **THEN** Agenta SHALL return the root and the first replies with a cursor, and the next read SHALL return the following replies without repeating or skipping any.

#### Scenario: Several messages in one second
- **WHEN** a Telegram group received several messages in the same second and the agent pages through them
- **THEN** each message SHALL appear exactly once.

#### Scenario: Messages from before the bot joined
- **WHEN** the agent pages past the oldest stored message of a Slack channel
- **THEN** Agenta SHALL return older messages fetched live from Slack.

#### Scenario: Hosted app rate limit
- **WHEN** the hosted Slack app hits Slack's limit of about one history request per minute
- **THEN** the read SHALL return the stored messages with a note such as "Slack limits this app to about one history request per minute. Try again in 40 seconds."

#### Scenario: Thread replies in live channel history
- **WHEN** a live channel page includes the root of a thread
- **THEN** the page SHALL NOT include that thread's replies, and the result SHALL tell the agent to read the thread with its thread ID.

#### Scenario: Stored messages deleted by retention
- **WHEN** retention has deleted a Slack channel's older stored messages
- **THEN** a read that reaches back that far SHALL fetch those messages live from Slack.

### Requirement: Edits and deletions are described honestly
Stored inbox rows SHALL be served as first received. The read result SHALL say that stored messages may not reflect later edits or deletions. Live Slack pages SHALL be served as Slack returns them, with current text and without deleted messages.

#### Scenario: Message edited after it was stored
- **WHEN** a person edits a Slack message that Agenta stored earlier
- **THEN** a read of the stored part SHALL show the original text, and the result SHALL carry the note about edits.

#### Scenario: Message deleted in Slack before the bot joined
- **WHEN** a message was deleted before the bot joined and the agent reads that period live
- **THEN** the deleted message SHALL NOT appear.

### Requirement: Telegram reads stored messages only
On Telegram, a read SHALL return only messages the bot received and Agenta stored. The result SHALL say that Telegram does not let bots read chat history. It SHALL also say that in groups where the bot's privacy mode is on, only messages addressed to the bot are included.

#### Scenario: Agent asks for older Telegram messages
- **WHEN** the agent pages past the oldest stored message of a Telegram group
- **THEN** the read SHALL return no more messages and SHALL say that earlier messages are not available to bots.

### Requirement: Only readable channels
Reading SHALL be limited to channel destinations in the bot's readable list at call time. Direct-message conversations SHALL NOT be readable through this tool.

#### Scenario: Channel not in the readable list
- **WHEN** the admin narrowed reading to #support and the agent reads #finance
- **THEN** Agenta SHALL refuse the read without calling Slack.

#### Scenario: Direct message
- **WHEN** the agent passes an ID that resolves to a direct-message conversation
- **THEN** Agenta SHALL refuse the read.
