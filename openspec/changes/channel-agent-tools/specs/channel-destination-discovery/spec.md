# Channel destination discovery delta

## Purpose

Tell a running agent which channels and people it can reach, with opaque IDs and truthful capabilities, on Slack and on Telegram.

## ADDED Requirements

### Requirement: List destinations with opaque IDs
`list_channel_destinations` SHALL return the channels and people the running agent can reach through its bots. Each result SHALL have an opaque `destination_id`, a `type` (`channel` or `person`), the platform, a display name, and the flags `can_post`, `can_read`, `can_search`, and `supports_threads`. Channel results SHALL also say whether their history is backfilled or observed only. Results SHALL NOT contain credentials or raw Slack channel, Slack user, Telegram chat, or Telegram user IDs. The tool SHALL accept an optional type filter, an optional name filter, a limit of at most 100, and a cursor.

#### Scenario: Agent lists its destinations
- **WHEN** a connected agent calls the list tool with no filters
- **THEN** Agenta SHALL return channels and people from every bot bound to that agent in the project, and no others.

#### Scenario: Name filter in a large workspace
- **WHEN** the agent lists people with the query "dana"
- **THEN** Agenta SHALL return only people whose name or handle matches, a page at a time.

#### Scenario: Posting is off but reading is on
- **WHEN** the bot's posting setting is off and its channels are readable
- **THEN** channel results SHALL show `can_post` false and `can_read` true, and no people SHALL be listed.

### Requirement: A destination ID is a reference, not a permission
A destination ID SHALL identify a stored channel or person. Holding one SHALL NOT grant access. Every later call SHALL look it up again inside the caller's project and the running agent's bots and check the current settings.

#### Scenario: ID copied to another agent
- **WHEN** a second agent in the same project uses a destination ID listed for the first agent's bot
- **THEN** Agenta SHALL return not found.

#### Scenario: Channel archived in Slack
- **WHEN** a listed Slack channel is archived before the agent posts to it
- **THEN** the send SHALL fail with a sanitized reason, and later listings SHALL omit that channel.

### Requirement: Slack destinations
On Slack, channel destinations SHALL be the public and private channels the bot is a member of. Group DMs SHALL NOT be listed. Person destinations SHALL be the people in the workspace, excluding bots, deactivated accounts, and Slackbot. Agenta SHALL refresh both lists from Slack on demand, SHALL cache them for a short time, and SHALL NOT call Slack on every list request.

#### Scenario: Bot invited to a private channel
- **WHEN** someone invites the bot to a private channel and the agent lists destinations after the cache expires
- **THEN** that channel SHALL appear as a channel destination.

#### Scenario: Public channel the bot is not in
- **WHEN** a public channel exists but the bot is not a member
- **THEN** it SHALL NOT be listed, because the bot cannot post there.

#### Scenario: Person who never talked to the bot
- **WHEN** a workspace member has never messaged the bot
- **THEN** the member SHALL still be listed as a person destination the agent can message.

### Requirement: Telegram destinations
On Telegram, channel destinations SHALL be the group and supergroup chats that sent the bot an update or were bound to it. Person destinations SHALL be only people who have a private chat with the bot, because a Telegram bot cannot start a conversation with a user. Agenta SHALL NOT claim that any other chat or person exists or can receive a message. The list SHALL explain these limits in a note when it returns Telegram results.

#### Scenario: Person who never messaged the bot
- **WHEN** a Telegram user wrote in a group but never opened a private chat with the bot
- **THEN** that user SHALL NOT be listed as a person destination.

#### Scenario: Person who wrote first
- **WHEN** a Telegram user sent the bot a private message
- **THEN** that user SHALL be listed as a person destination.

#### Scenario: Group the bot joined silently
- **WHEN** the bot was added to a group that has not sent it any update Agenta received
- **THEN** that group SHALL NOT be listed.

#### Scenario: Hosted Telegram bot
- **WHEN** the project uses the shared Agenta Telegram bot
- **THEN** only chats bound to this project SHALL be listed.
