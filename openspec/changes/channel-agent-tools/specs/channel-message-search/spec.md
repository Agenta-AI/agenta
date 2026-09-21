# Channel message search delta

## Purpose

Let connected agents retrieve permitted channel knowledge with explicit source coverage and without widening access to private conversations.

## ADDED Requirements

### Requirement: Permission-aware message search
`search_channel_messages` SHALL search only active destinations for which the running agent currently has search permission. The service SHALL apply project, deployment, connection, destination, and grant checks at query time. Search results SHALL NOT rely on permissions captured only when a message was indexed.

#### Scenario: Search across allowed destinations
- **WHEN** an agent searches without naming destinations
- **THEN** Agenta SHALL search only that agent's currently permitted destinations in the authenticated project.

#### Scenario: Search grant is revoked after indexing
- **WHEN** an editor removes search permission from a destination that still has indexed messages
- **THEN** later searches SHALL exclude those messages without waiting for index deletion.

#### Scenario: Destination token belongs to another tenant
- **WHEN** a query includes an opaque destination token from another project
- **THEN** Agenta SHALL refuse or omit it without revealing matching messages or destination metadata.

### Requirement: Search inputs and results
The search tool SHALL accept text query, optional opaque destination IDs, optional sender filter, optional inclusive time bounds, optional thread filter, and a bounded result limit. Each result SHALL include an opaque message ID, destination ID, provider, timestamp, sender display data when available, text excerpt, thread reference when available, and a provider permalink only when the caller may access it. Results SHALL use deterministic ordering and cursor pagination.

#### Scenario: Matching messages share a timestamp
- **WHEN** several permitted messages have the same provider timestamp
- **THEN** Agenta SHALL return a stable order and a cursor that neither skips nor repeats them on the next page.

#### Scenario: Sender data is unavailable
- **WHEN** an indexed event contains only a provider sender identifier that Agenta cannot resolve safely
- **THEN** the result SHALL omit display data rather than expose the raw identifier as a trusted identity.

### Requirement: Message lifecycle is reflected
The searchable projection SHALL ingest new permitted provider events and SHALL apply supported message edits and deletions. A deleted message SHALL stop appearing in normal results. Search SHALL distinguish content that Agenta no longer retains from a temporary indexing delay.

#### Scenario: Slack message is edited
- **WHEN** Agenta receives a valid edit event for an indexed Slack message
- **THEN** later searches SHALL use the edited content and retain its stable message identity.

#### Scenario: Slack message is deleted
- **WHEN** Agenta receives a valid deletion event for an indexed Slack message
- **THEN** normal search SHALL no longer return its prior text.

### Requirement: Slack indexing and backfill coverage
Agenta SHALL continuously index supported Slack message events for selected destinations and SHALL offer bounded, rate-limit-aware backfill where the installation has access and scopes. Search SHALL NOT query Slack's full workspace on every tool call. Slack coverage metadata SHALL state the earliest and latest indexed times, whether initial backfill completed, and known gaps or access failures.

#### Scenario: Fresh Slack destination
- **WHEN** an editor first enables search for an authorized Slack channel
- **THEN** Agenta SHALL begin live indexing, request bounded history backfill, and report incomplete coverage until that work settles.

#### Scenario: Slack refuses private-channel history
- **WHEN** the installation lacks membership or scope for backfill
- **THEN** search SHALL retain any lawfully observed events, report the access gap, and SHALL NOT claim complete history.

#### Scenario: Slack rate limits backfill
- **WHEN** Slack returns a retry delay during indexing
- **THEN** Agenta SHALL retain progress, respect that delay, and report incomplete coverage rather than blocking all searches.

### Requirement: Telegram observed-history boundary
Telegram search SHALL include only messages that Agenta lawfully observed and retained after the chat connected. Agenta SHALL NOT claim Telegram provider-history backfill, chat enumeration, or complete pre-connection coverage.

#### Scenario: User asks for older Telegram history
- **WHEN** the requested time range starts before Agenta's first retained event for the bound chat
- **THEN** the result SHALL state that the earlier range is unavailable through the Telegram Bot API.

### Requirement: Search is lexical in the first release
The first release SHALL provide text and metadata search. It SHALL NOT require embedding generation, semantic similarity, or an external vector service. Search behavior SHALL remain usable on a self-hosted deployment without an additional model credential.

#### Scenario: Self-hosted deployment has no embedding provider
- **WHEN** an authorized agent searches indexed messages
- **THEN** Agenta SHALL execute lexical search without requesting an embedding credential.
