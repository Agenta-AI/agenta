# Channel destination discovery delta

## Purpose

Tell a running agent where it can post, with opaque IDs and truthful capabilities, on Slack and on Telegram.

## ADDED Requirements

### Requirement: List destinations with opaque IDs
`list_channel_destinations` SHALL return the destinations the running agent can reach through its bots. Each result SHALL have an opaque `destination_id`, a `type`, the platform, a display name, and the flags `can_post`, `can_read`, `can_search`, and `supports_threads`. Results SHALL NOT contain credentials or raw Slack or Telegram IDs. The tool SHALL accept an optional type filter, an optional name filter, a limit of at most 100, and a cursor.

#### Scenario: Agent lists its destinations
- **WHEN** a connected agent calls the list tool with no filters
- **THEN** Agenta SHALL return destinations from every bot bound to that agent in the project, and no others.

#### Scenario: Name filter
- **WHEN** the agent lists destinations with the query "release"
- **THEN** Agenta SHALL return only destinations whose name matches, a page at a time.

#### Scenario: Posting is off but reading is on
- **WHEN** the bot's posting setting is off and its channels are readable
- **THEN** channel results SHALL show `can_post` false and `can_read` true.

### Requirement: A destination ID is a reference, not a permission
A destination ID SHALL identify a stored destination. Holding one SHALL NOT grant access. Every later call SHALL look it up again inside the caller's project and the running agent's bots and check the current settings.

#### Scenario: ID copied to another agent
- **WHEN** a second agent in the same project uses a destination ID listed for the first agent's bot
- **THEN** Agenta SHALL return not found.

#### Scenario: Channel archived in Slack
- **WHEN** a listed Slack channel is archived before the agent posts to it
- **THEN** the send SHALL fail with a sanitized reason, and later listings SHALL omit that channel.

### Requirement: Slack channel destinations
On Slack, channel destinations SHALL be the public and private channels the bot is a member of. Group DMs and direct messages SHALL NOT be listed as channels. Agenta SHALL refresh the list from Slack on demand, SHALL cache it for a short time, and SHALL NOT call Slack on every list request.

#### Scenario: Bot invited to a private channel
- **WHEN** someone invites the bot to a private channel and the agent lists destinations after the cache expires
- **THEN** that channel SHALL appear as a channel destination.

#### Scenario: Public channel the bot is not in
- **WHEN** a public channel exists but the bot is not a member
- **THEN** it SHALL NOT be listed, because the bot cannot post there.

### Requirement: Telegram channel destinations
On Telegram, channel destinations SHALL be the group and supergroup chats that sent the bot an update or were bound to it, because a Telegram bot cannot list the chats it is in. Agenta SHALL NOT claim that any other chat exists or can receive a message. The list SHALL explain this limit in a note when it returns Telegram results.

#### Scenario: Group the bot joined silently
- **WHEN** the bot was added to a group that has not sent it any update Agenta received
- **THEN** that group SHALL NOT be listed.

#### Scenario: Hosted Telegram bot
- **WHEN** the project uses the shared Agenta Telegram bot
- **THEN** only chats bound to this project SHALL be listed.

### Requirement: Person destinations
Pending decision: Mahmoud has not yet decided whether direct messages to people are in version one. If they are left out, this requirement is removed and the list SHALL return channel destinations only. If they stay, the list SHALL also return person destinations while the bot's posting and direct-message settings are both on. On Slack, person destinations SHALL be the people in the workspace, excluding bots, deactivated accounts, and Slackbot. On Telegram, they SHALL be only people who have a private chat with the bot, because a Telegram bot cannot start a conversation.

#### Scenario: Slack member who never talked to the bot
- **WHEN** direct messages are in scope and a Slack member has never messaged the bot
- **THEN** the member SHALL be listed as a person destination.

#### Scenario: Telegram user who never messaged the bot
- **WHEN** direct messages are in scope and a Telegram user never opened a private chat with the bot
- **THEN** that user SHALL NOT be listed.

#### Scenario: Direct messages switched off
- **WHEN** the bot's direct-message setting is off
- **THEN** no person destination SHALL be listed.
