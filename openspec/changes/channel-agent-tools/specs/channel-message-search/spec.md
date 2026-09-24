# Channel message search delta

## Purpose

Let a connected agent search what its readable channels said, without widening access and with honest coverage.

## ADDED Requirements

### Requirement: Search readable channels
`search_channel_messages` SHALL search the local message history of the channels the running agent may read at call time. It SHALL accept a text query and optional channel destination IDs, a sender (a person destination ID), an inclusive time range, a limit of at most 50, and a cursor. Without destination IDs it SHALL search every readable channel of every bot bound to the agent. Access SHALL be checked when the query runs, not when a message was stored.

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

### Requirement: Search results
Each result SHALL include the message ID, the channel destination ID and name, the thread ID when there is one, the sender's display name, a text excerpt, and the time. Results SHALL be ordered by relevance, then time, then message ID, and the cursor SHALL neither skip nor repeat results with equal rank and time. The response SHALL include coverage for each channel it searched.

#### Scenario: Equal timestamps
- **WHEN** several matches share the same rank and timestamp
- **THEN** paging with the cursor SHALL return each exactly once.

#### Scenario: Follow up on a result
- **WHEN** the agent passes a result's thread ID to `read_channel_messages`
- **THEN** Agenta SHALL return that thread.

#### Scenario: Sender name unknown
- **WHEN** Agenta cannot resolve a sender's display name
- **THEN** the result SHALL omit the name and SHALL NOT show the raw provider user ID.

### Requirement: Search covers only stored history
Search SHALL use only Agenta's local history. It SHALL NOT call the provider's search API. Slack results SHALL cover what backfill and live events stored. Telegram results SHALL cover only observed messages. Each response SHALL say so through its coverage.

#### Scenario: Slack channel with partial backfill
- **WHEN** a searched Slack channel's backfill is partial
- **THEN** the coverage for that channel SHALL say `partial` and give the oldest time covered.

#### Scenario: Telegram group
- **WHEN** a searched channel is a Telegram group
- **THEN** its coverage SHALL say `observed_only`.

### Requirement: Lexical search in version one
Version one SHALL provide text search in PostgreSQL. It SHALL NOT need an embedding model, a vector store, or any extra credential, so it works on a self-hosted deployment as installed.

#### Scenario: Self-hosted deployment
- **WHEN** an agent searches on a self-hosted deployment with no embedding provider
- **THEN** the search SHALL run and return lexical matches.
