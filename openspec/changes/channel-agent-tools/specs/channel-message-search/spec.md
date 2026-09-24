# Channel message search delta

## Purpose

Let a connected agent search the messages Agenta stored from its readable channels, without widening access and with an honest statement of what was searched.

## ADDED Requirements

### Requirement: Search stored messages of readable channels
`search_channel_messages` SHALL search the stored inbox messages of the channels the running agent may read at call time. It SHALL accept a text query, optional channel destination IDs, an inclusive time range, a limit of at most 50, and a cursor. Without destination IDs it SHALL search every readable channel of every bot bound to the agent. Access SHALL be checked when the query runs, not when a message was stored. Search SHALL exclude direct messages, button clicks, and answers consumed by an approval.

#### Scenario: Search everything readable
- **WHEN** the agent searches "refund policy" with no destination IDs
- **THEN** Agenta SHALL search every readable channel of the agent's bots in the project, and no others.

#### Scenario: Channel removed from the readable list
- **WHEN** an admin removes #finance from the readable list after its messages were stored
- **THEN** the next search SHALL NOT return #finance messages.

#### Scenario: Destination from another project
- **WHEN** a search names a destination ID from another project
- **THEN** Agenta SHALL treat it as not found and return no matches from it.

#### Scenario: Direct messages
- **WHEN** a search runs
- **THEN** it SHALL NOT return messages from direct-message conversations.

### Requirement: Search states what it searched
Each search result SHALL state, for each channel it searched, "Searched messages since the bot joined this channel." Search SHALL NOT call Slack or Telegram. Once retention has deleted a channel's older messages, the statement SHALL follow the wording the retention specification defines.

#### Scenario: Message from before the bot joined
- **WHEN** the only match is a Slack message posted before the bot joined
- **THEN** the search SHALL return no match and SHALL state that it searched messages since the bot joined.

#### Scenario: Telegram group
- **WHEN** a searched channel is a Telegram group
- **THEN** the search SHALL cover only messages the bot received there.

### Requirement: Search results
Each result SHALL include the message ID, the channel destination ID and name, the thread ID when there is one, the sender's display name when known, a text excerpt, and the time. Results SHALL be ordered by relevance, then time, then message ID. The cursor SHALL neither skip nor repeat results with equal rank and time. The bot's own posts SHALL NOT be searched in version one.

#### Scenario: Equal timestamps
- **WHEN** several matches share the same rank and timestamp
- **THEN** paging with the cursor SHALL return each exactly once.

#### Scenario: Follow up on a result
- **WHEN** the agent passes a result's thread ID to `read_channel_messages`
- **THEN** Agenta SHALL return that thread.

#### Scenario: Sender name unknown
- **WHEN** Agenta holds only a provider user ID for a sender
- **THEN** the result SHALL omit the name and SHALL NOT show the raw ID.

### Requirement: Lexical search in PostgreSQL
Version one SHALL use a PostgreSQL full-text index over the stored message text. It SHALL NOT need an embedding model, a vector store, a Slack user token, or any extra credential.

#### Scenario: Self-hosted deployment
- **WHEN** an agent searches on a self-hosted deployment with no embedding provider
- **THEN** the search SHALL run and return lexical matches.
